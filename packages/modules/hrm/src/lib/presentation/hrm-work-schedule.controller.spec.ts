import 'reflect-metadata';
import { expandTenantActions, HRM_ROLE_TEMPLATES } from '@enterprise-platform/contracts-identity';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { HrmWorkScheduleController } from './hrm-work-schedule.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));
jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));

const E1 = '00000000-0000-4000-8000-0000000000e1';
const E2 = '00000000-0000-4000-8000-0000000000e2';
const UNIT = '00000000-0000-4000-8000-0000000000d1';
const SHIFT = '00000000-0000-4000-8000-0000000000a1';
const req = { headers: {} } as Request;
const pattern = [{ weekday: 1, dayType: 'SHIFT' as const, shiftId: SHIFT }];
const dates = { fromDate: '2026-10-05', toDate: '2026-10-09' };

/** Controller với bộ quyền cho trước; ghi lại mọi lần kiểm quyền và chặn ngay sau đó (không cần DB). */
function setup(held: string[]) {
  const asked: string[] = [];
  const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
  const stop = jest.fn(async () => {
    throw new Error('STOP_AT_DATABASE');
  });
  const getContext = jest.fn(async (_req: Request, permission: string) => {
    asked.push(permission);
    if (!held.includes(permission)) throw new ForbiddenException(`missing ${permission}`);
    // Có quyền thì cho đi tiếp; dừng ngay khi controller bắt đầu chạm DB (chỉ cần kiểm tra lớp quyền).
    return { pool: { query: stop, connect: stop }, tenantId: 't', principal: { userId: 'u' } };
  });
  const controller = new HrmWorkScheduleController({ getContext } as never);
  return { controller, asked, query, getContext };
}

const all = ['hrm.schedule.read', 'hrm.schedule.manage', 'hrm.schedule.bulk', 'hrm.schedule.calendar'];

describe('13. phân quyền phân ca kiểm ở backend', () => {
  it('xem lịch cần hrm.schedule.read; thiếu thì bị chặn trước khi chạm DB', async () => {
    const { controller, query } = setup([]);
    await expect(controller.grid(req, { from: '2026-10-01', to: '2026-10-31' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.list(req, { from: '2026-10-01', to: '2026-10-31' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.exportSchedule(req, { from: '2026-10-01', to: '2026-10-31' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.audit(req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.listTemplates(req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.listHolidays(req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('chỉ có quyền xem thì không thao tác ghi được', async () => {
    const { controller } = setup(['hrm.schedule.read']);
    const body = { scope: { type: 'EMPLOYEE' as const, employeeIds: [E1] }, pattern, ...dates };
    await expect(controller.apply(req, body)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.preview(req, body)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.cancel(req, { scope: body.scope, ...dates })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.createTemplate(req, { code: 'HC', name: 'HC', days: pattern })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.updateTemplate(req, E1, { code: 'HC', name: 'HC', days: pattern })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.createHoliday(req, { name: 'Lễ', kind: 'HOLIDAY', ...dates, scope: { type: 'COMPANY' }, treatment: 'OFF' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.cancelHoliday(req, E1)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gán cho một nhân viên cần quyền tạo/gán', async () => {
    const { controller, asked } = setup(all);
    await controller
      .apply(req, { scope: { type: 'EMPLOYEE', employeeIds: [E1] }, pattern, ...dates })
      .catch(() => undefined);
    expect(asked).toEqual(['hrm.schedule.manage']);
  });

  it('nhiều nhân viên, phòng ban và toàn công ty cần quyền hàng loạt', async () => {
    for (const scope of [
      { type: 'EMPLOYEES' as const, employeeIds: [E1, E2] },
      { type: 'UNIT' as const, unitIds: [UNIT] },
      { type: 'COMPANY' as const },
    ]) {
      const { controller, asked } = setup(all);
      await controller.apply(req, { scope, pattern, ...dates, confirm: true }).catch(() => undefined);
      expect(asked).toEqual(['hrm.schedule.bulk']);
    }
  });

  it('người chỉ có quyền gán từng người không phân ca hàng loạt được', async () => {
    const { controller } = setup(['hrm.schedule.read', 'hrm.schedule.manage']);
    await expect(controller.apply(req, { scope: { type: 'COMPANY' }, pattern, ...dates })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.apply(req, { scope: { type: 'UNIT', unitIds: [UNIT] }, pattern, ...dates })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.preview(req, { scope: { type: 'EMPLOYEES', employeeIds: [E1, E2] }, pattern, ...dates })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ngoại lệ và ghi đè tất cả cần thêm quyền lịch lễ/ngoại lệ', async () => {
    const exception = setup(all);
    await exception.controller
      .apply(req, { kind: 'EXCEPTION', scope: { type: 'EMPLOYEE', employeeIds: [E1] }, pattern, ...dates })
      .catch(() => undefined);
    expect(exception.asked).toEqual(['hrm.schedule.manage', 'hrm.schedule.calendar']);

    const noCalendar = setup(['hrm.schedule.read', 'hrm.schedule.manage', 'hrm.schedule.bulk']);
    await expect(
      noCalendar.controller.apply(req, { kind: 'EXCEPTION', scope: { type: 'EMPLOYEE', employeeIds: [E1] }, pattern, ...dates }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      noCalendar.controller.apply(req, { scope: { type: 'EMPLOYEES', employeeIds: [E1, E2] }, pattern, ...dates, conflictMode: 'OVERWRITE_ALL' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('huỷ lịch kèm ngoại lệ cần quyền lịch lễ/ngoại lệ', async () => {
    const { controller } = setup(['hrm.schedule.read', 'hrm.schedule.manage']);
    await expect(
      controller.cancel(req, { scope: { type: 'EMPLOYEE', employeeIds: [E1] }, ...dates, includeExceptions: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ngày lễ chỉ cần quyền lịch lễ/ngoại lệ', async () => {
    const { controller, asked } = setup(all);
    await controller
      .createHoliday(req, { name: 'Quốc khánh', kind: 'HOLIDAY', fromDate: '2026-09-02', toDate: '2026-09-02', scope: { type: 'COMPANY' }, treatment: 'OFF' })
      .catch(() => undefined);
    expect(asked).toEqual(['hrm.schedule.calendar']);
  });

  it('phạm vi sai bị từ chối 400 trước khi kiểm quyền hay chạm DB', async () => {
    const { controller, getContext } = setup(all);
    await expect(controller.apply(req, { scope: { type: 'EMPLOYEE', employeeIds: [] }, pattern, ...dates })).rejects.toMatchObject({ status: 400 });
    expect(getContext).not.toHaveBeenCalled();
  });
});

describe('vai trò mẫu và quyền phụ thuộc', () => {
  it('chấm công viên được phân ca đầy đủ', () => {
    const template = HRM_ROLE_TEMPLATES.find((r) => r.key === 'timekeeper')!;
    const granted = new Set(expandTenantActions([...template.actions]));
    for (const key of all) expect(granted.has(key)).toBe(true);
  });

  it('quyền hàng loạt kéo theo gán và xem; quyền gán kéo theo xem', () => {
    const bulk = new Set(expandTenantActions(['hrm.schedule.bulk']));
    expect(bulk.has('hrm.schedule.manage') && bulk.has('hrm.schedule.read')).toBe(true);
    const manage = new Set(expandTenantActions(['hrm.schedule.manage']));
    expect(manage.has('hrm.schedule.read')).toBe(true);
    expect(manage.has('hrm.schedule.bulk')).toBe(false);
    expect(manage.has('hrm.schedule.calendar')).toBe(false);
  });

  it('quyền xem không kéo theo quyền ghi', () => {
    const read = new Set(expandTenantActions(['hrm.schedule.read']));
    for (const key of ['hrm.schedule.manage', 'hrm.schedule.bulk', 'hrm.schedule.calendar']) expect(read.has(key)).toBe(false);
  });

  it('quản trị HRM có đủ quyền phân ca', () => {
    const manage = new Set(expandTenantActions(['hrm.manage']));
    for (const key of all) expect(manage.has(key)).toBe(true);
  });
});

describe('lịch định kỳ không có ngày kết thúc: phân quyền', () => {
  const RULE = '00000000-0000-4000-8000-0000000000c1';
  /** pool trả về phạm vi của lịch định kỳ; chạm vào transaction thì dừng. */
  function ruleSetup(held: string[], scopeType: 'EMPLOYEE' | 'UNIT' | 'COMPANY') {
    const asked: string[] = [];
    const stop = jest.fn(async () => {
      throw new Error('STOP_AT_DATABASE');
    });
    const pool = {
      query: jest.fn(async () => ({ rows: [{ scope_type: scopeType }], rowCount: 1 })),
      connect: stop,
    };
    const getContext = jest.fn(async (_req: Request, permission: string) => {
      asked.push(permission);
      if (!held.includes(permission)) throw new ForbiddenException(`missing ${permission}`);
      return { pool, tenantId: 't', principal: { userId: 'u' } };
    });
    return { controller: new HrmWorkScheduleController({ getContext } as never), asked, pool };
  }

  it('xem danh sách lịch định kỳ cần quyền xem', async () => {
    const { controller } = ruleSetup([], 'COMPANY');
    await expect(controller.rules(req)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gán không có ngày kết thúc dùng cùng quy tắc quyền: một người cần gán, còn lại cần hàng loạt', async () => {
    const single = setup(all);
    await single.controller.apply(req, { scope: { type: 'EMPLOYEE', employeeIds: [E1] }, pattern, fromDate: '2026-11-01' }).catch(() => undefined);
    expect(single.asked).toEqual(['hrm.schedule.manage']);
    for (const scope of [{ type: 'UNIT' as const, unitIds: [UNIT] }, { type: 'COMPANY' as const }]) {
      const bulk = setup(all);
      await bulk.controller.apply(req, { scope, pattern, fromDate: '2026-11-01', confirm: true }).catch(() => undefined);
      expect(bulk.asked).toEqual(['hrm.schedule.bulk']);
    }
    const noBulk = setup(['hrm.schedule.read', 'hrm.schedule.manage']);
    await expect(noBulk.controller.apply(req, { scope: { type: 'COMPANY' }, pattern, fromDate: '2026-11-01' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(noBulk.controller.preview(req, { scope: { type: 'UNIT', unitIds: [UNIT] }, pattern, fromDate: '2026-11-01' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('kết thúc / huỷ lịch của một nhân viên chỉ cần quyền gán', async () => {
    const end = ruleSetup(['hrm.schedule.manage'], 'EMPLOYEE');
    await end.controller.endRule(req, RULE, { endDate: '2026-12-31' }).catch(() => undefined);
    expect(end.asked).toEqual(['hrm.schedule.manage']);
    const cancel = ruleSetup(['hrm.schedule.manage'], 'EMPLOYEE');
    await cancel.controller.cancelRule(req, RULE).catch(() => undefined);
    expect(cancel.asked).toEqual(['hrm.schedule.manage']);
  });

  it('kết thúc / huỷ lịch của phòng ban hoặc toàn công ty cần thêm quyền hàng loạt', async () => {
    for (const scopeType of ['UNIT', 'COMPANY'] as const) {
      const denied = ruleSetup(['hrm.schedule.manage'], scopeType);
      await expect(denied.controller.endRule(req, RULE, { endDate: '2026-12-31' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(denied.controller.cancelRule(req, RULE)).rejects.toBeInstanceOf(ForbiddenException);
      const allowed = ruleSetup(['hrm.schedule.manage', 'hrm.schedule.bulk'], scopeType);
      await allowed.controller.endRule(req, RULE, { endDate: '2026-12-31' }).catch(() => undefined);
      expect(allowed.asked).toEqual(['hrm.schedule.manage', 'hrm.schedule.bulk']);
    }
  });

  it('thiếu quyền gán thì không biết cả lịch định kỳ có tồn tại hay không (chặn trước khi tra DB)', async () => {
    const { controller, pool } = ruleSetup([], 'COMPANY');
    await expect(controller.endRule(req, RULE, { endDate: '2026-12-31' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
