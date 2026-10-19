import {
  assistantActionProblems,
  assistantFormPath,
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

  it('đơn tuỳ chỉnh chọn loại đơn qua biến thể', () => {
    expect(HRM_ASSISTANT_ACTIONS.createCustomRequest.variants?.lookup).toBe(
      '/api/hrm/v1/request-types',
    );
    expect(Object.keys(HRM_ASSISTANT_ACTIONS.createCustomRequest.draft)).not.toContain('typeId');
  });
});
