import type { PoolClient } from 'pg';
import { settleLeaveOnTermination } from './hrm-leave-settlement';

const EMP = '11111111-1111-4111-8111-111111111111';
const TYPE = '22222222-2222-4222-8222-222222222222';

function fake(options: {
  disposition?: string;
  used?: number;
  remaining?: number;
  prior?: Record<string, unknown>;
}) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      const one = (row: unknown) => ({ rows: [row], rowCount: 1 });
      const none = { rows: [], rowCount: 0 };
      if (/^\s*(INSERT|UPDATE)/i.test(sql) || sql.includes('pg_advisory')) {
        if (!sql.includes('pg_advisory')) writes.push({ sql, params });
        if (/UPDATE hrm_schema.leave_balances/.test(sql))
          return one({ remaining: String((options.remaining ?? 4.5) + Number(params[7])) });
        return none;
      }
      if (sql.includes('to_regclass')) return one({ ready: true });
      if (sql.includes('leave_settlement_settings'))
        return one({ unused_leave_disposition: options.disposition ?? 'CANCEL', updated_by: null, updated_at: null });
      if (sql.includes('join_date,inactive_from'))
        return one({ join_date: '2025-01-01', inactive_from: null, employment_status: 'RESIGNED' });
      if (sql.startsWith('SELECT employee_id FROM hrm_schema.employee_profiles'))
        return one({ employee_id: EMP });
      if (sql.includes('employment_contracts')) return none;
      if (sql.includes('FROM hrm_schema.leave_types'))
        return one({ id: TYPE, code: 'AL', name: 'Phép năm' });
      if (sql.includes('FROM hrm_schema.leave_settlements WHERE tenant_id=$1 AND operation_key'))
        return options.prior ? one(options.prior) : none;
      if (sql.includes('termination_date<>')) return none;
      if (sql.includes('FROM hrm_schema.leave_balances'))
        return one({ id: 'b1', remaining: String(options.remaining ?? 4.5), opening_balance: '0', adjusted: '0' });
      if (sql.includes('leave_accrual_schedules'))
        return one({
          id: 's1', accrual_frequency: 'MONTHLY', accrual_amount: '1', proration_rule: 'NONE',
          seniority_bonus_years: 5, seniority_bonus_days: '1', effective_from: '2020-01-01', effective_to: null,
        });
      if (sql.includes('leave_seniority_milestones')) return none;
      if (sql.includes('leave_request_days')) {
        // $4 = status, $6 = giới hạn đến ngày nghỉ (null với PENDING)
        return one({ days: params[3] === 'APPROVED' && params[5] === '2026-06-15' ? String(options.used ?? 3) : '0' });
      }
      return none;
    }),
  } as unknown as PoolClient;
  return { db, writes };
}

describe('settleLeaveOnTermination', () => {
  it('phép dư: hủy về 0, ghi sổ cái SETTLEMENT và leave_settlements SETTLED', async () => {
    const { db, writes } = fake({ used: 3, remaining: 4.5 });
    const r = await settleLeaveOnTermination(db, 't1', 'actor', EMP, '2026-06-15');
    const item = r.items[0];
    expect(item).toMatchObject({ entitledDays: 5.5, usedDays: 3, unusedDays: 2.5, overusedDays: 0, status: 'SETTLED', disposition: 'CANCEL' });
    const ledger = writes.find((w) => w.sql.includes('leave_transactions'))!;
    expect(ledger.sql).toContain("'SETTLEMENT'");
    expect(ledger.params[0]).toBe('t1');
    expect(ledger.params[3]).toBe(-4.5);
    expect(writes.some((w) => w.sql.includes('hrm_schema.leave_settlements'))).toBe(true);
    expect(ledger.params[7]).toBe(`settle:${EMP}:2026-06-15:${TYPE}`);
  });

  it('dùng dư: OVERUSE_OPEN, không thu hồi (không đổi quỹ khi quỹ đã âm)', async () => {
    const { db, writes } = fake({ used: 7, remaining: -1.5 });
    const r = await settleLeaveOnTermination(db, 't1', 'actor', EMP, '2026-06-15');
    expect(r.items[0]).toMatchObject({ unusedDays: 0, overusedDays: 1.5, status: 'OVERUSE_OPEN' });
    expect(writes.some((w) => /UPDATE hrm_schema.leave_balances/.test(w.sql))).toBe(false);
    const ledger = writes.find((w) => w.sql.includes('leave_transactions'))!;
    expect(Math.abs(ledger.params[3] as number)).toBe(0);
  });

  it('preview chỉ đọc, không ghi', async () => {
    const { db, writes } = fake({});
    const r = await settleLeaveOnTermination(db, 't1', 'actor', EMP, '2026-06-15', { preview: true });
    expect(r.preview).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(writes).toHaveLength(0);
  });

  it('chạy lại idempotent: dùng bản quyết toán cũ, không ghi thêm', async () => {
    const { db, writes } = fake({
      prior: {
        entitled_days: '5.5', used_days: '3', pending_days: '0', unused_days: '2.5',
        overused_days: '0', disposition: 'CANCEL', status: 'SETTLED',
      },
    });
    const r = await settleLeaveOnTermination(db, 't1', 'actor', EMP, '2026-06-15');
    expect(r.items[0].alreadySettled).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it('cấu hình PAYOUT_MARKED: ghi nhận đánh dấu trả tiền, không tính tiền', async () => {
    const { db, writes } = fake({ disposition: 'PAYOUT_MARKED' });
    const r = await settleLeaveOnTermination(db, 't1', 'actor', EMP, '2026-06-15');
    expect(r.disposition).toBe('PAYOUT_MARKED');
    const ledger = writes.find((w) => w.sql.includes('leave_transactions'))!;
    expect(String(ledger.params[5])).toContain('đánh dấu trả tiền');
    const settlement = writes.find((w) => w.sql.includes('INSERT INTO hrm_schema.leave_settlements'))!;
    expect(settlement.params).toContain('PAYOUT_MARKED');
  });

  it('từ chối ngày nghỉ không hợp lệ', async () => {
    const { db } = fake({});
    await expect(
      settleLeaveOnTermination(db, 't1', 'actor', EMP, '2025-01-01x'),
    ).rejects.toThrow();
  });
});
