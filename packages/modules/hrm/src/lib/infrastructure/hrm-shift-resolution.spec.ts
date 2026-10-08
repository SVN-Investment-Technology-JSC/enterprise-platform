import { ConflictException } from '@nestjs/common';
import { leaveDays } from './hrm-leave-operations.js';
import {
  pickShiftAssignment,
  resolveShiftRow,
} from './hrm-shift-resolution.js';
import { shiftForDate } from './hrm-time.js';

describe('pickShiftAssignment priority', () => {
  const personal = { name: 'personal' };
  const direct = { name: 'direct' };
  const parent = { name: 'parent' };
  const grand = { name: 'grand' };

  it('personal exception wins over unit and parent unit', () => {
    const r = pickShiftAssignment(
      [personal],
      [
        { depth: 0, unitId: 'u1', row: direct },
        { depth: 1, unitId: 'u0', row: parent },
      ],
    );
    expect(r?.source).toBe('EMPLOYEE');
    expect(r?.row).toBe(personal);
  });
  it('direct unit wins over parent unit', () => {
    const r = pickShiftAssignment(
      [],
      [
        { depth: 1, unitId: 'u0', row: parent },
        { depth: 0, unitId: 'u1', row: direct },
      ],
    );
    expect(r).toMatchObject({ source: 'UNIT', unitId: 'u1', depth: 0 });
  });
  it('falls back to the nearest ancestor and reports its source', () => {
    const r = pickShiftAssignment(
      [],
      [
        { depth: 2, unitId: 'u-1', row: grand },
        { depth: 1, unitId: 'u0', row: parent },
      ],
    );
    expect(r).toMatchObject({ source: 'PARENT_UNIT', unitId: 'u0', depth: 1 });
  });
  it('returns null without any assignment', () => {
    expect(pickShiftAssignment([], [])).toBeNull();
  });
  it('rejects overlapping personal rows and same-level unit rows', () => {
    expect(() => pickShiftAssignment([personal, personal], [])).toThrow(
      ConflictException,
    );
    expect(() =>
      pickShiftAssignment(
        [],
        [
          { depth: 0, unitId: 'u1', row: direct },
          { depth: 0, unitId: 'u1', row: parent },
        ],
      ),
    ).toThrow(ConflictException);
  });
});

/** Fake DB that answers by SQL fragment so the real query order does not matter. */
function fakeDb(opts: {
  personal?: Record<string, unknown>[];
  unit?: Record<string, unknown>[];
  weeklyOff?: number[];
  calendar?: Record<string, string>;
  unitTable?: boolean;
}) {
  return {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM hrm_schema.leave_types'))
        return { rows: [{ id: 't', unit: 'DAYS', paid: true }] };
      if (sql.includes('generate_series($2::date,$3::date')) {
        const rows = [];
        for (
          let t = Date.parse(String(params[1]));
          t <= Date.parse(String(params[2]));
          t += 86400000
        ) {
          const date = new Date(t).toISOString().slice(0, 10);
          rows.push({ date, day_kind: opts.calendar?.[date] ?? null });
        }
        return { rows };
      }
      if (sql.includes('FROM hrm_schema.timesheet_periods'))
        return { rows: [] };
      if (sql.includes('UPDATE hrm_schema.timesheet_periods'))
        return { rows: [] };
      if (sql.includes('FROM hrm_schema.policy_versions'))
        return {
          rows: [
            { id: 'p', config_json: { weeklyOffDays: opts.weeklyOff ?? [] } },
          ],
        };
      if (sql.includes('to_regclass'))
        return { rows: [{ ready: opts.unitTable ?? false }] };
      if (sql.includes('FROM hrm_schema.shift_assignments'))
        return { rows: opts.personal ?? [] };
      if (sql.includes('unit_shift_assignments'))
        return { rows: opts.unit ?? [] };
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    }),
  };
}

const shiftRow = (extra: Record<string, unknown> = {}) => ({
  id: 'shift-1',
  name: 'HC',
  assignment_id: 'a1',
  check_in_before_minutes: 60,
  check_out_after_minutes: 60,
  break_minutes: 60,
  grace_late_minutes: 0,
  grace_early_minutes: 0,
  starts_at: '2026-09-07T01:00:00Z',
  ends_at: '2026-09-07T10:00:00Z',
  break_starts_at: null,
  break_ends_at: null,
  ...extra,
});

describe('resolveShiftRow / shiftForDate with unit inheritance', () => {
  it('uses the personal exception even when the unit also has a shift', async () => {
    const db = fakeDb({
      personal: [shiftRow({ name: 'ca ca nhan' })],
      unit: [shiftRow({ name: 'ca don vi', depth: 0, unit_id: 'u1' })],
      unitTable: true,
    });
    const r = await resolveShiftRow(db as never, 't', 'e', '2026-09-07', 'UTC');
    expect(r?.source).toBe('EMPLOYEE');
    expect(r?.row.name).toBe('ca ca nhan');
  });
  it('inherits the unit shift, then the parent unit shift', async () => {
    const both = fakeDb({
      unit: [
        shiftRow({ name: 'cha', depth: 1, unit_id: 'u0', assignment_id: null }),
        shiftRow({
          name: 'phong',
          depth: 0,
          unit_id: 'u1',
          assignment_id: null,
        }),
      ],
      unitTable: true,
    });
    const direct = await resolveShiftRow(
      both as never,
      't',
      'e',
      '2026-09-07',
      'UTC',
    );
    expect(direct).toMatchObject({ source: 'UNIT', unitId: 'u1' });
    const onlyParent = fakeDb({
      unit: [
        shiftRow({ name: 'cha', depth: 1, unit_id: 'u0', assignment_id: null }),
      ],
      unitTable: true,
    });
    const parent = await resolveShiftRow(
      onlyParent as never,
      't',
      'e',
      '2026-09-07',
      'UTC',
    );
    expect(parent).toMatchObject({ source: 'PARENT_UNIT', unitId: 'u0' });
  });
  it('shiftForDate exposes the inherited source and no assignment id', async () => {
    const db = fakeDb({
      unit: [shiftRow({ depth: 0, unit_id: 'u1', assignment_id: null })],
      unitTable: true,
    });
    const shift = await shiftForDate(
      db as never,
      't',
      'e',
      '2026-09-07',
      'UTC',
    );
    expect(shift).toMatchObject({
      source: 'UNIT',
      unitId: 'u1',
      assignmentId: null,
    });
  });
  it('tenants without the unit table keep the legacy behaviour', async () => {
    const db = fakeDb({ unitTable: false });
    expect(
      await resolveShiftRow(db as never, 't', 'e', '2026-09-07', 'UTC'),
    ).toBeNull();
  });
});

describe('leave requests with weekly day-off', () => {
  const body = (duration: number) => ({
    employeeId: '11111111-1111-4111-8111-111111111111',
    leaveTypeId: '22222222-2222-4222-8222-222222222222',
    fromDate: '2026-09-04', // Friday
    toDate: '2026-09-07', // Monday
    duration,
    reason: 'viec rieng',
  });
  const personal = [shiftRow()];

  it('does not count Saturday/Sunday when they are weekly days off', async () => {
    const db = fakeDb({ weeklyOff: [6, 0], personal });
    const { days } = await leaveDays(db as never, 't', body(2) as never);
    expect(days.map((d) => d.date)).toEqual(['2026-09-04', '2026-09-07']);
  });
  it('asks for the working-day total when the duration spans the weekend', async () => {
    const db = fakeDb({ weeklyOff: [6, 0], personal });
    await expect(leaveDays(db as never, 't', body(4) as never)).rejects.toThrow(
      /là 2 ngày/,
    );
  });
  it('counts all days when no weekly day-off is configured (legacy)', async () => {
    const db = fakeDb({ weeklyOff: [], personal });
    const { days } = await leaveDays(db as never, 't', body(4) as never);
    expect(days).toHaveLength(4);
  });
  it('lets an explicit WORK calendar entry override the weekly day-off', async () => {
    const db = fakeDb({
      weeklyOff: [6, 0],
      personal,
      calendar: { '2026-09-05': 'WORK' },
    });
    const { days } = await leaveDays(db as never, 't', body(3) as never);
    expect(days.map((d) => d.date)).toEqual([
      '2026-09-04',
      '2026-09-05',
      '2026-09-07',
    ]);
  });
});
