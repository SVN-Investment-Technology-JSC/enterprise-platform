import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { isIP } from 'node:net';
import type { Request } from 'express';
import type { Pool } from 'pg';
import { distanceMeters } from '../domain/attendance-calculation.js';
import { hrmTransaction } from './hrm-transaction.js';
import {
  assertOpenDate,
  lockEmployee,
  recalculateAttendance,
  timeContext,
} from './hrm-time.js';
import { requireText, requireUuid } from './hrm-validation.js';
import { matchesIpRules } from './hrm-network.js';

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
      const allowedIps = Array.isArray(config.allowedIps)
        ? config.allowedIps
        : [];
      if (config.requireIp === true && !matchesIpRules(ip, allowedIps))
        throw new ForbiddenException(
          'Địa chỉ IP không thuộc danh sách cho phép',
        );
      if (config.requireGps === true) {
        const { latitude, longitude, accuracy } = input;
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
          accuracy > Number(config.maxGpsAccuracyMeters || 100)
        )
          throw new BadRequestException(
            typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > 0
              ? `Cần vị trí GPS có độ chính xác phù hợp (hiện ±${Math.round(accuracy)} m, cho phép tối đa ${Number(config.maxGpsAccuracyMeters || 100)} m)`
              : 'Cần vị trí GPS có độ chính xác phù hợp',
          );
        const sites = await db.query(
          `SELECT * FROM hrm_schema.attendance_sites WHERE tenant_id=$1 AND active=true`,
          [tenantId],
        );
        const distanceTo = (s: { latitude: unknown; longitude: unknown }) =>
          distanceMeters(
            { latitude, longitude },
            { latitude: Number(s.latitude), longitude: Number(s.longitude) },
          );
        const site = sites.rows.find((s) => distanceTo(s) <= Number(s.radius_meters));
        if (!site) {
          // Báo khoảng cách tới địa điểm gần nhất để người chấm công biết cần đi gần thêm hay vị trí đo bị lệch.
          const nearest = sites.rows
            .map((s) => ({ s, d: distanceTo(s) }))
            .sort((a, b) => a.d - b.d)[0];
          throw new ForbiddenException(
            nearest
              ? `Vị trí ngoài bán kính chấm công: cách "${nearest.s.name}" khoảng ${Math.round(nearest.d)} m (cho phép ${Number(nearest.s.radius_meters)} m), sai số vị trí ±${Math.round(accuracy)} m`
              : 'Vị trí ngoài bán kính chấm công: chưa có địa điểm chấm công nào đang hoạt động',
          );
        }
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
