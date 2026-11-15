/**
 * Che dữ liệu nhạy cảm của hồ sơ nhân viên (CCCD gồm số, ngày cấp, nơi cấp, ngày hết hạn và tệp ảnh;
 * mã số thuế, BHXH, tài khoản ngân hàng).
 * Chỉ người có quyền hrm.employee.sensitive (hoặc quản trị HRM) và chính chủ hồ sơ được xem nguyên.
 */
const CAMEL = [
  'identityCardNumber',
  'identityCardIssuedPlace',
  'identityCardIssuedDate',
  'identityCardExpiryDate',
  'taxCode',
  'socialInsuranceNumber',
  'bankAccountNumber',
  'bankName',
  'bankBranch',
] as const;

const SNAKE = [
  'identity_card_number',
  'identity_card_issued_place',
  'identity_card_issued_date',
  'identity_card_expiry_date',
  'identity_card_front_attachment_id',
  'identity_card_back_attachment_id',
  'tax_code',
  'social_insurance_number',
  'bank_account_number',
  'bank_name',
  'bank_branch',
] as const;

function nullify<T extends object>(value: T, keys: readonly string[]): T {
  const copy = { ...value } as Record<string, unknown>;
  for (const key of keys) if (key in copy) copy[key] = null;
  return copy as T;
}

/** Hồ sơ đã map sang camelCase (mapProfile). */
export function redactSensitiveProfile<T extends object>(profile: T): T {
  return nullify(profile, CAMEL);
}

/** Dòng thô từ bảng employee_profiles (snake_case). */
export function redactSensitiveRow<T extends object>(row: T): T {
  return nullify(row, SNAKE);
}

/** Giấy tờ hồ sơ (loadProfileDocuments): bỏ tệp ảnh CCCD và ngày hết hạn CCCD; ảnh thẻ, bằng cấp giữ nguyên. */
export function redactSensitiveDocuments<T extends object>(documents: T): T {
  return nullify(documents, ['identityCardExpiryDate', 'identityCardFront', 'identityCardBack']);
}

/** Số tài khoản chỉ giữ 4 số cuối: `****1234`. Rỗng thì giữ nguyên. */
export function maskAccountNumber(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return value;
  const compact = value.replace(/\s+/g, '');
  return `****${compact.slice(-4)}`;
}

/**
 * Dòng tổng lương (payroll_employee_totals): che số tài khoản trong `beneficiary_snapshot` với người không có quyền
 * xem dữ liệu nhạy cảm. Tên ngân hàng, chi nhánh giữ nguyên để kế toán còn đối chiếu.
 */
export function maskPayrollTotalBank<T extends { beneficiary_snapshot?: unknown }>(row: T): T {
  const snapshot = row.beneficiary_snapshot;
  if (!snapshot || typeof snapshot !== 'object') return row;
  const bank = snapshot as Record<string, unknown>;
  if (!('bank_account_number' in bank)) return row;
  return {
    ...row,
    beneficiary_snapshot: { ...bank, bank_account_number: maskAccountNumber(bank.bank_account_number) },
  };
}
