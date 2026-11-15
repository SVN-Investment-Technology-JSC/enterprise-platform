import 'reflect-metadata';
import type { Request } from 'express';
import { HrmPayrollController } from './hrm-payroll.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));
jest.mock('../infrastructure/hrm-procedure-bridge.service.js', () => ({ HrmProcedureBridgeService: class {} }));
jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

const RUN = '00000000-0000-4000-8000-0000000000a1';
const ACTOR = '00000000-0000-4000-8000-0000000000c1';
const ACCOUNT = '0011 2233 445566';

function harness(held: readonly string[]) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p'))
        return { rows: [{ status: 'FINALIZED', period_code: '2026-10' }], rowCount: 1 };
      if (sql.includes('FROM hrm_schema.payroll_employee_totals'))
        return {
          rows: [
            {
              employee_id: 'e1',
              net_salary: '15000000',
              payment_status: 'PENDING',
              payment_reference: null,
              beneficiary_snapshot: {
                employee_code: 'NV001',
                full_name: 'Nguyễn Văn A',
                bank_name: 'Ngân hàng B',
                bank_branch: 'Hà Nội',
                bank_account_number: ACCOUNT,
              },
            },
          ],
          rowCount: 1,
        };
      if (sql.includes('FROM hrm_schema.payroll_items')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn(async () => client), query: client.query };
  const controller = Object.create(HrmPayrollController.prototype) as HrmPayrollController;
  Object.assign(controller, {
    ctx: {
      getContext: jest.fn(async () => ({ pool, tenantId: 't1', principal: { userId: ACTOR, permissions: held } })),
      has: jest.fn((_context: unknown, permission: string) => held.includes(permission)),
    },
  });
  const audit = () => {
    const row = queries.find((q) => q.sql.includes('INSERT INTO hrm_schema.audit_log'));
    return row && { sql: row.sql, params: row.params, detail: JSON.parse(row.params[3] as string) };
  };
  return { controller, audit };
}

const req = { headers: {} } as Request;

describe('xuất chi trả lương: số tài khoản theo quyền', () => {
  it('chỉ có hrm.payroll.export: số tài khoản dạng ****5566, nhật ký ghi bản che', async () => {
    const { controller, audit } = harness(['hrm.payroll.export']);
    const { data } = await controller.exportRun(req, RUN, 'payments');
    expect(data.csv).toContain('****5566');
    expect(data.csv).not.toContain(ACCOUNT);
    expect(data.csv).not.toContain('001122334455');
    expect(audit()?.detail).toEqual({ kind: 'payments', periodCode: '2026-10', fullAccountNumbers: false });
  });

  it.each(['hrm.employee.sensitive', 'hrm.payroll.pay'])(
    'có %s: xuất số tài khoản đầy đủ và ghi nhật ký ai, kỳ lương nào (không ghi số tài khoản)',
    async (permission) => {
      const { controller, audit } = harness(['hrm.payroll.export', permission]);
      const { data } = await controller.exportRun(req, RUN, 'payments');
      expect(data.csv).toContain(ACCOUNT);
      const row = audit();
      expect(row?.sql).toContain("'PAYROLL_EXPORT','payroll_run'");
      expect(row?.params.slice(0, 3)).toEqual(['t1', ACTOR, RUN]);
      expect(row?.detail).toEqual({ kind: 'payments', periodCode: '2026-10', fullAccountNumbers: true });
      expect(row?.params[3]).not.toContain('445566');
    },
  );

  it('bản đối soát không có số tài khoản, nhật ký không đánh dấu số tài khoản đầy đủ', async () => {
    const { controller, audit } = harness(['hrm.payroll.export', 'hrm.payroll.pay']);
    await controller.exportRun(req, RUN, 'reconciliation');
    expect(audit()?.detail).toEqual({ kind: 'reconciliation', periodCode: '2026-10' });
  });
});
