import type { CrmCapabilities, CrmStatus } from '@enterprise-platform/contracts-crm';

/**
 * Trang của phân hệ. `id` cũng là đoạn hash trên URL nên phải ổn định: đổi
 * nhãn thì sửa `label`, giữ nguyên `id`.
 */
export type CrmView =
  | 'overview'
  | 'tasks'
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
  'customers',
  'leads',
  'activities',
  'overview',
  'tasks',
  'opportunities',
  'quotes',
  'contracts',
  'orders',
  'receivables',
  'warranty',
  'reports',
  'settings',
];

/**
 * Hai phần của module. `id` của từng trang (cũng là hash URL) không đổi khi trang
 * chuyển phần; phần chỉ quyết định thanh bên đang liệt kê trang nào.
 */
export type CrmSectionId = 'care' | 'sales';

export interface CrmSection {
  readonly id: CrmSectionId;
  readonly label: string;
  /** Trang thuộc phần này, theo thứ tự menu. */
  readonly views: readonly CrmView[];
}

export const CRM_SECTIONS: readonly CrmSection[] = [
  { id: 'care', label: 'Quản lý khách hàng', views: ['customers', 'leads', 'activities'] },
  {
    id: 'sales',
    label: 'Bán hàng',
    views: ['overview', 'tasks', 'opportunities', 'quotes', 'contracts', 'orders', 'receivables', 'warranty', 'reports'],
  },
];

/** Trang dùng chung, hiện ở cả hai phần (Cài đặt). */
export const CRM_SHARED_VIEWS: readonly CrmView[] = ['settings'];

/** Vào `/modules/crm` không hash thì mở phần này, trang này. */
export const CRM_DEFAULT_SECTION: CrmSectionId = 'care';
export const CRM_DEFAULT_VIEW: CrmView = 'customers';

export const CRM_PAGES: readonly CrmPage[] = [
  {
    id: 'customers',
    label: 'Khách hàng',
    group: 'Quản lý khách hàng',
    summary: 'Hồ sơ khách hàng, người liên hệ, nhóm khách và người phụ trách.',
  },
  {
    id: 'leads',
    label: 'Lead',
    group: 'Quản lý khách hàng',
    summary: 'Đầu mối tiềm năng; chuyển thành khách hàng và dự án bán hàng bằng một thao tác.',
  },
  {
    id: 'activities',
    label: 'Hoạt động chăm sóc',
    group: 'Quản lý khách hàng',
    summary: 'Gọi điện, email, gặp mặt, công việc; nhắc trước hạn và khi quá hạn.',
  },
  {
    id: 'overview',
    label: 'Tổng quan',
    group: 'Bán hàng',
    summary: 'Doanh thu, lợi nhuận, dự án bán hàng, công nợ so với kỳ trước và các việc cần chú ý trong phạm vi của bạn.',
  },
  {
    id: 'tasks',
    label: 'Việc cần xử lý',
    group: 'Bán hàng',
    summary: 'Báo giá, phương án kinh doanh đang chờ bạn duyệt và việc của báo giá bạn phụ trách.',
  },
  {
    id: 'opportunities',
    label: 'Dự án bán hàng',
    group: 'Bán hàng',
    summary: 'Dự án bán hàng theo giai đoạn: kanban kéo thả, dạng bảng, lịch sử chuyển giai đoạn.',
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

/** Phần chứa trang; trang dùng chung (Cài đặt) không thuộc phần nào. */
export function sectionOfView(view: CrmView): CrmSectionId | undefined {
  return CRM_SECTIONS.find((section) => section.views.includes(view))?.id;
}

/**
 * Các phần có ít nhất một trang người này được thấy, theo thứ tự hiển thị.
 * Phần không còn trang nào thì ẩn. `pages` mặc định là `CRM_PAGES`.
 */
export function visibleCrmSections(
  capabilities: CrmCapabilities,
  pages: readonly CrmPage[] = CRM_PAGES,
): CrmSection[] {
  const shown = new Set(pages.filter((page) => page.visible?.(capabilities) ?? true).map((page) => page.id));
  return CRM_SECTIONS.filter((section) => section.views.some((view) => shown.has(view)));
}

/** Trang đầu tiên được thấy của một phần (đích khi bấm bộ chuyển phần). */
export function firstViewOfSection(
  sectionId: CrmSectionId,
  capabilities: CrmCapabilities,
  pages: readonly CrmPage[] = CRM_PAGES,
): CrmView | undefined {
  const section = CRM_SECTIONS.find((entry) => entry.id === sectionId);
  const shown = new Set(pages.filter((page) => page.visible?.(capabilities) ?? true).map((page) => page.id));
  return section?.views.find((view) => shown.has(view));
}

/**
 * Trang thật sự mở. Hash tới trang bị ẩn (mở link cũ khi không có quyền) thì rơi về
 * trang đầu của phần mặc định, rồi tới trang đầu tiên được thấy.
 */
export function resolveCrmView(
  view: CrmView,
  capabilities: CrmCapabilities,
  pages: readonly CrmPage[] = CRM_PAGES,
): CrmView {
  const shown = pages.filter((page) => page.visible?.(capabilities) ?? true);
  if (shown.some((page) => page.id === view)) return view;
  return firstViewOfSection(CRM_DEFAULT_SECTION, capabilities, pages) ?? shown[0]?.id ?? CRM_DEFAULT_VIEW;
}

/**
 * Phần đang hiển thị: phần chứa trang đang mở; trang dùng chung giữ phần trước đó
 * (nếu phần ấy còn hiện được), không có thì phần hiện được đầu tiên.
 */
export function activeCrmSection(
  view: CrmView,
  previous: CrmSectionId | undefined,
  capabilities: CrmCapabilities,
  pages: readonly CrmPage[] = CRM_PAGES,
): CrmSectionId | undefined {
  const sections = visibleCrmSections(capabilities, pages);
  const own = sectionOfView(view);
  if (own) return sections.some((section) => section.id === own) ? own : sections[0]?.id;
  if (previous && sections.some((section) => section.id === previous)) return previous;
  return sections[0]?.id;
}

/** Trang hiện trên thanh bên khi đang ở một phần: trang của phần đó cộng trang dùng chung. */
export function viewsInSection(sectionId: CrmSectionId | undefined): readonly CrmView[] {
  const section = CRM_SECTIONS.find((entry) => entry.id === sectionId);
  return section ? [...section.views, ...CRM_SHARED_VIEWS] : [];
}

/** Đích của nút "Kho hàng". */
export const CRM_INVENTORY_HREF = '/modules/inventory';
export const CRM_INVENTORY_LABEL = 'Kho hàng';
export const CRM_INVENTORY_DENIED_HINT = 'Bạn chưa được cấp quyền vào Kho';

/** `hidden`: tenant chưa mua Kho; `enabled`: bấm được; `disabled`: hiện nhưng mờ, không bấm được. */
export type CrmInventoryButtonState = 'hidden' | 'enabled' | 'disabled';

/**
 * Trạng thái nút Kho từ `GET v1/status`. Chưa có status, thiếu cờ hay cờ sai kiểu đều coi là `false`:
 * không bao giờ mở nút bấm được khi không chắc. Chỉ là ẩn hiện; Kho vẫn tự kiểm quyền ở server.
 */
export function inventoryButtonState(
  status: Partial<Pick<CrmStatus, 'inventoryEntitled' | 'canAccessInventory'>> | undefined,
): CrmInventoryButtonState {
  if (status?.inventoryEntitled !== true) return 'hidden';
  return status.canAccessInventory === true ? 'enabled' : 'disabled';
}

/** Phạm vi dữ liệu hiện cho người dùng; quyền thật lọc ở API. */
export function crmScopeLabel(capabilities: CrmCapabilities): string {
  return capabilities.isTenantAdmin || capabilities.canManage || capabilities.canReadAll
    ? 'Toàn bộ dữ liệu CRM'
    : 'Dữ liệu của bạn và cấp dưới theo cơ cấu tổ chức';
}

/** Nhãn tiếng Việt của các quyền đang có, để trang Tổng quan cho người dùng biết mình làm được gì. */
export function crmCapabilityLabels(capabilities: CrmCapabilities): string[] {
  if (capabilities.isTenantAdmin) return ['Quản trị tenant: mọi quyền CRM'];
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
  'Bạn chưa được cấp quyền dùng phân hệ CRM. Liên hệ quản trị để được cấp quyền.';

/** Lỗi tải trạng thái là do chưa được cấp quyền (403), không phải lỗi hệ thống. */
export function isCrmAccessDenied(cause: unknown): boolean {
  return (cause as { statusCode?: unknown } | null | undefined)?.statusCode === 403;
}
