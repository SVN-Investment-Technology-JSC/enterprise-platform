import { calculateTimesheet } from '../infrastructure/hrm-timesheet-calculation.js';
import { ensureMonthPeriod } from '../infrastructure/hrm-timesheet-month.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import { HrmEmployeeController } from './hrm-employee.controller';
import { HrmShiftController } from './hrm-shift.controller';
import { HrmAttendanceController } from './hrm-attendance.controller';
import { HrmTimeSettingsController } from './hrm-time-settings.controller';
import { shiftForDate } from '../infrastructure/hrm-time';
import type { HrmContextService } from '../infrastructure/hrm-context.service';
import type { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service';
import { submitHrmRequest } from '../infrastructure/hrm-submission';
import { ingestEvent } from '../infrastructure/hrm-attendance-ingest';
jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));
const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;
integration('HRM time lifecycle PostgreSQL integration', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const userId = randomUUID();
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;
  let controller: HrmEmployeeController;
  const req = { headers: {} } as Request;
  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    const migrate = async (path: string) =>
      pool.query(
        await readFile(
          resolve(process.cwd(), '../../../migrations/tenant', path),
          'utf8',
        ),
      );
    for (const path of [
      'core/0001-core-schema.sql',
      'core/0002-organization-soft-delete.sql',
      'core/0006-employees.sql',
      'core/0007-org-hrm-bridge.sql',
      '0001-integration.sql',
      'hrm/0001-hrm.sql',
    ])
      await migrate(path);
    await pool.query(
      `INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1, 'Legacy employee', 'legacy@test.local', 'test-only')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date) VALUES ($1, $2, 'LEGACY', '2026-01-01')`,
      [userId, tenantId],
    );
    await migrate('hrm/0002-employee-identity.sql');
    await migrate('hrm/0002-employee-identity.sql');
    await migrate('hrm/0003-time-operations.sql');
    await migrate('hrm/0003-time-operations.sql');
    await migrate('hrm/0004-leave-operations.sql');
    await migrate('hrm/0005-timesheet-calculation.sql');
    await migrate('hrm/0006-payroll-formulas.sql');
    await migrate('hrm/0007-work-references.sql');
    await migrate('hrm/0008-profile-corrections.sql');
    await migrate('hrm/0009-leave-carryover.sql');
    await migrate('hrm/0010-attachments.sql');
    await migrate('hrm/0011-advance-settlement.sql');
    await migrate('hrm/0012-operations-and-workflow.sql');
    await migrate('hrm/0002-hrm-procedure-integration.sql');
    await migrate('hrm/0003-hrm-requests-enhancement.sql');
    await migrate('hrm/0014-hrm-profile-compatibility.sql');
    await migrate('hrm/0013-payroll-support.sql');
    await migrate('hrm/0015-hrm-procedure-sync.sql');
    await migrate('hrm/0015-procedure-definition-snapshot.sql');
    await migrate('hrm/0015-shift-submission.sql');
    await migrate('hrm/0016-hrm-lifecycle.sql');
    await migrate('hrm/0016-family-contract-lifecycle.sql');
    await migrate('hrm/0016-time-lifecycle.sql');
    await migrate('hrm/0033-leave-annual-policy.sql');
    await migrate('hrm/0051-hrm-leave-settlements-legacy.sql');
    await migrate('hrm/0035-hrm-work-schedules.sql');
    await migrate('hrm/0036-hrm-work-schedule-rules.sql');
    await migrate('hrm/0037-request-reason-catalog.sql');
    await migrate('hrm/0038-request-reason-categories.sql');
    await migrate('hrm/0039-request-catalog-codes.sql');
    await migrate('hrm/0045-hrm-request-reasons.sql');
    await migrate('hrm/0048-hrm-timesheet-payroll-linkage.sql');
    await migrate('hrm/0049-hrm-ot-reason-rate.sql');
    await migrate('hrm/0050-hrm-request-comments.sql');
    await migrate('hrm/0056-hrm-shift-soft-delete.sql');
    await migrate('hrm/0070-hrm-attendance-site-assignments.sql');
    await migrate('hrm/0071-hrm-attendance-location-settings.sql');
    await migrate('hrm/0072-hrm-attendance-site-unit-exclusions.sql');
    await migrate('hrm/0019-timesheet-attachment-lifecycle.sql');
    await migrate('hrm/0046-hrm-timesheet-month-close.sql');
    await migrate('hrm/0085-hrm-shift-punch-block.sql');
    await migrate('hrm/0086-hrm-attendance-site-soft-delete.sql');
    const ctx = {
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
      resolveEmployee: async () => ({ employeeId: userId }),
      getRequestContext: async () => ({
        pool,
        tenantId,
        principal: { userId },
      }),
    };
    controller = new HrmEmployeeController(ctx as unknown as HrmContextService);
  }, 30_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName))
        throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 30_000);

  // Gán ca cho nhân viên theo lịch từng ngày (employee_work_days), thay cho roster cũ.
  const scheduleShift = (
    employeeId: string,
    shiftId: string,
    from: string,
    to: string,
  ) =>
    pool.query(
      `INSERT INTO hrm_schema.employee_work_days (tenant_id,employee_id,work_date,day_type,shift_id,source)
       SELECT $1,$2,d::date,'SHIFT',$3,'MANUAL' FROM generate_series($4::date,$5::date,'1 day') d`,
      [tenantId, employeeId, shiftId, from, to],
    );
  const ctx = () =>
    ({
      has: () => true,
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
    }) as any;
  it('rejects stale edits of unused shifts instead of silently overwriting', async () => {
    const c = new HrmShiftController(ctx());
    const shift = (
      await c.createShift(req, {
        code: 'VERSIONED',
        name: 'Day',
        startTime: '08:00',
        endTime: '17:00',
        breakMinutes: 0,
      })
    ).data;
    const body = { name: 'Changed', expectedUpdatedAt: shift.updatedAt } as any;
    await c.updateShift(req, shift.id, body);
    await expect(c.updateShift(req, shift.id, body)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('resolves overnight shift windows from the work schedule and protects timing of scheduled shifts', async () => {
    const c = new HrmShiftController(ctx());
    const night = (
      await c.createShift(req, {
        code: 'NIGHT8',
        name: 'Night',
        startTime: '22:00',
        endTime: '06:00',
        crossMidnight: true,
        breakMinutes: 0,
      })
    ).data;
    const early = (
      await c.createShift(req, {
        code: 'EARLY8',
        name: 'Early',
        startTime: '05:00',
        endTime: '13:00',
        breakMinutes: 0,
      })
    ).data;
    await scheduleShift(userId, night.id, '2026-04-01', '2026-04-01');
    const db = await pool.connect();
    try {
      const slot = await shiftForDate(
        db,
        tenantId,
        userId,
        '2026-04-01',
        'Asia/Ho_Chi_Minh',
      );
      expect(slot?.window.end).toBe('2026-04-01T23:00:00.000Z');
    } finally {
      db.release();
    }
    await scheduleShift(userId, early.id, '2026-05-01', '2026-05-01');
    await expect(
      c.updateShift(req, early.id, {
        startTime: '04:00',
        expectedUpdatedAt: early.updatedAt,
      } as any),
    ).rejects.toThrow();
  });
  it('accepts configured CIDR, versions sites and protects calendar changes in closed periods', async () => {
    const c = new HrmTimeSettingsController(ctx());
    await c.policy(req, {
      effectiveFrom: '2026-06-01',
      timezone: 'Asia/Ho_Chi_Minh',
      reason: 'Cấu hình chính sách test',
      requireIp: true,
      allowedIps: ['10.20.0.0/16', '2001:db8::/32'],
      requireGps: false,
      maxGpsAccuracyMeters: 100,
    });
    const site = (
      await c.site(req, {
        name: 'Office',
        latitude: 10,
        longitude: 106,
        radiusMeters: 100,
      })
    ).data;
    const edited = (
      await (c as any).updateSite(req, site.id, {
        name: 'Office moved',
        latitude: 11,
        longitude: 107,
        radiusMeters: 150,
        expectedUpdatedAt: new Date(site.updated_at).toISOString(),
        reason: 'Move',
      })
    ).data;
    await expect(
      (c as any).updateSite(req, site.id, {
        radiusMeters: 200,
        expectedUpdatedAt: new Date(site.updated_at).toISOString(),
        reason: 'Stale',
      }),
    ).rejects.toMatchObject({ status: 409 });
    const foreign = new HrmTimeSettingsController({
      getContext: async () => ({
        pool,
        tenantId: randomUUID(),
        principal: { userId },
      }),
    } as any);
    await expect(
      (foreign as any).deactivateSite(req, site.id, {
        expectedUpdatedAt: new Date(edited.updated_at).toISOString(),
        reason: 'Foreign',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await (c as any).deactivateSite(req, site.id, {
      expectedUpdatedAt: new Date(edited.updated_at).toISOString(),
      reason: 'Close',
    });
    const day = (
      await c.calendar(req, {
        date: '2026-06-02',
        name: 'Holiday',
        kind: 'HOLIDAY',
        paid: true,
      })
    ).data;
    expect(day.work_date).toBe('2026-06-02');
    const settings = (await c.get(req)).data;
    expect(settings.calendar.find((row) => row.id === day.id)?.work_date).toBe(
      '2026-06-02',
    );
    expect(settings.versions[0].effective_from).toBe('2026-06-01');
    await expect(
      c.calendar(req, {
        date: '2026-06-03',
        name: 'Stale date',
        kind: 'OFF',
        paid: false,
        expectedUpdatedAt: new Date(day.updated_at).toISOString(),
        reason: 'Wrong date',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await (c as any).deleteCalendar(req, day.id, {
      expectedUpdatedAt: new Date(day.updated_at).toISOString(),
      reason: 'Correct calendar',
    });
    expect(
      (
        await pool.query(
          'SELECT id FROM hrm_schema.work_calendar WHERE id=$1',
          [day.id],
        )
      ).rowCount,
    ).toBe(0);
    await pool.query(
      "INSERT INTO hrm_schema.timesheet_periods(tenant_id,period_code,from_date,to_date,status) VALUES($1,'LOCK8','2026-05-01','2026-05-31','LOCKED') ON CONFLICT DO NOTHING",
      [tenantId],
    );
    await expect(
      c.calendar(req, {
        date: '2026-05-02',
        name: 'Closed',
        kind: 'OFF',
        paid: false,
      }),
    ).rejects.toThrow('đã khóa');
  });
  it('lists each raw punch with tenant scope instead of synthesizing first/last events', async () => {
    const ids = [randomUUID(), randomUUID()];
    for (let i = 0; i < 2; i++)
      await pool.query(
        `INSERT INTO hrm_schema.attendance_events(id,tenant_id,employee_id,work_date,event_kind,occurred_at,source,external_event_id,evidence) VALUES($1,$2,$3,'2026-06-05',$4,$5,'WEB_PORTAL',($1::uuid)::text,'{}')`,
        [
          ids[i],
          tenantId,
          userId,
          i ? 'OUT' : 'IN',
          i ? '2026-06-05T05:00:00Z' : '2026-06-05T01:00:00Z',
        ],
      );
    const c = new HrmAttendanceController(
      { scoped: async () => ({ pool, tenantId, employeeId: userId }) } as any,
      {} as any,
    );
    const result = await (c as any).listEvents(
      req,
      userId,
      '2026-06-01',
      '2026-06-30',
    );
    expect(result.data.map((r: any) => r.id).sort()).toEqual(ids.sort());
    expect(result.data.map((r: any) => r.event_kind)).toEqual(['OUT', 'IN']);
    const foreign = new HrmAttendanceController(
      {
        scoped: async () => ({
          pool,
          tenantId: randomUUID(),
          employeeId: userId,
        }),
      } as any,
      {} as any,
    );
    expect(
      (
        await (foreign as any).listEvents(
          req,
          userId,
          '2026-06-01',
          '2026-06-30',
        )
      ).data,
    ).toEqual([]);
  });
  it('preserves original GPS evidence when a site is edited or retired and enforces CIDR boundaries', async () => {
    const settings = new HrmTimeSettingsController(ctx());
    const shifts = new HrmShiftController(ctx());
    const shift = (
      await shifts.createShift(req, {
        code: 'GPS-DAY',
        name: 'GPS day',
        startTime: '08:00',
        endTime: '17:00',
        breakMinutes: 60,
        breakStartTime: '12:00',
        breakEndTime: '13:00',
      })
    ).data;
    await scheduleShift(userId, shift.id, '2026-07-01', '2026-07-01');
    await settings.policy(req, {
      effectiveFrom: '2026-07-01',
      timezone: 'Asia/Ho_Chi_Minh',
      reason: 'Cấu hình chính sách test',
      requireIp: true,
      allowedIps: ['10.20.0.0/16'],
      requireGps: true,
      maxGpsAccuracyMeters: 50,
    });
    const site = (
      await settings.site(req, {
        name: 'Original office',
        latitude: 12,
        longitude: 108,
        radiusMeters: 100,
      })
    ).data;
    const request = {
      headers: {},
      socket: { remoteAddress: '10.20.5.1' },
    } as Request;
    const punch = {
      employeeId: userId,
      kind: 'IN' as const,
      occurredAt: '2026-07-01T01:00:00Z',
      source: 'WEB_PORTAL',
      externalEventId: randomUUID(),
      latitude: 12,
      longitude: 108,
      accuracy: 20,
    };
    await expect(
      ingestEvent(pool as any, tenantId, userId, punch, {
        ...request,
        socket: { remoteAddress: '10.21.5.1' },
      } as Request),
    ).rejects.toThrow('IP');
    await expect(
      ingestEvent(
        pool as any,
        tenantId,
        userId,
        { ...punch, latitude: 13 },
        request,
      ),
    ).rejects.toThrow('bán kính');
    await ingestEvent(pool as any, tenantId, userId, punch, request);
    const readEvidence = async () =>
      (
        await pool.query(
          'SELECT evidence FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND external_event_id=$2',
          [tenantId, punch.externalEventId],
        )
      ).rows[0].evidence;
    const before = await readEvidence();
    expect(before.siteSnapshot).toEqual({
      name: 'Original office',
      latitude: 12,
      longitude: 108,
      radiusMeters: 100,
    });
    const changed = (
      await settings.updateSite(req, site.id, {
        latitude: 13,
        expectedUpdatedAt: new Date(site.updated_at).toISOString(),
        reason: 'Relocated office',
      })
    ).data;
    await settings.deactivateSite(req, site.id, {
      expectedUpdatedAt: new Date(changed.updated_at).toISOString(),
      reason: 'Retired office',
    });
    expect(await readEvidence()).toEqual(before);
  });

  it('kiểm vị trí theo cài đặt mới: phải đạt cả bán kính lẫn IP của địa điểm được gán, tắt kiểm tra thì chấm công ở đâu cũng được', async () => {
    const settings = new HrmTimeSettingsController(ctx());
    const shifts = new HrmShiftController(ctx());
    const shift = (
      await shifts.createShift(req, {
        code: 'SITE-DAY',
        name: 'Site day',
        startTime: '08:00',
        endTime: '17:00',
        breakMinutes: 60,
        breakStartTime: '12:00',
        breakEndTime: '13:00',
      })
    ).data;
    await scheduleShift(userId, shift.id, '2026-07-02', '2026-07-03');
    const site = (
      await settings.site(req, {
        name: 'Văn phòng mới',
        latitude: 21,
        longitude: 105,
        radiusMeters: 100,
        allowedIps: ['10.30.0.0/16'],
      })
    ).data;
    expect(site.allowed_ips).toEqual(['10.30.0.0/16']);
    await settings.updateSiteAssignments(req, site.id, { assignments: [{ scopeType: 'COMPANY', scopeId: '' }] });
    await settings.updateLocation(req, { locationCheck: true, maxGpsAccuracyMeters: 30 });
    const at = (ip: string) => ({ headers: {}, socket: { remoteAddress: ip } }) as Request;
    const punch = (extra: Record<string, unknown> = {}) => ({
      employeeId: userId,
      kind: 'IN' as const,
      occurredAt: '2026-07-02T01:00:00Z',
      source: 'WEB_PORTAL',
      externalEventId: randomUUID(),
      latitude: 21,
      longitude: 105,
      accuracy: 20,
      ...extra,
    });
    // Đúng vị trí nhưng sai IP của địa điểm.
    await expect(ingestEvent(pool as any, tenantId, userId, punch(), at('10.99.0.1'))).rejects.toThrow('IP');
    // Đúng IP nhưng ngoài bán kính.
    await expect(ingestEvent(pool as any, tenantId, userId, punch({ latitude: 22 }), at('10.30.0.1'))).rejects.toThrow('bán kính');
    // Sai số vượt dung sai 30 m của cài đặt (chính sách cũ cho phép 50 m).
    await expect(ingestEvent(pool as any, tenantId, userId, punch({ accuracy: 40 }), at('10.30.0.1'))).rejects.toThrow('độ chính xác');
    const ok = punch();
    await ingestEvent(pool as any, tenantId, userId, ok, at('10.30.0.1'));
    const evidence = (
      await pool.query('SELECT evidence FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND external_event_id=$2', [
        tenantId,
        ok.externalEventId,
      ])
    ).rows[0].evidence;
    expect(evidence).toMatchObject({ siteId: site.id, siteSnapshot: { name: 'Văn phòng mới' } });
    // Tắt kiểm tra vị trí: không cần GPS hay IP.
    await settings.updateLocation(req, { locationCheck: false, maxGpsAccuracyMeters: 30 });
    await ingestEvent(
      pool as any,
      tenantId,
      userId,
      { employeeId: userId, kind: 'OUT' as const, occurredAt: '2026-07-02T10:00:00Z', source: 'WEB_PORTAL', externalEventId: randomUUID() },
      at('203.0.113.9'),
    );
  });

  it('chặn chấm công trong giờ ca: vào muộn quá giới hạn và ra sớm quá giới hạn bị từ chối, vào sớm thì luôn được', async () => {
    const settings = new HrmTimeSettingsController(ctx());
    const shifts = new HrmShiftController(ctx());
    await settings.updateLocation(req, { locationCheck: false, maxGpsAccuracyMeters: 30 });
    const shift = (
      await shifts.createShift(req, {
        code: 'BLOCK-DAY',
        name: 'Ca có chặn chấm công',
        startTime: '07:30',
        endTime: '16:30',
        breakMinutes: 60,
        breakStartTime: '12:00',
        breakEndTime: '13:00',
        graceLateMinutes: 10,
        blockLateInMinutes: 30,
        blockEarlyOutMinutes: 15,
      })
    ).data;
    expect(shift).toMatchObject({ blockLateInMinutes: 30, blockEarlyOutMinutes: 15 });
    await scheduleShift(userId, shift.id, '2026-07-06', '2026-07-09');
    const web = { headers: {}, socket: { remoteAddress: '203.0.113.9' } } as Request;
    const punch = (kind: 'IN' | 'OUT', occurredAt: string) =>
      ingestEvent(pool as any, tenantId, userId, { employeeId: userId, kind, occurredAt, source: 'WEB_PORTAL', externalEventId: randomUUID() }, web);
    // Giờ Việt Nam = UTC + 7: 07:30 là 00:30Z.
    await punch('IN', '2026-07-06T00:45:00Z'); // 07:45, trễ 15 phút nhưng còn chấm được
    await punch('IN', '2026-07-07T01:00:00Z'); // 08:00, đúng giới hạn 30 phút
    await expect(punch('IN', '2026-07-08T01:01:00Z')).rejects.toThrow(/muộn nhất 08:00/); // 08:01
    await expect(punch('IN', '2026-07-08T01:30:00Z')).rejects.toThrow(/muộn nhất 08:00/); // 08:30
    await punch('IN', '2026-07-08T20:00:00Z'); // 03:00 sáng 09/07: chấm vào sớm bao nhiêu cũng được
    await expect(punch('OUT', '2026-07-06T09:14:00Z')).rejects.toThrow(/sớm nhất 16:15/); // 16:14
    await punch('OUT', '2026-07-06T09:15:00Z'); // 16:15
    // Lượt chấm bị từ chối không để lại dữ liệu.
    const saved = await pool.query(
      `SELECT count(*)::int AS n FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND employee_id=$2 AND work_date='2026-07-08'`,
      [tenantId, userId],
    );
    expect(saved.rows[0].n).toBe(0);
    // Sửa giới hạn khi ca đã được phân công vẫn được (chỉ ảnh hưởng lượt chấm sau này); null là bỏ chặn.
    const updated = (await shifts.updateShift(req, shift.id, { blockLateInMinutes: null, expectedUpdatedAt: shift.updatedAt })).data;
    expect(updated.blockLateInMinutes).toBeNull();
    expect(updated.blockEarlyOutMinutes).toBe(15);
  });

  it('xóa mềm địa điểm chấm công: biến khỏi danh mục, gỡ phạm vi áp dụng, giữ dòng và nhật ký, không xóa địa điểm cuối khi đang kiểm tra vị trí', async () => {
    const settings = new HrmTimeSettingsController(ctx());
    const iso = (value: unknown) => new Date(value as string).toISOString();
    const a = (await settings.site(req, { name: 'Địa điểm xóa A', latitude: 21, longitude: 105, radiusMeters: 100 })).data;
    const b = (await settings.site(req, { name: 'Địa điểm xóa B', latitude: 22, longitude: 106, radiusMeters: 100 })).data;
    await settings.updateSiteAssignments(req, a.id, { assignments: [{ scopeType: 'COMPANY', scopeId: '' }] });
    const listed = async () => ((await settings.get(req)).data.sites as { id: string }[]).map((x) => x.id);
    expect(await listed()).toEqual(expect.arrayContaining([a.id, b.id]));

    // Phiên bản cũ bị từ chối; xóa đúng phiên bản thì địa điểm biến khỏi danh mục.
    await expect(settings.deleteSite(req, a.id, { expectedUpdatedAt: '2000-01-01T00:00:00.000Z', reason: 'Xóa' })).rejects.toMatchObject({ status: 409 });
    expect((await settings.deleteSite(req, a.id, { expectedUpdatedAt: iso(a.updated_at), reason: 'Xóa' })).data).toEqual({ id: a.id, deleted: true });
    expect(await listed()).not.toContain(a.id);
    expect(await listed()).toContain(b.id);

    // Dòng vẫn còn (đã ngừng, có deleted_at), phạm vi áp dụng bị gỡ, nhật ký ghi lại cả phạm vi cũ.
    const row = (await pool.query('SELECT active, deleted_at FROM hrm_schema.attendance_sites WHERE tenant_id=$1 AND id=$2', [tenantId, a.id])).rows[0];
    expect(row.active).toBe(false);
    expect(row.deleted_at).not.toBeNull();
    expect((await pool.query('SELECT 1 FROM hrm_schema.attendance_site_assignments WHERE tenant_id=$1 AND site_id=$2', [tenantId, a.id])).rowCount).toBe(0);
    const audit = (await pool.query(`SELECT detail FROM hrm_schema.audit_log WHERE tenant_id=$1 AND action='SITE_DELETED' AND entity_id=$2`, [tenantId, a.id])).rows[0];
    expect(audit.detail.assignments).toEqual([{ scope_type: 'COMPANY', scope_id: expect.anything() }]);

    // Địa điểm đã xóa không sửa, không ngừng, không gán lại, không xóa lần nữa.
    await expect(settings.deleteSite(req, a.id, { expectedUpdatedAt: iso(row.deleted_at), reason: 'Xóa lại' })).rejects.toMatchObject({ status: 404 });
    await expect(settings.updateSite(req, a.id, { name: 'Sửa', expectedUpdatedAt: iso(a.updated_at), reason: 'Sửa' })).rejects.toMatchObject({ status: 404 });
    await expect(settings.updateSiteAssignments(req, a.id, { assignments: [{ scopeType: 'COMPANY', scopeId: '' }] })).rejects.toMatchObject({ status: 404 });

    // Đang bật kiểm tra vị trí: không xóa được địa điểm đang dùng cuối cùng.
    await pool.query('UPDATE hrm_schema.attendance_sites SET active=false WHERE tenant_id=$1 AND id<>$2', [tenantId, b.id]);
    await settings.updateLocation(req, { locationCheck: true, maxGpsAccuracyMeters: 30 });
    const fresh = (await pool.query('SELECT updated_at FROM hrm_schema.attendance_sites WHERE tenant_id=$1 AND id=$2', [tenantId, b.id])).rows[0];
    await expect(settings.deleteSite(req, b.id, { expectedUpdatedAt: iso(fresh.updated_at), reason: 'Xóa' })).rejects.toMatchObject({ response: { code: 'HRM_SITE_LAST_ACTIVE' } });
    await settings.updateLocation(req, { locationCheck: false, maxGpsAccuracyMeters: 30 });
    await settings.deleteSite(req, b.id, { expectedUpdatedAt: iso(fresh.updated_at), reason: 'Xóa' });
    expect(await listed()).not.toContain(b.id);
  });

  describe('ma trận chấm công với chặn vào muộn/ra sớm và bỏ khung chấm vào trước ca', () => {
    // Giờ Việt Nam (UTC+7) -> thời điểm ISO.
    const vn = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`).toISOString();
    const web = { headers: {}, socket: { remoteAddress: '203.0.113.9' } } as Request;
    const punch = (kind: 'IN' | 'OUT', occurredAt: string, source = 'WEB_PORTAL', self: Request | null = web) =>
      ingestEvent(pool as any, tenantId, userId, { employeeId: userId, kind, occurredAt, source, externalEventId: randomUUID() }, self ?? undefined);
    const workDateOf = async (kind: 'IN' | 'OUT', occurredAt: string) =>
      (
        await pool.query(
          `SELECT to_char(work_date,'YYYY-MM-DD') AS d FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND employee_id=$2 AND event_kind=$3 AND occurred_at=$4::timestamptz`,
          [tenantId, userId, kind, occurredAt],
        )
      ).rows[0]?.d as string | undefined;
    const calculate = async (month: string, from: string, to: string) => {
      const client = await (pool as any).connect();
      try {
        await client.query('BEGIN');
        const period = await ensureMonthPeriod(client, tenantId, { month, from, to } as any);
        await calculateTimesheet(client, tenantId, period.id);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };
    const sheet = async (from: string, to: string) =>
      Object.fromEntries(
        (
          await pool.query(
            `SELECT to_char(work_date,'YYYY-MM-DD') AS d, late_minutes, early_leave_minutes, status FROM hrm_schema.timesheets
              WHERE tenant_id=$1 AND employee_id=$2 AND work_date BETWEEN $3::date AND $4::date`,
            [tenantId, userId, from, to],
          )
        ).rows.map((r) => [r.d, r]),
      );

    it('ca ngày 07:30-16:30 (dung sai trễ 10, sớm 5, chặn vào 30, chặn ra 15): từng mốc giờ và kết quả công', async () => {
      const settings = new HrmTimeSettingsController(ctx());
      const shifts = new HrmShiftController(ctx());
      await settings.updateLocation(req, { locationCheck: false, maxGpsAccuracyMeters: 30 });
      const shift = (
        await shifts.createShift(req, {
          code: 'MATRIX-DAY',
          name: 'Ma trận ca ngày',
          startTime: '07:30',
          endTime: '16:30',
          breakMinutes: 60,
          breakStartTime: '12:00',
          breakEndTime: '13:00',
          graceLateMinutes: 10,
          graceEarlyMinutes: 5,
          checkOutAfterMinutes: 240,
          blockLateInMinutes: 30,
          blockEarlyOutMinutes: 15,
        })
      ).data;
      await scheduleShift(userId, shift.id, '2026-08-03', '2026-08-18');
      // Mỗi dòng: ngày, giờ vào, giờ ra, số phút trễ và về sớm tính công.
      const days: [string, string, string, number, number][] = [
        ['2026-08-03', '03:00', '16:30', 0, 0], // vào rất sớm vẫn được, không trễ
        ['2026-08-04', '07:40', '16:30', 0, 0], // đúng dung sai 10 phút: không tính trễ
        ['2026-08-05', '07:41', '16:30', 11, 0], // vượt dung sai: tính đủ 11 phút
        ['2026-08-06', '07:45', '16:30', 15, 0], // ví dụ của yêu cầu: 07:45 trễ 15 phút
        ['2026-08-07', '08:00', '16:30', 30, 0], // đúng giới hạn chặn: còn chấm được, trễ 30 phút
        ['2026-08-10', '07:30', '16:25', 0, 0], // ra sớm 5 phút nằm trong dung sai
        ['2026-08-11', '07:30', '16:15', 0, 15], // đúng giới hạn chặn ra sớm: còn chấm được, sớm 15 phút
        ['2026-08-12', '07:30', '20:30', 0, 0], // chấm ra đúng cuối khung 240 phút sau ca
      ];
      for (const [date, inAt, outAt] of days) {
        await punch('IN', vn(date, inAt));
        await punch('OUT', vn(date, outAt));
      }
      // Vượt giới hạn: bị từ chối và không để lại lượt chấm.
      await expect(punch('IN', vn('2026-08-13', '08:01'))).rejects.toThrow(/muộn nhất 08:00/);
      await expect(punch('IN', vn('2026-08-13', '08:30'))).rejects.toThrow(/muộn nhất 08:00/);
      await punch('IN', vn('2026-08-14', '07:30'));
      await expect(punch('OUT', vn('2026-08-14', '16:14'))).rejects.toThrow(/sớm nhất 16:15/);
      await punch('IN', vn('2026-08-17', '07:30'));
      await expect(punch('OUT', vn('2026-08-17', '20:31'))).rejects.toThrow(/Chưa có ca hợp lệ/); // quá khung ra sau ca
      expect((await pool.query(
        `SELECT count(*)::int AS n FROM hrm_schema.attendance_events WHERE tenant_id=$1 AND employee_id=$2 AND work_date='2026-08-13'`,
        [tenantId, userId],
      )).rows[0].n).toBe(0);
      // Nguồn máy chấm công không bị chặn (dữ liệu thật đã xảy ra, không từ chối).
      await punch('IN', vn('2026-08-18', '08:30'), 'BIOMETRIC_DEVICE', null);

      await calculate('2026-08', '2026-08-01', '2026-08-31');
      const rows = await sheet('2026-08-03', '2026-08-12');
      for (const [date, , , late, early] of days) {
        expect({ date, late: Number(rows[date].late_minutes), early: Number(rows[date].early_leave_minutes) }).toEqual({ date, late, early });
      }
      expect(rows['2026-08-04'].status).toBe('NORMAL');
    });

    it('ca không cấu hình giới hạn: chấm vào muộn hay ra sớm tới đâu cũng không bị chặn', async () => {
      const shifts = new HrmShiftController(ctx());
      const shift = (await shifts.createShift(req, { code: 'FREE-DAY', name: 'Ca không chặn', startTime: '08:00', endTime: '17:00', breakMinutes: 60, breakStartTime: '12:00', breakEndTime: '13:00' })).data;
      expect(shift).toMatchObject({ blockLateInMinutes: null, blockEarlyOutMinutes: null });
      await scheduleShift(userId, shift.id, '2026-10-05', '2026-10-06');
      await punch('IN', vn('2026-10-05', '12:00')); // muộn 4 giờ vẫn chấm được
      await punch('OUT', vn('2026-10-05', '12:30')); // ra rất sớm vẫn chấm được
    });

    it('chặn 0 phút: chỉ chấm vào được đến đúng giờ bắt đầu, chỉ chấm ra được từ đúng giờ kết thúc', async () => {
      const shifts = new HrmShiftController(ctx());
      const shift = (await shifts.createShift(req, { code: 'ZERO-BLOCK', name: 'Chặn 0 phút', startTime: '08:00', endTime: '17:00', breakMinutes: 60, breakStartTime: '12:00', breakEndTime: '13:00', blockLateInMinutes: 0, blockEarlyOutMinutes: 0 })).data;
      await scheduleShift(userId, shift.id, '2026-10-12', '2026-10-13');
      await punch('IN', vn('2026-10-12', '08:00'));
      await expect(punch('OUT', vn('2026-10-12', '16:59'))).rejects.toThrow(/sớm nhất 17:00/);
      await punch('OUT', vn('2026-10-12', '17:00'));
      await expect(punch('IN', vn('2026-10-13', '08:01'))).rejects.toThrow(/muộn nhất 08:00/);
    });

    it('ca đêm 22:00-06:00: chấm vào sớm được, chặn theo giờ bắt đầu/kết thúc, chấm ra buổi sáng thuộc ngày công của ca đêm', async () => {
      const shifts = new HrmShiftController(ctx());
      const shift = (
        await shifts.createShift(req, {
          code: 'MATRIX-NIGHT',
          name: 'Ma trận ca đêm',
          startTime: '22:00',
          endTime: '06:00',
          crossMidnight: true,
          breakMinutes: 0,
          graceLateMinutes: 10,
          graceEarlyMinutes: 5,
          checkOutAfterMinutes: 240,
          blockLateInMinutes: 30,
          blockEarlyOutMinutes: 20,
        })
      ).data;
      await scheduleShift(userId, shift.id, '2026-09-07', '2026-09-10');
      // Ca ngày 07/09: vào sớm 1 giờ, ra đúng 06:00 sáng hôm sau.
      await punch('IN', vn('2026-09-07', '21:00'));
      await punch('OUT', vn('2026-09-08', '06:00'));
      expect(await workDateOf('IN', vn('2026-09-07', '21:00'))).toBe('2026-09-07');
      // Lượt ra 06:00 sáng 08/09 gần ca đêm 07/09 hơn ca đêm 08/09 nên thuộc ngày công 07/09.
      expect(await workDateOf('OUT', vn('2026-09-08', '06:00'))).toBe('2026-09-07');
      // Ca ngày 08/09: vào 22:31 bị chặn, 22:30 được; ra 05:39 bị chặn, 05:40 được.
      await expect(punch('IN', vn('2026-09-08', '22:31'))).rejects.toThrow(/muộn nhất 22:30/);
      await punch('IN', vn('2026-09-08', '22:30'));
      await expect(punch('OUT', vn('2026-09-09', '05:39'))).rejects.toThrow(/sớm nhất 05:40/);
      await punch('OUT', vn('2026-09-09', '05:40'));
      expect(await workDateOf('OUT', vn('2026-09-09', '05:40'))).toBe('2026-09-08');
    });

    it('ca đêm liền ca ngày: lượt chấm sáng sớm chọn ca có giờ gần nhất, không báo xung đột hai cửa sổ ca', async () => {
      const shifts = new HrmShiftController(ctx());
      const night = (await shifts.createShift(req, { code: 'B2B-NIGHT', name: 'Đêm', startTime: '22:00', endTime: '06:00', crossMidnight: true, breakMinutes: 0, checkOutAfterMinutes: 240 })).data;
      const day = (await shifts.createShift(req, { code: 'B2B-DAY', name: 'Ngày', startTime: '07:30', endTime: '16:30', breakMinutes: 60, breakStartTime: '12:00', breakEndTime: '13:00', checkOutAfterMinutes: 240 })).data;
      await scheduleShift(userId, night.id, '2026-09-14', '2026-09-14');
      await scheduleShift(userId, day.id, '2026-09-15', '2026-09-15');
      await punch('IN', vn('2026-09-14', '22:00'));
      // 06:10 sáng 15/09: cách giờ kết thúc ca đêm 10 phút, cách giờ bắt đầu ca ngày 80 phút -> ra của ca đêm.
      await punch('OUT', vn('2026-09-15', '06:10'));
      expect(await workDateOf('OUT', vn('2026-09-15', '06:10'))).toBe('2026-09-14');
      // 07:00 sáng 15/09: cách ca đêm 60 phút, cách ca ngày 30 phút -> vào của ca ngày.
      await punch('IN', vn('2026-09-15', '07:00'));
      expect(await workDateOf('IN', vn('2026-09-15', '07:00'))).toBe('2026-09-15');
    });
  });
});
