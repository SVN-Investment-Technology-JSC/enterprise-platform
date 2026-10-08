/** Giới hạn khớp với `changeOwnPassword` ở Platform Identity. */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;

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
      id: 'digit',
      label: 'Có ít nhất một chữ số',
      required: false,
      passed: /\d/.test(next),
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
 * tách khỏi mức tối thiểu: mật khẩu 6 ký tự hợp lệ nhưng vẫn được đánh giá là yếu.
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
    passwordRules(draft).every((rule) => !rule.required || rule.passed)
  );
}
