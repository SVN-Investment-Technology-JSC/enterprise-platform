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
      if (text.startsWith('SELECT email, status, is_active FROM core_schema.users WHERE id = $1 AND deleted_at IS NULL'))
        return {
          rows: options.currentEmail === undefined ? [] : [{ email: options.currentEmail, status: 'active', is_active: true }],
          rowCount: 1,
        };
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
      const text = normalize(sql);
      platformCalls.push({ sql: text, params });
      if (text.startsWith('SELECT slug FROM tenancy_schema.tenants')) return { rows: [{ slug: 'savinajsc' }], rowCount: 1 };
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

describe('Audit of sensitive account operations (ISS-BE-034, platform part)', () => {
  afterEach(() => jest.restoreAllMocks());

  const auditedOperations = (audit: jest.SpyInstance) => audit.mock.calls.map((call) => call[2]);

  it('SEC-BE034-01: locking a user writes exactly one audit row with old and new status', async () => {
    const { service, audit } = makeUserService({
      actorIsAdmin: false,
      currentEmail: 'qa.victim@savinajsc.com',
      tenantResponders: [
        (sql) =>
          sql.startsWith('SELECT email, status, is_active FROM core_schema.users')
            ? { rows: [{ email: 'qa.victim@savinajsc.com', status: 'active', is_active: true }] }
            : undefined,
      ],
    });
    await service.updateCoreUser(TENANT, VICTIM, { status: 'disabled' }, ACTOR);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      ACTOR,
      'user.status.change',
      VICTIM,
      { status: 'active', isActive: true },
      { status: 'disabled', isActive: false },
    );
  });

  it('SEC-BE034-01: password reset and email change each write one audit row without the password', async () => {
    const { service, audit, tenantCalls } = makeUserService({
      actorIsAdmin: true,
      tenantResponders: [
        (sql) =>
          sql.startsWith('SELECT email, status, is_active FROM core_schema.users')
            ? { rows: [{ email: 'qa.victim@savinajsc.com', status: 'active', is_active: true }] }
            : undefined,
      ],
    });
    await service.updateCoreUser(TENANT, VICTIM, { password: 'Savina2026x', email: 'qa.new@savinajsc.com' }, ACTOR);
    expect(auditedOperations(audit)).toEqual(['user.password.reset', 'user.email.change']);
    const inserts = tenantCalls.filter((call) => call.sql.startsWith('INSERT INTO core_schema.authorization_audit'));
    expect(inserts).toHaveLength(2);
    expect(JSON.stringify(inserts.map((call) => call.params))).not.toMatch(/Savina2026x|scrypt\$/);
  });

  it('SEC-BE034-01: deleting a user writes exactly one audit row', async () => {
    const { service, audit } = makeUserService({
      actorIsAdmin: true,
      tenantResponders: [
        (sql) =>
          sql.startsWith('SELECT email, full_name AS "fullName" FROM core_schema.users')
            ? { rows: [{ email: 'qa.victim@savinajsc.com', fullName: 'Victim' }] }
            : undefined,
        (sql) => (sql.startsWith('DELETE FROM core_schema.users') ? { rows: [], rowCount: 1 } : undefined),
      ],
    });
    await service.deleteCoreUser(TENANT, VICTIM, ACTOR);
    expect(auditedOperations(audit)).toEqual(['user.delete']);
    expect(audit.mock.calls[0][4]).toEqual({ email: 'qa.victim@savinajsc.com', fullName: 'Victim' });
  });
});

describe('Deleting a user is a soft delete once the user has data (ISS-BE-035)', () => {
  afterEach(() => jest.restoreAllMocks());

  const target: ((sql: string) => { rows: unknown[]; rowCount?: number } | undefined) = (sql) =>
    sql.startsWith('SELECT email, full_name AS "fullName" FROM core_schema.users WHERE id = $1 AND deleted_at IS NULL')
      ? { rows: [{ email: 'qa.victim@savinajsc.com', fullName: 'Victim' }] }
      : undefined;
  const references = (sql: string) =>
    sql.includes('FROM pg_constraint c')
      ? {
          rows: [
            { table_name: 'core_schema.user_roles', column_name: 'user_id' },
            { table_name: 'core_schema.organization_node_assignments', column_name: 'user_id' },
          ],
        }
      : undefined;

  it('SEC-BE035-02: a user with an appointment is marked deleted, not DELETEd', async () => {
    const { service, tenantCalls, platformCalls, audit } = makeUserService({
      actorIsAdmin: true,
      tenantResponders: [
        target,
        references,
        (sql) => (sql.startsWith('SELECT 1 FROM core_schema.organization_node_assignments') ? { rows: [{}] } : undefined),
        (sql) => (sql.startsWith('UPDATE core_schema.users SET is_active = false') ? { rows: [], rowCount: 1 } : undefined),
      ],
    });
    await service.deleteCoreUser(TENANT, VICTIM, ACTOR);
    const update = tenantCalls.find((call) => call.sql.startsWith('UPDATE core_schema.users SET is_active = false'));
    expect(update?.sql).toContain('deleted_at = now()');
    expect(update?.params).toEqual([VICTIM]);
    expect(tenantCalls.some((call) => call.sql.startsWith('DELETE FROM core_schema.users'))).toBe(false);
    // Vai trò là cấu hình tài khoản, không được tính là dữ liệu.
    expect(tenantCalls.some((call) => call.sql.startsWith('SELECT 1 FROM core_schema.user_roles'))).toBe(false);
    expect(audit).toHaveBeenCalledWith(expect.anything(), ACTOR, 'user.delete', VICTIM, expect.anything(), { mode: 'soft' });
    expect(platformCalls.some((call) => call.sql.startsWith('UPDATE identity_schema.tenant_auth_sessions'))).toBe(true);
  });

  it('SEC-BE035-03: a user without any data is deleted for real', async () => {
    const { service, tenantCalls, audit } = makeUserService({
      actorIsAdmin: true,
      tenantResponders: [
        target,
        references,
        (sql) => (sql.startsWith('DELETE FROM core_schema.users') ? { rows: [], rowCount: 1 } : undefined),
      ],
    });
    await service.deleteCoreUser(TENANT, VICTIM, ACTOR);
    expect(tenantCalls.some((call) => call.sql.startsWith('DELETE FROM core_schema.users'))).toBe(true);
    expect(tenantCalls.some((call) => call.sql.includes('deleted_at = now()'))).toBe(false);
    expect(audit).toHaveBeenCalledWith(expect.anything(), ACTOR, 'user.delete', VICTIM, expect.anything(), { mode: 'hard' });
  });

  it('a user who granted permissions to others keeps a soft-deleted row so the audit names stay', async () => {
    const { service, tenantCalls } = makeUserService({
      actorIsAdmin: true,
      tenantResponders: [
        target,
        (sql) => (sql.startsWith('SELECT 1 FROM core_schema.authorization_audit WHERE actor_id') ? { rows: [{}] } : undefined),
        (sql) => (sql.startsWith('UPDATE core_schema.users SET is_active = false') ? { rows: [], rowCount: 1 } : undefined),
      ],
    });
    await service.deleteCoreUser(TENANT, VICTIM, ACTOR);
    expect(tenantCalls.some((call) => call.sql.startsWith('DELETE FROM core_schema.users'))).toBe(false);
  });

  it('an already deleted user is 404', async () => {
    const { service } = makeUserService({ actorIsAdmin: true });
    await expect(service.deleteCoreUser(TENANT, VICTIM, ACTOR)).rejects.toMatchObject({ status: 404 });
  });

  it('SEC-BE035-09: deleting oneself is still refused', async () => {
    const { service } = makeUserService({ actorIsAdmin: true });
    await expect(service.deleteCoreUser(TENANT, ACTOR, ACTOR)).rejects.toMatchObject({ status: 400 });
  });

  it('SEC-BE035-05/06: lists and login ignore soft-deleted rows', async () => {
    const { service } = makeUserService({ actorIsAdmin: true });
    const tenantPool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    jest
      .spyOn(service as unknown as { withTenantCoreDatabase: (id: string, op: (pool: unknown) => unknown) => unknown }, 'withTenantCoreDatabase')
      .mockImplementation(async (_id, operation) => operation(tenantPool));
    await service.coreUsers(TENANT);
    expect(tenantPool.query.mock.calls[0][0]).toContain('WHERE deleted_at IS NULL');
    await service.coreUsers(TENANT, { includeDeleted: true });
    expect(tenantPool.query.mock.calls[1][0]).not.toContain('deleted_at');
  });
});

describe('User email must belong to the tenant domain (ISS-BE-055)', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['a@gmail.com', 'a@savinajsc.com.vn', 'a@khac.com'])(
    'SEC-BE055-01: creating %p in tenant savinajsc is 400 naming the right domain',
    async (email) => {
      const { service, audit } = makeUserService({ actorIsAdmin: true });
      await expect(
        service.createCoreUser(TENANT, { fullName: 'A', email, password: 'Savina2026x' }, ACTOR),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'EMAIL_TENANT_MISMATCH', message: expect.stringContaining('@savinajsc.com') },
      });
      expect(audit).not.toHaveBeenCalled();
    },
  );

  it('SEC-BE055-02: a@savinajsc.com is accepted', async () => {
    const { service, tenantCalls } = makeUserService({ actorIsAdmin: true });
    await service.createCoreUser(TENANT, { fullName: 'A', email: 'A@savinajsc.com', password: 'Savina2026x' }, ACTOR);
    const insert = tenantCalls.find((call) => call.sql.startsWith('INSERT INTO core_schema.users'));
    expect(insert?.params[1]).toBe('a@savinajsc.com');
  });

  it('SEC-BE055-04: changing an email to another domain is 400', async () => {
    const { service, tenantCalls } = makeUserService({ actorIsAdmin: true, currentEmail: 'qa.victim@savinajsc.com' });
    await expect(
      service.updateCoreUser(TENANT, VICTIM, { email: 'qa.victim@gmail.com' }, ACTOR),
    ).rejects.toMatchObject({ status: 400, response: { code: 'EMAIL_TENANT_MISMATCH' } });
    expect(tenantCalls.some((call) => call.sql.startsWith('UPDATE core_schema.users'))).toBe(false);
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
