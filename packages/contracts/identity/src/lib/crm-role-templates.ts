import type { HrmRoleTemplate } from './hrm-role-templates.js';
import { TENANT_PERMISSION_ACTIONS } from './tenant-authorization.js';

/**
 * Bộ vai trò mẫu Bán hàng (CRM), một nguồn dữ liệu duy nhất (ISS-BE-011).
 * Chỉ là dữ liệu: việc tạo vào tenant do TenantAuthorizationService.seedCrmRoleTemplates làm (tự chạy khi platform
 * bật phân hệ Bán hàng cho tenant, hoặc quản trị tenant gọi POST /api/platform/v1/tenant-role-templates/crm).
 * Không tự gán vai trò cho ai.
 */
export const CRM_ROLE_TEMPLATES: readonly HrmRoleTemplate[] = [
  {
    key: 'crm-sales-staff',
    name: 'Nhân viên kinh doanh',
    description:
      'Xem dữ liệu Bán hàng trong phạm vi của mình; lập cơ hội, báo giá và đơn bán.',
    actions: ['crm.read', 'crm.opportunity.write', 'crm.quote.write', 'crm.order.write'],
  },
  {
    key: 'crm-sales-manager',
    name: 'Quản lý kinh doanh',
    description:
      'Như Nhân viên kinh doanh, thêm xem toàn bộ dữ liệu Bán hàng, duyệt báo giá và xem báo cáo.',
    actions: [
      'crm.read',
      'crm.opportunity.write',
      'crm.quote.write',
      'crm.order.write',
      'crm.read.all',
      'crm.quote.approve',
      'crm.report.read',
    ],
  },
];

export function invalidCrmTemplateActions(): string[] {
  const valid = new Set<string>(TENANT_PERMISSION_ACTIONS.map((a) => a.key));
  return CRM_ROLE_TEMPLATES.flatMap((t) => t.actions.filter((a) => !valid.has(a)));
}
