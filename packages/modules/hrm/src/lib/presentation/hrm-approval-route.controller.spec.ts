import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { HrmApprovalRouteController } from './hrm-approval-route.controller';
import { saveHrmProcedureBinding } from '../infrastructure/hrm-procedure-links.js';
import { fetchPublishedProcedureDefinition } from '../infrastructure/hrm-procedure-api.js';
import { procedureDefinitions } from '../infrastructure/hrm-work-references.js';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));
jest.mock('@enterprise-platform/platform-identity', () => ({ PlatformIdentityService: class {} }));
jest.mock('jose', () => ({ createRemoteJWKSet: jest.fn(), jwtVerify: jest.fn() }));
jest.mock('../infrastructure/hrm-work-references.js', () => ({ procedureDefinitions: jest.fn() }));
jest.mock('../infrastructure/hrm-procedure-api.js', () => ({
  ...jest.requireActual('../infrastructure/hrm-procedure-api.js'),
  fetchPublishedProcedureDefinition: jest.fn(),
}));
jest.mock('../infrastructure/hrm-procedure-links.js', () => ({
  ...jest.requireActual('../infrastructure/hrm-procedure-links.js'),
  saveHrmProcedureBinding: jest.fn(),
}));

const TENANT = '00000000-0000-4000-8000-000000000001';
const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const OWN = '00000000-0000-4000-8000-0000000000e1';
const OTHER = '00000000-0000-4000-8000-0000000000e2';
const MANAGER = '00000000-0000-4000-8000-0000000000e3';
const PROC_A = '00000000-0000-4000-8000-0000000000d1';
const PROC_B = '00000000-0000-4000-8000-0000000000d2';
const LT_SICK = '00000000-0000-4000-8000-0000000000f1';
const LT_UNPAID = '00000000-0000-4000-8000-0000000000f2';
const RS_OT_WORK = '00000000-0000-4000-8000-0000000000f3';
const req = { headers: {} } as Request;

interface Call {
  sql: string;
  params: unknown[];
}
interface Data {
  bindings?: Record<string, unknown>[];
  leaveTypes?: { id: string; code: string; name: string }[];
  reasons?: { id: string; kind: string; code: string; name: string }[];
  manager?: Record<string, unknown> | null;
  allowSelf?: boolean;
  defaultBindingExists?: boolean;
}

const binding = (
  id: string,
  kind: string,
  sub: string | null,
  mode: 'DIRECT' | 'PROCEDURE',
  proc: string | null = null,
) => ({ id, request_kind: kind, sub_type_code: sub, mode, procedure_definition_id: proc, configuration_status: 'ACTIVE' });

function build(data: Data = {}, permissions: string[] = ['hrm.automation.manage']) {
  const calls: Call[] = [];
  const bindings = data.bindings ?? [];
  const leaveTypes = data.leaveTypes ?? [];
  const reasons = data.reasons ?? [];
  const run = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('to_regclass')) return { rows: [{ ready: true }], rowCount: 1 };
    if (sql.includes('allow_self_approval'))
      return { rows: [{ allow_self_approval: data.allowSelf === true }], rowCount: 1 };
    if (sql.includes('FROM hrm_schema.employee_reporting_lines'))
      return { rows: data.manager ? [data.manager] : [], rowCount: data.manager ? 1 : 0 };
    if (sql.includes('FROM hrm_schema.request_procedure_bindings')) {
      if (sql.includes('sub_type_code IS NULL AND is_active LIMIT 1'))
        return { rows: data.defaultBindingExists === false ? [] : [{ '?column?': 1 }], rowCount: 1 };
      if (sql.includes('FOR UPDATE')) return { rows: bindings.filter((b) => b.sub_type_code === params[2]), rowCount: 0 };
      // xem trước: đã lọc theo loại đơn và mã lý do ($3)
      if (sql.includes('request_kind=$2'))
        return {
          rows: bindings.filter(
            (b) => b.request_kind === params[1] && (b.sub_type_code == null || b.sub_type_code === params[2]),
          ),
          rowCount: 1,
        };
      return { rows: bindings, rowCount: bindings.length };
    }
    if (sql.includes('FROM hrm_schema.leave_types')) {
      if (sql.includes('active=true')) return { rows: leaveTypes, rowCount: leaveTypes.length };
      const found = leaveTypes.filter((l) => (sql.includes('id=$2') ? l.id === params[1] : l.code === params[1]));
      return { rows: found, rowCount: found.length };
    }
    if (sql.includes('FROM hrm_schema.request_reasons')) {
      if (sql.includes('active=true')) return { rows: reasons, rowCount: reasons.length };
      const found = reasons.filter(
        (r) =>
          r.kind === params[2] &&
          (sql.includes('id=$2') ? r.id === params[1] : r.code.toUpperCase() === String(params[1]).toUpperCase()),
      );
      return { rows: found, rowCount: found.length };
    }
    return { rows: [], rowCount: 0 };
  };
  const client = { query: jest.fn(run), release: jest.fn() };
  const pool = { query: jest.fn(run), connect: jest.fn(async () => client) };
  const principal = { userId: ACTOR, permissions };
  const ctx = {
    getContext: jest.fn(async (_r: unknown, required?: string) => {
      if (required && required !== 'hrm.read' && !permissions.includes(required) && !permissions.includes('hrm.manage'))
        throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
      return { pool, tenantId: TENANT, principal };
    }),
    getRequestContext: jest.fn(async (_r: unknown, employeeId?: string, other?: string, self?: string) => {
      const need = employeeId && employeeId !== OWN ? other : self;
      if (need && !permissions.includes(need)) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
      return { pool, tenantId: TENANT, principal, employeeId: employeeId ?? OWN };
    }),
    has: jest.fn((_c: unknown, p: string) => permissions.includes(p) || permissions.includes('hrm.manage')),
    procedureAvailable: jest.fn(async () => true),
  };
  const controller = Object.create(HrmApprovalRouteController.prototype) as HrmApprovalRouteController;
  Object.assign(controller, { ctx });
  return { controller, ctx, calls, pool, client };
}

const save = saveHrmProcedureBinding as jest.Mock;
const fetchDefinition = fetchPublishedProcedureDefinition as jest.Mock;
const listDefinitions = procedureDefinitions as jest.Mock;

beforeEach(() => {
  save.mockReset().mockResolvedValue({ id: 'binding-new' });
  fetchDefinition.mockReset().mockImplementation(async (_t: string, id: string) => ({
    id,
    name: id === PROC_A ? 'Quy trình duyệt nghỉ không lương' : 'Quy trình chung',
    steps: [],
  }));
  listDefinitions.mockReset().mockResolvedValue([{ id: PROC_A, code: 'A', name: 'A' }]);
});

describe('GET /approval-config', () => {
  it('luôn đủ 7 loại đơn, mặc định quản lý trực tiếp khi chưa có cấu hình', async () => {
    const { controller, ctx } = build();
    const { data } = await controller.getConfig(req);
    expect(ctx.getContext).toHaveBeenCalledWith(req, 'hrm.automation.manage');
    expect(data.items.map((i) => [i.requestKind, i.label])).toEqual([
      ['leave', 'Nghỉ phép'],
      ['ot', 'Làm thêm giờ'],
      ['business_trip', 'Công tác'],
      ['shift_change', 'Đổi ca'],
      ['correction', 'Giải trình công'],
      ['advance', 'Ứng lương'],
      ['profile_correction', 'Đính chính hồ sơ'],
    ]);
    for (const item of data.items) {
      expect(item).toMatchObject({ mode: 'DIRECT', procedureDefinitionId: null, procedureName: null, inherited: false, bindingId: null });
      expect(item.reasonCode).toBeNull();
    }
    expect(data.procedureAvailable).toBe(true);
    expect(fetchDefinition).not.toHaveBeenCalled();
  });

  it('thêm dòng cho từng lý do (loại nghỉ và danh mục lý do), kế thừa cấu hình chung khi chưa có riêng', async () => {
    const { controller } = build({
      bindings: [
        binding('b-leave', 'leave', null, 'PROCEDURE', PROC_B),
        binding('b-unpaid', 'leave', 'UNPAID', 'PROCEDURE', PROC_A),
        binding('b-ot', 'ot', null, 'DIRECT'),
      ],
      leaveTypes: [
        { id: LT_SICK, code: 'SICK', name: 'Nghỉ ốm' },
        { id: LT_UNPAID, code: 'UNPAID', name: 'Nghỉ không lương' },
      ],
      reasons: [{ id: RS_OT_WORK, kind: 'OVERTIME', code: 'OT_WORK', name: 'Theo yêu cầu công việc' }],
    });
    const { data } = await controller.getConfig(req);
    const byLabel = new Map(data.items.map((i) => [i.label, i]));

    expect(data.items.map((i) => i.label)).toEqual([
      'Nghỉ phép',
      'Nghỉ phép · Nghỉ ốm',
      'Nghỉ phép · Nghỉ không lương',
      'Làm thêm giờ',
      'Làm thêm giờ · Theo yêu cầu công việc',
      'Công tác',
      'Đổi ca',
      'Giải trình công',
      'Ứng lương',
      'Đính chính hồ sơ',
    ]);
    expect(byLabel.get('Nghỉ phép')).toMatchObject({
      mode: 'PROCEDURE',
      procedureDefinitionId: PROC_B,
      procedureName: 'Quy trình chung',
      bindingId: 'b-leave',
      inherited: false,
    });
    // chưa có cấu hình riêng: dùng cấu hình chung của đơn nghỉ
    expect(byLabel.get('Nghỉ phép · Nghỉ ốm')).toMatchObject({
      reasonId: LT_SICK,
      reasonCode: 'SICK',
      reasonName: 'Nghỉ ốm',
      mode: 'PROCEDURE',
      procedureDefinitionId: PROC_B,
      inherited: true,
      bindingId: null,
    });
    // có cấu hình riêng: thắng cấu hình chung
    expect(byLabel.get('Nghỉ phép · Nghỉ không lương')).toMatchObject({
      reasonCode: 'UNPAID',
      mode: 'PROCEDURE',
      procedureDefinitionId: PROC_A,
      procedureName: 'Quy trình duyệt nghỉ không lương',
      inherited: false,
      bindingId: 'b-unpaid',
    });
    // lý do của đơn làm thêm giờ lấy từ danh mục lý do, kế thừa cấu hình chung (quản lý trực tiếp)
    expect(byLabel.get('Làm thêm giờ · Theo yêu cầu công việc')).toMatchObject({
      requestKind: 'ot',
      reasonId: RS_OT_WORK,
      reasonCode: 'OT_WORK',
      mode: 'DIRECT',
      inherited: true,
    });
  });

  it('cấu hình riêng DIRECT thắng cấu hình chung PROCEDURE', async () => {
    const { controller } = build({
      bindings: [binding('b1', 'leave', null, 'PROCEDURE', PROC_B), binding('b2', 'leave', 'SICK', 'DIRECT')],
      leaveTypes: [{ id: LT_SICK, code: 'SICK', name: 'Nghỉ ốm' }],
    });
    const { data } = await controller.getConfig(req);
    expect(data.items.find((i) => i.reasonCode === 'SICK')).toMatchObject({ mode: 'DIRECT', inherited: false, procedureName: null });
  });

  it('Procedure không khả dụng: không gọi tra tên, tên quy trình để null', async () => {
    const { controller, ctx } = build({ bindings: [binding('b1', 'leave', null, 'PROCEDURE', PROC_B)] });
    ctx.procedureAvailable.mockResolvedValue(false);
    const { data } = await controller.getConfig(req);
    expect(fetchDefinition).not.toHaveBeenCalled();
    expect(data.procedureAvailable).toBe(false);
    expect(data.items[0]).toMatchObject({ mode: 'PROCEDURE', procedureDefinitionId: PROC_B, procedureName: null });
  });

  it('thiếu quyền thì bị từ chối', async () => {
    const { controller } = build({}, ['hrm.self.read']);
    await expect(controller.getConfig(req)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('PUT /approval-config', () => {
  it('DIRECT cho loại đơn: lưu binding DIRECT chung qua hàm lưu có sẵn, không gọi Procedure', async () => {
    const { controller, ctx, client } = build();
    const result = await controller.putConfig(req, { requestKind: 'ot', mode: 'DIRECT' });
    expect(ctx.getContext).toHaveBeenCalledWith(req, 'hrm.automation.manage');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(client, {
      tenantId: TENANT,
      kind: 'ot',
      subTypeCode: undefined,
      mode: 'DIRECT',
      definitionId: undefined,
      actorId: ACTOR,
    });
    expect(ctx.procedureAvailable).toHaveBeenCalledTimes(1); // chỉ để dựng phản hồi, không để kiểm tra lưu
    expect(listDefinitions).not.toHaveBeenCalled();
    expect(result.data.items).toHaveLength(7);
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));
  });

  it('PROCEDURE cho loại đơn: kiểm tra Procedure dùng được và quy trình đã công bố, rồi lưu', async () => {
    const { controller, ctx, client } = build();
    save.mockResolvedValue({ id: 'b', warnings: ['Bước đầu không phải bước S'] });
    const result = await controller.putConfig(req, { requestKind: 'leave', mode: 'PROCEDURE', procedureDefinitionId: PROC_A });
    expect(ctx.procedureAvailable).toHaveBeenCalledWith(TENANT);
    expect(listDefinitions).toHaveBeenCalledWith(req, TENANT);
    expect(save).toHaveBeenCalledWith(client, {
      tenantId: TENANT,
      kind: 'leave',
      subTypeCode: undefined,
      mode: 'PROCEDURE',
      definitionId: PROC_A,
      actorId: ACTOR,
    });
    expect(result.data.warnings).toEqual(['Bước đầu không phải bước S']);
  });

  it('PROCEDURE cho một lý do nghỉ: lưu theo mã lý do rồi bảo đảm có binding DIRECT chung cho loại đơn', async () => {
    const { controller, client } = build({
      leaveTypes: [{ id: LT_UNPAID, code: 'UNPAID', name: 'Nghỉ không lương' }],
      defaultBindingExists: false,
    });
    await controller.putConfig(req, { requestKind: 'leave', reasonCode: 'UNPAID', mode: 'PROCEDURE', procedureDefinitionId: PROC_A });
    expect(save).toHaveBeenNthCalledWith(1, client, {
      tenantId: TENANT,
      kind: 'leave',
      subTypeCode: 'UNPAID',
      mode: 'PROCEDURE',
      definitionId: PROC_A,
      actorId: ACTOR,
    });
    expect(save).toHaveBeenNthCalledWith(2, client, { tenantId: TENANT, kind: 'leave', mode: 'DIRECT', actorId: ACTOR });
  });

  it('DIRECT cho một lý do của đơn làm thêm giờ: dùng mã gốc trong danh mục, không đụng binding chung đã có', async () => {
    const { controller, client } = build({
      reasons: [{ id: RS_OT_WORK, kind: 'OVERTIME', code: 'OT_WORK', name: 'Theo yêu cầu công việc' }],
      defaultBindingExists: true,
    });
    await controller.putConfig(req, { requestKind: 'ot', reasonCode: 'ot_work', mode: 'DIRECT' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(client, {
      tenantId: TENANT,
      kind: 'ot',
      subTypeCode: 'OT_WORK',
      mode: 'DIRECT',
      definitionId: undefined,
      actorId: ACTOR,
    });
  });

  it('INHERIT gỡ cấu hình riêng của lý do và ghi audit', async () => {
    const { controller, calls } = build({
      bindings: [binding('b-unpaid', 'leave', 'UNPAID', 'PROCEDURE', PROC_A)],
      leaveTypes: [{ id: LT_UNPAID, code: 'UNPAID', name: 'Nghỉ không lương' }],
    });
    await controller.putConfig(req, { requestKind: 'leave', reasonCode: 'UNPAID', mode: 'INHERIT' });
    expect(save).not.toHaveBeenCalled();
    const update = calls.find((c) => c.sql.includes('SET is_active=false'));
    expect(update?.params).toEqual([TENANT, 'leave', 'UNPAID', ACTOR]);
    const audit = calls.find((c) => c.sql.includes('audit_log'));
    expect(audit?.params[2]).toBe('b-unpaid');
  });

  it('PROCEDURE thiếu procedureDefinitionId bị từ chối trước khi chạm DB hay Procedure', async () => {
    const { controller, pool } = build();
    await expect(controller.putConfig(req, { requestKind: 'leave', mode: 'PROCEDURE' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.putConfig(req, { requestKind: 'leave', mode: 'PROCEDURE', procedureDefinitionId: 'khong-phai-uuid' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(listDefinitions).not.toHaveBeenCalled();
  });

  it('Procedure không khả dụng: từ chối cấu hình PROCEDURE bằng thông báo tiếng Việt, không lưu', async () => {
    const { controller, ctx } = build();
    ctx.procedureAvailable.mockResolvedValue(false);
    await expect(
      controller.putConfig(req, { requestKind: 'leave', mode: 'PROCEDURE', procedureDefinitionId: PROC_A }),
    ).rejects.toMatchObject({
      response: { code: 'PROCEDURE_UNAVAILABLE', message: expect.stringContaining('Procedure Engine') },
    });
    await expect(
      controller.putConfig(req, { requestKind: 'leave', mode: 'PROCEDURE', procedureDefinitionId: PROC_A }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(save).not.toHaveBeenCalled();
  });

  it('quy trình không nằm trong danh sách đã công bố của tenant thì từ chối', async () => {
    const { controller } = build();
    await expect(
      controller.putConfig(req, { requestKind: 'leave', mode: 'PROCEDURE', procedureDefinitionId: PROC_B }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('DIRECT vẫn lưu được khi Procedure không khả dụng (chuyển về quản lý trực tiếp)', async () => {
    const { controller, ctx } = build();
    ctx.procedureAvailable.mockResolvedValue(false);
    await controller.putConfig(req, { requestKind: 'leave', mode: 'DIRECT' });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('từ chối dữ liệu sai: loại đơn, chế độ, lý do cho loại đơn không có lý do, INHERIT không có lý do', async () => {
    const { controller, pool } = build();
    const bad: unknown[] = [
      undefined,
      { requestKind: 'khong-co', mode: 'DIRECT' },
      { requestKind: 'leave', mode: 'AUTO' },
      { requestKind: 'advance', reasonCode: 'X', mode: 'DIRECT' },
      { requestKind: 'profile_correction', reasonCode: 'X', mode: 'DIRECT' },
      { requestKind: 'leave', mode: 'INHERIT' },
      { requestKind: 'leave', reasonCode: 7, mode: 'DIRECT' },
    ];
    for (const body of bad) await expect(controller.putConfig(req, body)).rejects.toBeInstanceOf(BadRequestException);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('mã lý do phải khớp một lý do có thật của đúng loại đơn', async () => {
    const { controller, client } = build({
      leaveTypes: [{ id: LT_SICK, code: 'SICK', name: 'Nghỉ ốm' }],
      reasons: [{ id: RS_OT_WORK, kind: 'OVERTIME', code: 'OT_WORK', name: 'Theo yêu cầu công việc' }],
    });
    // mã không tồn tại
    await expect(controller.putConfig(req, { requestKind: 'leave', reasonCode: 'NOPE', mode: 'DIRECT' })).rejects.toBeInstanceOf(NotFoundException);
    // mã của loại nghỉ không dùng được cho đơn làm thêm giờ và ngược lại
    await expect(controller.putConfig(req, { requestKind: 'ot', reasonCode: 'SICK', mode: 'DIRECT' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.putConfig(req, { requestKind: 'leave', reasonCode: 'OT_WORK', mode: 'DIRECT' })).rejects.toBeInstanceOf(NotFoundException);
    // mã lý do của danh mục khác loại đơn (công tác)
    await expect(controller.putConfig(req, { requestKind: 'business_trip', reasonCode: 'OT_WORK', mode: 'DIRECT' })).rejects.toBeInstanceOf(NotFoundException);
    expect(save).not.toHaveBeenCalled();
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
  });

  it('thiếu quyền thì không lưu', async () => {
    const { controller, pool } = build({}, ['hrm.request.manage']);
    await expect(controller.putConfig(req, { requestKind: 'leave', mode: 'DIRECT' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('hrm.manage đủ quyền cấu hình', async () => {
    const { controller } = build({}, ['hrm.manage']);
    await controller.putConfig(req, { requestKind: 'leave', mode: 'DIRECT' });
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('GET /approval-route (xem trước người duyệt)', () => {
  const managerRow = { manager_employee_id: MANAGER, full_name: 'Trần Quản Lý', work_email: 'q@x.vn', position_name: 'Trưởng phòng' };

  it('DIRECT có quản lý trực tiếp: trả tên và chức danh, chặn tự duyệt mặc định', async () => {
    const { controller, ctx, calls } = build({ manager: managerRow }, ['hrm.self.read']);
    const { data } = await controller.getRoute(req, 'leave');
    expect(ctx.getRequestContext).toHaveBeenCalledWith(req, undefined, 'hrm.request.read', 'hrm.self.read');
    expect(data).toEqual({
      mode: 'DIRECT',
      directManager: { employeeId: MANAGER, fullName: 'Trần Quản Lý', positionName: 'Trưởng phòng' },
      selfApprovalBlocked: true,
    });
    expect(calls.find((c) => c.sql.includes('employee_reporting_lines'))?.params).toEqual([TENANT, OWN]);
  });

  it('DIRECT chưa có quản lý trực tiếp: directManager null kèm ghi chú', async () => {
    const { controller } = build({ manager: null }, ['hrm.self.read']);
    const { data } = await controller.getRoute(req, 'ot');
    expect(data.mode).toBe('DIRECT');
    expect(data.directManager).toBeNull();
    expect(data.note).toBe('Chưa có quản lý trực tiếp; đơn do người có quyền duyệt toàn bộ xử lý');
  });

  it('tenant bật ngoại lệ tự duyệt thì selfApprovalBlocked = false', async () => {
    const { controller } = build({ manager: managerRow, allowSelf: true }, ['hrm.self.read']);
    expect((await controller.getRoute(req, 'leave')).data.selfApprovalBlocked).toBe(false);
  });

  it('PROCEDURE: trả tên quy trình đã gắn và không tra quản lý', async () => {
    const { controller, calls } = build({ bindings: [binding('b1', 'advance', null, 'PROCEDURE', PROC_B)] }, ['hrm.self.read']);
    const { data } = await controller.getRoute(req, 'advance');
    expect(data).toMatchObject({ mode: 'PROCEDURE', procedureName: 'Quy trình chung' });
    expect(data.directManager).toBeUndefined();
    expect(calls.some((c) => c.sql.includes('employee_reporting_lines'))).toBe(false);
  });

  it('đơn nghỉ: chọn cấu hình theo lý do (leave_types.id -> mã) trước, rồi mới tới cấu hình chung', async () => {
    const world: Data = {
      manager: managerRow,
      bindings: [binding('b1', 'leave', null, 'DIRECT'), binding('b2', 'leave', 'UNPAID', 'PROCEDURE', PROC_A)],
      leaveTypes: [
        { id: LT_SICK, code: 'SICK', name: 'Nghỉ ốm' },
        { id: LT_UNPAID, code: 'UNPAID', name: 'Nghỉ không lương' },
      ],
    };
    const { controller } = build(world, ['hrm.self.read']);
    const unpaid = await controller.getRoute(req, 'leave', undefined, LT_UNPAID);
    expect(unpaid.data).toMatchObject({ mode: 'PROCEDURE', procedureName: 'Quy trình duyệt nghỉ không lương' });
    const sick = await controller.getRoute(req, 'leave', undefined, LT_SICK);
    expect(sick.data.mode).toBe('DIRECT');
    expect(sick.data.directManager?.fullName).toBe('Trần Quản Lý');
  });

  it('đơn làm thêm giờ: reasonId là request_reasons.id', async () => {
    const { controller } = build(
      {
        bindings: [binding('b1', 'ot', null, 'DIRECT'), binding('b2', 'ot', 'OT_WORK', 'PROCEDURE', PROC_A)],
        reasons: [{ id: RS_OT_WORK, kind: 'OVERTIME', code: 'OT_WORK', name: 'Theo yêu cầu công việc' }],
      },
      ['hrm.self.read'],
    );
    const { data } = await controller.getRoute(req, 'ot', undefined, RS_OT_WORK);
    expect(data).toMatchObject({ mode: 'PROCEDURE', procedureName: 'Quy trình duyệt nghỉ không lương' });
    // lý do không thuộc loại đơn công tác thì không tìm thấy
    await expect(controller.getRoute(req, 'business_trip', undefined, RS_OT_WORK)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('không đọc được tên quy trình thì procedureName null kèm ghi chú, vẫn trả mode PROCEDURE', async () => {
    fetchDefinition.mockRejectedValue(new Error('PE down'));
    const { controller } = build({ bindings: [binding('b1', 'leave', null, 'PROCEDURE', PROC_A)] }, ['hrm.self.read']);
    const { data } = await controller.getRoute(req, 'leave');
    expect(data).toMatchObject({ mode: 'PROCEDURE', procedureName: null });
    expect(data.note).toContain('Procedure Engine');
  });

  it('quyền: chính chủ dùng hrm.self.read; người khác cần hrm.request.read hoặc hrm.request.manage', async () => {
    // chính chủ nêu rõ mã nhân viên của mình
    const own = build({}, ['hrm.self.read']);
    await own.controller.getRoute(req, 'leave', OWN);
    expect(own.ctx.getRequestContext).toHaveBeenCalledWith(req, OWN, 'hrm.request.read', 'hrm.self.read');

    // xem hộ người khác bằng hrm.request.read
    const reader = build({ manager: managerRow }, ['hrm.request.read']);
    const viewed = await reader.controller.getRoute(req, 'leave', OTHER);
    expect(reader.ctx.getRequestContext).not.toHaveBeenCalled();
    expect(viewed.data.directManager?.employeeId).toBe(MANAGER);
    expect(reader.calls.find((c) => c.sql.includes('employee_reporting_lines'))?.params).toEqual([TENANT, OTHER]);

    // hrm.request.manage (tạo đơn hộ) cũng được xem
    const manager = build({ manager: managerRow }, ['hrm.request.manage']);
    await manager.controller.getRoute(req, 'leave', OTHER);
    expect(manager.ctx.getRequestContext).not.toHaveBeenCalled();

    // chỉ có hrm.self.read thì không xem được người khác
    const self = build({ manager: managerRow }, ['hrm.self.read']);
    await expect(self.controller.getRoute(req, 'leave', OTHER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('tham số sai bị từ chối', async () => {
    const { controller } = build({}, ['hrm.self.read']);
    await expect(controller.getRoute(req)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getRoute(req, 'khong-co')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getRoute(req, 'leave', 'khong-phai-uuid')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getRoute(req, 'leave', undefined, 'khong-phai-uuid')).rejects.toBeInstanceOf(BadRequestException);
  });
});
