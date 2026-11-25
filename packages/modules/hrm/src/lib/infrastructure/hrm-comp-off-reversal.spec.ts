import { planMonthAccrualReversal, reverseMonthAccruals } from './hrm-comp-off.js';

/** Sổ giả: ACCRUAL 4.3 ngày của một nhân viên (lô = id dòng cộng), kèm các dòng sử dụng tuỳ từng ca thử. */
function fakeDb(ledger: Record<string, unknown>[], inserts: unknown[][] = []) {
  return {
    inserts,
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("a.kind='ACCRUAL' AND a.period_month=$2"))
        return { rows: [{ id: 'lot1', employee_id: 'e1', net: '4.3', full_name: 'An', employee_code: 'NV1' }] };
      if (sql.includes('SELECT kind,days,lot_id'))
        return { rows: ledger };
      if (sql.includes("AND kind='ACCRUAL' AND period_month=$3")) return { rows: [{ id: 'lot1' }] };
      if (sql.includes('FROM hrm_schema.employee_profiles')) return { rows: [{ employee_id: 'e1' }], rowCount: 1 };
      if (sql.includes('count(*)::int')) return { rows: [{ n: 0 }] };
      if (sql.startsWith('INSERT INTO hrm_schema.comp_off_ledger')) inserts.push(params ?? []);
      return { rows: [], rowCount: 0 };
    }),
  };
}

const accrual = { kind: 'ACCRUAL', days: '4.3', lot_id: 'lot1', expires_on: null, occurred_on: '2026-11-01', request_id: null };
const usage = (days: string, kind = 'USAGE') => ({ kind, days, lot_id: 'lot1', expires_on: null, occurred_on: '2026-11-10', request_id: 'r1' });

describe('đảo quỹ nghỉ bù khi mở lại kỳ công', () => {
  it('chưa ai dùng: đảo toàn bộ số đã cộng', async () => {
    const plan = await planMonthAccrualReversal(fakeDb([accrual]) as never, 't', '2026-10');
    expect(plan.rows[0]).toMatchObject({ granted: 4.3, reversible: 4.3, kept: 0, held: 0 });
    expect(plan.blocked).toBe(false);
  });

  it('đã dùng một phần: chỉ đảo phần còn lại, phần đã dùng giữ nguyên, không bao giờ âm', async () => {
    const plan = await planMonthAccrualReversal(
      fakeDb([accrual, usage('-1.0', 'RESERVE'), usage('1.0', 'RELEASE'), usage('-1.0', 'USAGE')]) as never,
      't',
      '2026-10',
    );
    expect(plan.rows[0]).toMatchObject({ granted: 4.3, reversible: 3.3, kept: 1, held: 0 });
    expect(plan.totalReversible).toBe(3.3);
    expect(plan.totalKept).toBe(1);
  });

  it('đã dùng hết: không đảo gì', async () => {
    const plan = await planMonthAccrualReversal(fakeDb([accrual, { ...usage('-4.3') }]) as never, 't', '2026-10');
    expect(plan.rows[0]).toMatchObject({ reversible: 0, kept: 4.3 });
  });

  it('còn đơn nghỉ bù chờ duyệt đang giữ chỗ: chặn và không ghi gì', async () => {
    const db = fakeDb([accrual, usage('-1.0', 'RESERVE')]);
    await expect(reverseMonthAccruals(db as never, 't', 'actor', '2026-10', 'lý do')).rejects.toThrow(/giữ chỗ/);
    expect(db.inserts).toHaveLength(0);
  });

  it('ghi một dòng ADJUST âm bằng phần còn lại của lô, liên kết với dòng cộng', async () => {
    const db = fakeDb([accrual, usage('-1.0', 'RESERVE'), usage('1.0', 'RELEASE'), usage('-1.0', 'USAGE')]);
    await reverseMonthAccruals(db as never, 't', 'actor', '2026-10', 'lý do');
    expect(db.inserts).toHaveLength(1);
    const params = db.inserts[0] as unknown[];
    expect(params[3]).toBe(-3.3);
    expect(params[5]).toBe('lot1');
  });
});
