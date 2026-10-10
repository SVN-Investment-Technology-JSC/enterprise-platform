/**
 * Che dữ liệu nhạy cảm của hồ sơ nhân viên (CCCD, mã số thuế, BHXH, tài khoản ngân hàng).
 * Chỉ người có quyền hrm.employee.sensitive (hoặc quản trị HRM) và chính chủ hồ sơ được xem nguyên.
 */
const CAMEL = [
  'identityCardNumber',
  'identityCardIssuedPlace',
  'taxCode',
  'socialInsuranceNumber',
  'bankAccountNumber',
  'bankName',
  'bankBranch',
] as const;

const SNAKE = [
  'identity_card_number',
  'identity_card_issued_place',
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
