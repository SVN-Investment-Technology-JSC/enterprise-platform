import type { Pool, PoolClient } from 'pg';
import { distanceMeters } from '../domain/attendance-calculation.js';
import type { AttendanceSiteRow } from './hrm-attendance-site-resolve.js';
import { matchesIpRules } from './hrm-network.js';

type Db = Pick<PoolClient, 'query'> | Pool;

/**
 * Cài đặt kiểm tra vị trí khi chấm công của tenant (bảng `attendance_settings`, migration 0071). Thay cho cờ
 * requireGps/requireIp nằm trong phiên bản chính sách theo ngày: vị trí được kiểm theo địa điểm GPS (kèm IP của địa điểm
 * nếu khai báo), địa điểm gán cho phòng ban có kế thừa.
 */
export interface AttendanceLocationSettings {
  locationCheck: boolean;
  maxGpsAccuracyMeters: number;
  /** Tenant cũ chỉ kiểm IP: chưa chuyển sang địa điểm nên vẫn dùng cấu hình trong chính sách. */
  legacyPolicy: boolean;
}

/** Quy tắc vị trí đang hiệu lực cho một lượt chấm công. */
export interface LocationRule {
  /** `SITES`: kiểm theo địa điểm được gán; `POLICY`: cờ trong chính sách chấm công (tenant chưa chuyển). */
  source: 'SITES' | 'POLICY';
  requireGps: boolean;
  requireIp: boolean;
  maxGpsAccuracyMeters: number;
}

/** Đọc cài đặt; `null` khi chưa chạy migration hoặc tenant chưa có dòng nào (dùng chính sách như trước). */
export async function loadAttendanceLocationSettings(db: Db, tenantId: string): Promise<AttendanceLocationSettings | null> {
  const ready = await db.query(`SELECT to_regclass('hrm_schema.attendance_settings') IS NOT NULL AS ok`);
  if (ready.rows[0]?.ok !== true) return null;
  const res = await db.query(
    `SELECT location_check, max_gps_accuracy_meters, legacy_policy FROM hrm_schema.attendance_settings WHERE tenant_id=$1`,
    [tenantId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    locationCheck: row.location_check === true,
    maxGpsAccuracyMeters: Number(row.max_gps_accuracy_meters) || 100,
    legacyPolicy: row.legacy_policy === true,
  };
}

/** Quy tắc vị trí: theo cài đặt mới khi có, ngược lại theo cờ trong chính sách chấm công. */
export function effectiveLocationRule(
  settings: AttendanceLocationSettings | null,
  policyConfig: Record<string, unknown>,
): LocationRule {
  if (settings && !settings.legacyPolicy) {
    return {
      source: 'SITES',
      requireGps: settings.locationCheck,
      requireIp: false,
      maxGpsAccuracyMeters: settings.maxGpsAccuracyMeters,
    };
  }
  return {
    source: 'POLICY',
    requireGps: policyConfig.requireGps === true,
    requireIp: policyConfig.requireIp === true,
    maxGpsAccuracyMeters: Number(policyConfig.maxGpsAccuracyMeters) || 100,
  };
}

export type SiteMatch =
  | { ok: true; site: AttendanceSiteRow }
  | { ok: false; reason: 'OUTSIDE'; nearest: { site: AttendanceSiteRow; distance: number } | null }
  | { ok: false; reason: 'IP'; site: AttendanceSiteRow; distance: number };

/**
 * Chọn địa điểm mà lượt chấm công thoả: trong bán kính VÀ, nếu địa điểm khai báo IP, đúng IP của địa điểm đó (đạt cả hai).
 * Không địa điểm nào thoả thì báo nguyên nhân gần nhất: ngoài bán kính, hoặc đúng vị trí nhưng sai IP.
 */
export function matchAttendanceSite(
  sites: readonly AttendanceSiteRow[],
  fix: { latitude: number; longitude: number },
  ip: string,
): SiteMatch {
  const measured = sites.map((site) => ({
    site,
    distance: distanceMeters(fix, { latitude: Number(site.latitude), longitude: Number(site.longitude) }),
  }));
  const inRadius = measured.filter((m) => m.distance <= Number(m.site.radius_meters));
  const ipRules = (s: AttendanceSiteRow) => (Array.isArray(s.allowed_ips) ? s.allowed_ips : []);
  const passed = inRadius.find((m) => ipRules(m.site).length === 0 || matchesIpRules(ip, ipRules(m.site)));
  if (passed) return { ok: true, site: passed.site };
  if (inRadius.length > 0) {
    const nearest = [...inRadius].sort((a, b) => a.distance - b.distance)[0];
    return { ok: false, reason: 'IP', site: nearest.site, distance: nearest.distance };
  }
  const nearest = [...measured].sort((a, b) => a.distance - b.distance)[0];
  return { ok: false, reason: 'OUTSIDE', nearest: nearest ?? null };
}
