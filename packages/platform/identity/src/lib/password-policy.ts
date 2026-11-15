import { passwordPolicyViolation } from '@enterprise-platform/contracts-identity';
import { BadRequestException } from '@nestjs/common';

/**
 * Mật khẩu mới không đạt chính sách (ISS-BE-052). Tách lớp riêng để controller đổi mật khẩu không đếm lỗi này vào giới
 * hạn "nhập sai mật khẩu hiện tại".
 */
export class PasswordPolicyException extends BadRequestException {
  constructor(message: string) {
    super({ statusCode: 400, code: 'PASSWORD_POLICY_VIOLATION', message });
  }
}

/** Ném 400 với lý do tiếng Việt nếu mật khẩu không đạt chính sách dùng chung. */
export function assertPasswordPolicy(password: unknown): asserts password is string {
  const violation = passwordPolicyViolation(password);
  if (violation) throw new PasswordPolicyException(violation);
}
