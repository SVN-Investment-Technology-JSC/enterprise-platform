import 'reflect-metadata';
import {
  expandTenantActions,
  HRM_PERMISSION_ACTIONS,
  HRM_ROLE_TEMPLATES,
} from '@enterprise-platform/contracts-identity';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { approverPermissions } from '../infrastructure/hrm-approval-policy';
import { redactSensitiveProfile, redactSensitiveRow } from '../infrastructure/hrm-profile-visibility';
import { HrmAttendanceController } from './hrm-attendance.controller';
import { HrmEmployeeController } from './hrm-employee.controller';
import { HrmLeaveController } from './hrm-leave.controller';
import { HrmProfileCorrectionController } from './hrm-profile-correction.controller';
import { HrmRequestController } from './hrm-request.controller';
import { HrmSalaryController } from './hrm-salary.controller';
import { HrmTimesheetController } from './hrm-timesheet.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));
jest.mock('../infrastructure/hrm-procedure-bridge.service.js', () => ({ HrmProcedureBridgeService: class {} }));
jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

const req = { headers: {} } as Request;
const template = (key: string) => new Set(expandTenantActions([...HRM_ROLE_TEMPLATES.find((r) => r.key === key)!.actions]));

describe('RBAC: quyền duyệt không còn cho đọc toàn tenant', () => {
  it('quyền duyệt không kéo theo quyền đọc đơn, chấm công, quỹ phép toàn tenant', () => {
    for (const approve of ['hrm.leave.approve', 'hrm.ot.approve', 'hrm.trip.approve', 'hrm.profile.approve', 'hrm.attendance.approve', 'hrm.advance.approve', 'hrm.shift.approve', 'hrm.leave.approve.all', 'hrm.advance.approve.all', 'hrm.shift.approve.all']) {
      const granted = new Set(expandTenantActions([approve]));
      for (const read of ['hrm.request.read', 'hrm.attendance.read', 'hrm.leave.read', 'hrm.advance.read', 'hrm.shift.read'])
        expect(granted.has(read)).toBe(false);
    }
  });

  it('.approve.all vẫn kéo theo .approve; quản lý hồ sơ kéo theo quyền xem dữ liệu nhạy cảm', () => {
    expect(new Set(expandTenantActions(['hrm.leave.approve.all'])).has('hrm.leave.approve')).toBe(true);
    const manage = new Set(expandTenantActions(['hrm.employee.manage']));
    expect(manage.has('hrm.employee.sensitive') && manage.has('hrm.employee.read')).toBe(true);
    expect(new Set(expandTenantActions(['hrm.employee.read'])).has('hrm.employee.sensitive')).toBe(false);
  });

  it('quyền mới nằm trong danh mục hành động', () => {
    expect(HRM_PERMISSION_ACTIONS.some((a) => a.key === 'hrm.employee.sensitive')).toBe(true);
  });

  it('trưởng bộ phận chỉ duyệt trong phạm vi: không có quyền đọc toàn tenant', () => {
    const head = template('department-head');
    for (const key of ['hrm.leave.approve', 'hrm.ot.approve', 'hrm.trip.approve', 'hrm.shift.approve', 'hrm.advance.approve', 'hrm.self.read'])
      expect(head.has(key)).toBe(true);
    for (const key of ['hrm.request.read', 'hrm.attendance.read', 'hrm.leave.read', 'hrm.advance.read', 'hrm.shift.read', 'hrm.employee.read', 'hrm.timesheet.read', 'hrm.payroll.read'])
      expect(head.has(key)).toBe(false);
  });

  it('mọi vai trò nghiệp vụ đều dùng được không gian cá nhân của chính mình', () => {
    for (const role of HRM_ROLE_TEMPLATES.filter((r) => r.key !== 'hrm-admin')) {
      const granted = template(role.key);
      expect(granted.has('hrm.self.read')).toBe(true);
    }
  });

  it('chỉ nhân sự hồ sơ và quản trị xem được dữ liệu nhạy cảm; trưởng phòng nhân sự và C&B thì không', () => {
    expect(template('hr-profile').has('hrm.employee.sensitive')).toBe(true);
    expect(template('hrm-admin').has('hrm.employee.sensitive')).toBe(true);
    expect(template('hr-head').has('hrm.employee.sensitive')).toBe(false);
    expect(template('comp-ben').has('hrm.employee.sensitive')).toBe(false);
  });
});

describe('danh sách đơn: người duyệt đọc theo phạm vi, chỉ khi mở danh sách chờ duyệt', () => {
  function capture(controller: object, method: string, args: unknown[]) {
    let captured: unknown[] | undefined;
    const ctx = {
      scoped: jest.fn(async (...a: unknown[]) => {
        captured = a;
        throw new Error('STOP');
      }),
    };
    const target = Object.create((controller as { prototype: object }).prototype) as Record<string, (...x: unknown[]) => Promise<unknown>>;
    Object.assign(target, { ctx });
    return target[method](...args).catch(() => captured);
  }

  const cases: [string, string, string, string, unknown[], (fa?: string) => unknown[]][] = [
    ['leave', 'HrmLeaveController', 'listLeaveRequests', 'hrm.request.read', [], (fa) => [req, undefined, undefined, fa]],
  ];
  void cases;

  const run = async (klass: object, method: string, kind: Parameters<typeof approverPermissions>[0], read: string, build: (fa?: string) => unknown[]) => {
    const withApproval = await capture(klass, method, build('1'));
    const without = await capture(klass, method, build(undefined));
    expect(withApproval?.[1]).toBe(read);
    expect(withApproval?.[3]).toEqual(approverPermissions(kind));
    expect(without?.[3]).toEqual([]);
  };

  it('nghỉ phép', () => run(HrmLeaveController, 'listLeaveRequests', 'leave', 'hrm.request.read', (fa) => [req, undefined, undefined, fa]));
  it('tăng ca', () => run(HrmRequestController, 'listOtRequests', 'ot', 'hrm.request.read', (fa) => [req, undefined, undefined, undefined, fa]));
  it('công tác', () => run(HrmRequestController, 'listBusinessTripRequests', 'business_trip', 'hrm.request.read', (fa) => [req, undefined, undefined, fa]));
  it('đổi ca', () => run(HrmRequestController, 'listShiftChanges', 'shift_change', 'hrm.request.read', (fa) => [req, undefined, fa]));
  it('giải trình công', () => run(HrmAttendanceController, 'listCorrections', 'correction', 'hrm.request.read', (fa) => [req, undefined, undefined, fa]));
  it('đính chính hồ sơ', () => run(HrmProfileCorrectionController, 'list', 'profile_correction', 'hrm.request.read', (fa) => [req, undefined, undefined, fa]));
  it('tạm ứng lương', () => run(HrmSalaryController, 'listAdvanceRequests', 'advance', 'hrm.advance.read', (fa) => [req, undefined, undefined, fa]));

  it('quyền duyệt theo loại gồm cả duyệt trong phạm vi và duyệt toàn tenant', () => {
    expect(approverPermissions('leave')).toEqual(['hrm.leave.approve', 'hrm.leave.approve.all']);
    expect(approverPermissions('advance')).toEqual(['hrm.advance.approve', 'hrm.advance.approve.all']);
  });
});

describe('che dữ liệu nhạy cảm của hồ sơ', () => {
  const profile = {
    fullName: 'A',
    identityCardNumber: '0123',
    identityCardIssuedPlace: 'Hà Nội',
    taxCode: '999',
    socialInsuranceNumber: '77',
    bankAccountNumber: '123456',
    bankName: 'VCB',
    phone: '090',
  };

  it('xoá CCCD, MST, BHXH, ngân hàng; giữ trường còn lại', () => {
    const out = redactSensitiveProfile(profile);
    expect(out).toMatchObject({ fullName: 'A', phone: '090', identityCardNumber: null, taxCode: null, socialInsuranceNumber: null, bankAccountNumber: null, bankName: null });
    expect(profile.taxCode).toBe('999'); // không sửa đối tượng gốc
  });

  it('dạng dòng thô snake_case', () => {
    expect(redactSensitiveRow({ tax_code: '1', bank_name: 'B', phone: 'p' })).toEqual({ tax_code: null, bank_name: null, phone: 'p' });
  });

  it('danh sách nhân viên: người không có quyền nhạy cảm thấy null, người có quyền và chính chủ thấy đủ', async () => {
    const stamps = { join_date: '2024-01-01', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' };
    const rows = [
      { ...stamps, employee_id: 'e1', user_id: 'u1', employee_code: 'A1', full_name: 'A', identity_card_number: '0123', tax_code: '999', bank_account_number: '55' },
      { ...stamps, employee_id: 'e2', user_id: 'u2', employee_code: 'A2', full_name: 'B', identity_card_number: '0456', tax_code: '888', bank_account_number: '66' },
    ];
    const pool = {
      query: jest.fn(async (sql: string) => (sql.includes('count(*)') ? { rows: [{ total: 2 }] } : { rows })),
    };
    const make = (userId: string, sensitive: boolean) => {
      const controller = Object.create(HrmEmployeeController.prototype) as HrmEmployeeController;
      Object.assign(controller, {
        ctx: {
          getContext: jest.fn(async () => ({ pool, tenantId: 't', principal: { userId, permissions: ['hrm.employee.read', 'hrm.salary.read'] } })),
          has: (_c: unknown, permission: string) => (permission === 'hrm.employee.sensitive' ? sensitive : false),
        },
      });
      return controller;
    };
    const hidden = await make('hr', false).listEmployees(req);
    expect(hidden.data.map((p) => p.identityCardNumber)).toEqual([null, null]);
    const full = await make('hr', true).listEmployees(req);
    expect(full.data.map((p) => p.identityCardNumber)).toEqual(['0123', '0456']);
    const own = await make('u2', false).listEmployees(req);
    expect(own.data.map((p) => p.identityCardNumber)).toEqual([null, '0456']);
  });
});

describe('PATCH /my-profile: định danh phải qua đơn đính chính', () => {
  function controllerWith(current: Record<string, unknown>, fullName = 'Nguyễn A') {
    const queries: string[] = [];
    const pool = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT date_of_birth')) return { rows: [current] };
        if (sql.startsWith('UPDATE hrm_schema.employee_profiles'))
          return { rows: [{ ...current, phone: '0909', join_date: '2024-01-01', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' }] };
        return { rows: [] };
      }),
    };
    const controller = Object.create(HrmEmployeeController.prototype) as HrmEmployeeController;
    Object.assign(controller, {
      ctx: {
        getContext: jest.fn(async () => ({ pool, tenantId: 't', principal: { userId: 'u1' } })),
        resolveEmployee: jest.fn(async () => ({ employeeId: 'e1', fullName })),
      },
    });
    return { controller, queries };
  }
  const current = {
    date_of_birth: '1990-05-01',
    identity_card_number: '012345678',
    identity_card_issued_date: '2020-01-02',
    identity_card_issued_place: 'Cục CSQLHC',
  };

  it('đổi họ tên, ngày sinh hoặc CCCD thì bị từ chối kèm danh sách trường', async () => {
    const { controller, queries } = controllerWith(current);
    for (const [body, field] of [
      [{ fullName: 'Tên khác' }, 'fullName'],
      [{ dateOfBirth: '1991-05-01' }, 'dateOfBirth'],
      [{ identityCardNumber: '999' }, 'identityCardNumber'],
      [{ identityCardIssuedDate: '2021-01-01' }, 'identityCardIssuedDate'],
      [{ identityCardIssuedPlace: 'Nơi khác' }, 'identityCardIssuedPlace'],
    ] as const) {
      const error = await controller.updateMyProfile(req, body as never).catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({ code: 'HRM_PROFILE_CHANGE_REQUIRES_APPROVAL', fields: [field] });
    }
    expect(queries.some((q) => q.startsWith('UPDATE'))).toBe(false); // không ghi gì
  });

  it('gửi lại đúng giá trị cũ cùng thay đổi liên hệ thì cho phép và không đụng trường định danh', async () => {
    const { controller, queries } = controllerWith(current);
    await controller.updateMyProfile(req, {
      fullName: 'Nguyễn A',
      dateOfBirth: '1990-05-01',
      identityCardNumber: '012345678',
      phone: '0909',
      currentAddress: 'Số 1',
    } as never);
    const update = queries.find((q) => q.startsWith('UPDATE hrm_schema.employee_profiles'))!;
    expect(update).toContain('phone');
    expect(update).toContain('current_address');
    for (const col of ['date_of_birth', 'identity_card_number', 'identity_card_issued_date', 'identity_card_issued_place']) expect(update).not.toContain(col);
    expect(queries.some((q) => q.includes('UPDATE core_schema.employees'))).toBe(false); // không còn đổi họ tên trực tiếp
  });
});

describe('Bảng công của tôi và dữ liệu chấm công', () => {
  it('my-timesheet luôn lọc theo nhân viên của tài khoản và tính tổng', async () => {
    const calls: unknown[][] = [];
    const pool = {
      query: jest.fn(async (...args: unknown[]) => {
        calls.push(args);
        return {
          rows: [
            { work_date: '2026-10-05', status: 'NORMAL', scheduled_minutes: 480, worked_minutes: 480, paid_minutes: 480, ot_minutes: 30, late_minutes: 5, early_leave_minutes: 0, workday_units: '1', is_manually_adjusted: false, period_code: 'P10', period_status: 'LOCKED', shift_code: 'HC', shift_name: 'Hành chính' },
            { work_date: '2026-10-06', status: 'ABSENT', scheduled_minutes: 480, worked_minutes: 0, paid_minutes: 0, ot_minutes: 0, late_minutes: 0, early_leave_minutes: 0, workday_units: '0', is_manually_adjusted: false, period_code: 'P10', period_status: 'OPEN', shift_code: 'HC', shift_name: 'Hành chính' },
          ],
        };
      }),
    };
    const controller = Object.create(HrmTimesheetController.prototype) as HrmTimesheetController;
    const getContext = jest.fn(async () => ({ pool, tenantId: 't', principal: { userId: 'u1' } }));
    Object.assign(controller, { ctx: { getContext, resolveEmployee: jest.fn(async () => ({ employeeId: 'e-own' })) } });
    const result = await controller.myTimesheet(req, '2026-10-01', '2026-10-31');
    expect(getContext).toHaveBeenCalledWith(req, 'hrm.self.read');
    expect((calls[0][1] as unknown[])[1]).toBe('e-own');
    expect(result.data[0]).toMatchObject({ workDate: '2026-10-05', periodStatus: 'LOCKED', otMinutes: 30 });
    expect(result.meta.summary).toMatchObject({ workdayUnits: 1, paidMinutes: 480, otMinutes: 30, lateMinutes: 5 });
    await expect(controller.myTimesheet(req, '2026-01-01', '2026-12-31')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('attendance-data cần quyền xem chấm công toàn tenant, kiểm tra khoảng ngày và trạng thái', async () => {
    const pool = { query: jest.fn(async (sql: string) => (sql.includes('count(*)') ? { rows: [{ total: 1 }] } : { rows: [{ id: 'a1', employee_id: 'e1', employee_code: 'NV1', full_name: 'A', department_name: 'Kế toán', work_date: '2026-10-05', check_in_at: '2026-10-05T01:00:00Z', check_out_at: null, worked_minutes: 0, scheduled_minutes: 480, late_minutes: 12, early_minutes: 0, status: 'LATE', attendance_source: 'WEB_PORTAL' }] })) };
    const getContext = jest.fn(async (_r: Request, permission: string) => {
      if (permission !== 'hrm.attendance.read') throw new ForbiddenException('thiếu quyền');
      return { pool, tenantId: 't', principal: { userId: 'u1' } };
    });
    const controller = Object.create(HrmAttendanceController.prototype) as HrmAttendanceController;
    Object.assign(controller, { ctx: { getContext } });
    const result = await controller.attendanceData(req, '2026-10-01', '2026-10-31', 'LATE');
    expect(getContext).toHaveBeenCalledWith(req, 'hrm.attendance.read');
    expect(result.data[0]).toMatchObject({ employeeCode: 'NV1', lateMinutes: 12, scheduledMinutes: 480, status: 'LATE' });
    expect(result.meta).toEqual({ total: 1, page: 1, pageSize: 50 });
    await expect(controller.attendanceData(req, '2026-10-01', '2026-10-31', 'KHONG_CO')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.attendanceData(req, '2026-01-01', '2026-12-31')).rejects.toBeInstanceOf(BadRequestException);
    Object.assign(controller, { ctx: { getContext: jest.fn(async () => { throw new ForbiddenException('thiếu quyền'); }) } });
    await expect(controller.attendanceData(req, '2026-10-01', '2026-10-31')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
