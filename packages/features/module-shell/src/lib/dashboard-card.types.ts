import type { ReactNode } from 'react';

/** Bề ngang thẻ trên lưới 4 cột. */
export type DashboardCardSize = 'sm' | 'md' | 'lg' | 'xl';

export interface DashboardCardDefinition<TData> {
  /**
   * Id ổn định, được lưu vào cấu hình của tenant.
   *
   * Không bao giờ đổi tên id — chỉ ngừng dùng. Đổi tên là làm mất lựa chọn của
   * mọi tenant đang bật thẻ đó.
   */
  readonly id: string;
  readonly title: string;
  /** Hiện trong màn chọn thẻ, để admin biết mình đang bật cái gì. */
  readonly description: string;
  readonly size: DashboardCardSize;
  /** Dùng cho tenant chưa từng mở màn cài đặt. */
  readonly defaultEnabled?: boolean;
  readonly render: (data: TData) => ReactNode;
}

export type DashboardCardCatalog<TData> = readonly DashboardCardDefinition<TData>[];

/**
 * Chọn thẻ nào, theo thứ tự nào.
 *
 * Ba luật phân giải, cố ý đặt ở một chỗ vì cả dashboard lẫn màn chọn thẻ đều dùng:
 *  - Thứ tự lấy từ `selection`, không lấy từ catalog. Sắp xếp lại chỉ là sắp xếp
 *    lại mảng đã lưu, không cần cột thứ tự.
 *  - Id không khớp catalog thì bỏ qua im lặng, để bản sau gỡ một thẻ không làm
 *    hỏng tenant còn lưu id cũ.
 *  - `selection` rỗng thì rơi về các thẻ `defaultEnabled`, nên tenant mới có
 *    dashboard dùng được ngay mà không cần dữ liệu seed.
 */
export function resolveDashboardCards<TData>(
  catalog: DashboardCardCatalog<TData>,
  selection: readonly string[],
): DashboardCardDefinition<TData>[] {
  if (selection.length === 0) {
    return catalog.filter((card) => card.defaultEnabled);
  }
  const byId = new Map(catalog.map((card) => [card.id, card]));
  return selection
    .map((id) => byId.get(id))
    .filter((card): card is DashboardCardDefinition<TData> => card !== undefined);
}
