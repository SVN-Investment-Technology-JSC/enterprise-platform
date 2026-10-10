import 'reflect-metadata';
import type { Request } from 'express';
import { HrmPayrollController } from './hrm-payroll.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));
jest.mock('../infrastructure/hrm-procedure-bridge.service.js', () => ({ HrmProcedureBridgeService: class {} }));
jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

const RUN = '00000000-0000-4000-8000-0000000000a1';
const PERIOD = '00000000-0000-4000-8000-0000000000b1';

describe('chốt lương: chỉ thu hồi ứng cho nhân viên có trong lần tính', () => {
  it('lịch thu hồi chỉ lấy nhân viên có dòng tổng của lần lương đang chốt', async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('FROM hrm_schema.payroll_runs r JOIN hrm_schema.payroll_periods p'))
          return { rows: [{ id: RUN, status: 'CALCULATED', payroll_period_id: PERIOD, timesheet_period_id: 'ts1' }], rowCount: 1 };
        if (sql.includes('information_schema')) return { rows: [{ ready: false }], rowCount: 1 };
        if (sql.includes("status='FINALIZED'")) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM hrm_schema.timesheet_periods')) return { rows: [{ status: 'LOCKED' }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn(async () => client), query: client.query };
    const controller = Object.create(HrmPayrollController.prototype) as HrmPayrollController;
    Object.assign(controller, {
      ctx: { getContext: jest.fn(async () => ({ pool, tenantId: 't1', principal: { userId: 'u1' } })) },
    });
    // các bước sau khi chốt có thể lỗi do dữ liệu giả; chỉ cần câu truy vấn lịch thu hồi đã được gửi
    await controller.finalizeRun({ headers: {} } as Request, RUN).catch(() => undefined);
    const advance = queries.find((q) => q.sql.includes('FROM hrm_schema.salary_advance_deductions d'));
    expect(advance).toBeDefined();
    expect(advance!.sql).toContain('payroll_employee_totals');
    expect(advance!.sql).toContain('t.employee_id=a.employee_id');
    expect(advance!.params).toEqual(['t1', PERIOD, RUN]);
  });
});
