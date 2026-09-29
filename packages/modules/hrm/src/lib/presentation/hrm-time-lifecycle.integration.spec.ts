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
  it('versions roster edits, rejects overnight overlap and preserves cancelled history', async () => {
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
    const roster = (
      await c.createEmployeeAssignment(req, userId, {
        shiftId: night.id,
        effectiveFrom: '2026-04-01',
        effectiveTo: '2026-04-01',
      })
    ).data;
    await expect(
      c.createEmployeeAssignment(req, userId, {
        shiftId: early.id,
        effectiveFrom: '2026-04-02',
        effectiveTo: '2026-04-02',
      }),
    ).rejects.toMatchObject({ status: 400 });
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
    const updated = (
      await (c as any).updateAssignment(req, roster.id, {
        effectiveTo: '2026-04-03',
        reason: 'Extend roster',
        expectedUpdatedAt: roster.updatedAt,
      })
    ).data;
    await expect(
      (c as any).updateAssignment(req, roster.id, {
        effectiveTo: '2026-04-04',
        reason: 'Stale',
        expectedUpdatedAt: roster.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await pool.query(
      "INSERT INTO hrm_schema.timesheet_periods(tenant_id,period_code,from_date,to_date,status,calculated_at) VALUES($1,'OPEN8','2026-04-01','2026-04-30','OPEN',now())",
      [tenantId],
    );
    await (c as any).cancelAssignment(req, roster.id, {
      reason: 'Cancel test roster',
      expectedUpdatedAt: updated.updatedAt,
      effectiveTo: '2026-04-20',
    });
    expect(
      (
        await pool.query(
          'SELECT status FROM hrm_schema.shift_assignments WHERE id=$1',
          [roster.id],
        )
      ).rows[0].status,
    ).toBe('CANCELLED');
    expect(
      (
        await pool.query(
          "SELECT to_char(effective_to,'YYYY-MM-DD') AS date FROM hrm_schema.shift_assignments WHERE id=$1",
          [roster.id],
        )
      ).rows[0].date,
    ).toBe('2026-04-03');
    expect(
      (
        await pool.query(
          "SELECT calculated_at FROM hrm_schema.timesheet_periods WHERE period_code='OPEN8'",
        )
      ).rows[0].calculated_at,
    ).toBeNull();
    const locked = (
      await c.createEmployeeAssignment(req, userId, {
        shiftId: early.id,
        effectiveFrom: '2026-05-01',
        effectiveTo: '2026-05-01',
      })
    ).data;
    await pool.query(
      "INSERT INTO hrm_schema.timesheet_periods(tenant_id,period_code,from_date,to_date,status) VALUES($1,'LOCK8','2026-05-01','2026-05-31','LOCKED')",
      [tenantId],
    );
    await expect(
      (c as any).cancelAssignment(req, locked.id, {
        reason: 'Must block',
        expectedUpdatedAt: locked.updatedAt,
      }),
    ).rejects.toThrow('đã khóa');
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
      requireIp: true,
      allowedIps: ['10.20.0.0/16', '2001:db8::/32'],
      requireGps: false,
      maxGpsAccuracyMeters: 100,
      requireDevice: false,
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
    await shifts.createEmployeeAssignment(req, userId, {
      shiftId: shift.id,
      effectiveFrom: '2026-07-01',
      effectiveTo: '2026-07-01',
    });
    await settings.policy(req, {
      effectiveFrom: '2026-07-01',
      timezone: 'Asia/Ho_Chi_Minh',
      requireIp: true,
      allowedIps: ['10.20.0.0/16'],
      requireGps: true,
      maxGpsAccuracyMeters: 50,
      requireDevice: false,
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
});
