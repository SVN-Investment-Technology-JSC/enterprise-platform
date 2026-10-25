import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Get,
  Patch,
  Put,
  Delete,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SetAttendanceSiteAssignmentsRequest } from '@enterprise-platform/contracts-hrm';
import { parseSiteIps, validIpRule } from '../infrastructure/hrm-network.js';
import {
  effectiveLocationRule,
  loadAttendanceLocationSettings,
} from '../infrastructure/hrm-attendance-location.js';
import {
  assertLifecycleVersion,
  lifecycleAudit,
} from '../infrastructure/hrm-lifecycle.js';
import { isoDate } from '../infrastructure/hrm-time.js';
import { publishPolicyVersion } from '../infrastructure/hrm-policy-versions.js';
import {
  buildHolidayDraft,
  cloneHolidayYear,
  selectHolidaysToSave,
} from '../domain/holiday-calendar.js';
import { HOLIDAY_TEMPLATE_LABEL } from '../domain/holiday-templates.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { hrmTransaction } from '../infrastructure/hrm-transaction.js';
import { assertOpenDate } from '../infrastructure/hrm-time.js';
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
    await this.ctx.getContext(req, 'hrm.read');
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.time.configure',
    );
    const [calendar, sites, versions, siteAssignments, units, locationSettings] = await Promise.all([
      pool.query(
        `SELECT * FROM hrm_schema.work_calendar WHERE tenant_id=$1 ORDER BY work_date DESC LIMIT 730`,
        [tenantId],
      ),
      pool.query(
        `SELECT * FROM hrm_schema.attendance_sites WHERE tenant_id=$1 ORDER BY name`,
        [tenantId],
      ),
      pool.query(
        `SELECT v.*,p.code AS policy_code,p.name AS policy_name FROM hrm_schema.policy_versions v JOIN hrm_schema.policies p ON p.id=v.policy_id WHERE p.tenant_id=$1 AND p.policy_type='ATTENDANCE' ORDER BY v.effective_from DESC,v.version_no DESC`,
        [tenantId],
      ),
      pool.query(
        `SELECT a.*,
           CASE 
             WHEN a.scope_type IN ('UNIT', 'UNIT_EXCLUDE', 'POSITION') THEN n.name
             WHEN a.scope_type = 'EMPLOYEE' THEN e.full_name
             ELSE 'Toàn công ty'
           END as scope_name
         FROM hrm_schema.attendance_site_assignments a
         LEFT JOIN core_schema.organization_nodes n ON n.id = a.scope_id AND a.scope_type IN ('UNIT', 'UNIT_EXCLUDE', 'POSITION')
         LEFT JOIN core_schema.employees e ON e.id = a.scope_id AND a.scope_type = 'EMPLOYEE'
         WHERE a.tenant_id = $1
         ORDER BY a.created_at`,
        [tenantId],
      ),
      // Đơn vị để gán địa điểm: gán cho đơn vị thì mọi đơn vị con kế thừa.
      pool.query(
        `SELECT id, parent_id, code, name FROM core_schema.organization_nodes
          WHERE deleted_at IS NULL AND category <> 'position' AND status = 'active'
          ORDER BY name`,
      ),
      loadAttendanceLocationSettings(pool, tenantId),
    ]);
    // Chưa có cài đặt riêng thì hiển thị theo cờ trong chính sách đang hiệu lực, đúng như máy chủ đang kiểm.
    const policyNow = versions.rows.find(
      (v) =>
        isoDate(v.effective_from) <= isoDate(new Date()) &&
        (!v.effective_to || isoDate(v.effective_to) >= isoDate(new Date())) &&
        !(Array.isArray(v.config_json?.employeeIds) && v.config_json.employeeIds.length),
    );
    const location = effectiveLocationRule(locationSettings, policyNow?.config_json ?? {});
    const year = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
    }).format(new Date());
    const holidayCount = (
      await pool.query(
        `SELECT count(*)::int AS n FROM hrm_schema.work_calendar WHERE tenant_id=$1 AND day_kind='HOLIDAY' AND work_date>=make_date($2::int,1,1) AND work_date<=make_date($2::int,12,31)`,
        [tenantId, Number(year)],
      )
    ).rows[0].n as number;
    return {
      data: {
        holidayStatus: {
          year: Number(year),
          count: holidayCount,
          missing: holidayCount === 0,
          warning:
            holidayCount === 0
              ? `Năm ${year} chưa có lịch nghỉ lễ - ngày công có thể bị tính sai`
              : null,
          templateLabel: HOLIDAY_TEMPLATE_LABEL,
        },
        calendar: calendar.rows.map((row) => ({
          ...row,
          work_date: isoDate(row.work_date),
        })),
        sites: sites.rows.map((s) => ({
          ...s,
          allowed_ips: Array.isArray(s.allowed_ips) ? s.allowed_ips : [],
          assignments: siteAssignments.rows.filter((a) => a.site_id === s.id),
        })),
        units: units.rows.map((u) => ({ id: u.id, parentId: u.parent_id ?? null, code: u.code, name: u.name })),
        location: {
          locationCheck: location.requireGps,
          maxGpsAccuracyMeters: location.maxGpsAccuracyMeters,
          // Tenant cũ chỉ kiểm IP bằng chính sách: chưa chuyển sang địa điểm.
          legacyPolicy: location.source === 'POLICY' && location.requireIp,
          configured: locationSettings !== null,
        },
        versions: versions.rows.map((row) => ({
          ...row,
          effective_from: isoDate(row.effective_from),
          effective_to: row.effective_to ? isoDate(row.effective_to) : null,
        })),
      },
    };
  }

  @Post('policy')
  async policy(
    @Req() req: Request,
    @Body()
    body: {
      effectiveFrom: string;
      effectiveTo?: string | null;
      employeeIds?: string[];
      reason: string;
      timezone: string;
      requireIp: boolean;
      allowedIps: string[];
      requireGps: boolean;
      maxGpsAccuracyMeters: number;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.time.configure',
    );
    const date = requireDate(body.effectiveFrom, 'effectiveFrom');
    const reason = requireText(body.reason, 'Lý do thay đổi', 2000);
    const effectiveTo = body.effectiveTo
      ? requireDate(body.effectiveTo, 'effectiveTo')
      : null;
    const employeeIds = Array.isArray(body.employeeIds) ? body.employeeIds : [];
    employeeIds.forEach((id) => requireUuid(id, 'employeeIds'));
    try {
      new Intl.DateTimeFormat('en', { timeZone: body.timezone });
    } catch {
      throw new BadRequestException('Múi giờ không hợp lệ');
    }
    if (
      !body.timezone ||
      !Array.isArray(body.allowedIps) ||
      body.allowedIps.some((ip) => !validIpRule(ip))
    )
      throw new BadRequestException('Danh sách IP không hợp lệ');
    if (body.requireIp && !body.allowedIps.length)
      throw new BadRequestException('Cần ít nhất một IP cho phép');
    if (
      !Number.isFinite(body.maxGpsAccuracyMeters) ||
      body.maxGpsAccuracyMeters < 1 ||
      body.maxGpsAccuracyMeters > 1000
    )
      throw new BadRequestException('Dung sai GPS phải từ 1 đến 1000 m');
    for (const flag of [body.requireIp, body.requireGps])
      if (typeof flag !== 'boolean')
        throw new BadRequestException('Thiếu điều kiện kiểm soát chấm công');
    return hrmTransaction(pool, async (db) => {
      const result = await publishPolicyVersion(db, tenantId, 'ATTENDANCE', {
        effectiveFrom: date,
        effectiveTo,
        employeeIds,
        reason,
        actorId: principal.userId,
        defaultCode: 'ATTENDANCE_DEFAULT',
        defaultName: 'Quy định chấm công',
        inherit: true,
        config: {
          timezone: body.timezone,
          requireIp: body.requireIp,
          allowedIps: body.allowedIps,
          requireGps: body.requireGps,
          maxGpsAccuracyMeters: body.maxGpsAccuracyMeters,
        },
      });
      const row = result.version;
      return {
        data: {
          ...row,
          effective_from: isoDate(row.effective_from),
          effective_to: row.effective_to ? isoDate(row.effective_to) : null,
          closed: result.closed,
          warnings: result.warnings,
        },
      };
    });
  }

  // ---- FIX-C-09: holiday calendar by year ---------------------------------
  private async yearDates(
    pool: { query: (sql: string, p: unknown[]) => Promise<{ rows: any[] }> },
    tenantId: string,
    year: number,
  ) {
    return (
      await pool.query(
        `SELECT work_date,day_kind,name,paid FROM hrm_schema.work_calendar WHERE tenant_id=$1 AND work_date>=make_date($2::int,1,1) AND work_date<=make_date($2::int,12,31) ORDER BY work_date`,
        [tenantId, year],
      )
    ).rows.map((r) => ({
      date: isoDate(r.work_date),
      kind: r.day_kind as string,
      name: r.name as string,
      paid: r.paid as boolean,
    }));
  }
  private parseYear(value: unknown) {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      throw new BadRequestException('Năm không hợp lệ (2000-2100)');
    return year;
  }

  @Get('calendar/holiday-draft')
  async holidayDraft(
    @Req() req: Request,
    @Query('year') yearRaw: string,
    @Query('source') source?: string,
  ) {
    const { pool, tenantId } = await this.ctx.getContext(
      req,
      'hrm.time.configure',
    );
    const year = this.parseYear(yearRaw);
    const current = await this.yearDates(pool, tenantId, year);
    const existing = current.map((r) => r.date);
    if (source === 'previous') {
      const previous = (await this.yearDates(pool, tenantId, year - 1)).filter(
        (r) => r.kind === 'HOLIDAY',
      );
      return {
        data: {
          year,
          source: 'previous',
          label: `Nhân bản từ năm ${year - 1} - cần HR xác nhận`,
          items: cloneHolidayYear(previous, year, existing),
        },
      };
    }
    return {
      data: {
        year,
        source: 'template',
        label: HOLIDAY_TEMPLATE_LABEL,
        items: buildHolidayDraft(year, existing),
      },
    };
  }

  @Post('calendar/holiday-draft/confirm')
  async confirmHolidayDraft(
    @Req() req: Request,
    @Body()
    body: {
      year: number;
      items: { date: string | null; name: string; paid: boolean }[];
      reason?: string;
    },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.time.configure',
    );
    const year = this.parseYear(body.year);
    if (!Array.isArray(body.items) || body.items.length > 60)
      throw new BadRequestException('Danh sách ngày lễ không hợp lệ');
    for (const i of body.items) {
      if (i.date) requireDate(i.date, 'date');
      requireText(i.name, 'name', 180);
      if (typeof i.paid !== 'boolean')
        throw new BadRequestException('Thiếu quy định hưởng lương');
    }
    return hrmTransaction(pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `hrm-calendar-year:${tenantId}:${year}`,
      ]);
      const existing = await this.yearDates(db, tenantId, year);
      const { toSave, skipped } = selectHolidaysToSave(
        body.items,
        year,
        existing.map((r) => r.date),
      );
      for (const item of toSave) {
        await assertOpenDate(db, tenantId, item.date);
        await db.query(
          `INSERT INTO hrm_schema.work_calendar (tenant_id,work_date,day_kind,name,paid,created_by) VALUES ($1,$2,'HOLIDAY',$3,$4,$5) ON CONFLICT (tenant_id,work_date) DO NOTHING`,
          [tenantId, item.date, item.name, item.paid, principal.userId],
        );
      }
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'HOLIDAY_YEAR_IMPORTED',
        tenantId,
        { year, saved: toSave, skipped, reason: body.reason ?? null },
      );
      return { data: { year, saved: toSave.length, skipped } };
    });
  }

  @Post('calendar')
  async calendar(
    @Req() req: Request,
    @Body()
    body: {
      date: string;
      kind: string;
      name: string;
      paid: boolean;
      expectedUpdatedAt?: string;
      reason?: string;
    },
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
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'hrm-calendar:' + tenantId + ':' + body.date,
      ]);
      await assertOpenDate(db, tenantId, body.date);
      const before = (
        await db.query(
          'SELECT * FROM hrm_schema.work_calendar WHERE tenant_id=$1 AND work_date=$2 FOR UPDATE',
          [tenantId, body.date],
        )
      ).rows[0];
      if (before) {
        assertLifecycleVersion(before, body.expectedUpdatedAt);
        requireText(body.reason, 'reason', 1000);
      } else if (body.expectedUpdatedAt) {
        throw new ConflictException(
          'Ngày ngoại lệ đã thay đổi hoặc bị xóa. Vui lòng tải lại dữ liệu.',
        );
      }
      const result = await db.query(
        `INSERT INTO hrm_schema.work_calendar (tenant_id,work_date,day_kind,name,paid,created_by) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (tenant_id,work_date) DO UPDATE SET day_kind=EXCLUDED.day_kind,name=EXCLUDED.name,paid=EXCLUDED.paid,updated_at=GREATEST(clock_timestamp(),work_calendar.updated_at+interval '1 millisecond') RETURNING *`,
        [
          tenantId,
          body.date,
          body.kind,
          body.name,
          body.paid,
          principal.userId,
        ],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'CALENDAR_SAVED',
        result.rows[0].id,
        { before, after: result.rows[0], reason: body.reason },
      );
      return {
        data: {
          ...result.rows[0],
          work_date: isoDate(result.rows[0].work_date),
        },
      };
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
      allowedIps?: string[];
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
    const allowedIps = parseSiteIps(body.allowedIps);
    const result = await pool.query(
      `INSERT INTO hrm_schema.attendance_sites (tenant_id,name,latitude,longitude,radius_meters,allowed_ips,created_by) VALUES ($1,$2,$3,$4,$5,$6::text[],$7) RETURNING *`,
      [
        tenantId,
        body.name,
        body.latitude,
        body.longitude,
        body.radiusMeters,
        allowedIps,
        principal.userId,
      ],
    );
    return { data: result.rows[0] };
  }

  @Delete('calendar/:id')
  async deleteCalendar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { expectedUpdatedAt: string; reason: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.time.configure',
    );
    requireUuid(id, 'id');
    requireText(body.reason, 'reason', 1000);
    return hrmTransaction(pool, async (db) => {
      const owner = (
        await db.query(
          'SELECT work_date FROM hrm_schema.work_calendar WHERE tenant_id=$1 AND id=$2',
          [tenantId, id],
        )
      ).rows[0];
      if (!owner) throw new NotFoundException('Không tìm thấy ngày ngoại lệ');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'hrm-calendar:' + tenantId + ':' + isoDate(owner.work_date),
      ]);
      await assertOpenDate(db, tenantId, isoDate(owner.work_date));
      const row = (
        await db.query(
          'SELECT * FROM hrm_schema.work_calendar WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [tenantId, id],
        )
      ).rows[0];
      if (!row) throw new NotFoundException('Không tìm thấy ngày ngoại lệ');
      assertLifecycleVersion(row, body.expectedUpdatedAt);
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'CALENDAR_DELETED',
        id,
        { before: row, reason: body.reason },
      );
      await db.query(
        'DELETE FROM hrm_schema.work_calendar WHERE tenant_id=$1 AND id=$2',
        [tenantId, id],
      );
      return { data: { id, deleted: true } };
    });
  }
  @Patch('sites/:id')
  async updateSite(
    @Req() req: Request,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      latitude?: number;
      longitude?: number;
      radiusMeters?: number;
      allowedIps?: string[];
      expectedUpdatedAt: string;
      reason: string;
    },
  ) {
    return this.mutateSite(req, id, body, false);
  }
  @Post('sites/:id/deactivate')
  async deactivateSite(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { expectedUpdatedAt: string; reason: string },
  ) {
    return this.mutateSite(req, id, body, true);
  }
  private async mutateSite(
    req: Request,
    id: string,
    body: {
      name?: string;
      latitude?: number;
      longitude?: number;
      radiusMeters?: number;
      allowedIps?: string[];
      expectedUpdatedAt: string;
      reason: string;
    },
    deactivate: boolean,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.time.configure',
    );
    requireUuid(id, 'id');
    requireText(body.reason, 'reason', 1000);
    return hrmTransaction(pool, async (db) => {
      const row = (
        await db.query(
          'SELECT * FROM hrm_schema.attendance_sites WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [tenantId, id],
        )
      ).rows[0];
      if (!row) throw new NotFoundException('Không tìm thấy địa điểm');
      assertLifecycleVersion(row, body.expectedUpdatedAt);
      if (!row.active)
        throw new BadRequestException(
          'Địa điểm đã ngừng; tạo địa điểm mới để sử dụng.',
        );
      const name = body.name ?? row.name,
        latitude = body.latitude ?? row.latitude,
        longitude = body.longitude ?? row.longitude,
        radius = body.radiusMeters ?? row.radius_meters;
      const allowedIps = body.allowedIps === undefined ? (row.allowed_ips ?? []) : parseSiteIps(body.allowedIps);
      requireText(name, 'name', 180);
      if (
        !Number.isFinite(latitude) ||
        Math.abs(latitude) > 90 ||
        !Number.isFinite(longitude) ||
        Math.abs(longitude) > 180 ||
        !Number.isInteger(radius) ||
        radius < 1 ||
        radius > 100000
      )
        throw new BadRequestException('Tọa độ hoặc bán kính không hợp lệ');
      const result = await db.query(
        `UPDATE hrm_schema.attendance_sites SET name=$3,latitude=$4,longitude=$5,radius_meters=$6,active=$7,allowed_ips=$8::text[],updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tenantId, id, name, latitude, longitude, radius, !deactivate, allowedIps],
      );
      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        deactivate ? 'SITE_DEACTIVATED' : 'SITE_UPDATED',
        id,
        { before: row, after: result.rows[0], reason: body.reason },
      );
      return { data: result.rows[0] };
    });
  }

  /**
   * Cài đặt kiểm tra vị trí khi chấm công của tenant (thay cho cờ requireGps/requireIp trong phiên bản chính sách):
   * bật thì chấm công phải nằm trong bán kính của một địa điểm được gán (và đúng IP của địa điểm đó nếu có khai báo).
   */
  @Put('location')
  async updateLocation(
    @Req() req: Request,
    @Body() body: { locationCheck: boolean; maxGpsAccuracyMeters: number; reason?: string },
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(req, 'hrm.time.configure');
    if (typeof body.locationCheck !== 'boolean') throw new BadRequestException('Thiếu trạng thái kiểm tra vị trí');
    if (
      !Number.isInteger(body.maxGpsAccuracyMeters) ||
      body.maxGpsAccuracyMeters < 1 ||
      body.maxGpsAccuracyMeters > 1000
    )
      throw new BadRequestException('Dung sai GPS phải là số nguyên từ 1 đến 1000 m');
    return hrmTransaction(pool, async (db) => {
      const ready = await db.query(`SELECT to_regclass('hrm_schema.attendance_settings') IS NOT NULL AS ok`);
      if (ready.rows[0]?.ok !== true)
        throw new BadRequestException('Cơ sở dữ liệu HRM chưa được cập nhật (migration 0071); chạy migration trước');
      if (body.locationCheck) {
        const active = await db.query(
          'SELECT 1 FROM hrm_schema.attendance_sites WHERE tenant_id=$1 AND active=true LIMIT 1',
          [tenantId],
        );
        if (!active.rowCount)
          throw new BadRequestException('Cần ít nhất một địa điểm đang dùng trước khi bật kiểm tra vị trí');
      }
      const before = await loadAttendanceLocationSettings(db, tenantId);
      await db.query(
        `INSERT INTO hrm_schema.attendance_settings (tenant_id, location_check, max_gps_accuracy_meters, legacy_policy, updated_by)
         VALUES ($1,$2,$3,false,$4)
         ON CONFLICT (tenant_id) DO UPDATE
           SET location_check=EXCLUDED.location_check, max_gps_accuracy_meters=EXCLUDED.max_gps_accuracy_meters,
               legacy_policy=false, updated_at=now(), updated_by=EXCLUDED.updated_by`,
        [tenantId, body.locationCheck, body.maxGpsAccuracyMeters, principal.userId],
      );
      await lifecycleAudit(db, tenantId, principal.userId, 'LOCATION_SETTINGS_UPDATED', tenantId, {
        before,
        after: { locationCheck: body.locationCheck, maxGpsAccuracyMeters: body.maxGpsAccuracyMeters },
        reason: body.reason ?? null,
      });
      return { data: { locationCheck: body.locationCheck, maxGpsAccuracyMeters: body.maxGpsAccuracyMeters } };
    });
  }

  @Put('sites/:id/assignments')
  async updateSiteAssignments(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SetAttendanceSiteAssignmentsRequest,
  ) {
    const { pool, tenantId, principal } = await this.ctx.getContext(
      req,
      'hrm.time.configure',
    );
    requireUuid(id, 'id');
    return hrmTransaction(pool, async (db) => {
      const site = (
        await db.query(
          'SELECT * FROM hrm_schema.attendance_sites WHERE tenant_id=$1 AND id=$2',
          [tenantId, id],
        )
      ).rows[0];
      if (!site) throw new NotFoundException('Không tìm thấy địa điểm');

      // Xoá các phân công cũ của địa điểm này
      await db.query(
        'DELETE FROM hrm_schema.attendance_site_assignments WHERE tenant_id=$1 AND site_id=$2',
        [tenantId, id],
      );

      const assignments = Array.isArray(body.assignments) ? body.assignments : [];
      for (const a of assignments) {
        if (!['COMPANY', 'UNIT', 'UNIT_EXCLUDE', 'POSITION', 'EMPLOYEE'].includes(a.scopeType)) {
          throw new BadRequestException('Loại phạm vi không hợp lệ');
        }
        const scopeId = a.scopeType === 'COMPANY' ? tenantId : a.scopeId;
        requireUuid(scopeId, 'scopeId');
        await db.query(
          `INSERT INTO hrm_schema.attendance_site_assignments (tenant_id, site_id, scope_type, scope_id, created_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, site_id, scope_type, scope_id) DO NOTHING`,
          [tenantId, id, a.scopeType, scopeId, principal.userId],
        );
      }

      const refreshed = await db.query(
        `SELECT a.*,
           CASE 
             WHEN a.scope_type IN ('UNIT', 'UNIT_EXCLUDE', 'POSITION') THEN n.name
             WHEN a.scope_type = 'EMPLOYEE' THEN e.full_name
             ELSE 'Toàn công ty'
           END as scope_name
         FROM hrm_schema.attendance_site_assignments a
         LEFT JOIN core_schema.organization_nodes n ON n.id = a.scope_id AND a.scope_type IN ('UNIT', 'UNIT_EXCLUDE', 'POSITION')
         LEFT JOIN core_schema.employees e ON e.id = a.scope_id AND a.scope_type = 'EMPLOYEE'
         WHERE a.tenant_id = $1 AND a.site_id = $2
         ORDER BY a.created_at`,
        [tenantId, id],
      );

      await lifecycleAudit(
        db,
        tenantId,
        principal.userId,
        'SITE_ASSIGNMENTS_UPDATED',
        id,
        { siteName: site.name, assignments: refreshed.rows, reason: body.reason },
      );

      return { data: { siteId: id, assignments: refreshed.rows } };
    });
  }
}

