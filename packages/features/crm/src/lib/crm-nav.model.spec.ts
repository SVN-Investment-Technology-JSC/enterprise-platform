import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import { CRM_PAGES, CRM_VIEWS, crmCapabilityLabels, crmScopeLabel, visibleCrmPages } from './crm-nav.model';

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
});
