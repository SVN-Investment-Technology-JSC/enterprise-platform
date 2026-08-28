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
  /** Dải thông báo/lỗi nằm trên nội dung. */
  readonly banner?: ReactNode;
  /** Tên hoặc thông tin người thao tác hiển thị (tuỳ chọn ghi đè). */
  readonly actor?: string;
  /** Slug của Tenant (tuỳ chọn ghi đè). */
  readonly tenantSlug?: string;
  readonly children: ReactNode;
}

