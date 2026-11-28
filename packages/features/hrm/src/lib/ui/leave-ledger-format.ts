import type { HrmLeaveTransactionType } from '@enterprise-platform/contracts-hrm';

/** Single decimal format for the ledger (vi-VN: -0,5). */
export function formatLeaveNumber(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

/**
 * Năm chỉ số hiển thị của quỹ phép năm, dùng chung cho bảng và Drawer:
 * - `total` = Có thể dùng (đã trừ đơn chờ duyệt, gồm cả phần ứng);
 * - `advance` = phần còn ứng được thêm theo chính sách (0 nếu không cho ứng);
 * - `stock` = Còn tồn = total - advance (phần phép đã tích luỹ còn lại, có thể âm khi đang dùng phần ứng);
 * - `used` = đã duyệt + chờ duyệt;
 * - `adjusted` = tổng điều chỉnh thủ công.
 */
export function leaveBalanceFigures(row: {
  remaining: number;
  used: number;
  pending: number;
  adjusted?: number;
  advanceAllowed?: boolean;
  entitlement: number;
  accrued: number;
  entitledToDate?: number | null;
  projectedEntitlement?: number | null;
}) {
  const accrued = row.entitledToDate ?? row.accrued;
  const advance = row.advanceAllowed
    ? Math.max(0, (row.projectedEntitlement ?? row.entitlement) - accrued)
    : 0;
  const total = Number(row.remaining || 0);
  return {
    total,
    advance,
    stock: total - advance,
    used: Number(row.used || 0) + Number(row.pending || 0),
    adjusted: Number(row.adjusted || 0),
  };
}

export const leaveTransactionLabels: Record<HrmLeaveTransactionType, string> = {
  ACCRUAL: 'Cộng phép tháng',
  SENIORITY_ACCRUAL: 'Cộng phép thâm niên',
  USAGE: 'Sử dụng',
  REVERSAL: 'Hoàn/đảo',
  ADJUSTMENT: 'Điều chỉnh',
  CARRYOVER_OUT: 'Chuyển sang năm sau',
  CARRYOVER_IN: 'Nhận phép chuyển',
  YEAR_END_RESET: 'Reset cuối năm',
  CARRYOVER_EXPIRE: 'Hết hạn phép chuyển',
  RECOVERY: 'Thu hồi',
};
