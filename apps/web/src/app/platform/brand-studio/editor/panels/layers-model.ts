import type { IconDocument, IconShape } from '@enterprise-platform/shared-brand-icon';

export const MAX_LAYER_NAME = 40;

/** Lớp trên cùng hiển thị trước: lớp cuối mảng `shapes` nằm ở đầu danh sách. */
export const displayOrder = (shapes: readonly IconShape[]): IconShape[] => [...shapes].reverse();

/** Các mã nằm giữa `anchor` và `target` (gồm cả hai đầu) theo thứ tự hiển thị; không có điểm neo thì chỉ chọn `target`. */
export function rangeIds(order: readonly string[], anchor: string | null, target: string): string[] {
  const to = order.indexOf(target);
  if (to < 0) return [];
  const from = anchor === null ? -1 : order.indexOf(anchor);
  if (from < 0) return [target];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

export type DropPosition = 'above' | 'below';

/** Thả ở nửa trên hay nửa dưới của dòng đang rê tới. */
export const dropPosition = (clientY: number, rect: { top: number; height: number }): DropPosition =>
  clientY < rect.top + rect.height / 2 ? 'above' : 'below';

/**
 * Chỉ số đích cho `moveShape` khi kéo lớp ở `from` thả lên dòng `over` (cả hai là chỉ số trong mảng `shapes`, 0 là lớp dưới cùng).
 * "Phía trên" trên màn hình là chỉ số lớn hơn trong mảng. `moveShape` rút phần tử ra rồi chèn lại nên chỉ số đích tính trên
 * mảng đã rút.
 */
export function dropTargetIndex(from: number, over: number, position: DropPosition): number {
  const overAfterRemoval = over - (from < over ? 1 : 0);
  return position === 'above' ? overAfterRemoval + 1 : overAfterRemoval;
}

/** Tên lớp sau khi sửa: gọn khoảng trắng, cắt độ dài; rỗng thì giữ tên cũ. */
export function normalizeLayerName(input: string, fallback: string): string {
  const name = input.trim().replace(/\s+/g, ' ').slice(0, MAX_LAYER_NAME);
  return name || fallback;
}

/** Tài liệu chỉ chứa một lớp (luôn hiện, kể cả lớp đang ẩn) để vẽ ảnh nhỏ cho dòng lớp. */
export function layerThumbnailDoc(size: number, shape: IconShape): IconDocument {
  return {
    schema: 1,
    id: 'layer-thumbnail',
    name: shape.name,
    description: '',
    category: 'custom',
    tags: [],
    status: 'draft',
    size,
    shapes: [{ ...shape, hidden: false }],
    createdAt: '',
    updatedAt: '',
  };
}
