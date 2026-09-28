import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import {
  deviceTokenHash,
  requestDeviceToken,
} from '../infrastructure/hrm-attendance-ingest.js';
import {
  assertOpenDate,
  assertOpenRange,
  lockEmployee,
} from '../infrastructure/hrm-time.js';
import {
  requireDate,
  requireText,
  requireUuid,
} from '../infrastructure/hrm-validation.js';

@Controller('v1/time-settings')
export class HrmTimeSettingsController {
  constructor(private readonly ctx: HrmContextService) {}

  @Get()
  async get(@Req() req: Request) {
    const context = await this.ctx.getContext(req, 'hrm.read');
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      this.ctx.has(context, 'hrm.time.configure')
        ? 'hrm.time.configure'
        : 'hrm.device.manage',
    );
    const [calendar, sites, devices, versions] = await Promise.all([
      pool.query(
        `SELECT * FROM hrm_schema.work_calendar WHERE tenant_id=$1 ORDER BY work_date DESC LIMIT 730`,
        [tenantId],
      ),
      pool.query(
        `SELECT * FROM hrm_schema.attendance_sites WHERE tenant_id=$1 ORDER BY name`,
        [tenantId],
      ),
      pool.query(
        `SELECT d.id,d.employee_id,e.full_name,d.name,d.status,d.created_at FROM hrm_schema.attendance_devices d JOIN hrm_schema.employee_directory e ON e.tenant_id=d.tenant_id AND e.employee_id=d.employee_id WHERE d.tenant_id=$1 ORDER BY d.created_at DESC`,
        [tenantId],
      ),
      pool.query(
        `SELECT v.* FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id WHERE p.tenant_id=$1 AND p.code='ATTENDANCE_DEFAULT' ORDER BY v.effective_from DESC`,
        [tenantId],
      ),
    ]);
    return {
      data: {
        calendar: calendar.rows,
        sites: sites.rows,
        devices: devices.rows,
        versions: versions.rows,
      },
    };
  }

  @Post('policy')
  async policy(
    @Req() req: Request,
    @Body()
    body: {
      effectiveFrom: string;
      timezone: string;
      requireIp: boolean;
      allowedIps: string[];
      requireGps: boolean;
      maxGpsAccuracyMeters: number;
      requireDevice: boolean;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.time.configure',
    );
    const date = requireDate(body.effectiveFrom, 'effectiveFrom');
    try {
      new Intl.DateTimeFormat('en', { timeZone: body.timezone });
    } catch {
      throw new BadRequestException('Múi giờ không hợp lệ');
    }
    if (
      !body.timezone ||
      !Array.isArray(body.allowedIps) ||
      body.allowedIps.some((ip) => typeof ip !== 'string' || !isIP(ip))
    )
      throw new BadRequestException('Danh sách IP không hợp lệ');
    if (body.requireIp && !body.allowedIps.length)
      throw new BadRequestException('Cần ít nhất một IP cho phép');
    if (
      !Number.isFinite(body.maxGpsAccuracyMeters) ||
      body.maxGpsAccuracyMeters < 1 ||
      body.maxGpsAccuracyMeters > 1000
    )
      throw new BadRequestException('Độ chính xác GPS phải từ 1 đến 1000 m');
    for (const flag of [body.requireIp, body.requireGps, body.requireDevice])
      if (typeof flag !== 'boolean')
        throw new BadRequestException('Thiếu điều kiện kiểm soát chấm công');
    return hrmTransaction(pool, async (db) => {
      await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `hrm-policy:${tenantId}:ATTENDANCE`,
      ]);
      await assertOpenRange(db, tenantId, date);
      const policy = await db.query(
        `INSERT INTO hrm_schema.policies (tenant_id,code,name,policy_type,created_by) VALUES ($1,'ATTENDANCE_DEFAULT','Quy định chấm công','ATTENDANCE',$2)
        ON CONFLICT (tenant_id,code) DO UPDATE SET updated_at=now() RETURNING id`,
        [tenantId, principal.userId],
      );
      const id = policy.rows[0].id;
      const existing = await db.query(
        `SELECT id FROM hrm_schema.policy_versions WHERE policy_id=$1 AND effective_from >= $2::date`,
        [id, date],
      );
      if (existing.rowCount)
        throw new BadRequestException(
          'Ngày hiệu lực phải sau phiên bản đã lưu gần nhất',
        );
      await db.query(
        `UPDATE hrm_schema.policy_versions SET effective_to=$2::date-1,status='SUPERSEDED' WHERE policy_id=$1 AND effective_to IS NULL`,
        [id, date],
      );
      const result = await db.query(
        `INSERT INTO hrm_schema.policy_versions (policy_id,version_no,effective_from,config_json,status,created_by)
        SELECT $1,COALESCE(max(version_no),0)+1,$2,$3,'ACTIVE',$4 FROM hrm_schema.policy_versions WHERE policy_id=$1 RETURNING *`,
        [id, date, JSON.stringify(body), principal.userId],
      );
      return { data: result.rows[0] };
    });
  }

  @Post('calendar')
  async calendar(
    @Req() req: Request,
    @Body() body: { date: string; kind: string; name: string; paid: boolean },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.time.configure',
    );
    requireDate(body.date, 'date');
    requireText(body.name, 'name', 180);
    if (
      !['WORK', 'OFF', 'HOLIDAY'].includes(body.kind) ||
      typeof body.paid !== 'boolean'
    )
      throw new BadRequestException(
        'Loại ngày hoặc quy định hưởng lương không hợp lệ',
      );
    return hrmTransaction(pool, async (db) => {
      await assertOpenDate(db, tenantId, body.date);
      const result = await db.query(
        `INSERT INTO hrm_schema.work_calendar (tenant_id,work_date,day_kind,name,paid,created_by) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (tenant_id,work_date) DO UPDATE SET day_kind=EXCLUDED.day_kind,name=EXCLUDED.name,paid=EXCLUDED.paid RETURNING *`,
        [
          tenantId,
          body.date,
          body.kind,
          body.name,
          body.paid,
          principal.userId,
        ],
      );
      return { data: result.rows[0] };
    });
  }

  @Post('sites')
  async site(
    @Req() req: Request,
    @Body()
    body: {
      name: string;
      latitude: number;
      longitude: number;
      radiusMeters: number;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.time.configure',
    );
    requireText(body.name, 'name', 180);
    if (
      !Number.isFinite(body.latitude) ||
      Math.abs(body.latitude) > 90 ||
      !Number.isFinite(body.longitude) ||
      Math.abs(body.longitude) > 180 ||
      !Number.isInteger(body.radiusMeters) ||
      body.radiusMeters < 1 ||
      body.radiusMeters > 100000
    )
      throw new BadRequestException('Tọa độ hoặc bán kính không hợp lệ');
    const result = await pool.query(
      `INSERT INTO hrm_schema.attendance_sites (tenant_id,name,latitude,longitude,radius_meters,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        tenantId,
        body.name,
        body.latitude,
        body.longitude,
        body.radiusMeters,
        principal.userId,
      ],
    );
    return { data: result.rows[0] };
  }

  @Post('devices/register')
  async register(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { name: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.self.attendance',
    );
    const { employeeId } = await this.ctx.resolveEmployee(
      pool,
      tenantId,
      principal.userId,
    );
    requireText(body.name, 'name', 180);
    const token = requestDeviceToken(req) || randomBytes(32).toString('hex');
    const result = await hrmTransaction(pool, async (db) => {
      await lockEmployee(db, tenantId, employeeId);
      const prior = await db.query(
        `SELECT id,status FROM hrm_schema.attendance_devices WHERE tenant_id=$1 AND employee_id=$2 AND token_hash=$3 AND status<>'REVOKED'`,
        [tenantId, employeeId, deviceTokenHash(token)],
      );
      if (prior.rows[0]) return prior.rows[0];
      const inserted = await db.query(
        `INSERT INTO hrm_schema.attendance_devices (tenant_id,employee_id,token_hash,name) VALUES ($1,$2,$3,$4) RETURNING id,status`,
        [tenantId, employeeId, deviceTokenHash(token), body.name],
      );
      return inserted.rows[0];
    });
    res.cookie('ep_hrm_device', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/hrm',
      maxAge: 365 * 86400000,
    });
    return { data: result };
  }

  @Post('devices/:id/:action')
  async deviceAction(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('action') action: string,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.device.manage',
    );
    requireUuid(id, 'id');
    if (!['approve', 'revoke'].includes(action))
      throw new BadRequestException('Thao tác không hợp lệ');
    return hrmTransaction(pool, async (db) => {
      const device = await db.query(
        `SELECT employee_id,status FROM hrm_schema.attendance_devices WHERE tenant_id=$1 AND id=$2`,
        [tenantId, id],
      );
      if (!device.rows[0])
        throw new NotFoundException('Không tìm thấy thiết bị');
      await lockEmployee(db, tenantId, device.rows[0].employee_id);
      const latest = await db.query(
        `SELECT status FROM hrm_schema.attendance_devices WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, id],
      );
      if (action === 'approve') {
        if (latest.rows[0].status === 'REVOKED')
          throw new BadRequestException('Thiết bị đã thu hồi phải đăng ký lại');
        await db.query(
          `UPDATE hrm_schema.attendance_devices SET status='REVOKED' WHERE tenant_id=$1 AND employee_id=$2 AND status='ACTIVE' AND id<>$3`,
          [tenantId, device.rows[0].employee_id, id],
        );
      }
      await db.query(
        `UPDATE hrm_schema.attendance_devices SET status=$3,approved_by=$4,approved_at=now() WHERE tenant_id=$1 AND id=$2`,
        [
          tenantId,
          id,
          action === 'approve' ? 'ACTIVE' : 'REVOKED',
          principal.userId,
        ],
      );
      await db.query(
        `INSERT INTO hrm_schema.audit_log (tenant_id,actor_id,action,entity_type,entity_id,detail) VALUES ($1,$2,$3,'ATTENDANCE_DEVICE',$4,'{}')`,
        [tenantId, principal.userId, action, id],
      );
      return {
        data: { id, status: action === 'approve' ? 'ACTIVE' : 'REVOKED' },
      };
    });
  }
}
