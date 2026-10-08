import { canSubmitPasswordChange, passwordRules, passwordStrength } from './password-rules';

describe('password rules', () => {
  const draft = {
    currentPassword: 'Old-password-1',
    newPassword: 'New-password-12',
    confirmation: 'New-password-12',
  };

  it('allows a long new password that differs from the current one and is confirmed', () => {
    expect(canSubmitPasswordChange(draft)).toBe(true);
  });

  it.each([
    ['current password is missing', { ...draft, currentPassword: '' }],
    ['new password is too short', { ...draft, newPassword: 'Ab-1x', confirmation: 'Ab-1x' }],
    ['new password equals the current one', { ...draft, newPassword: draft.currentPassword, confirmation: draft.currentPassword }],
    ['confirmation does not match', { ...draft, confirmation: 'New-password-13' }],
  ])('blocks submit when %s', (_, value) => {
    expect(canSubmitPasswordChange(value)).toBe(false);
  });

  it('accepts a 6-character password', () => {
    expect(canSubmitPasswordChange({ ...draft, newPassword: 'abcdef', confirmation: 'abcdef' })).toBe(true);
  });

  it('does not require the advisory character classes', () => {
    const plain = { ...draft, newPassword: 'allowercaseletters', confirmation: 'allowercaseletters' };
    expect(canSubmitPasswordChange(plain)).toBe(true);
    expect(passwordRules(plain).filter((rule) => !rule.passed).map((rule) => rule.id)).toEqual([
      'case',
      'digit',
      'symbol',
    ]);
  });

  it('grades strength', () => {
    expect(passwordStrength('')).toBe('empty');
    expect(passwordStrength('Ab-1xy')).toBe('weak');
    expect(passwordStrength('Short-1x')).toBe('fair');
    expect(passwordStrength('allowercaseletters')).toBe('weak');
    expect(passwordStrength('Lowerandupper')).toBe('fair');
    expect(passwordStrength('New-password-12')).toBe('strong');
  });
});
