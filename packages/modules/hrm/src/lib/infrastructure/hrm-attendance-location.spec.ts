import { BadRequestException } from '@nestjs/common';
import type { AttendanceSiteRow } from './hrm-attendance-site-resolve.js';
import {
  effectiveLocationRule,
  loadAttendanceLocationSettings,
  matchAttendanceSite,
} from './hrm-attendance-location.js';
import { parseSiteIps } from './hrm-network.js';

const site = (id: string, latitude: number, longitude: number, radius: number, ips: string[] = []): AttendanceSiteRow => ({
  id,
  tenant_id: 't',
  name: `VP ${id}`,
  latitude,
  longitude,
  radius_meters: radius,
  active: true,
  allowed_ips: ips,
});

// ~0,0009 độ vĩ ≈ 100 m.
const HQ = site('hq', 10.0, 106.0, 150, ['203.0.113.0/24']);
const BRANCH = site('br', 10.5, 106.5, 150);

describe('effectiveLocationRule', () => {
  it('chưa có cài đặt thì theo cờ trong chính sách như trước', () => {
    expect(effectiveLocationRule(null, { requireGps: true, requireIp: true, maxGpsAccuracyMeters: 50 })).toEqual({
      source: 'POLICY',
      requireGps: true,
      requireIp: true,
      maxGpsAccuracyMeters: 50,
    });
    expect(effectiveLocationRule(null, {})).toMatchObject({ requireGps: false, requireIp: false, maxGpsAccuracyMeters: 100 });
  });

  it('có cài đặt mới thì bỏ qua cờ cũ trong chính sách', () => {
    expect(
      effectiveLocationRule(
        { locationCheck: true, maxGpsAccuracyMeters: 30, legacyPolicy: false },
        { requireGps: false, requireIp: true },
      ),
    ).toEqual({ source: 'SITES', requireGps: true, requireIp: false, maxGpsAccuracyMeters: 30 });
    expect(
      effectiveLocationRule({ locationCheck: false, maxGpsAccuracyMeters: 100, legacyPolicy: false }, { requireGps: true }),
    ).toMatchObject({ source: 'SITES', requireGps: false });
  });

  it('tenant cũ chỉ kiểm IP vẫn theo chính sách cho tới khi khai báo GPS', () => {
    expect(
      effectiveLocationRule({ locationCheck: false, maxGpsAccuracyMeters: 100, legacyPolicy: true }, { requireIp: true }),
    ).toMatchObject({ source: 'POLICY', requireIp: true, requireGps: false });
  });
});

describe('matchAttendanceSite - phải đạt cả vị trí lẫn IP của địa điểm', () => {
  const at = { latitude: 10.0005, longitude: 106.0 };

  it('trong bán kính và đúng IP của địa điểm thì hợp lệ', () => {
    const match = matchAttendanceSite([HQ, BRANCH], at, '203.0.113.7');
    expect(match).toMatchObject({ ok: true, site: { id: 'hq' } });
  });

  it('địa điểm không khai báo IP thì chỉ cần đúng vị trí', () => {
    const match = matchAttendanceSite([BRANCH], { latitude: 10.5, longitude: 106.5 }, '198.51.100.9');
    expect(match).toMatchObject({ ok: true, site: { id: 'br' } });
  });

  it('đúng vị trí nhưng sai IP thì báo sai IP, không cho qua', () => {
    const match = matchAttendanceSite([HQ], at, '198.51.100.9');
    expect(match).toMatchObject({ ok: false, reason: 'IP', site: { id: 'hq' } });
  });

  it('đúng IP nhưng ngoài bán kính thì báo ngoài bán kính kèm địa điểm gần nhất', () => {
    const match = matchAttendanceSite([HQ, BRANCH], { latitude: 10.2, longitude: 106.2 }, '203.0.113.7');
    expect(match.ok).toBe(false);
    if (!match.ok && match.reason === 'OUTSIDE') {
      expect(match.nearest?.site.id).toBe('hq');
      expect(match.nearest?.distance).toBeGreaterThan(150);
    }
  });

  it('nhiều địa điểm chồng nhau: chọn địa điểm thoả cả hai điều kiện', () => {
    const near = site('near', 10.0, 106.0, 150, ['198.51.100.0/24']);
    const match = matchAttendanceSite([near, HQ], at, '203.0.113.7');
    expect(match).toMatchObject({ ok: true, site: { id: 'hq' } });
  });

  it('không có địa điểm nào thì báo ngoài bán kính không kèm địa điểm gần nhất', () => {
    expect(matchAttendanceSite([], at, '203.0.113.7')).toEqual({ ok: false, reason: 'OUTSIDE', nearest: null });
  });
});

describe('loadAttendanceLocationSettings', () => {
  const db = (rows: Record<string, unknown>[][]) => {
    const queue = [...rows];
    return { query: jest.fn(async () => ({ rows: queue.shift() ?? [] })) } as never;
  };

  it('chưa chạy migration hoặc tenant chưa có dòng thì trả null', async () => {
    expect(await loadAttendanceLocationSettings(db([[{ ok: false }]]), 't')).toBeNull();
    expect(await loadAttendanceLocationSettings(db([[{ ok: true }], []]), 't')).toBeNull();
  });

  it('đọc đúng các cột', async () => {
    const settings = await loadAttendanceLocationSettings(
      db([[{ ok: true }], [{ location_check: true, max_gps_accuracy_meters: 40, legacy_policy: false }]]),
      't',
    );
    expect(settings).toEqual({ locationCheck: true, maxGpsAccuracyMeters: 40, legacyPolicy: false });
  });
});

describe('parseSiteIps', () => {
  it('bỏ ô trống và trùng, chấp nhận IP và CIDR', () => {
    expect(parseSiteIps([' 203.0.113.5 ', '', '203.0.113.5', '10.0.0.0/8'])).toEqual(['203.0.113.5', '10.0.0.0/8']);
    expect(parseSiteIps(undefined)).toEqual([]);
  });

  it('từ chối IP sai và quá 50 mục', () => {
    expect(() => parseSiteIps(['abc'])).toThrow(BadRequestException);
    expect(() => parseSiteIps(['10.0.0.0/99'])).toThrow(BadRequestException);
    expect(() => parseSiteIps('203.0.113.5')).toThrow(BadRequestException);
    expect(() => parseSiteIps(Array.from({ length: 51 }, (_, i) => `10.0.0.${i}`))).toThrow(/50/);
  });
});
