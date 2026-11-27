import type { PoolClient } from 'pg';

jest.mock('./hrm-time.js', () => ({ lockEmployee: jest.fn(), isoDate: (v: unknown) => String(v) }));
jest.mock('./hrm-lifecycle.js', () => ({ lifecycleAudit: jest.fn() }));
jest.mock('./hrm-leave-operations.js', () => ({
  ensureLeaveBalance: jest.fn(async () => ({ id: 'bal-1', accrued: 11, remaining: 3 })),
}));
jest.mock('./hrm-annual-leave.js', () => ({ unpostedUsableEntitlement: jest.fn(async () => ({ extra: 0 })) }));
jest.mock('./hrm-leave-balance.js', () => ({
  applyLeaveDelta: jest.fn(async (_db: unknown, _t: string, _id: string, delta: { remaining: number }) => ({
    remaining: 3 + delta.remaining,
  })),
  pendingReservedDays: jest.fn(async () => 0),
}));

import { lifecycleAudit } from './hrm-lifecycle.js';
import { importLeaveAdjustments, LEAVE_IMPORT_KEY_PREFIX } from './hrm-leave-adjust.js';

const TENANT = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000b1';

function fakeDb(opts: { annualType?: boolean } = {}) {
  const inserts: unknown[][] = [];
  const db = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM hrm_schema.leave_types') && sql.includes('is_annual AND active')) {
        return { rows: opts.annualType === false ? [] : [{ id: 'type-annual' }] };
      }
      if (sql.includes('FROM hrm_schema.employee_directory')) {
        return { rows: [{ id: 'emp-1', employee_code: 'NV001' }] };
      }
      if (sql.includes('SELECT CASE WHEN is_annual')) return { rows: [{ negative_limit: 0 }] };
      if (sql.includes('CURRENT_DATE')) return { rows: [{ today: '2026-11-27' }] };
      if (sql.includes('INSERT INTO hrm_schema.leave_transactions')) {
        inserts.push(params ?? []);
        return { rows: [{ id: 'tx-1' }] };
      }
      return { rows: [] };
    }),
  } as unknown as PoolClient;
  return { db, inserts };
}

describe('importLeaveAdjustments', () => {
  it('ghi giao dịch ADJUSTMENT có người thực hiện và khóa import, bỏ qua dòng sai, và ghi nhật ký lô', async () => {
    const { db, inserts } = fakeDb();
    const result = await importLeaveAdjustments(db, TENANT, ACTOR, {
      fileName: 'phep.xlsx',
      rows: [
        { employeeCode: 'nv001', days: 2, reason: 'Nhập số dư đầu kỳ', year: 2026 },
        { employeeCode: 'KHONG-CO', days: 1, reason: 'Sai mã' },
        { employeeCode: 'NV001', days: 0, reason: 'Bằng 0' },
        { employeeCode: 'NV001', days: 1, reason: '  ' },
        { employeeCode: 'NV001', days: 1, reason: 'Sai năm', year: 1999 },
      ],
    });

    expect(result.applied).toBe(1);
    expect(result.skipped.map((s) => s.rowIndex)).toEqual([2, 3, 4, 5]);
    expect(inserts).toHaveLength(1);
    // [tenant, employee, leaveType, days, balanceAfter, note, year, actor, operationKey]
    expect(inserts[0].slice(0, 8)).toEqual([TENANT, 'emp-1', 'type-annual', 2, 5, 'Nhập số dư đầu kỳ', 2026, ACTOR]);
    expect(String(inserts[0][8]).startsWith(`${LEAVE_IMPORT_KEY_PREFIX}${result.batchId}:`)).toBe(true);
    expect(lifecycleAudit).toHaveBeenCalledWith(db, TENANT, ACTOR, 'LEAVE_BALANCE_IMPORTED', result.batchId, {
      fileName: 'phep.xlsx',
      total: 5,
      applied: 1,
      skipped: 4,
    });
  });

  it('từ chối danh sách rỗng, quá 1.000 dòng, và khi chưa có loại nghỉ Phép năm', async () => {
    await expect(importLeaveAdjustments(fakeDb().db, TENANT, ACTOR, { rows: [] })).rejects.toThrow('không được để trống');
    const many = Array.from({ length: 1001 }, () => ({ employeeCode: 'NV001', days: 1, reason: 'x' }));
    await expect(importLeaveAdjustments(fakeDb().db, TENANT, ACTOR, { rows: many })).rejects.toThrow('tối đa 1.000');
    await expect(
      importLeaveAdjustments(fakeDb({ annualType: false }).db, TENANT, ACTOR, {
        rows: [{ employeeCode: 'NV001', days: 1, reason: 'x' }],
      }),
    ).rejects.toThrow('Phép năm');
  });
});
