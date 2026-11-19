import { randomBytes, scryptSync } from 'node:crypto';
import { PlatformIdentityService } from './platform-identity.service';

type RecordedQuery = { pool: string; sql: string };
type Responder = (sql: string) => Record<string, unknown>[];

const recorded: RecordedQuery[] = [];
let tenantResponder: Responder = () => [];

jest.mock('@enterprise-platform/adapter-database', () => ({
  ...jest.requireActual('@enterprise-platform/adapter-database'),
  resolveTenantDatabaseUrl: jest.fn(() => 'postgresql://tenant:tenant@localhost:5432/tenant_db'),
  createPostgresPool: jest.fn((_url: string, options?: { application_name?: string }) => {
    const name = options?.application_name ?? 'unknown';
    return {
      query: jest.fn(async (sql: string) => {
        recorded.push({ pool: name, sql });
        return { rows: tenantResponder(sql), rowCount: 0 };
      }),
      end: jest.fn(async () => undefined),
    };
  }),
}));

jest.mock('jose', () => {
  class SignJWT {
    setProtectedHeader() { return this; }
    setSubject() { return this; }
    setIssuer() { return this; }
    setAudience() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    async sign() { return 'signed-token'; }
  }
  return {
    exportJWK: jest.fn().mockResolvedValue({}),
    generateKeyPair: jest.fn().mockResolvedValue({ privateKey: {}, publicKey: {} }),
    importPKCS8: jest.fn().mockResolvedValue({}),
    importSPKI: jest.fn().mockResolvedValue({}),
    jwtVerify: jest.fn(),
    SignJWT,
  };
});

const DDL_PATTERN = /ALTER\s+TABLE|CREATE\s+(UNIQUE\s+)?INDEX|CREATE\s+OR\s+REPLACE\s+VIEW/i;

type TenantPool = { query: (sql: string) => Promise<unknown> };
type Testable = {
  pool: { query: jest.Mock };
  withTenantAuthorizationDatabase: <T>(tenantId: string, operation: (pool: TenantPool) => Promise<T>) => Promise<T>;
  withTenantCoreDatabase: <T>(tenantId: string, operation: (pool: TenantPool) => Promise<T>) => Promise<T>;
};

function scryptHash(password: string): string {
  const salt = randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('base64url')}`;
}

const access = {
  roles: ['tenant-user'],
  permissions: ['maintenance.read'],
  moduleKeys: ['maintenance'],
  authorizationRevision: '1',
};
const coreUser = { id: 'user-1', email: 'admin@savina.com', fullName: 'Admin', systemRole: 'tenant-user' };

describe('PlatformIdentityService does not change tenant schema while serving requests (ISS-OPS-011)', () => {
  let service: PlatformIdentityService;
  let testable: Testable;

  beforeEach(() => {
    recorded.length = 0;
    tenantResponder = () => [];
    service = new PlatformIdentityService();
    testable = service as unknown as Testable;
    testable.pool = {
      query: jest.fn(async (sql: string) => {
        recorded.push({ pool: 'platform', sql });
        if (/FROM tenancy_schema\.tenants t\s+JOIN tenancy_schema\.tenant_db_configs db/.test(sql)) {
          return { rows: [{ tenant_id: 'tenant-1', tenant_slug: 'savina', secret_ref: 'sec', database_name: 'tenant_db' }] };
        }
        if (/FROM tenancy_schema\.tenant_db_configs d/.test(sql)) {
          return { rows: [{ secret_ref: 'sec', database_name: 'tenant_db', config_version: 1 }] };
        }
        if (/FROM identity_schema\.tenant_auth_sessions s/.test(sql)) {
          return {
            rows: [{
              tenant_id: 'tenant-1', tenant_slug: 'savina', core_user_id: 'user-1', database_name: 'tenant_db',
              host: 'localhost', port: 5432, secret_ref: 'sec', ssl: false, config_version: 1,
              entitled: true, session_active: true, membership_active: true,
            }],
          };
        }
        return { rows: [] };
      }),
    };
    // Authorization still reads through the long-lived tenant pool, the path that used to run DDL first.
    jest.spyOn(service.authorization, 'resolveWithUser').mockImplementation((tenantId) =>
      testable.withTenantAuthorizationDatabase(tenantId, async (pool) => {
        await pool.query('SELECT authorization_revision FROM core_schema.users WHERE id = $1');
        return { access, user: coreUser };
      }),
    );
  });

  function ddlStatements() {
    return recorded.filter((query) => DDL_PATTERN.test(query.sql));
  }

  it('tenant login issues no ALTER TABLE, CREATE INDEX or CREATE OR REPLACE VIEW', async () => {
    const passwordHash = scryptHash('correct-password');
    tenantResponder = (sql) => (/FROM core_schema\.users/.test(sql) && /lower\(email\)/.test(sql)
      ? [{ id: 'user-1', email: 'admin@savina.com', full_name: 'Admin', password_hash: passwordHash, system_role: 'tenant-user' }]
      : []);

    const result = await service.login({ portal: 'tenant', email: 'admin@savina.com', password: 'correct-password' });

    expect(result.principal).toMatchObject({ kind: 'tenant-user', tenantId: 'tenant-1' });
    expect(recorded.some((query) => query.pool === 'enterprise-platform:tenant-authorization')).toBe(true);
    expect(ddlStatements()).toEqual([]);
  });

  it('access decision issues no schema-changing statement', async () => {
    const decision = await service.decide({
      tenantId: 'tenant-1', userId: 'user-1', sessionId: 'session-1', moduleKey: 'maintenance', permission: 'maintenance.read',
    });

    expect(decision.allowed).toBe(true);
    expect(recorded.filter((query) => query.pool === 'enterprise-platform:tenant-authorization').map((query) => query.sql)).toEqual([
      'SELECT authorization_revision FROM core_schema.users WHERE id = $1',
    ]);
    expect(ddlStatements()).toEqual([]);
  });

  it('tenant core database helper only runs the requested operation', async () => {
    await testable.withTenantCoreDatabase('tenant-1', (pool) => pool.query('SELECT 1'));

    expect(recorded.filter((query) => query.pool === 'enterprise-platform:tenant-user-management').map((query) => query.sql)).toEqual([
      'SELECT 1',
    ]);
    expect(ddlStatements()).toEqual([]);
  });
});
