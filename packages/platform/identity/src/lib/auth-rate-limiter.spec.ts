import { AuthRateLimiter } from './auth-rate-limiter';

describe('AuthRateLimiter', () => {
  let clock: number;
  const options = {
    enabled: true,
    emailRule: { max: 3, windowMs: 1000 },
    ipRule: { max: 5, windowMs: 1000 },
    maxKeys: 100,
  };
  const make = (o = options) => new AuthRateLimiter(o, () => clock);
  beforeEach(() => (clock = 0));

  it('blocks an email after max failures with a generic 429', () => {
    const l = make();
    for (let i = 0; i < 3; i++) l.recordFailure('login', '1.1.1.1', ' User@X.com ');
    expect(() => l.assertAllowed('login', '2.2.2.2', 'user@x.com')).toThrow(
      expect.objectContaining({ status: 429 }),
    );
    expect(() => l.assertAllowed('login', '2.2.2.2', 'other@x.com')).not.toThrow();
  });

  it('blocks an IP independently of the email', () => {
    const l = make();
    for (let i = 0; i < 5; i++) l.recordFailure('login', '1.1.1.1', `u${i}@x.com`);
    expect(() => l.assertAllowed('login', '1.1.1.1', 'new@x.com')).toThrow();
  });

  it('expires after the window and resets email on success', () => {
    const l = make();
    for (let i = 0; i < 3; i++) l.recordFailure('login', '1.1.1.1', 'a@x.com');
    clock = 1001;
    expect(() => l.assertAllowed('login', '9.9.9.9', 'a@x.com')).not.toThrow();
    for (let i = 0; i < 3; i++) l.recordFailure('login', '1.1.1.1', 'a@x.com');
    l.recordSuccess('login', 'a@x.com');
    expect(() => l.assertAllowed('login', '9.9.9.9', 'a@x.com')).not.toThrow();
  });

  it('does not count successful logins and can be disabled', () => {
    const l = make();
    for (let i = 0; i < 20; i++) l.assertAllowed('login', '1.1.1.1', 'ok@x.com');
    const off = make({ ...options, enabled: false });
    for (let i = 0; i < 20; i++) off.recordFailure('login', '1.1.1.1', 'a@x.com');
    expect(() => off.assertAllowed('login', '1.1.1.1', 'a@x.com')).not.toThrow();
  });

  it('keeps scopes separate', () => {
    const l = make();
    for (let i = 0; i < 3; i++) l.recordFailure('login', '1.1.1.1', 'a@x.com');
    expect(() => l.assertAllowed('reset', '9.9.9.9', 'a@x.com')).not.toThrow();
  });
});
