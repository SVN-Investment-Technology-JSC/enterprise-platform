import type { FinanceVoucher } from '@enterprise-platform/contracts-finance';
import type { MenuEntry } from '@enterprise-platform/feature-shared';

/** Hành động nhanh trên danh sách phiếu (menu chuột phải), không cần mở từng phiếu. */
export type FinanceMenuActionId = 'edit' | 'approve' | 'cancel' | 'delete' | 'duplicate';

const item = (id: FinanceMenuActionId, label: string, danger = false): MenuEntry<FinanceMenuActionId> => ({ kind: 'item', id, label, danger });

/**
 * Dựng menu chuột phải cho một phiếu, từ đúng `permissions` máy chủ đã tính (một nguồn sự thật duy nhất, khớp các
 * nút ở trang chi tiết) — không tính lại công thức quyền ở client. "Nhân bản" luôn hiện nếu lập được loại phiếu này,
 * không phụ thuộc trạng thái hay chủ phiếu (nhân bản phiếu của người khác để tạo phiếu mới là hợp lệ).
 */
export function buildVoucherMenu(voucher: Pick<FinanceVoucher, 'permissions'>, canCreate: boolean): MenuEntry<FinanceMenuActionId>[] {
  const can = voucher.permissions;
  const entries: MenuEntry<FinanceMenuActionId>[] = [];
  if (can.canEdit) entries.push(item('edit', 'Sửa'));
  if (can.canApprove) entries.push(item('approve', 'Duyệt'));
  if (can.canCancel) entries.push(item('cancel', 'Huỷ', true));
  if (can.canDelete) entries.push(item('delete', 'Xoá', true));
  if (canCreate) {
    if (entries.length) entries.push({ kind: 'separator' });
    entries.push(item('duplicate', 'Nhân bản'));
  }
  return entries;
}
