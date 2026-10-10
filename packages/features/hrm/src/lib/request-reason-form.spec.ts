import type { HrmRequestReason } from '@enterprise-platform/contracts-hrm';
import {
  approvalRoutePath,
  approverLine,
  choiceFromCatalogReason,
  choiceFromLeaveType,
  descriptionRequired,
  draftReasonFields,
  emptyReasonCatalogMessage,
  isApprovalRoutePreview,
  isReasonedRequestKind,
  reasonBlockMessage,
  reasonCatalogKindOf,
  reasonCell,
  reasonPayload,
  requestReasonView,
  type RequestReasonChoice,
} from './request-reason-form';

const catalogReason = (over: Partial<HrmRequestReason> = {}): HrmRequestReason => ({
  id: 'r1',
  tenantId: 't1',
  kind: 'OVERTIME',
  code: 'THEO_YEU_CAU',
  name: 'Theo yêu cầu công việc',
  description: '  Làm thêm theo tiến độ dự án  ',
  paid: true,
  requiresDescription: false,
  active: true,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const choice = (over: Partial<RequestReasonChoice> = {}): RequestReasonChoice => ({
  id: 'r1',
  code: 'THEO_YEU_CAU',
  name: 'Theo yêu cầu công việc',
  description: null,
  paid: true,
  requiresDescription: false,
  deductBalance: false,
  ...over,
});

describe('loại đơn và danh mục lý do', () => {
  it('năm loại đơn có lý do; danh mục chỉ có ở bốn loại không phải đơn nghỉ', () => {
    for (const kind of ['leave', 'ot', 'business_trip', 'shift_change', 'correction'])
      expect(isReasonedRequestKind(kind)).toBe(true);
    for (const kind of ['advance', 'profile_correction', 'other'])
      expect(isReasonedRequestKind(kind)).toBe(false);
    expect(reasonCatalogKindOf('ot')).toBe('OVERTIME');
    expect(reasonCatalogKindOf('business_trip')).toBe('BUSINESS_TRIP');
    expect(reasonCatalogKindOf('shift_change')).toBe('SHIFT_CHANGE');
    expect(reasonCatalogKindOf('correction')).toBe('ATTENDANCE_CORRECTION');
    expect(reasonCatalogKindOf('leave')).toBeUndefined();
    expect(reasonCatalogKindOf('advance')).toBeUndefined();
  });

  it('chuẩn hóa lý do danh mục và lý do nghỉ về cùng một dạng', () => {
    expect(choiceFromCatalogReason(catalogReason())).toEqual({
      id: 'r1',
      code: 'THEO_YEU_CAU',
      name: 'Theo yêu cầu công việc',
      description: 'Làm thêm theo tiến độ dự án',
      paid: true,
      requiresDescription: false,
      deductBalance: false,
    });
    expect(
      choiceFromCatalogReason(catalogReason({ description: null, paid: false, requiresDescription: true })),
    ).toMatchObject({ description: null, paid: false, requiresDescription: true });
    expect(
      choiceFromLeaveType({ id: 'l1', code: 'ANNUAL', name: 'Nghỉ phép năm', paid: true, deductBalance: true }),
    ).toMatchObject({ id: 'l1', paid: true, deductBalance: true, description: null, requiresDescription: false });
    // Chỉ lý do phép năm trừ quỹ khi API không nói rõ deductBalance.
    expect(choiceFromLeaveType({ id: 'l2', code: 'A', name: 'A', isAnnual: true }).deductBalance).toBe(true);
    expect(choiceFromLeaveType({ id: 'l3', code: 'B', name: 'B', paid: false }).deductBalance).toBe(false);
    expect(choiceFromLeaveType({ id: 'l3', code: 'B', name: 'B', paid: false }).paid).toBe(false);
  });

  it('mô tả chỉ bắt buộc khi lý do cấu hình cần mô tả', () => {
    expect(descriptionRequired(choice())).toBe(false);
    expect(descriptionRequired(choice({ requiresDescription: true }))).toBe(true);
    expect(descriptionRequired(undefined)).toBe(false);
  });
});

describe('reasonBlockMessage', () => {
  const base = { kind: 'ot' as const, choices: [choice()], reasonId: 'r1', description: '' };

  it('hợp lệ khi đã chọn lý do và lý do không cần mô tả', () => {
    expect(reasonBlockMessage(base)).toBeNull();
  });

  it('danh mục rỗng: thông báo trỏ đúng nơi cấu hình theo loại đơn', () => {
    expect(reasonBlockMessage({ ...base, choices: [] })).toBe(
      'Chưa có lý do nào cho loại đơn này. Quản trị viên cần cấu hình tại Cấu hình, Lý do đơn từ.',
    );
    expect(reasonBlockMessage({ ...base, kind: 'leave', choices: [] })).toBe(
      'Chưa có lý do nào cho loại đơn này. Quản trị viên cần cấu hình tại Cấu hình, Phép năm và lý do nghỉ.',
    );
    expect(emptyReasonCatalogMessage('shift_change')).toContain('Lý do đơn từ');
  });

  it('đang tải và lỗi tải được ưu tiên hơn thông báo danh mục rỗng', () => {
    expect(reasonBlockMessage({ ...base, choices: [], loading: true })).toBe('Đang tải danh sách lý do.');
    expect(reasonBlockMessage({ ...base, choices: [], error: 'Máy chủ bận' })).toBe(
      'Không tải được danh sách lý do: Máy chủ bận',
    );
  });

  it('chưa chọn lý do hoặc lý do không còn trong danh mục thì chặn', () => {
    expect(reasonBlockMessage({ ...base, reasonId: '' })).toBe('Vui lòng chọn lý do.');
    expect(reasonBlockMessage({ ...base, reasonId: 'khong-co' })).toBe('Vui lòng chọn lý do.');
  });

  it('lý do cần mô tả: chặn khi mô tả trống hoặc chỉ có khoảng trắng', () => {
    const needs = { ...base, choices: [choice({ requiresDescription: true, name: 'Khác' })] };
    expect(reasonBlockMessage(needs)).toBe('Lý do "Khác" yêu cầu nhập mô tả.');
    expect(reasonBlockMessage({ ...needs, description: '   ' })).toBe('Lý do "Khác" yêu cầu nhập mô tả.');
    expect(reasonBlockMessage({ ...needs, description: 'Việc đột xuất' })).toBeNull();
  });
});

describe('reasonPayload', () => {
  it('đơn nghỉ gửi leaveTypeId + description, các đơn khác gửi reasonId + description', () => {
    expect(reasonPayload('leave', 'lt1', 'Khám bệnh')).toEqual({ leaveTypeId: 'lt1', description: 'Khám bệnh' });
    for (const kind of ['ot', 'business_trip', 'shift_change', 'correction'] as const)
      expect(reasonPayload(kind, 'r1', 'Chi tiết')).toEqual({ reasonId: 'r1', description: 'Chi tiết' });
  });

  it('cắt khoảng trắng, bỏ description khi trống và không bao giờ có reason', () => {
    expect(reasonPayload('ot', 'r1', '  Làm đêm  ')).toEqual({ reasonId: 'r1', description: 'Làm đêm' });
    expect(reasonPayload('ot', 'r1', '   ')).toEqual({ reasonId: 'r1' });
    expect(reasonPayload('leave', 'lt1', '')).toEqual({ leaveTypeId: 'lt1' });
    expect(reasonPayload('ot', 'r1', 'x')).not.toHaveProperty('reason');
  });
});

describe('draftReasonFields', () => {
  it('nạp lại reasonId và description từ bản nháp mới', () => {
    expect(draftReasonFields('ot', { reasonId: 'r1', description: 'Chi tiết' })).toEqual({
      reasonId: 'r1',
      description: 'Chi tiết',
    });
    expect(draftReasonFields('leave', { leaveTypeId: 'lt1', description: 'Khám bệnh' })).toEqual({
      reasonId: 'lt1',
      description: 'Khám bệnh',
    });
  });

  it('bản nháp cũ chỉ có reason: dùng làm mô tả và để trống lý do', () => {
    expect(draftReasonFields('ot', { reason: '[Tăng ca] Làm việc cuối tuần' })).toEqual({
      reasonId: '',
      description: '[Tăng ca] Làm việc cuối tuần',
    });
    expect(draftReasonFields('ot', { reasonId: 'r1', description: 'Mới', reason: 'Cũ' }).description).toBe('Mới');
    expect(draftReasonFields('ot', null)).toEqual({ reasonId: '', description: '' });
  });
});

describe('hiển thị lý do và mô tả của đơn', () => {
  it('reasonCell: rỗng hoặc thiếu thì "—"', () => {
    expect(reasonCell('Nghỉ ốm')).toBe('Nghỉ ốm');
    expect(reasonCell('  Nghỉ ốm ')).toBe('Nghỉ ốm');
    expect(reasonCell('')).toBe('—');
    expect(reasonCell('   ')).toBe('—');
    expect(reasonCell(null)).toBe('—');
    expect(reasonCell(undefined)).toBe('—');
  });

  it('requestReasonView tách lý do (reasonName) khỏi mô tả (description)', () => {
    expect(
      requestReasonView({ reasonName: 'Nghỉ ốm', description: 'Đi khám', reason: 'Đi khám' }),
    ).toEqual({ reason: 'Nghỉ ốm', description: 'Đi khám' });
    expect(requestReasonView({ reasonName: 'Nghỉ ốm', description: null, reason: '' })).toEqual({
      reason: 'Nghỉ ốm',
      description: '—',
    });
  });

  it('đơn cũ chưa có lý do danh mục: lý do "—", mô tả là nội dung cũ', () => {
    expect(requestReasonView({ reasonName: null, description: 'Việc gia đình', reason: 'Việc gia đình' })).toEqual({
      reason: '—',
      description: 'Việc gia đình',
    });
    expect(requestReasonView({ reason: 'Chỉ có trường cũ' })).toEqual({
      reason: '—',
      description: 'Chỉ có trường cũ',
    });
    expect(requestReasonView({})).toEqual({ reason: '—', description: '—' });
  });
});

describe('người duyệt dự kiến', () => {
  it('dựng đường dẫn approval-route, bỏ reasonId khi chưa chọn lý do', () => {
    expect(approvalRoutePath({ kind: 'ot', employeeId: 'e1', reasonId: 'r1' })).toBe(
      '/approval-route?kind=ot&employeeId=e1&reasonId=r1',
    );
    expect(approvalRoutePath({ kind: 'advance', employeeId: 'e1' })).toBe('/approval-route?kind=advance&employeeId=e1');
  });

  it('chỉ nhận phản hồi có mode DIRECT hoặc PROCEDURE', () => {
    expect(isApprovalRoutePreview({ mode: 'DIRECT' })).toBe(true);
    expect(isApprovalRoutePreview({ mode: 'PROCEDURE', procedureName: 'Quy trình A' })).toBe(true);
    expect(isApprovalRoutePreview([])).toBe(false);
    expect(isApprovalRoutePreview(null)).toBe(false);
    expect(isApprovalRoutePreview({ mode: 'OTHER' })).toBe(false);
  });

  it('DIRECT có quản lý: họ tên và chức danh', () => {
    expect(
      approverLine({
        mode: 'DIRECT',
        directManager: { employeeId: 'm1', fullName: 'Trần Văn B', positionName: 'Trưởng phòng' },
      }),
    ).toEqual({ method: 'Quản lý trực tiếp', detail: 'Trần Văn B, Trưởng phòng', note: '' });
    expect(
      approverLine({ mode: 'DIRECT', directManager: { employeeId: 'm1', fullName: 'Trần Văn B', positionName: null } })
        .detail,
    ).toBe('Trần Văn B');
  });

  it('DIRECT chưa có quản lý: không có chi tiết, giữ ghi chú của máy chủ', () => {
    expect(approverLine({ mode: 'DIRECT', directManager: null, note: ' Chưa có quản lý trực tiếp ' })).toEqual({
      method: 'Quản lý trực tiếp',
      detail: '',
      note: 'Chưa có quản lý trực tiếp',
    });
  });

  it('PROCEDURE: tên quy trình', () => {
    expect(approverLine({ mode: 'PROCEDURE', procedureName: 'Quy trình duyệt OT' })).toEqual({
      method: 'Duyệt theo quy trình',
      detail: 'Quy trình duyệt OT',
      note: '',
    });
    expect(approverLine({ mode: 'PROCEDURE', procedureName: null }).detail).toBe('');
  });
});
