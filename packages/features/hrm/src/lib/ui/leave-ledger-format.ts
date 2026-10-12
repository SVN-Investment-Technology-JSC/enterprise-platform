import type { HrmLeaveTransactionType } from '@enterprise-platform/contracts-hrm';

/** Single decimal format for the ledger (vi-VN: -0,5). */
export function formatLeaveNumber(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
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
