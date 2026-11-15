import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { PlatformIdentityService } from './platform-identity.service';
import { PasswordPolicyException } from './password-policy';

jest.mock('jose', () => ({
  exportJWK: jest.fn().mockResolvedValue({}),
  generateKeyPair: jest.fn().mockResolvedValue({ privateKey: {}, publicKey: {} }),
  importPKCS8: jest.fn().mockResolvedValue({}),
  importSPKI: jest.fn().mockResolvedValue({}),
  jwtVerify: jest.fn(),
  SignJWT: jest.fn(),
}));

const TENANT = 'tenant-1';
const ACTOR = '00000000-0000-4000-8000-000000000001';
const VICTIM = '00000000-0000-4000-8000-000000000002';

function makeService() {
  const service = new PlatformIdentityService();
  const pool = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: jest.fn() };
  (service as unknown as { pool: unknown }).pool = pool;
  const mutate = jest.spyOn(service.authorization, 'mutate');
  return { service, pool, mutate };
}

type Call = { sql: string; params: unknown[] };

/**
 * Service với DB tenant giả cho luồng sửa/xoá người dùng: `mutate` chạy callback trên client giả, `isAdmin` theo cờ.
 * Ghi lại mọi câu SQL trên DB tenant (`tenantCalls`) và DB platform (`platformCalls`).
 */
function makeUserService(options: {
  actorIsAdmin: boolean;
  currentEmail?: string;
  tenantResponders?: ((sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number } | undefined)[];
}) {
  const service = new PlatformIdentityService();
  const tenantCalls: Call[] = [];
  const platformCalls: Call[] = [];
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  const tenantClient = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      const text = normalize(sql);
      tenantCalls.push({ sql: text, params });
      for (const respond of options.tenantResponders ?? []) {
        const result = respond(text, params);
        if (result) return { rowCount: result.rows.length, ...result };
      }
      if (text.startsWith('SELECT email FROM core_schema.users WHERE id = $1 FOR UPDATE'))
        return { rows: options.currentEmail === undefined ? [] : [{ email: options.currentEmail }], rowCount: 1 };
      if (text.startsWith('UPDATE core_schema.users SET full_name'))
        return { rows: [{ id: params[0], email: params[2] ?? options.currentEmail }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  };
  const platformClient = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      const text = normalize(sql);
      platformCalls.push({ sql: text, params });
      if (text.startsWith('UPDATE identity_schema.tenant_auth_sessions')) return { rows: [{ id: 'session-v' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  const pool = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      platformCalls.push({ sql: normalize(sql), params });
      return { rows: [], rowCount: 0 };
    }),
    connect: jest.fn(async () => platformClient),
  };
  (service as unknown as { pool: unknown }).pool = pool;
  const authorization = service.authorization;
  jest
    .spyOn(authorization, 'mutate')
    .mockImplementation(async (_tenant, _actor, operation) => operation(tenantClient as never));
  jest.spyOn(authorization, 'isAdmin').mockResolvedValue(options.actorIsAdmin);
  jest.spyOn(authorization, 'protectAdmin').mockResolvedValue(undefined);
  jest.spyOn(authorization, 'assertAdminRemains').mockResolvedValue(undefined);
  const audit = jest.spyOn(authorization, 'audit');
  return { service, tenantCalls, platformCalls, audit };
}

describe('Only tenant administrators change credentials of a user (ISS-BE-002)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('SEC-BE002-01: a non-admin with core.users.update cannot reset a password', async () => {
    const { service, tenantCalls } = makeUserService({ actorIsAdmin: false, currentEmail: 'qa.victim@savinajsc.com' });
    await expect(service.updateCoreUser(TENANT, VICTIM, { password: 'Savina2026x' }, ACTOR)).rejects.toMatchObject({
      status: 403,
      response: { code: 'CREDENTIAL_CHANGE_ADMIN_ONLY', message: expect.stringContaining('quản trị tenant') },
    });
    expect(tenantCalls.some((call) => call.sql.startsWith('UPDATE core_schema.users'))).toBe(false);
  });

  it('SEC-BE002-02: a non-admin cannot change the email', async () => {
    const { service, tenantCalls } = makeUserService({ actorIsAdmin: false, currentEmail: 'qa.victim@savinajsc.com' });
    await expect(
      service.updateCoreUser(TENANT, VICTIM, { email: 'qa.attacker@savinajsc.com' }, ACTOR),
    ).rejects.toMatchObject({ status: 403 });
    expect(tenantCalls.some((call) => call.sql.startsWith('UPDATE core_schema.users'))).toBe(false);
  });

  it('SEC-BE002-03: a non-admin can still change the display name, and resubmitting the same email is not a change', async () => {
    const { service, platformCalls } = makeUserService({ actorIsAdmin: false, currentEmail: 'qa.victim@savinajsc.com' });
    await expect(
      service.updateCoreUser(TENANT, VICTIM, { fullName: 'Tên mới', email: 'QA.Victim@savinajsc.com' }, ACTOR),
    ).resolves.toMatchObject({ id: VICTIM });
    expect(platformCalls.some((call) => call.sql.includes('tenant_auth_sessions'))).toBe(false);
  });

  it('SEC-BE002-07/08/10: an admin resets a password; sessions are revoked and the audit has no password', async () => {
    const { service, tenantCalls, platformCalls, audit } = makeUserService({
      actorIsAdmin: true,
      currentEmail: 'qa.victim@savinajsc.com',
    });
    await service.updateCoreUser(TENANT, VICTIM, { password: 'Savina2026x' }, ACTOR);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(expect.anything(), ACTOR, 'user.password.reset', VICTIM, null, { passwordReset: true });
    const auditInsert = tenantCalls.find((call) => call.sql.startsWith('INSERT INTO core_schema.authorization_audit'));
    expect(JSON.stringify(auditInsert?.params)).not.toMatch(/Savina2026x|scrypt/);
    const revoke = platformCalls.find((call) => call.sql.startsWith('UPDATE identity_schema.tenant_auth_sessions'));
    expect(revoke?.params).toEqual([TENANT, VICTIM, null]);
    const event = platformCalls.find((call) => call.sql.startsWith('INSERT INTO integration_schema.outbox_events'));
    expect(JSON.parse(event?.params[4] as string)).toMatchObject({ payload: { reason: 'password-reset' } });
  });

  it('SEC-BE002-09: an admin changes the email; old sessions are revoked and the audit keeps old and new email', async () => {
    const { service, platformCalls, audit } = makeUserService({ actorIsAdmin: true, currentEmail: 'qa.victim@savinajsc.com' });
    await service.updateCoreUser(TENANT, VICTIM, { email: 'qa.victim2@savinajsc.com' }, ACTOR);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      ACTOR,
      'user.email.change',
      VICTIM,
      { email: 'qa.victim@savinajsc.com' },
      { email: 'qa.victim2@savinajsc.com' },
    );
    const event = platformCalls.find((call) => call.sql.startsWith('INSERT INTO integration_schema.outbox_events'));
    expect(JSON.parse(event?.params[4] as string)).toMatchObject({ payload: { reason: 'email-changed' } });
  });
});

describe('Password policy on every password write (ISS-BE-052)', () => {
  it('SEC-BE052-03: creating a user with "123456" is rejected before touching the database', async () => {
    const { service, mutate } = makeService();
    await expect(
      service.createCoreUser(TENANT, { fullName: 'A', email: 'qa.x@savinajsc.com', password: '123456' }, ACTOR),
    ).rejects.toBeInstanceOf(PasswordPolicyException);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('SEC-BE052-04: an administrator reset to "123456" is rejected', async () => {
    const { service, mutate } = makeService();
    await expect(service.updateCoreUser(TENANT, VICTIM, { password: '123456' }, ACTOR)).rejects.toBeInstanceOf(
      PasswordPolicyException,
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it('SEC-BE052-05: changing one\'s own password to "123456" is rejected', async () => {
    const { service, pool } = makeService();
    const principal = { kind: 'tenant-user', userId: VICTIM, tenantId: TENANT, sessionId: 's' } as AuthenticatedPrincipal;
    await expect(
      service.changeOwnPassword(principal, { currentPassword: 'Old-pass-2026', newPassword: '123456' }),
    ).rejects.toMatchObject({ response: { code: 'PASSWORD_POLICY_VIOLATION', message: 'Mật khẩu phải có ít nhất 8 ký tự.' } });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects a weak password on the tenant admin reset link', async () => {
    const { service, pool } = makeService();
    await expect(service.resetTenantPassword({ token: 't', password: 'abcdefgh' })).rejects.toBeInstanceOf(
      PasswordPolicyException,
    );
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
