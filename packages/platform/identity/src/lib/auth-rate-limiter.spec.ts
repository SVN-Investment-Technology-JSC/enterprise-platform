import {
  AuthRateLimitedException,
  AuthRateLimiter,
  authRateLimiterOptionsFromEnv,
} from './auth-rate-limiter';

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

  it('blocks an email + IP pair after max failures with a generic 429', () => {
    const l = make();
    for (let i = 0; i < 3; i++) l.recordFailure('login', '1.1.1.1', ' User@X.com ');
    expect(() => l.assertAllowed('login', '1.1.1.1', 'user@x.com')).toThrow(
      expect.objectContaining({ status: 429 }),
    );
    expect(() => l.assertAllowed('login', '1.1.1.1', 'other@x.com')).not.toThrow();
  });

  it('SEC-BE010-01: the default rule blocks after 10 failures of the same email from the same IP', () => {
    const l = new AuthRateLimiter(authRateLimiterOptionsFromEnv({}), () => clock);
    for (let i = 0; i < 9; i++) l.recordFailure('login', '10.0.0.1', 'victim@savina.com');
    expect(() => l.assertAllowed('login', '10.0.0.1', 'victim@savina.com')).not.toThrow();
    l.recordFailure('login', '10.0.0.1', 'victim@savina.com');
    expect(() => l.assertAllowed('login', '10.0.0.1', 'victim@savina.com')).toThrow(
      expect.objectContaining({ status: 429 }),
    );
  });

  it('SEC-BE010-02: failures for an email from IP A do not lock that email out on IP B', () => {
    const l = make();
    for (let i = 0; i < 10; i++) l.recordFailure('login', '10.0.0.1', 'victim@x.com');
    expect(() => l.assertAllowed('login', '10.0.0.1', 'victim@x.com')).toThrow();
    expect(() => l.assertAllowed('login', '10.0.0.2', 'victim@x.com')).not.toThrow();
  });

  it('SEC-BE010-03: an IP that failed for many emails is blocked, other IPs are not', () => {
    const l = make();
    for (let i = 0; i < 5; i++) l.recordFailure('login', '1.1.1.1', `u${i}@x.com`);
    expect(() => l.assertAllowed('login', '1.1.1.1', 'new@x.com')).toThrow();
    expect(() => l.assertAllowed('login', '2.2.2.2', 'admin@x.com')).not.toThrow();
  });

  it('reports how long to wait and a Vietnamese message', () => {
    const l = make({ ...options, emailRule: { max: 2, windowMs: 10 * 60_000 } });
    l.recordFailure('login', '1.1.1.1', 'a@x.com');
    clock = 60_000;
    l.recordFailure('login', '1.1.1.1', 'a@x.com');
    clock = 120_000;
    let error: unknown;
    try {
      l.assertAllowed('login', '1.1.1.1', 'a@x.com');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AuthRateLimitedException);
    const limited = error as AuthRateLimitedException;
    // Lần sai đầu (t=0) rơi khỏi cửa sổ 10 phút ở t=600s; hiện t=120s nên còn 480s.
    expect(limited.retryAfterSeconds).toBe(480);
    expect(limited.getResponse()).toMatchObject({
      statusCode: 429,
      code: 'AUTH_RATE_LIMITED',
      message: expect.stringContaining('8 phút'),
    });
  });

  it('expires after the window and resets the pair on success', () => {
    const l = make();
    for (let i = 0; i < 3; i++) l.recordFailure('login', '1.1.1.1', 'a@x.com');
    clock = 1001;
    expect(() => l.assertAllowed('login', '1.1.1.1', 'a@x.com')).not.toThrow();
    for (let i = 0; i < 3; i++) l.recordFailure('login', '1.1.1.1', 'a@x.com');
    l.recordSuccess('login', '1.1.1.1', 'a@x.com');
    expect(() => l.assertAllowed('login', '1.1.1.1', 'a@x.com')).not.toThrow();
  });

  it('does not count successful logins and can be disabled', () => {
    const l = make();
    for (let i = 0; i < 20; i++) l.assertAllowed('login', '1.1.1.1', 'ok@x.com');
    const off = make({ ...options, enabled: false });
    for (let i = 0; i < 20; i++) off.recordFailure('login', '1.1.1.1', 'a@x.com');
    expect(() => off.assertAllowed('login', '1.1.1.1', 'a@x.com')).not.toThrow();
  });

  it('keeps scopes separate, so refresh failures never lock login', () => {
    const l = make();
    for (let i = 0; i < 3; i++) l.recordFailure('login', '1.1.1.1', 'a@x.com');
    expect(() => l.assertAllowed('reset', '1.1.1.1', 'a@x.com')).not.toThrow();
    for (let i = 0; i < 5; i++) l.recordFailure('refresh', '9.9.9.9');
    expect(() => l.assertAllowed('refresh', '9.9.9.9')).toThrow();
    expect(() => l.assertAllowed('login', '9.9.9.9', 'b@x.com')).not.toThrow();
  });

  it('reads the thresholds from the environment', () => {
    expect(
      authRateLimiterOptionsFromEnv({ AUTH_RATE_LIMIT_IP_MAX: '80', AUTH_RATE_LIMIT_EMAIL_MAX: '7' }),
    ).toMatchObject({ ipRule: { max: 80 }, emailRule: { max: 7 } });
    expect(authRateLimiterOptionsFromEnv({})).toMatchObject({ ipRule: { max: 50 }, emailRule: { max: 10 } });
  });
});
