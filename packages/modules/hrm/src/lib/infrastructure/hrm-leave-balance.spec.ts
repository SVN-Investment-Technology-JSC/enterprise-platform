import type { PoolClient } from 'pg';
import { applyLeaveDelta } from './hrm-leave-balance';
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
