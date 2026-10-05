import { evaluatePayroll, type PayrollComponent } from './payroll-formula.js';

const DEDUCTIONS = [
  'STATUTORY_DEDUCTION',
  'TAX_DEDUCTION',
  'ADVANCE_DEDUCTION',
  'OTHER_DEDUCTION',
];

export interface DryRunResult {
  items: { code: string; name: string; type: string; amount: number; formula: string }[];
  gross: number;
  deductions: number;
  net: number;
  /** Chênh lệch NET_PAY so với thu nhập trừ khấu trừ (phải ~0 mới ghi được kỳ lương thật). */
  netMismatch: number;
  warnings: string[];
}

/**
 * Tính thử công thức cho một nhân viên từ bộ biến hệ thống của kỳ đã tính (snapshot).
 * Hàm thuần: không đọc/ghi dữ liệu. Tham số công thức thử (`inputs`) ghi đè tham số chung nhưng
 * không được ghi đè biến hệ thống.
 */
export function dryRunPayroll(
  components: PayrollComponent[],
  systemInputs: Record<string, number | string>,
  customInputs: Record<string, number>,
  systemKeys: readonly string[],
): DryRunResult {
  for (const key of Object.keys(customInputs))
    if (systemKeys.includes(key))
      throw new Error(`Tham số không được trùng biến hệ thống: ${key}`);
  const input = { ...customInputs, ...systemInputs };
  const items = evaluatePayroll(components, input).map((c) => ({
    code: c.code,
    name: c.name,
    type: c.type,
    amount: c.amount,
    formula: c.formula,
  }));
  const total = (types: string[]) =>
    Math.round(
      items.filter((c) => types.includes(c.type)).reduce((n, c) => n + c.amount, 0) * 100,
    ) / 100;
  const gross =
    total(['EARNING', 'ALLOWANCE', 'OVERTIME']) + Number(input.MANUAL_EARNINGS || 0);
  const deductions = total(DEDUCTIONS) + Number(input.MANUAL_DEDUCTIONS || 0);
  const net = total(['NET_PAY']);
  const netMismatch = Math.round((gross - deductions - net) * 100) / 100;
  const warnings: string[] = [];
  if (Math.abs(netMismatch) > 0.011)
    warnings.push('NET_PAY không khớp tổng thu nhập trừ khấu trừ; kỳ lương thật sẽ từ chối công thức này');
  if (items.some((c) => c.amount < 0))
    warnings.push('Có thành phần âm; kỳ lương thật sẽ từ chối');
  const advance = total(['ADVANCE_DEDUCTION']);
  if (Math.abs(advance - Number(input.ADVANCE_DUE || 0)) > 0.011)
    warnings.push('Khoản thu hồi ứng lương không khớp lịch thu hồi (ADVANCE_DUE)');
  return {
    items,
    gross: Math.round(gross * 100) / 100,
    deductions: Math.round(deductions * 100) / 100,
    net,
    netMismatch,
    warnings,
  };
}
