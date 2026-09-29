import type {
  AccessDecisionRequest,
  AccessDecisionResponse,
} from '@enterprise-platform/contracts-identity';
import { PlatformIdentityService } from './platform-identity.service';

jest.mock('jose', () => ({
  exportJWK: jest.fn().mockResolvedValue({}),
  generateKeyPair: jest.fn().mockResolvedValue({
    privateKey: {},
    publicKey: {},
  }),
  importPKCS8: jest.fn().mockResolvedValue({}),
  importSPKI: jest.fn().mockResolvedValue({}),
  jwtVerify: jest.fn(),
  SignJWT: jest.fn(),
}));

type MockTenantPool = { query: jest.Mock; end: jest.Mock };
type TestablePlatformIdentity = {
  pool: { query: jest.Mock };
  withTenantCoreDatabase: (
    tenantId: string,
    operation: (pool: MockTenantPool) => Promise<unknown>,
  ) => Promise<unknown>;
  decideTenantCoreSession: (
    input: AccessDecisionRequest,
  ) => Promise<AccessDecisionResponse | undefined>;
};

describe('PlatformIdentityService - Access Decision', () => {
  let service: PlatformIdentityService;
  let testable: TestablePlatformIdentity;
  let mockPlatformPool: { query: jest.Mock };
  let mockTenantPool: MockTenantPool;

  const input = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    sessionId: 'session-1',
    moduleKey: 'maintenance',
    permission: 'maintenance.manage',
  };

  function platformRow(overrides: Record<string, unknown> = {}) {
    return {
      tenant_id: 'tenant-1',
      tenant_slug: 'savina',
      core_user_id: 'user-1',
      database_name: 'tenant_db',
      host: 'localhost',
      port: 5432,
      secret_ref: 'sec',
      ssl: false,
      config_version: 1,
      entitled: true,
      session_active: true,
      membership_active: true,
      ...overrides,
    };
  }

  beforeEach(() => {
    mockPlatformPool = { query: jest.fn() };
    mockTenantPool = { query: jest.fn(), end: jest.fn() };

    service = new PlatformIdentityService();
    testable = service as unknown as TestablePlatformIdentity;
    testable.pool = mockPlatformPool;
    jest
      .spyOn(testable, 'withTenantCoreDatabase')
      .mockImplementation(async (_tenantId, operation) =>
        operation(mockTenantPool),
      );
  });

  it('returns MODULE_NOT_ENTITLED when the module is disabled for the tenant', async () => {
    mockPlatformPool.query.mockResolvedValueOnce({
      rows: [platformRow({ entitled: false })],
    });

    await expect(testable.decideTenantCoreSession(input)).resolves.toEqual(
      { allowed: false, code: 'MODULE_NOT_ENTITLED' },
    );
  });

  it('returns SESSION_INACTIVE when the dedicated tenant session is no longer active', async () => {
    mockPlatformPool.query.mockResolvedValueOnce({
      rows: [platformRow({ session_active: false })],
    });

    await expect(testable.decideTenantCoreSession(input)).resolves.toEqual(
      { allowed: false, code: 'SESSION_INACTIVE' },
    );
  });

  it('returns MEMBERSHIP_INACTIVE when the tenant is no longer active', async () => {
    mockPlatformPool.query.mockResolvedValueOnce({
      rows: [platformRow({ membership_active: false })],
    });

    await expect(testable.decideTenantCoreSession(input)).resolves.toEqual(
      { allowed: false, code: 'MEMBERSHIP_INACTIVE' },
    );
  });

  it('returns MODULE_ROLE_FORBIDDEN when authorization lacks the module', async () => {
    mockPlatformPool.query.mockResolvedValueOnce({ rows: [platformRow()] });
    jest.spyOn(service.authorization, 'resolve').mockResolvedValue({
      roles: ['tenant-user'],
      permissions: ['maintenance.read'],
      moduleKeys: ['inventory'],
      authorizationRevision: '1',
    });

    await expect(testable.decideTenantCoreSession(input)).resolves.toEqual(
      { allowed: false, code: 'MODULE_ROLE_FORBIDDEN' },
    );
  });

  it('returns PERMISSION_DENIED when the module is allowed but the action is not', async () => {
    mockPlatformPool.query.mockResolvedValueOnce({ rows: [platformRow()] });
    const access = {
      roles: ['tenant-user', 'technician'],
      permissions: ['maintenance.read'],
      moduleKeys: ['maintenance'],
      authorizationRevision: '1',
    };
    jest.spyOn(service.authorization, 'resolve').mockResolvedValue(access);
    jest.spyOn(service.authorization, 'allowsModule').mockReturnValue(false);

    await expect(testable.decideTenantCoreSession(input)).resolves.toEqual(
      { allowed: false, code: 'PERMISSION_DENIED' },
    );
  });

  it('returns a tenant principal when module and action authorization pass', async () => {
    mockPlatformPool.query.mockResolvedValueOnce({ rows: [platformRow()] });
    const access = {
      roles: ['tenant-user', 'maintenance-lead'],
      permissions: ['maintenance.manage'],
      moduleKeys: ['maintenance'],
      authorizationRevision: '1',
    };
    jest.spyOn(service.authorization, 'resolve').mockResolvedValue(access);
    jest.spyOn(service.authorization, 'allowsModule').mockReturnValue(true);
    mockTenantPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-1',
          email: 'manager@savina.com',
          full_name: 'Manager',
          system_role: 'tenant-user',
        },
      ],
    });

    const result = await testable.decideTenantCoreSession(input);

    expect(result?.allowed).toBe(true);
    expect(result?.principal).toMatchObject({
      userId: 'user-1',
      displayName: 'Manager',
      roles: ['tenant-user', 'maintenance-lead'],
      permissions: ['maintenance.manage'],
    });
  });

  it('accepts wildcard module access for a tenant admin', async () => {
    mockPlatformPool.query.mockResolvedValueOnce({
      rows: [platformRow({ core_user_id: 'admin-1' })],
    });
    const access = {
      roles: ['tenant-user', 'tenant-admin'],
      permissions: ['tenant.manage'],
      moduleKeys: ['*'],
      authorizationRevision: '1',
    };
    jest.spyOn(service.authorization, 'resolve').mockResolvedValue(access);
    jest.spyOn(service.authorization, 'allowsModule').mockReturnValue(true);
    mockTenantPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'admin-1',
          email: 'admin@savina.com',
          full_name: 'Admin',
          system_role: 'tenant-admin',
        },
      ],
    });

    const result = await testable.decideTenantCoreSession({
      ...input,
      userId: 'admin-1',
    });

    expect(result?.allowed).toBe(true);
    expect(result?.principal?.roles).toContain('tenant-admin');
  });
});
