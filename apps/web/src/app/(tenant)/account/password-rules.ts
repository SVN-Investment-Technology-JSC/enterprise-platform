import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordPolicyViolation,
} from '@enterprise-platform/contracts-identity';

/** Giới hạn và chính sách dùng chung với `changeOwnPassword` ở Platform Identity (ISS-BE-052). */
export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };

export interface PasswordRule {
  readonly id: string;
  readonly label: string;
  /** Bắt buộc thì chặn nút lưu; khuyến nghị chỉ làm tăng độ mạnh. */
  readonly required: boolean;
  readonly passed: boolean;
}

export interface PasswordDraft {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly confirmation: string;
}

export function passwordRules(draft: PasswordDraft): PasswordRule[] {
  const next = draft.newPassword;
  return [
    {
      id: 'length',
      label: `Từ ${PASSWORD_MIN_LENGTH} ký tự trở lên`,
      required: true,
      passed: next.length >= PASSWORD_MIN_LENGTH && next.length <= PASSWORD_MAX_LENGTH,
    },
    {
      id: 'letter-digit',
      label: 'Có cả chữ cái và chữ số',
      required: true,
      passed: /\p{L}/u.test(next) && /\d/.test(next),
    },
    {
      id: 'common',
      label: 'Không phải mật khẩu phổ biến dễ đoán',
      required: true,
      passed: next.length > 0 && !passwordPolicyViolation(next)?.includes('phổ biến'),
    },
    {
      id: 'different',
      label: 'Khác mật khẩu hiện tại',
      required: true,
      passed: next.length > 0 && next !== draft.currentPassword,
    },
    {
      id: 'match',
      label: 'Xác nhận mật khẩu trùng khớp',
      required: true,
      passed: next.length > 0 && next === draft.confirmation,
    },
    {
      id: 'case',
      label: 'Có cả chữ hoa và chữ thường',
      required: false,
      passed: /[a-z]/.test(next) && /[A-Z]/.test(next),
    },
    {
      id: 'symbol',
      label: 'Có ít nhất một ký tự đặc biệt',
      required: false,
      passed: /[^A-Za-z0-9]/.test(next),
    },
  ];
}

export type PasswordStrength = 'empty' | 'weak' | 'fair' | 'strong';

/**
 * Độ mạnh dựa trên độ dài và số nhóm ký tự khuyến nghị đã đạt. Ngưỡng độ dài
 * tách khỏi mức tối thiểu: mật khẩu vừa đủ điều kiện vẫn có thể được đánh giá là yếu.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return 'empty';
  if (password.length < 8) return 'weak';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  if ((classes >= 4 && password.length >= 12) || (classes >= 3 && password.length >= 16)) return 'strong';
  if (classes >= 2) return 'fair';
  return 'weak';
}

export function canSubmitPasswordChange(draft: PasswordDraft): boolean {
  return (
    draft.currentPassword.length > 0 &&
    passwordRules(draft).every((rule) => !rule.required || rule.passed) &&
    !passwordPolicyViolation(draft.newPassword)
  );
}
