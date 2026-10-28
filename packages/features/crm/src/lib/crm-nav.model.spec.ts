import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import {
  CRM_ACCESS_DENIED_MESSAGE,
  CRM_PAGES,
  CRM_VIEWS,
  crmCapabilityLabels,
  crmScopeLabel,
  isCrmAccessDenied,
  visibleCrmPages,
} from './crm-nav.model';

const ids = (capabilities = CRM_NO_CAPABILITIES) => visibleCrmPages(capabilities).map((page) => page.id);

describe('menu Bán hàng', () => {
  it('mỗi trang có đúng một mục và cùng thứ tự với danh sách view', () => {
    expect(CRM_PAGES.map((page) => page.id)).toEqual(CRM_VIEWS);
  });

  it('người chỉ có crm.read không thấy Báo cáo, Cấu hình', () => {
    expect(ids()).not.toContain('reports');
    expect(ids()).not.toContain('settings');
    expect(ids()).toContain('customers');
  });

  it('crm.report.read thấy Báo cáo; crm.manage và quản trị tenant thấy Cấu hình', () => {
    expect(ids({ ...CRM_NO_CAPABILITIES, canReadReport: true })).toContain('reports');
    expect(ids({ ...CRM_NO_CAPABILITIES, canManage: true })).toContain('settings');
    expect(ids({ ...CRM_NO_CAPABILITIES, isTenantAdmin: true })).toEqual(CRM_VIEWS);
  });

  it('nhãn phạm vi và quyền tiếng Việt', () => {
    expect(crmScopeLabel(CRM_NO_CAPABILITIES)).toContain('cấp dưới');
    expect(crmScopeLabel({ ...CRM_NO_CAPABILITIES, canReadAll: true })).toBe('Toàn bộ dữ liệu Bán hàng');
    expect(crmCapabilityLabels(CRM_NO_CAPABILITIES)).toEqual(['Chỉ xem']);
    expect(crmCapabilityLabels({ ...CRM_NO_CAPABILITIES, canWriteQuote: true })).toEqual(['Lập báo giá']);
  });

  it('thẻ Tổng quan có mô tả thật, không còn nhãn giai đoạn hay chữ giữ chỗ', () => {
    for (const page of CRM_PAGES) {
      expect(page.summary.length).toBeGreaterThan(20);
      expect(page).not.toHaveProperty('phase');
      expect(page.summary).not.toMatch(/giai đoạn \d|đang được xây dựng/i);
    }
  });

  it('chưa có quyền crm.* (403) là trạng thái riêng, lỗi khác vẫn là lỗi', () => {
    expect(isCrmAccessDenied({ statusCode: 403, message: 'Không được phép truy cập Bán hàng.' })).toBe(true);
    expect(isCrmAccessDenied({ statusCode: 500 })).toBe(false);
    expect(isCrmAccessDenied(undefined)).toBe(false);
    expect(isCrmAccessDenied(new Error('mạng'))).toBe(false);
    expect(CRM_ACCESS_DENIED_MESSAGE).toBe(
      'Bạn chưa được cấp quyền dùng phân hệ Bán hàng. Liên hệ quản trị để được cấp quyền.',
    );
  });
});
