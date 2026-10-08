import type { PoolClient } from 'pg';
import { accrueMonth } from './hrm-leave-accrual';

const EMP = '11111111-1111-4111-8111-111111111111';

function fake(opts: {
  basisSource?: string;
  timing?: string;
  delay?: number;
  contracts?: Record<string, unknown>[];
  today?: string;
}) {
  const ledger: unknown[][] = [];
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      const one = (row: unknown) => ({ rows: [row], rowCount: 1 });
      const none = { rows: [], rowCount: 0 };
      if (sql.includes('AT TIME ZONE')) return one({ today: opts.today ?? '2026-07-15' });
      if (sql.includes('pg_advisory')) return none;
      if (sql.includes('FROM hrm_schema.leave_accrual_schedules s'))
        return one({
          id: 's1', leave_type_id: 'lt1', accrual_frequency: 'MONTHLY', accrual_amount: '1',
          proration_rule: 'NONE', seniority_bonus_years: 5, seniority_bonus_days: '1',
          effective_from: '2020-01-01', effective_to: null,
          basis_date_source: opts.basisSource ?? 'JOIN_DATE',
          start_delay_months: opts.delay ?? 0,
          accrual_timing: opts.timing ?? 'END_OF_MONTH',
        });
      if (sql.includes('leave_seniority_milestones')) return none;
      if (sql.includes('FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND deleted_at IS NULL AND join_date'))
        return one({ employee_id: EMP, join_date: '2026-01-01', employment_status: 'OFFICIAL', inactive_from: null });
      if (sql.startsWith('SELECT employee_id FROM hrm_schema.employee_profiles')) return one({ employee_id: EMP });
      if (sql.includes('employment_contracts'))
        return { rows: opts.contracts ?? [], rowCount: (opts.contracts ?? []).length };
      if (sql.includes('operation_key=$2')) return none;
      if (sql.includes('INSERT INTO hrm_schema.leave_balances')) return none;
      if (sql.includes('FROM hrm_schema.leave_balances')) return one({ id: 'b1' });
      if (sql.includes('UPDATE hrm_schema.leave_balances')) return one({ remaining: '1' });
      if (sql.includes('INSERT INTO hrm_schema.leave_transactions')) {
        ledger.push(params);
        return none;
      }
      return none;
    }),
  } as unknown as PoolClient;
  return { db, ledger };
}

describe('accrueMonth', () => {
  it('JOIN_DATE giữ hành vi cũ: cộng 1 ngày tháng đã kết thúc', async () => {
    const { db, ledger } = fake({});
    const r = await accrueMonth(db, 't', 'a', '2026-05');
    expect(r.credited).toBe(1);
    expect(ledger[0][8]).toBe('accrual:s1:' + EMP + ':2026-05');
  });

  it('chưa có hợp đồng chính thức: bỏ qua kèm lý do, không ném lỗi', async () => {
    const { db, ledger } = fake({
      basisSource: 'CURRENT_CONTRACT_SIGN_DATE',
      contracts: [
        { employee_id: EMP, contract_type: 'PROBATION', sign_date: '2026-01-01', effective_from: '2026-01-01', effective_to: null, status: 'ACTIVE' },
      ],
    });
    const r = await accrueMonth(db, 't', 'a', '2026-05');
    expect(r.credited).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.skippedDetails[0].reason).toContain('hợp đồng chính thức');
    expect(ledger).toHaveLength(0);
  });

  it('trễ 3 tháng theo mốc hợp đồng: tháng 3 bỏ qua, tháng 4 được cộng', async () => {
    const contracts = [
      { employee_id: EMP, contract_type: 'DEFINITE', sign_date: '2026-01-01', effective_from: '2026-01-01', effective_to: null, status: 'ACTIVE' },
    ];
    const a = fake({ basisSource: 'CURRENT_CONTRACT_SIGN_DATE', delay: 3, contracts });
    expect((await accrueMonth(a.db, 't', 'a', '2026-03')).credited).toBe(0);
    const b = fake({ basisSource: 'CURRENT_CONTRACT_SIGN_DATE', delay: 3, contracts });
    expect((await accrueMonth(b.db, 't', 'a', '2026-04')).credited).toBe(1);
  });

  it('tháng đang diễn ra: chỉ cộng lịch đầu tháng', async () => {
    const end = fake({ timing: 'END_OF_MONTH' });
    const r1 = await accrueMonth(end.db, 't', 'a', '2026-07');
    expect(r1.credited).toBe(0);
    const start = fake({ timing: 'START_OF_MONTH' });
    expect((await accrueMonth(start.db, 't', 'a', '2026-07')).credited).toBe(1);
  });

  it('tháng tương lai bị từ chối', async () => {
    const { db } = fake({});
    await expect(accrueMonth(db, 't', 'a', '2026-09')).rejects.toThrow('đã kết thúc');
  });
});
