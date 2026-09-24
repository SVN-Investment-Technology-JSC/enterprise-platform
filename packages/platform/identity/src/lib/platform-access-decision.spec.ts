import { ForbiddenException } from '@nestjs/common';
import { PlatformIdentityService } from './platform-identity.service';

describe('PlatformIdentityService - Access Decision & Quota Enforcement', () => {
  let service: PlatformIdentityService;
  let mockPlatformPool: { query: jest.Mock };
  let mockTenantPool: { query: jest.Mock; end: jest.Mock };

  beforeEach(() => {
    mockPlatformPool = { query: jest.fn() };
    mockTenantPool = { query: jest.fn(), end: jest.fn() };

    service = new PlatformIdentityService();
    (service as any).pool = mockPlatformPool;

    // Mock withTenantCoreDatabase to use mockTenantPool
    jest.spyOn(service as any, 'withTenantCoreDatabase').mockImplementation(async (...args: unknown[]) => {
      const fn = args[1] as any;
      return await fn(mockTenantPool);
    });
  });

  describe('decideTenantCoreSession (Dual Access Decision Engine)', () => {
    const input = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      sessionId: 'session-1',
      moduleKey: 'maintenance',
      permission: 'maintenance.manage',
    };

    it('returns MODULE_NOT_ENTITLED when tenant has not enabled module', async () => {
      mockPlatformPool.query.mockResolvedValueOnce({
        rows: [
          {
            tenant_id: 'tenant-1',
            tenant_slug: 'savina',
            core_user_id: 'user-1',
            database_name: 'tenant_db',
            host: 'localhost',
            port: 5432,
            secret_ref: 'sec',
            ssl: false,
            config_version: 1,
            entitled: false,
            session_active: true,
            membership_active: true,
          },
        ],
      });

      const res = await (service as any).decideTenantCoreSession(input);
      expect(res).toEqual({ allowed: false, code: 'MODULE_NOT_ENTITLED' });
    });

    it('returns MODULE_ROLE_FORBIDDEN when user roles do not grant module access', async () => {
      mockPlatformPool.query.mockResolvedValueOnce({
        rows: [
          {
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
          },
        ],
      });

      // User exists
      mockTenantPool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'user-1', email: 'staff@savina.com', full_name: 'Staff', system_role: 'tenant-user' }],
        })
        // Has roles table
        .mockResolvedValueOnce({ rows: [{ exists: true }] })
        // User has roles for inventory ONLY
        .mockResolvedValueOnce({
          rows: [
            { role_code: 'warehouse-staff', module_key: 'inventory', permission_key: 'inventory.read' },
          ],
        });

      const res = await (service as any).decideTenantCoreSession(input);
      expect(res).toEqual({ allowed: false, code: 'MODULE_ROLE_FORBIDDEN' });
    });

    it('returns PERMISSION_DENIED when user has module access but lacks specific action permission', async () => {
      mockPlatformPool.query.mockResolvedValueOnce({
        rows: [
          {
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
          },
        ],
      });

      mockTenantPool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'user-1', email: 'staff@savina.com', full_name: 'Staff', system_role: 'tenant-user' }],
        })
        .mockResolvedValueOnce({ rows: [{ exists: true }] })
        // Has maintenance module but only maintenance.read, not maintenance.manage
        .mockResolvedValueOnce({
          rows: [
            { role_code: 'technician', module_key: 'maintenance', permission_key: 'maintenance.read' },
          ],
        });

      const res = await (service as any).decideTenantCoreSession(input);
      expect(res).toEqual({ allowed: false, code: 'PERMISSION_DENIED' });
    });

    it('allows access and returns tenant user principal when role grants permission', async () => {
      mockPlatformPool.query.mockResolvedValueOnce({
        rows: [
          {
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
          },
        ],
      });

      mockTenantPool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'user-1', email: 'manager@savina.com', full_name: 'Manager', system_role: 'tenant-user' }],
        })
        .mockResolvedValueOnce({ rows: [{ exists: true }] })
        .mockResolvedValueOnce({
          rows: [
            { role_code: 'maintenance-lead', module_key: 'maintenance', permission_key: 'maintenance.manage' },
          ],
        });

      const res = await (service as any).decideTenantCoreSession(input);
      expect(res.allowed).toBe(true);
      expect(res.principal?.displayName).toBe('Manager');
      expect(res.principal?.roles).toContain('maintenance-lead');
      expect(res.principal?.permissions).toContain('maintenance.manage');
    });

    it('grants full access to tenant-admin', async () => {
      mockPlatformPool.query.mockResolvedValueOnce({
        rows: [
          {
            tenant_id: 'tenant-1',
            tenant_slug: 'savina',
            core_user_id: 'admin-1',
            database_name: 'tenant_db',
            host: 'localhost',
            port: 5432,
            secret_ref: 'sec',
            ssl: false,
            config_version: 1,
            entitled: true,
            session_active: true,
            membership_active: true,
          },
        ],
      });

      mockTenantPool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'admin-1', email: 'admin@savina.com', full_name: 'Admin', system_role: 'tenant-admin' }],
        })
        .mockResolvedValueOnce({ rows: [{ exists: true }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await (service as any).decideTenantCoreSession(input);
      expect(res.allowed).toBe(true);
      expect(res.principal?.roles).toContain('tenant-admin');
    });
  });

  describe('assertActiveUsersQuota (Quota Enforcement)', () => {
    it('throws QUOTA_EXCEEDED ForbiddenException when active user count exceeds hard limit', async () => {
      // Mock subscription limit: 50 active users, hard enforcement
      mockPlatformPool.query.mockResolvedValueOnce({
        rows: [{ limit_value: 50, enforcement: 'hard' }],
      });

      // Mock current count in tenant DB: 50 active users
      mockTenantPool.query.mockResolvedValueOnce({
        rows: [{ count: '50' }],
      });

      await expect((service as any).assertActiveUsersQuota('tenant-1', 1)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('passes when active user count is below limit', async () => {
      mockPlatformPool.query.mockResolvedValueOnce({
        rows: [{ limit_value: 50, enforcement: 'hard' }],
      });

      mockTenantPool.query.mockResolvedValueOnce({
        rows: [{ count: '45' }],
      });

      await expect((service as any).assertActiveUsersQuota('tenant-1', 1)).resolves.toBeUndefined();
    });

    it('bypasses when enforcement is soft', async () => {
      mockPlatformPool.query.mockResolvedValueOnce({
        rows: [{ limit_value: 50, enforcement: 'soft' }],
      });

      await expect((service as any).assertActiveUsersQuota('tenant-1', 1)).resolves.toBeUndefined();
    });
  });
});
