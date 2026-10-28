import type { CrmCapabilities } from '@enterprise-platform/contracts-crm';

/**
 * Trang của phân hệ. `id` cũng là đoạn hash trên URL nên phải ổn định: đổi
 * nhãn thì sửa `label`, giữ nguyên `id`.
 */
export type CrmView =
  | 'overview'
  | 'customers'
  | 'leads'
  | 'opportunities'
  | 'activities'
  | 'quotes'
  | 'contracts'
  | 'orders'
  | 'receivables'
  | 'warranty'
  | 'reports'
  | 'settings';

export interface CrmPage {
  readonly id: CrmView;
  readonly label: string;
  readonly group: string;
  /** Câu mô tả ngắn trên thẻ của trang Tổng quan. */
  readonly summary: string;
  /** Ai thấy trang này; không khai thì mọi người có `crm.read`. */
  readonly visible?: (capabilities: CrmCapabilities) => boolean;
}

export const CRM_VIEWS: readonly CrmView[] = [
  'overview',
  'customers',
  'leads',
  'opportunities',
  'activities',
  'quotes',
  'contracts',
  'orders',
  'receivables',
  'warranty',
  'reports',
  'settings',
];

export const CRM_PAGES: readonly CrmPage[] = [
  {
    id: 'overview',
    label: 'Tổng quan',
    group: 'Bán hàng',
    summary: 'Doanh thu, lợi nhuận, cơ hội, công nợ so với kỳ trước và các việc cần chú ý trong phạm vi của bạn.',
  },
  {
    id: 'customers',
    label: 'Khách hàng',
    group: 'Bán hàng',
    summary: 'Hồ sơ khách hàng, người liên hệ, nhóm khách và người phụ trách.',
  },
  {
    id: 'leads',
    label: 'Lead',
    group: 'Bán hàng',
    summary: 'Đầu mối tiềm năng; chuyển thành khách hàng và cơ hội bằng một thao tác.',
  },
  {
    id: 'opportunities',
    label: 'Cơ hội',
    group: 'Bán hàng',
    summary: 'Cơ hội theo giai đoạn: kanban kéo thả, dạng bảng, lịch sử chuyển giai đoạn.',
  },
  {
    id: 'activities',
    label: 'Hoạt động',
    group: 'Bán hàng',
    summary: 'Gọi điện, email, gặp mặt, công việc; nhắc trước hạn và khi quá hạn.',
  },
  {
    id: 'quotes',
    label: 'Báo giá',
    group: 'Bán hàng',
    summary: 'Bảng giá, chính sách chiết khấu, báo giá theo phiên bản và duyệt báo giá.',
  },
  {
    id: 'contracts',
    label: 'Hợp đồng',
    group: 'Giao dịch',
    summary: 'Hợp đồng mua bán, hợp đồng khung, điều khoản thanh toán và hiệu lực.',
  },
  {
    id: 'orders',
    label: 'Đơn bán',
    group: 'Giao dịch',
    summary: 'Đơn bán, giữ hàng ở Kho, kế hoạch giao và xuất kho.',
  },
  {
    id: 'receivables',
    label: 'Công nợ',
    group: 'Giao dịch',
    summary: 'Sổ công nợ khách hàng, thu tiền qua phiếu thu Tài chính, hạn mức tín dụng.',
  },
  {
    id: 'warranty',
    label: 'Bảo hành',
    group: 'Sau bán',
    summary: 'Yêu cầu bảo hành, đổi trả theo serial và nhập trả về Kho.',
  },
  {
    id: 'reports',
    label: 'Báo cáo',
    group: 'Sau bán',
    summary: 'Doanh thu, sản lượng, lợi nhuận theo nhân viên, khách hàng, sản phẩm, khu vực.',
    visible: (capabilities) => capabilities.isTenantAdmin || capabilities.canReadReport,
  },
  {
    id: 'settings',
    label: 'Cấu hình',
    group: 'Quản trị',
    summary: 'Nhóm khách, quy tắc mã khách hàng, nhắc hoạt động; bảng giá, chính sách chiết khấu, thử tính giá; ngưỡng và cách duyệt báo giá.',
    visible: (capabilities) => capabilities.isTenantAdmin || capabilities.canManage,
  },
];

/** Trang người này được thấy, giữ nguyên thứ tự menu. */
export function visibleCrmPages(capabilities: CrmCapabilities): CrmPage[] {
  return CRM_PAGES.filter((page) => page.visible?.(capabilities) ?? true);
}

/** Phạm vi dữ liệu hiện cho người dùng; quyền thật lọc ở API. */
export function crmScopeLabel(capabilities: CrmCapabilities): string {
  return capabilities.isTenantAdmin || capabilities.canManage || capabilities.canReadAll
    ? 'Toàn bộ dữ liệu Bán hàng'
    : 'Dữ liệu của bạn và cấp dưới theo cơ cấu tổ chức';
}

/** Nhãn tiếng Việt của các quyền đang có, để trang Tổng quan cho người dùng biết mình làm được gì. */
export function crmCapabilityLabels(capabilities: CrmCapabilities): string[] {
  if (capabilities.isTenantAdmin) return ['Quản trị tenant: mọi quyền Bán hàng'];
  const labels: [boolean, string][] = [
    [capabilities.canManage, 'Quản trị bán hàng'],
    [capabilities.canWriteOpportunity, 'Quản lý khách hàng, cơ hội'],
    [capabilities.canWriteQuote, 'Lập báo giá'],
    [capabilities.canApproveQuote, 'Duyệt báo giá'],
    [capabilities.canWriteOrder, 'Lập đơn bán'],
    [capabilities.canWriteContract, 'Quản lý hợp đồng'],
    [capabilities.canWriteReceivable, 'Thu tiền, công nợ'],
    [capabilities.canWriteWarranty, 'Xử lý bảo hành'],
    [capabilities.canReadReport, 'Xem báo cáo'],
  ];
  const held = labels.filter(([on]) => on).map(([, label]) => label);
  return held.length ? held : ['Chỉ xem'];
}

/** Câu hiện khi người dùng chưa có quyền `crm.*` nào (`GET v1/status` trả 403). */
export const CRM_ACCESS_DENIED_MESSAGE =
  'Bạn chưa được cấp quyền dùng phân hệ Bán hàng. Liên hệ quản trị để được cấp quyền.';

/** Lỗi tải trạng thái là do chưa được cấp quyền (403), không phải lỗi hệ thống. */
export function isCrmAccessDenied(cause: unknown): boolean {
  return (cause as { statusCode?: unknown } | null | undefined)?.statusCode === 403;
}
