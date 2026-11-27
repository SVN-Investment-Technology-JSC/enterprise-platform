import type { FinanceVoucher } from '@enterprise-platform/contracts-finance';
import type { MenuEntry } from '@enterprise-platform/feature-shared';

/** Hành động nhanh trên danh sách phiếu (menu chuột phải), không cần mở từng phiếu. */
export type FinanceMenuActionId = 'edit' | 'approve' | 'cancel' | 'duplicate';

const item = (id: FinanceMenuActionId, label: string, danger = false): MenuEntry<FinanceMenuActionId> => ({ kind: 'item', id, label, danger });

/** Nhãn thao tác duyệt nhanh: duyệt và ghi sổ ngay (phiếu thường) hoặc ghi sổ phiếu có nguồn. */
export const APPROVE_MENU_LABEL = 'Duyệt ghi sổ';

/**
 * Dựng menu chuột phải cho một phiếu, từ đúng `permissions` máy chủ đã tính (một nguồn sự thật duy nhất, khớp các
 * nút ở trang chi tiết) — không tính lại công thức quyền ở client. "Nhân bản" luôn hiện nếu lập được loại phiếu này,
 * không phụ thuộc trạng thái hay chủ phiếu (nhân bản phiếu của người khác để tạo phiếu mới là hợp lệ).
 *
 * "Duyệt ghi sổ" bấm được khi phiếu đủ thông tin và người xem được duyệt (phiếu thường) hoặc được ghi sổ (phiếu có nguồn); người
 * có quyền duyệt mà phiếu chưa đủ điều kiện thì thấy mục mờ kèm lý do máy chủ trả (`approveBlockedReason`). "Huỷ" không hỏi lại:
 * phiếu chưa ghi sổ bị xoá hẳn, phiếu đã ghi sổ được đảo bút toán (nên không còn mục "Xoá" riêng).
 */
export function buildVoucherMenu(voucher: Pick<FinanceVoucher, 'permissions'>, canCreate: boolean): MenuEntry<FinanceMenuActionId>[] {
  const can = voucher.permissions;
  const entries: MenuEntry<FinanceMenuActionId>[] = [];
  if (can.canEdit || can.sourced.canEditSourced) entries.push(item('edit', 'Sửa'));
  const approvable = can.canApprove || can.sourced.canPost;
  if (approvable) entries.push(item('approve', APPROVE_MENU_LABEL));
  else if (can.approveBlockedReason) entries.push({ kind: 'item', id: 'approve', label: APPROVE_MENU_LABEL, disabledReason: can.approveBlockedReason });
  if (can.canCancel) entries.push(item('cancel', 'Huỷ', true));
  if (canCreate) {
    if (entries.length) entries.push({ kind: 'separator' });
    entries.push(item('duplicate', 'Nhân bản'));
  }
  return entries;
}
