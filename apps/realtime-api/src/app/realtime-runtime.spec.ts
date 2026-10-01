import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PostgresNotificationStore } from '@enterprise-platform/module-notifications';
import {
  DefaultRealtimeRequestContextResolver,
  HttpRealtimeAuthClient,
  PostgresRealtimeStoreRegistry,
} from './realtime-runtime';

const tenantPrincipal = {
  kind: 'tenant-user' as const,
  tenantId: 'tenant-a',
  tenantSlug: 'a',
  membershipId: 'membership-a',
  userId: 'user-a',
  sessionId: 'session-a',
  email: 'a@example.test',
  displayName: 'A',
  roles: ['tenant-user'],
  permissions: [],
};

describe('HttpRealtimeAuthClient', () => {
  it('forwards only the session cookie to the internal auth endpoint', async () => {
    const fetcher = jest.fn(async () =>
      new Response(JSON.stringify(tenantPrincipal), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new HttpRealtimeAuthClient('http://platform.internal', fetcher);

    await expect(client.authenticate('ep_access=signed; other=value')).resolves.toEqual(
      tenantPrincipal,
    );
    expect(fetcher).toHaveBeenCalledWith(
      'http://platform.internal/api/auth/v1/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ cookie: 'ep_access=signed' }),
      }),
    );
  });

  it('rejects missing sessions and non-tenant principals', async () => {
    const client = new HttpRealtimeAuthClient('http://platform.internal', jest.fn());
    await expect(client.authenticate('other=value')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const fetcher = jest.fn(async () =>
      new Response(
        JSON.stringify({
          ...tenantPrincipal,
          kind: 'platform-admin',
          tenantId: undefined,
          tenantSlug: undefined,
          membershipId: undefined,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      new HttpRealtimeAuthClient('http://platform.internal', fetcher).authenticate(
        'ep_access=signed',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('PostgresRealtimeStoreRegistry', () => {
  it('resolves only an active tenant database and builds the notification store on that pool', async () => {
    const tenantPool = { query: jest.fn() };
    const platform = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            tenant_id: 'tenant-a',
            database_name: 'tenant_a',
            host: 'db',
            port: 5432,
            secret_ref: 'TENANT_A_URL',
            ssl: false,
            config_version: 7,
          },
        ],
      }),
    };
    const pools = { forTenant: jest.fn().mockResolvedValue(tenantPool) };
    const registry = new PostgresRealtimeStoreRegistry(platform as never, pools as never);

    await expect(registry.forTenant('tenant-a')).resolves.toBeInstanceOf(
      PostgresNotificationStore,
    );
    expect(platform.query).toHaveBeenCalledWith(expect.stringContaining("tenant.status = 'active'"), [
      'tenant-a',
    ]);
    expect(pools.forTenant).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a', configVersion: 7 }),
    );
  });
});

describe('DefaultRealtimeRequestContextResolver', () => {
  it('binds authenticated tenant ownership to its own store', async () => {
    const store = {} as PostgresNotificationStore;
    const auth = { authenticate: jest.fn().mockResolvedValue(tenantPrincipal) };
    const stores = { forTenant: jest.fn().mockResolvedValue(store) };
    const resolver = new DefaultRealtimeRequestContextResolver(auth, stores);
    const req = {
      headers: { cookie: 'ep_access=signed' },
      cookies: {},
    } as unknown as Request;

    await expect(resolver.resolve(req)).resolves.toEqual({
      principal: tenantPrincipal,
      store,
    });
    expect(stores.forTenant).toHaveBeenCalledWith('tenant-a');
  });

  it('requires double-submit CSRF for cookie-authenticated mutations', () => {
    const resolver = new DefaultRealtimeRequestContextResolver(
      { authenticate: jest.fn() },
      { forTenant: jest.fn() },
    );
    const valid = {
      headers: {
        cookie: 'ep_access=signed; ep_csrf=csrf-token',
        'x-csrf-token': 'csrf-token',
      },
      cookies: {},
    } as unknown as Request;
    expect(() => resolver.requireCsrf(valid)).not.toThrow();

    const invalid = {
      headers: {
        cookie: 'ep_access=signed; ep_csrf=csrf-token',
        'x-csrf-token': 'other',
      },
      cookies: {},
    } as unknown as Request;
    expect(() => resolver.requireCsrf(invalid)).toThrow(ForbiddenException);
  });
});
