import { UnauthorizedException } from '@nestjs/common';
import { PlatformIdentityService, sessionIdleTimeoutMinutes } from './platform-identity.service';
import { RefreshSessionExpiredException, RefreshSessionIdleExpiredException } from './session-errors';

jest.mock('jose', () => ({
  exportJWK: jest.fn().mockResolvedValue({}),
  generateKeyPair: jest.fn().mockResolvedValue({ privateKey: {}, publicKey: {} }),
  importPKCS8: jest.fn().mockResolvedValue({}),
  importSPKI: jest.fn().mockResolvedValue({}),
  jwtVerify: jest.fn(),
  SignJWT: jest.fn(),
}));

type QueryResult = { rows: unknown[]; rowCount?: number };
type Responder = (sql: string, params: unknown[]) => QueryResult | undefined;

/** Pool giả: mỗi câu SQL được trả lời bởi responder đầu tiên nhận nó; còn lại trả rỗng. */
function fakePool(responders: Responder[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    calls.push({ sql: text, params });
    for (const respond of responders) {
      const result = respond(text, params);
      if (result) return result;
    }
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: jest.fn() };
  return { pool: { query, connect: jest.fn(async () => client) }, calls };
}

type Testable = {
  pool: unknown;
  verifyPassword: (stored: string, password: string) => Promise<boolean>;
};

function makeService(responders: Responder[]) {
  const service = new PlatformIdentityService();
  const fake = fakePool(responders);
  (service as unknown as Testable).pool = fake.pool;
  return { service, ...fake };
}

describe('PlatformIdentityService login timing (ISS-BE-010)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('SEC-BE010-08: runs scrypt against a dummy hash when the platform email does not exist', async () => {
    const { service } = makeService([]);
    const verify = jest.spyOn(service as unknown as Testable, 'verifyPassword');
    await expect(
      service.login({ email: 'nobody@platform.local', password: 'Wrong-pass1', portal: 'platform' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0][0]).toMatch(/^scrypt\$/);
    expect(verify.mock.calls[0][1]).toBe('Wrong-pass1');
  });

  it('SEC-BE010-08: runs scrypt when a tenant email has no tenant behind it', async () => {
    const { service } = makeService([]);
    const verify = jest.spyOn(service as unknown as Testable, 'verifyPassword');
    await expect(
      service.login({ email: 'a@khongtontai.com', password: 'Wrong-pass1', portal: 'tenant' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.login({ email: 'a@gmail.vn', password: 'Wrong-pass1', portal: 'tenant' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify).toHaveBeenCalledTimes(2);
  });
});

describe('PlatformIdentityService refresh failures (ISS-BE-010)', () => {
  it('SEC-BE010-04: a token of an expired or revoked session is reported as natural expiry', async () => {
    const { service } = makeService([
      (sql) => (sql.startsWith('SELECT 1 FROM identity_schema.auth_sessions WHERE refresh_token_hash') ? { rows: [{}] } : undefined),
    ]);
    await expect(service.refresh('old-refresh', 'old-csrf')).rejects.toBeInstanceOf(RefreshSessionExpiredException);
  });

  it('rotation keeps the replaced token hash so a later reuse can be detected', async () => {
    const { service, calls } = makeService([
      (sql) =>
        sql.startsWith('SELECT s.id AS session_id, s.tenant_id')
          ? { rows: [] }
          : undefined,
      (sql) =>
        sql.startsWith('SELECT s.id AS session_id, u.id')
          ? { rows: [{ session_id: 's-1', id: 'u-1', email: 'root@platform.local', display_name: 'Root', password_hash: 'x', kind: 'platform-admin', membership_id: null, tenant_id: null, tenant_slug: null }] }
          : undefined,
    ]);
    const testable = service as unknown as { createPrincipal: () => Promise<unknown>; sign: () => Promise<string> };
    jest.spyOn(testable, 'createPrincipal').mockResolvedValue({ kind: 'platform-admin' });
    jest.spyOn(testable, 'sign').mockResolvedValue('access');
    await expect(service.refresh('r1', 'c1')).resolves.toMatchObject({ accessToken: 'access' });
    const rotation = calls.find((call) => call.sql.startsWith('UPDATE identity_schema.auth_sessions'));
    expect(rotation?.sql).toContain('previous_refresh_token_hash = refresh_token_hash');
  });
});

describe('PlatformIdentityService refresh token reuse (ISS-BE-053)', () => {
  const reusedSession = (withinGrace: boolean): Responder => (sql) =>
    sql.includes('WHERE previous_refresh_token_hash = $1 AND revoked_at IS NULL')
      ? { rows: [{ kind: 'tenant', id: 'session-9', tenant_id: 'tenant-1', core_user_id: 'user-1', within_grace: withinGrace }] }
      : undefined;

  it('SEC-BE053-01: reusing a rotated token after the grace period revokes the whole session', async () => {
    const { service, calls } = makeService([
      reusedSession(false),
      (sql) => (sql.includes('SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id') ? { rows: [{ id: 'session-9' }] } : undefined),
    ]);
    const error = await service.refresh('r1-old', 'c1-old').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error).not.toBeInstanceOf(RefreshSessionExpiredException);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
    const revoke = calls.find((call) => call.sql.startsWith('UPDATE identity_schema.tenant_auth_sessions SET revoked_at = now()'));
    expect(revoke?.params).toEqual(['session-9']);
    const outbox = calls.find((call) => call.sql.startsWith('INSERT INTO integration_schema.outbox_events'));
    expect(outbox?.params[0]).toBeDefined();
    expect(JSON.parse(outbox?.params[4] as string)).toMatchObject({ payload: expect.objectContaining({ reason: 'refresh-token-reused' }) });
    // Thu hồi phải được COMMIT, không bị ROLLBACK cùng lỗi.
    const commitIndex = calls.findIndex((call, index) => index > calls.indexOf(revoke as never) && call.sql === 'COMMIT');
    expect(commitIndex).toBeGreaterThan(-1);
  });

  it('SEC-BE053-02: reusing a rotated token within the grace period (two tabs) does not revoke', async () => {
    const { service, calls } = makeService([reusedSession(true)]);
    await expect(service.refresh('r1-old', 'c1-old')).rejects.toBeInstanceOf(RefreshSessionExpiredException);
    expect(calls.some((call) => call.sql.includes('SET revoked_at'))).toBe(false);
  });

  it('an unknown token is a plain 401 so the controller counts it', async () => {
    const { service } = makeService([]);
    const error = await service.refresh('forged', 'forged').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error).not.toBeInstanceOf(RefreshSessionExpiredException);
  });
});

describe('PlatformIdentityService session idle timeout', () => {
  const platformRow = (idleExpired: boolean) => ({
    session_id: 's-1', id: 'u-1', email: 'root@platform.local', display_name: 'Root', password_hash: 'x',
    kind: 'platform-admin', membership_id: null, tenant_id: null, tenant_slug: null, idle_expired: idleExpired,
  });
  const platformSession = (idleExpired: boolean): Responder[] => [
    (sql) => (sql.startsWith('SELECT s.id AS session_id, s.tenant_id') ? { rows: [] } : undefined),
    (sql) => (sql.startsWith('SELECT s.id AS session_id, u.id') ? { rows: [platformRow(idleExpired)] } : undefined),
  ];
  const tenantSession: Responder = (sql) =>
    sql.startsWith('SELECT s.id AS session_id, s.tenant_id')
      ? { rows: [{ session_id: 'ts-1', tenant_id: 'tenant-1', core_user_id: 'user-1', tenant_slug: 'acme', secret_ref: 'x', database_name: 'db', idle_expired: true }] }
      : undefined;

  afterEach(() => {
    delete process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES;
    jest.restoreAllMocks();
  });

  it('defaults to 8 hours and accepts a custom value from the environment', () => {
    expect(sessionIdleTimeoutMinutes({})).toBe(480);
    expect(sessionIdleTimeoutMinutes({ AUTH_SESSION_IDLE_TIMEOUT_MINUTES: '60' })).toBe(60);
    expect(sessionIdleTimeoutMinutes({ AUTH_SESSION_IDLE_TIMEOUT_MINUTES: '0' })).toBe(480);
    expect(sessionIdleTimeoutMinutes({ AUTH_SESSION_IDLE_TIMEOUT_MINUTES: 'abc' })).toBe(480);
  });

  it('measures idleness from the last refresh (or creation) with the configured timeout', async () => {
    process.env.AUTH_SESSION_IDLE_TIMEOUT_MINUTES = '90';
    const { service, calls } = makeService(platformSession(false));
    const testable = service as unknown as { createPrincipal: () => Promise<unknown>; sign: () => Promise<string> };
    jest.spyOn(testable, 'createPrincipal').mockResolvedValue({ kind: 'platform-admin' });
    jest.spyOn(testable, 'sign').mockResolvedValue('access');
    await service.refresh('r1', 'c1');
    for (const prefix of ['SELECT s.id AS session_id, s.tenant_id', 'SELECT s.id AS session_id, u.id']) {
      const select = calls.find((call) => call.sql.startsWith(prefix));
      expect(select?.sql).toContain('COALESCE(s.rotated_at, s.created_at) <= now() - make_interval(secs => $3) AS idle_expired');
      expect(select?.params[2]).toBe(90 * 60);
    }
  });

  it('a session refreshed within the timeout succeeds and moves the refresh mark', async () => {
    const { service, calls } = makeService(platformSession(false));
    const testable = service as unknown as { createPrincipal: () => Promise<unknown>; sign: () => Promise<string> };
    jest.spyOn(testable, 'createPrincipal').mockResolvedValue({ kind: 'platform-admin' });
    jest.spyOn(testable, 'sign').mockResolvedValue('access');
    await expect(service.refresh('r1', 'c1')).resolves.toMatchObject({ accessToken: 'access' });
    const rotation = calls.find((call) => call.sql.startsWith('UPDATE identity_schema.auth_sessions'));
    expect(rotation?.sql).toContain('rotated_at = now()');
    expect(calls.some((call) => call.sql.includes('SET revoked_at'))).toBe(false);
  });

  it('a platform session idle past the timeout is revoked and answered with SESSION_IDLE_EXPIRED', async () => {
    const { service, calls } = makeService(platformSession(true));
    const error = await service.refresh('r1', 'c1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RefreshSessionIdleExpiredException);
    // Vẫn là hết hạn tự nhiên: controller không đếm vào giới hạn thất bại.
    expect(error).toBeInstanceOf(RefreshSessionExpiredException);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      statusCode: 401,
      code: 'SESSION_IDLE_EXPIRED',
      message: 'Phiên đăng nhập đã hết hạn do không hoạt động, vui lòng đăng nhập lại.',
    });
    const revoke = calls.find((call) => call.sql.startsWith('UPDATE identity_schema.auth_sessions SET revoked_at = now()'));
    expect(revoke?.params).toEqual(['s-1']);
    expect(calls.some((call) => call.sql.includes('refresh_token_hash = $2'))).toBe(false);
    const commitIndex = calls.findIndex((call, index) => index > calls.indexOf(revoke as never) && call.sql === 'COMMIT');
    expect(commitIndex).toBeGreaterThan(-1);
  });

  it('a tenant session idle past the timeout is revoked with an idle-timeout event', async () => {
    const { service, calls } = makeService([
      tenantSession,
      (sql) => (sql.includes('SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id') ? { rows: [{ id: 'ts-1' }] } : undefined),
    ]);
    const error = await service.refresh('r1', 'c1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RefreshSessionIdleExpiredException);
    const revoke = calls.find((call) => call.sql.startsWith('UPDATE identity_schema.tenant_auth_sessions SET revoked_at = now()'));
    expect(revoke?.params).toEqual(['ts-1']);
    const outbox = calls.find((call) => call.sql.startsWith('INSERT INTO integration_schema.outbox_events'));
    expect(JSON.parse(outbox?.params[4] as string)).toMatchObject({ payload: expect.objectContaining({ reason: 'idle-timeout' }) });
    // Không mở pool tenant và không rơi xuống nhánh phiên platform.
    expect(calls.some((call) => call.sql.startsWith('SELECT s.id AS session_id, u.id'))).toBe(false);
    expect(calls.some((call) => call.sql.includes('refresh_token_hash = $2'))).toBe(false);
  });
});
