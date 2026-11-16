import type { WorkItem } from '@enterprise-platform/contracts-workspace';

/**
 * Ô tiến độ của một công việc có sửa được không, và sửa bằng cách nào.
 *  · `editable: true, quantity: false` → bảng chọn nhanh 0–100 (việc tính theo % tự cập nhật);
 *  · `editable: true, quantity: true`  → bấm mở hộp báo khối lượng;
 *  · `editable: false` → chỉ xem, kèm `reason` để giải thích ở tooltip (vắng khi không cần giải thích).
 * Server vẫn là nơi chặn thật; đây chỉ để không đưa ra thao tác chắc chắn bị từ chối.
 */
export function progressCellMode(
  item: Pick<WorkItem, 'status' | 'progressMethod'>,
  options: { readonly hasChildren: boolean; readonly canWrite: boolean },
): { readonly editable: boolean; readonly quantity: boolean; readonly reason?: string } {
  const method = item.progressMethod ?? 'manual';
  if (!options.canWrite) return { editable: false, quantity: false };
  if (item.status === 'done') {
    return { editable: false, quantity: false, reason: 'Công việc đã hoàn thành; mở lại để đổi tiến độ.' };
  }
  if (item.status === 'cancelled') return { editable: false, quantity: false };
  if (options.hasChildren) {
    return { editable: false, quantity: false, reason: 'Tiến độ tự tính từ các việc con.' };
  }
  if (method === 'checklist') {
    return {
      editable: false,
      quantity: false,
      reason: 'Tiến độ tính theo đầu việc: mở công việc để tích đầu việc.',
    };
  }
  return { editable: true, quantity: method === 'quantity' };
}
