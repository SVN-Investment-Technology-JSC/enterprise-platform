import { PASSWORD_POLICY_HINT, passwordPolicyViolation } from '@enterprise-platform/contracts-identity';
import { assertPasswordPolicy, PasswordPolicyException } from './password-policy';

describe('passwordPolicyViolation (ISS-BE-052)', () => {
  it.each([
    ['123456', 'ít nhất 8 ký tự'],
    ['abcdefgh', 'chữ số'],
    ['12345678', 'chữ cái'],
    ['password1', 'phổ biến'],
    ['PassWord1', 'phổ biến'],
    ['', 'nhập mật khẩu'],
  ])('SEC-BE052-01: rejects %p with a Vietnamese reason', (password, reason) => {
    expect(passwordPolicyViolation(password)).toEqual(expect.stringContaining(reason));
  });

  it('rejects non-strings and passwords longer than 128 characters', () => {
    expect(passwordPolicyViolation(undefined)).toBeDefined();
    expect(passwordPolicyViolation(`a1${'x'.repeat(127)}`)).toEqual(expect.stringContaining('128'));
  });

  it.each(['Savina2026x', 'mật khẩu 2026', 'Temporary-Password-2026'])('SEC-BE052-02: accepts %p', (password) => {
    expect(passwordPolicyViolation(password)).toBeUndefined();
  });

  it('exposes a hint for the UI', () => {
    expect(PASSWORD_POLICY_HINT).toContain('8 ký tự');
  });
});

describe('assertPasswordPolicy', () => {
  it('throws a 400 { statusCode, code, message } for a weak password', () => {
    let error: unknown;
    try {
      assertPasswordPolicy('123456');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PasswordPolicyException);
    expect((error as PasswordPolicyException).getResponse()).toEqual({
      statusCode: 400,
      code: 'PASSWORD_POLICY_VIOLATION',
      message: 'Mật khẩu phải có ít nhất 8 ký tự.',
    });
  });

  it('passes a valid password', () => {
    expect(() => assertPasswordPolicy('Savina2026x')).not.toThrow();
  });
});
