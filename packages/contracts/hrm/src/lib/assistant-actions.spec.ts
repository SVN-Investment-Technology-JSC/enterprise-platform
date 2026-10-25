import {
  assistantActionProblems,
  assistantFormPath,
  toCatalogItem,
} from '@enterprise-platform/contracts-assistant';
import { HRM_ASSISTANT_ACTIONS } from './assistant-actions.js';

describe('HRM_ASSISTANT_ACTIONS', () => {
  it('khai báo hợp lệ theo chuẩn của Trợ lý', () => {
    expect(assistantActionProblems(HRM_ASSISTANT_ACTIONS)).toEqual([]);
  });

  it('mọi thao tác dùng form tạo đơn của trang Đơn từ và cần quyền tự tạo đơn', () => {
    for (const action of Object.values(HRM_ASSISTANT_ACTIONS)) {
      expect(action.module).toBe('hrm');
      expect(action.page).toBe('/modules/hrm/requests');
      // Route của hrm-web: apps/hrm-web/src/app/assistant/form.
      expect(assistantFormPath(action.page)).toBe('/modules/hrm/assistant/form');
      expect(action.permission).toBe('hrm.self.request');
      expect(Object.keys(action.draft)).not.toContain('employeeId');
    }
  });

  it('ô bắt buộc khớp kiểm tra của form tạo đơn', () => {
    const required = (action: Parameters<typeof toCatalogItem>[0]) =>
      Object.entries(toCatalogItem(action).draft)
        .filter(([, field]) => field.required)
        .map(([name]) => name)
        .sort();
    expect(required(HRM_ASSISTANT_ACTIONS.createLeaveRequest)).toEqual(['leaveTypeId']);
    // Làm thêm giờ và công tác luôn bắt buộc Mô tả (descriptionMandatoryFor của HRM).
    expect(required(HRM_ASSISTANT_ACTIONS.createOtRequest)).toEqual(['description', 'reasonId']);
    expect(required(HRM_ASSISTANT_ACTIONS.createBusinessTripRequest)).toEqual([
      'description',
      'destination',
      'reasonId',
    ]);
    expect(required(HRM_ASSISTANT_ACTIONS.createCustomRequest)).toEqual([]);
  });

  it('đơn tuỳ chỉnh chọn loại đơn qua biến thể: chỉ loại công ty tự tạo, kèm cách nhập thời gian và ô riêng', () => {
    expect(HRM_ASSISTANT_ACTIONS.createCustomRequest.variants).toMatchObject({
      lookup: '/api/hrm/v1/request-types?engine=GENERIC',
      columns: ['timeMode', 'fields'],
    });
    expect(Object.keys(HRM_ASSISTANT_ACTIONS.createCustomRequest.draft)).not.toContain('typeId');
  });

  it('tra lý do giữ cờ bắt buộc mô tả; đơn tuỳ chỉnh giữ thêm kind để khớp loại đơn', () => {
    const columns = (field: { columns?: readonly string[] } | string | undefined) =>
      typeof field === 'object' ? field.columns : undefined;
    expect(columns(HRM_ASSISTANT_ACTIONS.createOtRequest.draft.reasonId)).toEqual(['requiresDescription']);
    expect(columns(HRM_ASSISTANT_ACTIONS.createBusinessTripRequest.draft.reasonId)).toEqual([
      'requiresDescription',
    ]);
    expect(columns(HRM_ASSISTANT_ACTIONS.createCustomRequest.draft.reasonId)).toEqual([
      'kind',
      'requiresDescription',
    ]);
  });
});
