import type { ReactNode } from 'react';

/**
 * Một mục trên thanh điều hướng dọc.
 *
 * `id` đồng thời là đoạn hash trên URL, nên nó phải ổn định: đổi id là làm hỏng
 * mọi link đã chia sẻ. Cần đổi nhãn thì sửa `label`, giữ nguyên `id`.
 */
export interface ModuleNavItem<TViewId extends string = string> {
  readonly id: TViewId;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly badge?: string | number;
  /** Tiêu đề nhóm; các mục liền nhau cùng `group` được gom lại dưới một tiêu đề. */
  readonly group?: string;
  /** Module tự quyết định ẩn hiện; shell chỉ lọc chứ không xét quyền. */
  readonly hidden?: boolean;
}

/** Một dòng trong mục riêng của thanh bên, ví dụ một dự án. */
export interface ModuleSidebarItem {
  readonly id: string;
  readonly label: string;
  /** Chú thích khi rê chuột; mặc định là `label`. */
  readonly title?: string;
  /** Biểu tượng hoặc ô viết tắt bên trái. */
  readonly leading?: ReactNode;
  /** Chữ nhỏ bên phải, ví dụ tiến độ. */
  readonly trailing?: ReactNode;
  readonly active?: boolean;
  readonly onSelect: () => void;
}

/**
 * Mục riêng của module trên thanh bên, nằm dưới các mục điều hướng: tiêu đề,
 * một nút thao tác (thường là "+"), danh sách dòng và một dòng cuối kiểu "Tất
 * cả …". Khung vẽ bằng đúng kiểu của mục điều hướng để hai phần cùng một nhịp.
 */
export interface ModuleSidebarSection {
  readonly id: string;
  readonly title: string;
  /** Số nhỏ cạnh tiêu đề, ví dụ tổng số dự án. */
  readonly count?: number;
  readonly action?: {
    readonly label: string;
    readonly icon?: ReactNode;
    readonly onClick: () => void;
  };
  readonly items: readonly ModuleSidebarItem[];
  readonly footer?: { readonly label: string; readonly onClick: () => void };
  /** Hiện khi `items` rỗng. */
  readonly emptyText?: string;
}

export interface ModuleShellProps<TViewId extends string = string> {
  readonly moduleKey: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly nav: readonly ModuleNavItem<TViewId>[];
  readonly view: TViewId;
  readonly onViewChange: (next: TViewId) => void;
  /** Link "← Trang chủ" về Tenant Portal; bỏ trống thì không hiện. */
  readonly homeHref?: string;
  /** Nút thao tác riêng của từng view, do module dựng. */
  readonly actions?: ReactNode;
  /**
   * Chỉ kiểu `light`: các bậc thêm vào cuối breadcrumb, sau tên trang — ví dụ
   * tên dự án đang mở: "Không gian làm việc › Dự án › SCADA nhà máy Tân Ân".
   */
  readonly crumbs?: readonly string[];
  /** Dải thông báo/lỗi nằm trên nội dung. */
  readonly banner?: ReactNode;
  /** Tên hoặc thông tin người thao tác hiển thị (tuỳ chọn ghi đè). */
  readonly actor?: string;
  /** Slug của Tenant (tuỳ chọn ghi đè). */
  readonly tenantSlug?: string;
  /**
   * Cho phép thu rail thành dải biểu tượng sát cạnh trái.
   *
   * Mặc định tắt: module nào không khai thì rail giữ nguyên như cũ, nên bật
   * tính năng này không đụng tới Kho, Bảo trì hay Quy trình.
   */
  readonly collapsible?: boolean;
  /** Trạng thái thu gọn, do module giữ để còn dùng cho bố cục của chính nó. */
  readonly collapsed?: boolean;
  readonly onCollapsedChange?: (next: boolean) => void;
  /**
   * Kiểu khung. `classic` là rail tối kèm thanh trên (mặc định);
   * `light` là thanh bên sáng có khối người dùng, không có thanh trên —
   * breadcrumb và nút thao tác nằm ngay đầu vùng nội dung.
   */
  readonly appearance?: 'classic' | 'light';
  /**
   * Chỉ kiểu `light`: có thì hiện ô "Tìm nhanh" trên thanh bên, và phím
   * Ctrl+K (Cmd+K) mở cùng chỗ đó từ bất kỳ đâu trong module.
   */
  readonly onQuickSearch?: () => void;
  /** Chỉ kiểu `light`: các mục riêng của module, vẽ dưới danh sách điều hướng. */
  readonly sidebarSections?: readonly ModuleSidebarSection[];
  readonly children: ReactNode;
}

