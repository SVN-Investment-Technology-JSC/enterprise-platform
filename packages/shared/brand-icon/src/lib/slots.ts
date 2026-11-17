import type { BrandSvgMode } from './api-types';

/** Nhóm vị trí sử dụng icon trong toàn hệ thống. */
export type IconSlotGroup = 'brand' | 'module' | 'nav' | 'custom' | (string & {});

export interface IconSlotMeta {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  readonly description: string;
  /** `brand`: giữ màu thương hiệu & gradient; `mono`: dùng `currentColor` theo màu chữ. */
  readonly colorMode: BrandSvgMode;
  readonly recommendedSize: number;
  /** Đánh dấu vị trí do người dùng tự tạo; false hoặc undefined là vị trí hệ thống cố định. */
  readonly isCustom?: boolean;
}

export const SLOT_ID_PATTERN = /^[a-z][a-z0-9_.-]{1,63}$/;

export function isValidSlotId(id: unknown): id is string {
  return typeof id === 'string' && SLOT_ID_PATTERN.test(id);
}

export interface CustomSlotPayload {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly group?: string;
  readonly colorMode?: BrandSvgMode;
  readonly recommendedSize?: number;
}

export const ICON_SLOTS = [
  // Thương hiệu cốt lõi
  {
    id: 'brand.logo',
    group: 'brand',
    label: 'Logo chính hệ thống',
    description: 'Hiển thị ở góc trên thanh bên và đầu trang ứng dụng.',
    colorMode: 'brand',
    recommendedSize: 32,
  },

  // Biểu tượng phân hệ
  {
    id: 'module.workspace',
    group: 'module',
    label: 'Không gian làm việc (Workspace)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Workspace.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.hrm',
    group: 'module',
    label: 'Nhân sự & Chấm công (HRM)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ HRM.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.inventory',
    group: 'module',
    label: 'Kho & Vật tư (Inventory)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Kho vận.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.maintenance',
    group: 'module',
    label: 'Bảo trì thiết bị (CMMS)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Bảo trì.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.finance',
    group: 'module',
    label: 'Tài chính & Kế toán (Finance)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Tài chính.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.procedure',
    group: 'module',
    label: 'Quy trình & Phê duyệt (Procedure)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Quy trình.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.crm',
    group: 'module',
    label: 'Bán hàng & Khách hàng (CRM)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ CRM.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.shared',
    group: 'module',
    label: 'Kho tài liệu dùng chung (Shared)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Tài liệu.',
    colorMode: 'brand',
    recommendedSize: 24,
  },
  {
    id: 'module.social',
    group: 'module',
    label: 'Mạng nội bộ (Social)',
    description: 'Thẻ ứng dụng và menu chuyển phân hệ Mạng nội bộ.',
    colorMode: 'brand',
    recommendedSize: 24,
  },

  // Menu điều hướng thanh bên (một màu theo ngữ cảnh)
  {
    id: 'nav.dashboard',
    group: 'nav',
    label: 'Bảng điều khiển',
    description: 'Mục điều hướng Tổng quan / Bảng điều khiển.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.applications',
    group: 'nav',
    label: 'Ứng dụng phân hệ',
    description: 'Mục điều hướng danh sách ứng dụng phân hệ.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.organization',
    group: 'nav',
    label: 'Sơ đồ tổ chức',
    description: 'Mục điều hướng cơ cấu tổ chức & phòng ban.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.users',
    group: 'nav',
    label: 'Tài khoản người dùng',
    description: 'Mục điều hướng quản lý người dùng / khách hàng.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.authorization',
    group: 'nav',
    label: 'Vai trò & Phân quyền',
    description: 'Mục điều hướng thiết lập vai trò và quyền hạn.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.account',
    group: 'nav',
    label: 'Tài khoản của tôi',
    description: 'Mục điều hướng hồ sơ cá nhân người dùng.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.tenants',
    group: 'nav',
    label: 'Khách hàng (Tenants)',
    description: 'Mục điều hướng quản lý tenant trên Platform Admin.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.plans',
    group: 'nav',
    label: 'Gói dịch vụ & Hạn mức',
    description: 'Mục điều hướng cấu hình gói dịch vụ nền tảng.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.brand-studio',
    group: 'nav',
    label: 'Thư viện icon',
    description: 'Mục điều hướng Thư viện icon Brand Studio.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.brand-standards',
    group: 'nav',
    label: 'Bảng màu & Quy chuẩn',
    description: 'Mục điều hướng Bảng màu & Quy chuẩn thương hiệu.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.brand-slots',
    group: 'nav',
    label: 'Vị trí sử dụng icon',
    description: 'Mục điều hướng màn hình gán icon vào vị trí.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.data-import',
    group: 'nav',
    label: 'Nhập dữ liệu',
    description: 'Mục điều hướng nhập dữ liệu hàng loạt.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.settings',
    group: 'nav',
    label: 'Cài đặt phân hệ',
    description: 'Mục điều hướng cài đặt chung trong các phân hệ.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
  {
    id: 'nav.reports',
    group: 'nav',
    label: 'Báo cáo & Thống kê',
    description: 'Mục điều hướng báo cáo và phân tích dữ liệu.',
    colorMode: 'mono',
    recommendedSize: 18,
  },
] as const;

export type BuiltInSlotId = (typeof ICON_SLOTS)[number]['id'];
export type IconSlotId = BuiltInSlotId | (string & {});

export const SLOT_GROUP_LABELS: Record<string, string> = {
  brand: 'Thương hiệu',
  module: 'Phân hệ',
  nav: 'Thanh điều hướng',
  custom: 'Tùy chỉnh',
};

const SLOT_BY_ID = new Map<string, IconSlotMeta>(
  ICON_SLOTS.map((slot) => [slot.id, slot]),
);

export function isBuiltInSlotId(value: string): value is BuiltInSlotId {
  return SLOT_BY_ID.has(value);
}

export function isIconSlotId(value: string): value is IconSlotId {
  return isValidSlotId(value);
}

export function getIconSlotMeta(slot: string): IconSlotMeta | undefined {
  return SLOT_BY_ID.get(slot);
}

const MODULE_KEY_TO_SLOT: Record<string, IconSlotId> = {
  workspace: 'module.workspace',
  hrm: 'module.hrm',
  inventory: 'module.inventory',
  maintenance: 'module.maintenance',
  finance: 'module.finance',
  'procedure-engine': 'module.procedure',
  procedure: 'module.procedure',
  crm: 'module.crm',
  shared: 'module.shared',
  social: 'module.social',
};

/** Ánh xạ `moduleKey` sang vị trí icon tương ứng; trả undefined nếu không có slot riêng. */
export function moduleSlotId(moduleKey: string): IconSlotId | undefined {
  return MODULE_KEY_TO_SLOT[moduleKey];
}

/** Tiền tố ID an toàn cho `<defs>` / `<symbol>` của từng slot trong DOM trang. */
export function slotSymbolId(slot: IconSlotId): string {
  return `ep-slot-${slot.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}
