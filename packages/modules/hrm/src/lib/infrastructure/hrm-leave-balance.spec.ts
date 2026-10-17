import type { PoolClient } from 'pg';
import { applyLeaveDelta, displayedRemainingDays, listEmployeeLeaveBalanceRows } from './hrm-leave-balance';
import {
  areSimilarLeaveNames,
  findSimilarLeaveTypes,
  mergeLeaveTypes,
  rethrowDuplicateLeaveCode,
} from './hrm-leave-merge';
import { summarizeReconciliation } from './hrm-leave-reconcile';

function fakeDb(handler: (sql: string, params: unknown[]) => unknown) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return handler(sql, params) ?? { rows: [], rowCount: 0 };
    }),
  } as unknown as PoolClient;
  return { db, calls };
}

describe('applyLeaveDelta', () => {
  it('always scopes the update by tenant_id and returns the new remaining', async () => {
    const { db, calls } = fakeDb(() => ({
      rows: [{ remaining: '3.50' }],
      rowCount: 1,
    }));
    const result = await applyLeaveDelta(db, 'tenant-1', 'bal-1', {
      accrued: 1,
      remaining: 1,
    });
    expect(result.remaining).toBe(3.5);
    expect(calls[0].sql).toContain('WHERE tenant_id=$1 AND id=$2');
    expect(calls[0].params.slice(0, 2)).toEqual(['tenant-1', 'bal-1']);
  });

  it('rejects when the minRemaining invariant blocks the update', async () => {
    const { db } = fakeDb((sql) =>
      sql.startsWith('UPDATE')
        ? { rows: [], rowCount: 0 }
        : { rows: [{ '?column?': 1 }], rowCount: 1 },
    );
    await expect(
      applyLeaveDelta(
        db,
        't',
        'b',
        { used: 5, remaining: -5 },
        { minRemaining: -2 },
      ),
    ).rejects.toThrow('vượt hạn mức âm');
  });

  it('reports a missing balance in another tenant as not found', async () => {
    const { db } = fakeDb(() => ({ rows: [], rowCount: 0 }));
    await expect(
      applyLeaveDelta(db, 'other', 'b', { remaining: 1 }),
    ).rejects.toThrow('Không tìm thấy quỹ phép');
  });

  it('rejects non-finite deltas before touching the database', async () => {
    const { db, calls } = fakeDb(() => null);
    await expect(
      applyLeaveDelta(db, 't', 'b', { remaining: Number.NaN }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('reconciliation', () => {
  it('reports balances whose remaining differs from ledger or formula', () => {
    const summary = summarizeReconciliation(2026, [
      { id: 'a', employee_id: 'e', leave_type_id: 't', year: 2026, remaining: '5', ledger_sum: '5', formula: '5' },
      { id: 'b', employee_id: 'e', leave_type_id: 't2', year: 2026, remaining: '4', ledger_sum: '5', formula: '4' },
    ]);
    expect(summary.checked).toBe(2);
    expect(summary.mismatchCount).toBe(1);
    expect(summary.mismatches[0]).toMatchObject({
      balanceId: 'b',
      ledgerDifference: -1,
    });
  });
});

describe('duplicate leave type code', () => {
  it('maps unique violation to 409 and rethrows other errors', () => {
    expect(() => rethrowDuplicateLeaveCode({ code: '23505' })).toThrow(
      'Mã loại nghỉ đã tồn tại',
    );
    const other = new Error('boom');
    expect(() => rethrowDuplicateLeaveCode(other)).toThrow(other);
  });
});

describe('leave type merge', () => {
  it('detects similar names ignoring accents and case', () => {
    expect(areSimilarLeaveNames('Phép năm', 'PHEP NAM')).toBe(true);
    expect(areSimilarLeaveNames('Phép năm', 'Nghỉ phép năm (Annual Leave)')).toBe(true);
    expect(areSimilarLeaveNames('Nghỉ ốm', 'Thai sản')).toBe(false);
    expect(
      findSimilarLeaveTypes([
        { id: '1', code: 'A', name: 'Phép năm' },
        { id: '2', code: 'B', name: 'Nghỉ phép năm' },
        { id: '3', code: 'C', name: 'Thai sản' },
      ]),
    ).toHaveLength(1);
  });

  const typeRow = (id: string, unit = 'DAYS') => ({
    id,
    code: id,
    unit,
    paid: true,
    deduct_balance: true,
    active: true,
    merged_into_id: null,
  });

  it('refuses to merge types with different units', async () => {
    const { db } = fakeDb((sql) =>
      sql.includes('FROM hrm_schema.leave_types')
        ? { rows: [typeRow('s', 'HOURS'), typeRow('t', 'DAYS')], rowCount: 2 }
        : null,
    );
    await expect(mergeLeaveTypes(db, 'tn', 'u', 's', 't', 'r')).rejects.toThrow(
      'khác đơn vị tính',
    );
  });

  it('refuses to merge a type into itself', async () => {
    const { db } = fakeDb(() => null);
    await expect(mergeLeaveTypes(db, 'tn', 'u', 's', 's', 'r')).rejects.toThrow(
      'phải khác nhau',
    );
  });
});

describe('listEmployeeLeaveBalanceRows', () => {
  it('thêm dòng mặc định cho lý do phép năm chưa có dòng quỹ, không ghi DB', async () => {
    const { db, calls } = fakeDb(() => ({
      rows: [{ leave_type_id: 'annual', has_balance: false, accrued: 0, remaining: 0 }],
      rowCount: 1,
    }));
    const rows = await listEmployeeLeaveBalanceRows(db, 'tenant-1', 'emp-1', 2026);
    expect(rows).toEqual([{ leave_type_id: 'annual', has_balance: false, accrued: 0, remaining: 0 }]);
    expect(calls).toHaveLength(1);
    const sql = calls[0].sql;
    expect(sql.trimStart().startsWith('SELECT')).toBe(true);
    // Dòng quỹ đã có (mọi lý do) vẫn được giữ; lý do phép năm đang áp dụng luôn có một dòng dù chưa có quỹ.
    expect(sql).toContain('LEFT JOIN hrm_schema.leave_balances');
    expect(sql).toContain('lb.id IS NOT NULL OR (lt.is_annual AND lt.active)');
    expect(sql).toContain('lt.deleted_at IS NULL');
    expect(calls[0].params).toEqual(['tenant-1', 'emp-1', 2026]);
  });
});

describe('displayedRemainingDays', () => {
  it('có chính sách, chưa có dòng quỹ: lấy số dùng được hiện tại, không lấy định mức cả năm', () => {
    // Đậu Bá Kiên (prod, 13/10/2026): định mức cả năm 13, đã đến hạn 10 tháng nhưng sổ chưa ghi gì.
    const row = { projected_entitlement: 13, available: 10, remaining: 0 };
    expect(displayedRemainingDays(row, 13, 0)).toBe(10);
  });

  it('có chính sách, đã có dòng quỹ: theo available (đã trừ đơn chờ duyệt)', () => {
    expect(displayedRemainingDays({ projected_entitlement: 12, available: 7.5, remaining: 8 }, 12, 4)).toBe(7.5);
  });

  it('có chính sách nhưng thiếu available: định mức trừ đã dùng', () => {
    expect(displayedRemainingDays({ projected_entitlement: 12 }, 12, 4)).toBe(8);
  });

  it('không có chính sách: số remaining ghi sổ, làm tròn 2 chữ số', () => {
    expect(displayedRemainingDays({ remaining: '3.456' }, 0, 0)).toBe(3.46);
    expect(displayedRemainingDays({ projected_entitlement: null, available: 9, remaining: 2 }, 0, 0)).toBe(2);
    expect(displayedRemainingDays({}, 0, 0)).toBe(0);
  });
});
