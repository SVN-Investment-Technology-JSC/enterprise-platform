import { calculateTimesheet } from './hrm-timesheet-calculation';

/**
 * Tính công cả kỳ phải nạp dữ liệu theo lô: số truy vấn không được tăng theo số nhân viên (trước đây ~12 truy vấn cho từng
 * cặp nhân viên-ngày, tháng 47 người mất ~18.000 truy vấn và hơn 17 giây trong một giao dịch giữ khóa kỳ công).
 */
const DAYS = ['2026-10-05', '2026-10-06', '2026-10-07'];

async function run(employeeCount: number) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const employees = Array.from({ length: employeeCount }, (_, i) => ({
    employee_id: `emp-${i}`,
    join_date: '2026-01-01',
    inactive_from: null,
  }));
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const rows = (found: unknown[]) => ({ rows: found, rowCount: found.length });
      if (sql.includes('FROM hrm_schema.timesheet_periods'))
        return rows([{ id: 'period-1', status: 'OPEN', from_date: DAYS[0], to_date: DAYS[2] }]);
      if (sql.includes('generate_series(0')) return rows([]);
      if (sql.includes('generate_series')) return rows(DAYS.map((date) => ({ date, day_kind: null, holiday_paid: null })));
      if (sql.includes('FROM hrm_schema.timesheets t')) return rows([]);
      if (sql.includes('FROM hrm_schema.employee_profiles')) return rows(employees);
      if (sql.includes('count(*)::int AS count')) return rows([{ count: employeeCount * DAYS.length, abnormal: 0 }]);
      return rows([]);
    }),
  };
  await calculateTimesheet(db as never, 't', 'period-1');
  return calls;
}

describe('tính công theo lô', () => {
  it('số truy vấn không tăng theo số nhân viên', async () => {
    const few = await run(1);
    const many = await run(40);
    expect(many.length).toBe(few.length);
    // Hai trường hợp đều xa mức một truy vấn cho mỗi nhân viên-ngày.
    expect(many.length).toBeLessThan(80);
  });

  it('ghi mọi dòng công của kỳ trong một câu lệnh theo lô', async () => {
    const calls = await run(40);
    const upserts = calls.filter((c) => c.sql.includes('INSERT INTO hrm_schema.timesheets'));
    expect(upserts).toHaveLength(1);
    expect(upserts[0].params).toHaveLength(40 * DAYS.length * 19);
  });
});
