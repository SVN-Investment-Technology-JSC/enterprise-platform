import type { PoolClient } from 'pg';
import { importCompOffAdjustments } from './hrm-comp-off.js';

describe('importCompOffAdjustments', () => {
  it('applies valid rows and skips invalid employeeCode, days, or reason', async () => {
    const queries: string[] = [];
    const db = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM hrm_schema.employee_directory')) {
          return {
            rows: [{ id: '00000000-0000-4000-8000-0000000000e1', employee_code: 'NV001' }],
          };
        }
        if (sql.includes('FROM hrm_schema.employee_profiles')) {
          return {
            rowCount: 1,
            rows: [{ employee_id: '00000000-0000-4000-8000-0000000000e1' }],
          };
        }
        if (sql.includes('FROM hrm_schema.comp_off_ledger')) {
          return { rows: [] };
        }
        if (sql.includes('FROM hrm_schema.policy_versions')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    } as unknown as PoolClient;

    const result = await importCompOffAdjustments(
      db,
      '00000000-0000-4000-8000-0000000000t1',
      '00000000-0000-4000-8000-0000000000a1',
      {
        rows: [
          { employeeCode: 'nv001', days: 2, reason: 'Nhập số dư đầu kỳ', expiresOn: '2026-12-31' },
          { employeeCode: 'UNKNOWN', days: 1, reason: 'Sai mã NV' },
          { employeeCode: 'NV001', days: 0, reason: 'Số ngày bằng 0' },
          { employeeCode: 'NV001', days: 1, reason: '   ' },
          { employeeCode: 'NV001', days: 1, reason: 'Sai ngày', expiresOn: '31/12/2026' },
        ],
      },
    );

    expect(result.applied).toBe(1);
    expect(result.skipped).toHaveLength(4);
    expect(result.skipped.map((s) => s.rowIndex)).toEqual([2, 3, 4, 5]);
    expect(queries.some((q) => q.includes("INSERT INTO hrm_schema.comp_off_ledger"))).toBe(true);
  });
});
