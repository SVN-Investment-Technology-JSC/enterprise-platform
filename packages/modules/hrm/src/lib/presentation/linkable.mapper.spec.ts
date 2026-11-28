import 'reflect-metadata';
import type {
  HrmBusinessTripRequest,
  HrmCustomRequest,
  HrmLeaveRequest,
  HrmOtRequest,
  HrmPersonnelDecision,
} from '@enterprise-platform/contracts-hrm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { HRM_REQUIRED_PERMISSION } from '../infrastructure/hrm-access.guard.js';
import { HrmCustomRequestController } from './hrm-custom-request.controller.js';
import { HrmEmployeeController } from './hrm-employee.controller.js';
import { HrmLeaveController } from './hrm-leave.controller.js';
import { HrmPersonnelDecisionController } from './hrm-personnel-decision.controller.js';
import { HrmRequestController } from './hrm-request.controller.js';
import { HrmLinkableController } from './linkable.controller.js';
import {
  HRM_LINKABLE_KIND_LIST,
  customObject,
  decisionCandidate,
  decisionObject,
  hrmLaunchUrl,
  hrmLinkablePeople,
  isHrmLinkableKind,
  leaveCandidate,
  leaveObject,
  matchesLinkableQuery,
  otCandidate,
  otObject,
  tripObject,
  vnDate,
} from './linkable.mapper.js';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));
jest.mock('../infrastructure/hrm-procedure-bridge.service.js', () => ({ HrmProcedureBridgeService: class {} }));

const EMP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = 'user-a';
const USER_B = 'user-b';
const people = hrmLinkablePeople([
  { employeeId: EMP_A, employeeCode: 'NV001', fullName: 'Nguyễn Văn An', department: 'Phòng Kỹ thuật', userId: USER_A },
  { employeeId: EMP_B, employeeCode: 'NV002', fullName: 'Trần Thị Bình', department: 'Phòng Nhân sự', userId: USER_B },
]);

const common = {
  tenantId: 't',
  employeeId: EMP_A,
  reasonId: 'r-1',
  reasonName: 'Hoàn thành dự án',
  description: 'Lắp đặt tủ điện nhà máy A',
  reason: 'Lắp đặt tủ điện nhà máy A',
  approvedBy: USER_B,
  approvedAt: '2026-11-20T18:30:00.000Z',
  createdAt: '2026-11-19T02:00:00.000Z',
  updatedAt: '2026-11-19T02:00:00.000Z',
};

const ot = {
  ...common,
  id: 'ot-1',
  workDate: '2026-11-20',
  startTime: '18:00:00',
  endTime: '21:30:00',
  plannedMinutes: 210,
  approvedMinutes: 180,
  actualMinutes: 0,
  billableOtMinutes: 0,
  otType: 'WEEKDAY',
  otRateMultiplier: 1.5,
  monthlyAccumulatedOtMinutes: 600,
  paid: true,
  status: 'APPROVED',
} as HrmOtRequest;

const leave = {
  ...common,
  id: 'lv-1',
  leaveTypeId: 'lt-1',
  leaveTypeName: 'Nghỉ ốm',
  reasonName: 'Nghỉ ốm',
  isPaid: false,
  fromDate: '2026-11-24',
  toDate: '2026-11-25',
  duration: 1.5,
  status: 'PENDING',
  currentStepName: 'Trưởng phòng duyệt',
  currentAssigneeName: 'Trần Thị Bình',
  approvedBy: null,
  approvedAt: null,
} as HrmLeaveRequest;

const trip = {
  ...common,
  id: 'bt-1',
  businessTripType: 'DOMESTIC',
  destination: 'Hải Phòng',
  fromDate: '2026-12-01',
  toDate: '2026-12-03',
  daysCount: 3,
  allowOt: false,
  perDiemPolicyId: 'pd-1',
  projectName: 'Dự án nhà máy A',
  transportMode: 'COMPANY_VEHICLE',
  status: 'APPROVED',
} as HrmBusinessTripRequest;

const custom = {
  ...common,
  id: 'cr-1',
  typeId: 'ty-1',
  typeCode: 'WFH',
  typeName: 'Làm việc từ xa',
  fromAt: '2026-11-26T01:00:00.000Z',
  toAt: '2026-11-26T10:00:00.000Z',
  durationMinutes: 480,
  fields: { soTien: 5_000_000 },
  attachmentFileId: null,
  status: 'APPROVED',
  submittedBy: USER_A,
  rejectionReason: null,
} as HrmCustomRequest;

const decision = {
  id: 'pd-1',
  decisionNo: 'QD-2026-015',
  decisionType: 'PROMOTE',
  status: 'APPLIED',
  employeeId: EMP_A,
  employeeName: 'Nguyễn Văn An',
  employeeCode: 'NV001',
  effectiveDate: '2026-12-01',
  reason: 'Hoàn thành tốt nhiệm vụ',
  fromPositionName: 'Kỹ sư',
  fromUnitName: 'Phòng Kỹ thuật',
  fromBaseSalary: 15_000_000,
  toPositionName: 'Trưởng nhóm',
  toUnitName: 'Phòng Kỹ thuật',
  toBaseSalary: 22_000_000,
  salaryChanged: true,
  managerMode: 'KEEP',
  subordinateMode: 'KEEP',
  approvedBy: USER_B,
  approvedAt: '2026-11-25T03:00:00.000Z',
  appliedSteps: {},
  applyAttempts: 0,
  version: 1,
  createdAt: '2026-11-24T03:00:00.000Z',
  updatedAt: '2026-11-25T03:00:00.000Z',
} as HrmPersonnelDecision;

const fieldOf = (object: { fields: readonly { key: string; value: unknown }[] }, key: string) =>
  object.fields.find((field) => field.key === key)?.value;
const SENSITIVE = /lương|salary|hệ số|rate|phụ cấp|công tác phí|5000000|15000000|22000000|1,5|1\.5/i;

describe('Nhân sự công bố đối tượng liên kết', () => {
  it('năm loại thuộc module hrm, khoá hợp lệ, không điền sẵn', () => {
    expect(HRM_LINKABLE_KIND_LIST.map((kind) => [kind.key, kind.label])).toEqual([
      ['hrm.ot-request', 'Đơn làm thêm'],
      ['hrm.leave-request', 'Đơn nghỉ phép'],
      ['hrm.business-trip', 'Đơn công tác'],
      ['hrm.custom-request', 'Đơn khác'],
      ['hrm.personnel-decision', 'Quyết định nhân sự'],
    ]);
    for (const kind of HRM_LINKABLE_KIND_LIST) {
      expect(kind.key).toMatch(/^hrm\.[a-z][a-z0-9-]*$/);
      expect(kind).toMatchObject({ moduleLabel: 'Nhân sự', prefill: false });
    }
    expect(isHrmLinkableKind('hrm.ot-request')).toBe(true);
    expect(isHrmLinkableKind('hrm.payslip')).toBe(false);
    expect(isHrmLinkableKind('crm.contract')).toBe(false);
  });

  it('đường dẫn mở hồ sơ là đường dẫn nội bộ hợp lệ của Nhân sự', () => {
    expect(hrmLaunchUrl('hrm.ot-request', 'ot-1')).toBe('/modules/hrm/approvals?type=ot&request=ot-1');
    expect(hrmLaunchUrl('hrm.business-trip', 'b 1')).toBe('/modules/hrm/approvals?type=business_trip&request=b%201');
    expect(hrmLaunchUrl('hrm.personnel-decision', 'pd-1')).toBe('/modules/hrm/employees?view=decisions');
    for (const object of [otObject(ot, people), leaveObject(leave, people), tripObject(trip, people), customObject(custom, people)]) {
      expect(object.launchUrl).toMatch(/^\/modules\/[A-Za-z0-9._~\-/#?=&%]*$/);
      expect(object.prefill).toBeUndefined();
      expect(object.upstream).toEqual([]);
    }
  });

  it('đơn làm thêm: nhãn gồm loại, ngày, họ tên; fields không có hệ số hay có lương', () => {
    const object = otObject(ot, people);
    expect(object.label).toBe('Đơn làm thêm 20/11/2026 — Nguyễn Văn An');
    expect(object.status).toBe('Đã duyệt');
    expect(fieldOf(object, 'requester')).toBe('NV001 · Nguyễn Văn An');
    expect(fieldOf(object, 'department')).toBe('Phòng Kỹ thuật');
    expect(fieldOf(object, 'time')).toBe('18:00–21:30');
    expect(fieldOf(object, 'plannedHours')).toBe('3,5 giờ');
    expect(fieldOf(object, 'approvedHours')).toBe('3 giờ');
    expect(fieldOf(object, 'approvedBy')).toBe('NV002 · Trần Thị Bình');
    // 18:30 UTC là 01:30 sáng hôm sau giờ Việt Nam.
    expect(fieldOf(object, 'approvedAt')).toBe('2026-11-21');
    expect(object.fields.map((field) => field.key)).not.toEqual(expect.arrayContaining(['paid']));
    expect(JSON.stringify(object)).not.toMatch(SENSITIVE);
    expect(object.fields.every((field) => field.type !== 'money')).toBe(true);
  });

  it('đơn làm thêm nhiều khoảng: gộp ngày và tổng giờ của cả nhóm', () => {
    const grouped = {
      ...ot,
      groupId: ot.id,
      groupRanges: [
        { id: 'g2', workDate: '2026-11-22', startTime: '18:00', endTime: '20:00', fromAt: null, toAt: null, plannedMinutes: 120, status: 'APPROVED' },
        { id: 'ot-1', workDate: '2026-11-20', startTime: '18:00', endTime: '21:30', fromAt: null, toAt: null, plannedMinutes: 210, status: 'APPROVED' },
      ],
    } as HrmOtRequest;
    expect(otCandidate(grouped, people).label).toBe('Đơn làm thêm 20/11/2026 – 22/11/2026 — Nguyễn Văn An');
    expect(fieldOf(otObject(grouped, people), 'plannedHours')).toBe('5,5 giờ');
    expect(fieldOf(otObject(grouped, people), 'time')).toBe('2 khoảng');
  });

  it('đơn nghỉ: loại nghỉ chỉ ở fields, không ở nhãn hay dòng phụ', () => {
    const candidate = leaveCandidate(leave, people);
    expect(candidate.label).toBe('Đơn nghỉ phép 24/11/2026 – 25/11/2026 — Nguyễn Văn An');
    expect(`${candidate.label} ${candidate.hint}`).not.toMatch(/ốm/);
    const object = leaveObject(leave, people);
    expect(fieldOf(object, 'leaveType')).toBe('Nghỉ ốm');
    expect(fieldOf(object, 'days')).toBe('1,5 ngày');
    expect(fieldOf(object, 'currentStep')).toBe('Trưởng phòng duyệt');
    expect(fieldOf(object, 'approvedBy')).toBeNull();
    expect(object.fields.some((field) => field.key === 'reason')).toBe(false);
  });

  it('đơn công tác và đơn khác: thông tin hữu ích, không công tác phí hay trường động', () => {
    const tripView = tripObject(trip, people);
    expect(tripView.label).toBe('Đơn công tác Hải Phòng 01/12/2026 – 03/12/2026 — Nguyễn Văn An');
    expect(fieldOf(tripView, 'destination')).toBe('Hải Phòng');
    expect(fieldOf(tripView, 'days')).toBe('3 ngày');
    expect(fieldOf(tripView, 'project')).toBe('Dự án nhà máy A');
    expect(fieldOf(tripView, 'transport')).toBe('Xe công ty');
    expect(JSON.stringify(tripView)).not.toMatch(/perDiem|pd-1/);

    const customView = customObject(custom, people);
    expect(customView.label).toBe('Làm việc từ xa 26/11/2026 — Nguyễn Văn An');
    expect(fieldOf(customView, 'duration')).toBe('8 giờ');
    expect(JSON.stringify(customView)).not.toMatch(/soTien|5000000/);
  });

  it('quyết định nhân sự: nhãn là số và loại quyết định, không họ tên, không lương', () => {
    const candidate = decisionCandidate(decision);
    expect(candidate).toMatchObject({
      kind: 'hrm.personnel-decision',
      code: 'QD-2026-015',
      label: 'QD-2026-015 — Thăng chức',
      status: 'Đã áp dụng',
      hint: 'NV001 · Nguyễn Văn An — 01/12/2026',
    });
    const object = decisionObject(decision, people);
    expect(fieldOf(object, 'toPosition')).toBe('Trưởng nhóm — Phòng Kỹ thuật');
    expect(fieldOf(object, 'approvedBy')).toBe('NV002 · Trần Thị Bình');
    expect(JSON.stringify(object)).not.toMatch(SENSITIVE);
    expect(JSON.stringify(object)).not.toMatch(/salaryChanged|BaseSalary/);
  });

  it('thiếu họ tên (nhân viên đã nghỉ) thì nhãn vẫn đọc được', () => {
    expect(otCandidate({ ...ot, employeeId: 'other' }, people).label).toBe('Đơn làm thêm 20/11/2026');
    expect(fieldOf(otObject({ ...ot, employeeId: 'other' }, people), 'requester')).toBeNull();
  });

  it('tìm không phân biệt dấu, mọi từ đều phải khớp', () => {
    const candidate = otCandidate(ot, people);
    expect(matchesLinkableQuery(candidate, '')).toBe(true);
    expect(matchesLinkableQuery(candidate, 'nguyen an')).toBe(true);
    expect(matchesLinkableQuery(candidate, 'NV001 kỹ thuật')).toBe(true);
    expect(matchesLinkableQuery(candidate, '20/11')).toBe(true);
    expect(matchesLinkableQuery(candidate, 'binh')).toBe(false);
  });

  it('ngày theo giờ Việt Nam', () => {
    expect(vnDate('2026-11-20T17:00:00.000Z')).toBe('2026-11-21');
    expect(vnDate('2026-11-20T16:59:00.000Z')).toBe('2026-11-20');
    expect(vnDate(null)).toBeNull();
  });
});

/* ------------------------------------------------------------------ Route: quyền và phạm vi như route gốc */

class FakeContext {
  constructor(private readonly permissions: readonly string[]) {}
  async getContext(_req: unknown, permission = 'hrm.read') {
    if (permission !== 'hrm.read' && !this.permissions.includes(permission)) throw new ForbiddenException();
    return { principal: { userId: USER_A, permissions: this.permissions }, tenantId: 't', pool: {} };
  }
  has(_context: unknown, permission: string) {
    return this.permissions.includes(permission);
  }
}

const req = { headers: {} } as Request;
const options = [
  { employeeId: EMP_A, employeeCode: 'NV001', fullName: 'Nguyễn Văn An', department: 'Phòng Kỹ thuật', userId: USER_A },
  { employeeId: EMP_B, employeeCode: 'NV002', fullName: 'Trần Thị Bình', department: 'Phòng Nhân sự', userId: USER_B },
];

function build(permissions: readonly string[]) {
  const controller = new HrmLinkableController(new FakeContext(permissions) as never, {} as never, {} as never);
  return controller;
}

describe('HrmLinkableController', () => {
  let listOt: jest.SpyInstance;

  beforeEach(() => {
    listOt = jest.spyOn(HrmRequestController.prototype, 'listOtRequests').mockImplementation(async (...args: unknown[]) => {
      const forApproval = args[5];
      // Danh sách thường của nhân viên: đơn của mình; danh sách chờ duyệt: đơn cấp dưới.
      const data =
        forApproval === '1'
          ? [{ ...ot, id: 'ot-sub', employeeId: EMP_B, createdAt: '2026-11-21T00:00:00.000Z' }]
          : [ot, { ...ot, id: 'ot-follower', groupId: 'ot-1' }];
      return { data, meta: {} } as never;
    });
    jest.spyOn(HrmLeaveController.prototype, 'listLeaveRequests').mockResolvedValue({ data: [leave], meta: {} } as never);
    jest
      .spyOn(HrmRequestController.prototype, 'listBusinessTripRequests')
      .mockResolvedValue({ data: [trip], meta: {} } as never);
    jest.spyOn(HrmCustomRequestController.prototype, 'list').mockResolvedValue({ data: [custom], meta: {} } as never);
    jest.spyOn(HrmEmployeeController.prototype, 'employeeOptions').mockResolvedValue({ data: options, meta: { total: 2 } });
    jest.spyOn(HrmPersonnelDecisionController.prototype, 'list').mockImplementation(async function (this: { ctx: FakeContext }) {
      await this.ctx.getContext(req, 'hrm.appointment.read');
      return { data: [decision], meta: { requestId: '' } };
    });
    jest.spyOn(HrmPersonnelDecisionController.prototype, 'get').mockImplementation(async function (
      this: { ctx: FakeContext },
      _req: Request,
      id: string,
    ) {
      await this.ctx.getContext(req, 'hrm.appointment.read');
      if (id === 'bad') throw new BadRequestException();
      if (id !== decision.id) throw new NotFoundException();
      return { data: decision, meta: { requestId: '' } };
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('mọi route mới đều khai @RequirePermission', () => {
    for (const handler of ['kinds', 'search', 'resolve'] as const) {
      expect(Reflect.getMetadata(HRM_REQUIRED_PERMISSION, HrmLinkableController.prototype[handler])).toBe('hrm.read');
    }
  });

  it('kinds chỉ trả loại người dùng đọc được', async () => {
    const employee = await build(['hrm.self.read']).kinds(req);
    expect(employee.kinds.map((kind) => kind.key)).toEqual([
      'hrm.ot-request',
      'hrm.leave-request',
      'hrm.business-trip',
      'hrm.custom-request',
    ]);
    const hr = await build(['hrm.request.read', 'hrm.appointment.read']).kinds(req);
    expect(hr.kinds).toHaveLength(5);
    expect((await build([]).kinds(req)).kinds).toEqual([]);
  });

  it('search không có q: đơn của mình cộng đơn chờ duyệt, mới nhất trước, bỏ khoảng bổ sung', async () => {
    const result = await build(['hrm.self.read', 'hrm.request.approve']).search(req, 'hrm.ot-request', '', '10');
    expect(result.items.map((item) => item.id)).toEqual(['ot-sub', 'ot-1']);
    expect(listOt).toHaveBeenCalledTimes(2);
    expect(listOt.mock.calls[1][5]).toBe('1');
  });

  it('người có hrm.request.read chỉ đọc danh sách thường (đã là mọi đơn)', async () => {
    await build(['hrm.request.read']).search(req, 'hrm.ot-request', undefined, undefined);
    expect(listOt).toHaveBeenCalledTimes(1);
  });

  it('search theo q và giới hạn số dòng', async () => {
    const controller = build(['hrm.self.read', 'hrm.request.approve']);
    expect((await controller.search(req, 'hrm.ot-request', 'tran binh', '10')).items.map((item) => item.id)).toEqual([
      'ot-sub',
    ]);
    expect((await controller.search(req, 'hrm.ot-request', '', '1')).items).toHaveLength(1);
  });

  it('loại không thuộc Nhân sự bị từ chối', async () => {
    await expect(build(['hrm.read']).search(req, 'hrm.payslip', '', '')).rejects.toBeInstanceOf(BadRequestException);
    await expect(build(['hrm.read']).resolve(req, 'crm.contract', 'x')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolve bỏ qua id không thấy trong phạm vi', async () => {
    const result = await build(['hrm.self.read']).resolve(req, 'hrm.leave-request', 'lv-1,khong-co,lv-1');
    expect(result.items.map((item) => item.id)).toEqual(['lv-1']);
    expect(fieldOf(result.items[0], 'requester')).toBe('NV001 · Nguyễn Văn An');
  });

  it('resolve không còn quyền đọc loại đơn thì trả rỗng; search thì báo 403', async () => {
    jest.spyOn(HrmCustomRequestController.prototype, 'list').mockRejectedValue(new ForbiddenException());
    expect(await build([]).resolve(req, 'hrm.custom-request', 'cr-1')).toEqual({ items: [] });
    await expect(build([]).search(req, 'hrm.custom-request', '', '')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('quyết định nhân sự: cần hrm.appointment.read, id sai hoặc không thấy thì bỏ qua', async () => {
    const reader = build(['hrm.appointment.read']);
    expect((await reader.resolve(req, 'hrm.personnel-decision', 'pd-1,bad,missing')).items.map((item) => item.id)).toEqual([
      'pd-1',
    ]);
    expect((await reader.search(req, 'hrm.personnel-decision', 'thang chuc', '')).items).toHaveLength(1);
    expect(await build(['hrm.self.read']).resolve(req, 'hrm.personnel-decision', 'pd-1')).toEqual({ items: [] });
    await expect(build(['hrm.self.read']).search(req, 'hrm.personnel-decision', '', '')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lỗi khác (bug, mất kết nối DB) không bị nuốt', async () => {
    jest.spyOn(HrmLeaveController.prototype, 'listLeaveRequests').mockRejectedValue(new Error('boom'));
    await expect(build(['hrm.request.read']).resolve(req, 'hrm.leave-request', 'lv-1')).rejects.toThrow('boom');
  });
});
