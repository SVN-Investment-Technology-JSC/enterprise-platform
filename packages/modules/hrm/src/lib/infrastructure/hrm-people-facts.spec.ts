import type { Pool } from 'pg';
import { listProfileFacts, parseProfileFactsFilter } from './hrm-people-facts';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

function poolReturning(rows: unknown[]) {
  const query = jest.fn().mockResolvedValue({ rows });
  return { pool: { query } as unknown as Pool, query };
}

describe('profile-facts của HRM', () => {
  it('đổi dòng DB thành ngày sinh và ngày vào công ty, bỏ dòng trống', async () => {
    const { pool, query } = poolReturning([
      { user_id: U1, date_of_birth: '1990-03-07', join_date: '2020-01-15', employee_code: 'NV001' },
      { user_id: U2, date_of_birth: null, join_date: '2021-02-01', employee_code: '  ' },
      { user_id: 'x', date_of_birth: null, join_date: null, employee_code: null },
      { user_id: U3, date_of_birth: null, join_date: null, employee_code: 'NV003' },
    ]);
    const facts = await listProfileFacts(pool, 't1');
    expect(facts).toEqual([
      { userId: U1, birthYear: 1990, birthMonth: 3, birthDay: 7, joinDate: '2020-01-15', employeeCode: 'NV001' },
      { userId: U2, joinDate: '2021-02-01' },
      { userId: U3, employeeCode: 'NV003' },
    ]);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(['t1']);
    expect(sql).toContain("NOT IN ('RESIGNED','TERMINATED')");
    expect(sql).toContain('e.user_id IS NOT NULL');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it('thêm điều kiện userIds và month vào truy vấn', async () => {
    const { pool, query } = poolReturning([]);
    await listProfileFacts(pool, 't1', { userIds: [U1], month: 5 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('ANY($2::uuid[])');
    expect(sql).toContain('EXTRACT(MONTH FROM ep.date_of_birth) = $3');
    expect(params).toEqual(['t1', [U1], 5]);
  });

  it('đọc bộ lọc từ query string', () => {
    expect(parseProfileFactsFilter()).toEqual({});
    expect(parseProfileFactsFilter(`${U1}, ${U2}`, '12')).toEqual({ userIds: [U1, U2], month: 12 });
  });

  it('từ chối tháng và id sai', () => {
    expect(() => parseProfileFactsFilter(undefined, '13')).toThrow();
    expect(() => parseProfileFactsFilter(undefined, 'abc')).toThrow();
    expect(() => parseProfileFactsFilter('not-a-uuid')).toThrow();
  });
});
