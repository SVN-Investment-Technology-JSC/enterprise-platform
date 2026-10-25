import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { isIP } from 'node:net';
import type { Request } from 'express';
import type { Pool } from 'pg';
import { hrmTransaction } from './hrm-transaction.js';
import {
  assertOpenDate,
  lockEmployee,
  recalculateAttendance,
  timeContext,
} from './hrm-time.js';
import { requireText, requireUuid } from './hrm-validation.js';
import { matchesIpRules } from './hrm-network.js';
import { resolveAllowedAttendanceSites } from './hrm-attendance-site-resolve.js';
import {
  effectiveLocationRule,
  loadAttendanceLocationSettings,
  matchAttendanceSite,
} from './hrm-attendance-location.js';

export interface AttendanceEventInput {
  employeeId: string;
  kind: 'IN' | 'OUT';
  occurredAt: string;
  source: string;
  externalEventId: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}
export async function ingestEvent(
  pool: Pool,
  tenantId: string,
  actorId: string,
  input: AttendanceEventInput,
  selfRequest?: Request,
) {
  requireUuid(input.employeeId, 'employeeId');
  requireText(input.externalEventId, 'externalEventId', 180);
  if (!['IN', 'OUT'].includes(input.kind))
    throw new BadRequestException('Loại lượt chấm công phải là IN hoặc OUT');
  if (!['WEB_PORTAL', 'MOBILE_GPS', 'BIOMETRIC_DEVICE'].includes(input.source))
    throw new BadRequestException('Nguồn chấm công không hợp lệ');
  if (
    !Number.isFinite(Date.parse(input.occurredAt)) ||
    Date.parse(input.occurredAt) > Date.now() + 60000
  )
    throw new BadRequestException('Thời điểm chấm công không hợp lệ');
  return hrmTransaction(pool, async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `hrm-event:${tenantId}:${input.source}:${input.externalEventId}`,
    ]);
    await lockEmployee(db, tenantId, input.employeeId);
    const prior = await db.query(
      `SELECT * FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND source=$2 AND external_event_id=$3`,
      [tenantId, input.source, input.externalEventId],
    );
    if (prior.rows[0]) {
      const row = prior.rows[0];
      if (
        row.employee_id !== input.employeeId ||
        row.event_kind !== input.kind ||
        (!selfRequest &&
          new Date(row.occurred_at).toISOString() !==
            new Date(input.occurredAt).toISOString())
      )
        throw new ConflictException('Mã sự kiện đã dùng cho dữ liệu khác');
      const summary = await db.query(
        `SELECT * FROM hrm_schema.attendances WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3`,
        [tenantId, input.employeeId, row.work_date],
      );
      return summary.rows[0];
    }
    const context = await timeContext(
      db,
      tenantId,
      input.employeeId,
      input.occurredAt,
    );
    const employee = (
      await db.query(
        `SELECT employment_status, to_jsonb(p)->>'inactive_from' AS inactive_from
       FROM hrm_schema.employee_profiles p WHERE tenant_id=$1 AND employee_id=$2`,
        [tenantId, input.employeeId],
      )
    ).rows[0];
    if (
      ['RESIGNED', 'TERMINATED'].includes(employee?.employment_status) &&
      (!employee.inactive_from || context.date >= employee.inactive_from)
    ) {
      throw new ConflictException(
        'Không ghi nhận chấm công từ ngày nhân viên ngừng hoạt động.',
      );
    }
    await assertOpenDate(db, tenantId, context.date);
    const config = context.policy?.config_json || {};
    const evidence: Record<string, unknown> = {
      policyVersionId: context.policy?.id || null,
      timezone: context.timezone,
    };
    if (selfRequest) {
      if (!context.shift)
        throw new BadRequestException(
          'Chưa có ca hợp lệ tại thời điểm chấm công',
        );
      // Only trust the socket peer unless an operator has explicitly configured trusted gateway addresses.
      let ip = (selfRequest.socket.remoteAddress || '').replace(/^::ffff:/, '');
      const proxies = (process.env.HRM_TRUSTED_PROXY_IPS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (proxies.includes(ip)) {
        const forwarded = selfRequest.headers['x-forwarded-for'];
        const chain = (typeof forwarded === 'string' ? forwarded : '')
          .split(',')
          .map((s) => s.trim().replace(/^::ffff:/, ''));
        const clientIp = [...chain]
          .reverse()
          .find((address) => !proxies.includes(address));
        if (clientIp && isIP(clientIp)) ip = clientIp;
      }
      evidence.ip = ip;
      // Quy tắc vị trí: theo địa điểm GPS (kèm IP của địa điểm) khi tenant đã chuyển sang cài đặt mới; tenant chưa chuyển thì
      // vẫn theo cờ trong chính sách chấm công như trước.
      const rule = effectiveLocationRule(await loadAttendanceLocationSettings(db, tenantId), config);
      if (rule.requireIp) {
        const allowedIps = Array.isArray(config.allowedIps) ? config.allowedIps : [];
        if (!matchesIpRules(ip, allowedIps))
          throw new ForbiddenException('Địa chỉ IP không thuộc danh sách cho phép');
      }
      if (rule.requireGps) {
        const { latitude, longitude, accuracy } = input;
        const maxAccuracy = rule.maxGpsAccuracyMeters;
        if (
          typeof latitude !== 'number' ||
          !Number.isFinite(latitude) ||
          Math.abs(latitude) > 90 ||
          typeof longitude !== 'number' ||
          !Number.isFinite(longitude) ||
          Math.abs(longitude) > 180 ||
          typeof accuracy !== 'number' ||
          !Number.isFinite(accuracy) ||
          accuracy < 0 ||
          accuracy > maxAccuracy
        )
          throw new BadRequestException(
            typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > 0
              ? `Cần vị trí GPS có độ chính xác phù hợp (hiện ±${Math.round(accuracy)} m, cho phép tối đa ${maxAccuracy} m)`
              : 'Cần vị trí GPS có độ chính xác phù hợp',
          );
        const allowedSites = await resolveAllowedAttendanceSites(db, tenantId, input.employeeId);
        if (!allowedSites.length) {
          throw new ForbiddenException(
            'Bạn chưa được phân công địa điểm làm việc; vui lòng liên hệ bộ phận nhân sự',
          );
        }
        // Cài đặt mới: trong bán kính VÀ đúng IP của địa điểm (nếu có khai báo IP). Chính sách cũ: chỉ xét bán kính, IP đã
        // kiểm ở trên theo danh sách chung.
        const match = matchAttendanceSite(
          rule.source === 'SITES' ? allowedSites : allowedSites.map((s) => ({ ...s, allowed_ips: [] })),
          { latitude, longitude },
          ip,
        );
        if (!match.ok) {
          const siteNames = allowedSites.map((s) => `"${s.name}"`).join(', ');
          if (match.reason === 'IP')
            throw new ForbiddenException(
              `Vị trí hợp lệ tại "${match.site.name}" nhưng địa chỉ IP hiện tại không thuộc danh sách cho phép của địa điểm này`,
            );
          throw new ForbiddenException(
            match.nearest
              ? `Vị trí ngoài bán kính chấm công: cách "${match.nearest.site.name}" khoảng ${Math.round(match.nearest.distance)} m (cho phép ${Number(match.nearest.site.radius_meters)} m), sai số vị trí ±${Math.round(accuracy)} m. Địa điểm được phân công: ${siteNames}`
              : 'Vị trí ngoài bán kính chấm công: không tìm thấy địa điểm được phân công hợp lệ',
          );
        }
        const site = match.site;
        Object.assign(evidence, {
          latitude,
          longitude,
          accuracy,
          siteId: site.id,
          siteSnapshot: { name: site.name, latitude: site.latitude, longitude: site.longitude, radiusMeters: site.radius_meters },
        });
      }
      const last = await db.query(
        `SELECT event_kind FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND voided_by_correction_id IS NULL ORDER BY occurred_at DESC,id DESC LIMIT 1`,
        [tenantId, input.employeeId, context.date],
      );
      if (
        last.rows[0]?.event_kind === input.kind ||
        (!last.rowCount && input.kind === 'OUT')
      )
        throw new ConflictException(
          'Thứ tự lượt vào/ra không hợp lệ; vui lòng tải lại dữ liệu',
        );
    }
    await db.query(
      `INSERT INTO hrm_schema.attendance_events (tenant_id,employee_id,work_date,event_kind,occurred_at,source,external_event_id,evidence,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        tenantId,
        input.employeeId,
        context.date,
        input.kind,
        input.occurredAt,
        input.source,
        input.externalEventId,
        JSON.stringify(evidence),
        actorId,
      ],
    );
    return recalculateAttendance(
      db,
      tenantId,
      input.employeeId,
      context.date,
      context.timezone,
      input.source,
    );
  });
}
