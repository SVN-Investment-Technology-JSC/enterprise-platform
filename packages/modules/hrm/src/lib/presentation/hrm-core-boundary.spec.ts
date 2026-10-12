import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { HrmEmployeeController } from './hrm-employee.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));
jest.mock('../infrastructure/hrm-procedure-bridge.service.js', () => ({ HrmProcedureBridgeService: class {} }));
jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

const TENANT = 't1';
const ACTOR = 'u-admin';
const CORE_EMP = '00000000-0000-4000-8000-0000000000e1';
const CORE_USER = '00000000-0000-4000-8000-0000000000c1';
const NEW_EMP = '00000000-0000-4000-8000-0000000000e2';
const req = { headers: {} } as Request;

interface Call {
  sql: string;
  params: unknown[];
}

function build(options: { coreExists?: boolean; insertError?: { code: string } } = {}) {
  const calls: Call[] = [];
  const coreExists = options.coreExists ?? true;
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM core_schema.employees') && sql.includes('FOR SHARE'))
        return { rows: coreExists ? [{ id: params[1] }] : [], rowCount: coreExists ? 1 : 0 };
      if (sql.includes('FROM core_schema.employees') && sql.includes('user_id = $2')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO core_schema.employees') && sql.includes('FROM core_schema.users'))
        return { rows: [{ id: NEW_EMP }], rowCount: 1 };
      if (sql.includes('INSERT INTO hrm_schema.employee_profiles')) {
        if (options.insertError) throw Object.assign(new Error('duplicate'), options.insertError);
        return { rows: [{ employee_id: params[0], employee_code: params[2] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  const pool = {
    connect: jest.fn(async () => client),
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('employee_directory'))
        return {
          rows: [{ employee_id: params[1], employee_code: 'NV01', full_name: 'Nguyễn A', work_email: 'a@x.vn', join_date: '2026-01-01', created_at: new Date(), updated_at: new Date() }],
          rowCount: 1,
        };
      return { rows: [], rowCount: 0 };
    }),
  };
  const ctx = {
    getContext: jest.fn(async () => ({ pool, tenantId: TENANT, principal: { userId: ACTOR, permissions: [] } })),
    has: jest.fn(() => true),
  };
  const controller = Object.create(HrmEmployeeController.prototype) as HrmEmployeeController;
  Object.assign(controller, { ctx });
  return { controller, ctx, calls, pool, client };
}

const profile = { employeeCode: 'NV01', joinDate: '2026-01-01', employmentStatus: 'OFFICIAL' };
const writesCoreEmployee = (calls: Call[]) =>
  calls.some((c) => /(INSERT INTO|UPDATE)\s+core_schema\.employees/i.test(c.sql));
/** Dòng liên kết duy nhất HRM được tạo: sao chép họ tên, email từ tài khoản Core, không nhận từ client. */
const bridgeInserts = (calls: Call[]) =>
  calls.filter((c) => /INSERT INTO\s+core_schema\.employees/i.test(c.sql));

describe('HRM khởi tạo hồ sơ trên nhân sự đã có ở Core', () => {
  it('nhân sự Core có sẵn: chỉ tạo hồ sơ HRM, không ghi bảng nhân sự của Core', async () => {
    const { controller, calls } = build();
    const result = await controller.createEmployee(req, { ...profile, employeeId: CORE_EMP });
    expect(writesCoreEmployee(calls)).toBe(false);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO hrm_schema.employee_profiles'));
    expect(insert?.params.slice(0, 3)).toEqual([CORE_EMP, TENANT, 'NV01']);
    expect(calls.some((c) => c.sql.includes('audit_log') && c.params.includes('EMPLOYEE_PROFILE_INITIALIZED'))).toBe(true);
    // họ tên, email lấy từ view thư mục (Core), không phải từ dữ liệu client gửi
    expect(result.data.fullName).toBe('Nguyễn A');
  });

  it('tài khoản chưa có nhân sự: tạo dòng liên kết sao chép từ tài khoản Core, cùng giao dịch với hồ sơ HRM', async () => {
    const { controller, calls, client } = build();
    await controller.createEmployee(req, { ...profile, userId: CORE_USER });
    const bridge = bridgeInserts(calls);
    expect(bridge).toHaveLength(1);
    expect(bridge[0].sql).toContain('FROM core_schema.users');
    expect(bridge[0].params).toEqual([TENANT, CORE_USER]);
    // họ tên, email không đi qua tham số: lấy thẳng từ cột của tài khoản Core
    expect(bridge[0].sql).toContain('u.full_name');
    const order = client.query.mock.calls.map((c) => String(c[0]));
    expect(order.findIndex((q) => q.includes('INSERT INTO core_schema.employees'))).toBeLessThan(
      order.findIndex((q) => q.includes('INSERT INTO hrm_schema.employee_profiles')),
    );
    expect(order).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));
    const insert = calls.find((c) => c.sql.includes('INSERT INTO hrm_schema.employee_profiles'));
    expect(insert?.params[0]).toBe(NEW_EMP);
  });

  it('không cho HRM nhận họ tên hoặc email để tự tạo người mới', async () => {
    const { controller, calls } = build();
    for (const extra of [{ fullName: 'Người mới' }, { workEmail: 'x@y.vn' }])
      await expect(
        controller.createEmployee(req, { ...profile, employeeId: CORE_EMP, ...extra } as never),
      ).rejects.toMatchObject({ response: { code: 'HRM_CORE_OWNED_FIELD' } });
    expect(calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  it('bắt buộc chọn đúng một người ở Core', async () => {
    const { controller } = build();
    await expect(controller.createEmployee(req, { ...profile })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.createEmployee(req, { ...profile, employeeId: CORE_EMP, userId: CORE_USER }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nhân sự không tồn tại ở Core thì từ chối', async () => {
    const { controller } = build({ coreExists: false });
    await expect(controller.createEmployee(req, { ...profile, employeeId: CORE_EMP })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đã có hồ sơ hoặc trùng mã nhân viên trả 409', async () => {
    const { controller } = build({ insertError: { code: '23505' } });
    await expect(controller.createEmployee(req, { ...profile, employeeId: CORE_EMP })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('danh sách người ở Core chưa có hồ sơ HRM', () => {
  it('lấy từ nhân sự Core chưa có hồ sơ và tài khoản chưa có nhân sự, quyền hrm.employee.manage', async () => {
    const { controller, ctx, pool } = build();
    pool.query.mockResolvedValueOnce({
      rows: [
        { employee_id: CORE_EMP, user_id: null, full_name: 'A', email: 'a@x.vn', source: 'employee' },
        { employee_id: null, user_id: CORE_USER, full_name: 'B', email: 'b@x.vn', source: 'user' },
      ],
      rowCount: 2,
    });
    const result = await controller.listCorePeople(req);
    expect(ctx.getContext).toHaveBeenCalledWith(req, 'hrm.employee.manage');
    expect(result.data).toEqual([
      { employeeId: CORE_EMP, userId: null, fullName: 'A', email: 'a@x.vn', source: 'employee' },
      { employeeId: null, userId: CORE_USER, fullName: 'B', email: 'b@x.vn', source: 'user' },
    ]);
    const sql = String(pool.query.mock.calls[0][0]);
    expect(sql).toContain('core_schema.employees');
    expect(sql).toContain('core_schema.users');
    expect(sql).toContain('hrm_schema.employee_profiles');
  });
});

describe('khởi tạo hồ sơ HRM hàng loạt từ Core', () => {
  const E2 = '00000000-0000-4000-8000-0000000000e3';
  const bulk = (items: unknown[]) => ({ items }) as never;

  it('tạo nhiều hồ sơ trong một giao dịch, người từ tài khoản được tạo dòng liên kết từ Core', async () => {
    const { controller, calls, client } = build();
    const result = await controller.initializeEmployeesBulk(
      req,
      bulk([
        { ...profile, employeeCode: 'NV001', employeeId: CORE_EMP },
        { ...profile, employeeCode: 'NV002', userId: CORE_USER },
      ]),
    );
    expect(result.data.created).toBe(2);
    expect(result.data.employeeIds).toEqual([CORE_EMP, NEW_EMP]);
    expect(bridgeInserts(calls)).toHaveLength(1);
    expect(calls.filter((c) => c.sql.includes('INSERT INTO hrm_schema.employee_profiles'))).toHaveLength(2);
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));
  });

  it('từ chối cả lô khi có mã trùng, người chọn hai lần, thiếu dữ liệu hoặc quá số lượng', async () => {
    const { controller, calls } = build();
    const cases = [
      [{ ...profile, employeeCode: 'NV01', employeeId: CORE_EMP }, { ...profile, employeeCode: 'nv01', employeeId: E2 }],
      [{ ...profile, employeeCode: 'A', employeeId: CORE_EMP }, { ...profile, employeeCode: 'B', employeeId: CORE_EMP }],
      [{ ...profile, employeeCode: 'A' }],
      [{ ...profile, employeeCode: 'A', employeeId: CORE_EMP, fullName: 'X' }],
      [],
      Array.from({ length: 201 }, (_, i) => ({ ...profile, employeeCode: `C${i}`, employeeId: CORE_EMP })),
    ];
    for (const items of cases)
      await expect(controller.initializeEmployeesBulk(req, bulk(items))).rejects.toBeInstanceOf(BadRequestException);
    expect(calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  it('một dòng đã có hồ sơ thì hoàn tác cả lô (409)', async () => {
    const { controller, client } = build({ insertError: { code: '23505' } });
    await expect(
      controller.initializeEmployeesBulk(req, bulk([{ ...profile, employeeCode: 'NV01', employeeId: CORE_EMP }])),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
  });
});
