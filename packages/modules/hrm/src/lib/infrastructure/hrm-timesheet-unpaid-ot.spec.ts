import { calculateTimesheet } from './hrm-timesheet-calculation';

jest.mock('./hrm-time.js', () => ({
  ...jest.requireActual('./hrm-time.js'),
  resolvePolicy: jest.fn(async () => ({ id: 'pol-att', config_json: { timezone: 'Asia/Ho_Chi_Minh' } })),
  dayContextForDate: jest.fn(async () => ({ shift: null, scheduleDayType: null, holidayPaid: null })),
}));

/**
 * OT không lương (đơn chọn lý do có paid=false): vẫn là đơn hợp lệ và vẫn ghi giờ thực tế, nhưng chỉ OT đã duyệt
 * có lương mới được cộng vào timesheets.ot_minutes (nguồn của OT_MINUTES khi tính lương).
 */
const DAY = '2026-10-05';
const ot = (id: string, startHour: number, over: Record<string, unknown> = {}) => ({
  id,
  work_date: DAY,
  approved_minutes: 60,
  ot_rate_multiplier: 1.5,
  starts_at: `${DAY}T${String(startHour).padStart(2, '0')}:00:00.000Z`,
  ends_at: `${DAY}T${String(startHour + 1).padStart(2, '0')}:00:00.000Z`,
  ...over,
});

async function run(otRows: Record<string, unknown>[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const rows = (found: unknown[]) => ({ rows: found, rowCount: found.length });
      if (sql.includes('FROM hrm_schema.timesheet_periods'))
        return rows([{ id: 'period-1', status: 'OPEN', from_date: DAY, to_date: DAY }]);
      if (sql.includes('generate_series')) return rows([{ date: DAY, day_kind: null, holiday_paid: null }]);
      if (sql.includes('FROM hrm_schema.timesheets t')) return rows([]);
      if (sql.includes('FROM hrm_schema.employee_profiles'))
        return rows([{ employee_id: 'emp-1', join_date: '2026-01-01', inactive_from: null }]);
      if (sql.includes('FROM hrm_schema.attendance_events'))
        return rows([
          { id: 'in', event_kind: 'IN', occurred_at: `${DAY}T11:00:00.000Z` },
          { id: 'out', event_kind: 'OUT', occurred_at: `${DAY}T13:00:00.000Z` },
        ]);
      if (sql.includes('FROM hrm_schema.ot_requests')) return rows(otRows);
      if (sql.includes('count(*)::int AS count')) return rows([{ count: 1, abnormal: 0 }]);
      return rows([]);
    }),
  };
  await calculateTimesheet(db as never, 't', 'period-1');
  const upserts = calls.filter((c) => c.sql.includes('INSERT INTO hrm_schema.timesheets'));
  expect(upserts).toHaveLength(1);
  const otUpdates = Object.fromEntries(
    calls
      .filter((c) => c.sql.includes('UPDATE hrm_schema.ot_requests'))
      .map((c) => [c.params[1] as string, { actual: c.params[2], billable: c.params[3] }]),
  );
  const params = upserts[0].params;
  return { otMinutes: params[11], snapshot: JSON.parse(params[16] as string), otUpdates };
}

describe('bảng công: chỉ OT đã duyệt có lương được cộng vào ot_minutes', () => {
  it('OT có lương được cộng; OT không lương vẫn ghi giờ thực tế nhưng không cộng và không có hệ số', async () => {
    const result = await run([ot('ot-paid', 11, { paid: true }), ot('ot-unpaid', 12, { paid: false })]);
    expect(result.otMinutes).toBe(60);
    expect(result.snapshot.weightedOtMinutes).toBe(90);
    expect(result.otUpdates['ot-paid']).toEqual({ actual: 60, billable: 60 });
    expect(result.otUpdates['ot-unpaid']).toEqual({ actual: 60, billable: 0 });
  });

  it('chỉ có OT không lương: ot_minutes bằng 0', async () => {
    const result = await run([ot('ot-unpaid', 11, { paid: false })]);
    expect(result.otMinutes).toBe(0);
    expect(result.snapshot.weightedOtMinutes).toBe(0);
    expect(result.otUpdates['ot-unpaid']).toEqual({ actual: 60, billable: 0 });
  });

  it('đơn cũ chưa có cột paid (null hoặc không có) tính là có lương', async () => {
    const result = await run([ot('ot-null', 11, { paid: null }), ot('ot-missing', 12)]);
    expect(result.otMinutes).toBe(120);
    expect(result.snapshot.weightedOtMinutes).toBe(180);
  });

  it('OT có lương vẫn bị giới hạn bởi số phút được duyệt và giờ chấm thực tế', async () => {
    const result = await run([ot('ot-short', 11, { paid: true, approved_minutes: 30 })]);
    expect(result.otMinutes).toBe(30);
    expect(result.otUpdates['ot-short']).toEqual({ actual: 60, billable: 30 });
  });
});
