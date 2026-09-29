import type { Request } from 'express';
import type { TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import { PlatformAccessController } from './platform-access.controller.js';
import type { PlatformIdentityService } from './platform-identity.service.js';
jest.mock('./platform-identity.service.js', () => ({
  PlatformIdentityService: class {},
}));

describe('Tenant authorization API gates', () => {
  const request = {
    headers: { 'x-csrf-token': 'csrf' },
    cookies: { ep_access: 'token', ep_csrf: 'csrf' },
  } as unknown as Request;
  let principal: TenantUserPrincipal;
  let identity: {
    verifyAccessToken: jest.Mock;
    coreUsers: jest.Mock;
    createCoreUser: jest.Mock;
    mutateCoreOrganization: jest.Mock;
    tenantModuleCatalog: jest.Mock;
    tenantModules: jest.Mock;
    authorization: {
      assignRoles: jest.Mock;
      savePermission: jest.Mock;
      listRoles: jest.Mock;
    };
  };
  let controller: PlatformAccessController;
  beforeEach(() => {
    principal = {
      kind: 'tenant-user',
      tenantId: 'tenant-a',
      tenantSlug: 'a',
      userId: 'user',
      sessionId: 'session',
      membershipId: 'user',
      email: 'a@example.test',
      displayName: 'A',
      roles: ['tenant-user'],
      permissions: ['core.users.read'],
      moduleKeys: ['procedure-engine'],
    };
    identity = {
      verifyAccessToken: jest.fn(async () => principal),
      coreUsers: jest.fn(async () => []),
      createCoreUser: jest.fn(),
      mutateCoreOrganization: jest.fn(),
      tenantModuleCatalog: jest.fn(async () => [
        { key: 'procedure-engine' },
        { key: 'inventory' },
      ]),
      tenantModules: jest.fn(async () => [
        { key: 'procedure-engine' },
        { key: 'inventory' },
      ]),
      authorization: {
        assignRoles: jest.fn(),
        savePermission: jest.fn(),
        listRoles: jest.fn(),
      },
    };
    controller = new PlatformAccessController(
      identity as unknown as PlatformIdentityService,
    );
  });
  it('scopes reads to the authenticated tenant', async () => {
    await controller.coreUsers(request);
    expect(identity.coreUsers).toHaveBeenCalledWith('tenant-a');
  });
  it('does not confuse read permission with create permission', async () => {
    await expect(
      controller.createCoreUser(request, { fullName: 'B' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(identity.createCoreUser).not.toHaveBeenCalled();
  });
  it('reserves role/permission management for the built-in admin', async () => {
    principal = { ...principal, permissions: ['tenant.manage'] };
    await expect(controller.roles(request)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      controller.setUserRoles(request, 'victim', { roleIds: [] }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('enforces CSRF on authorization writes', async () => {
    principal = { ...principal, roles: ['tenant-admin'] };
    await expect(
      controller.createPermission({ ...request, headers: {} } as Request, {
        name: 'Read',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(identity.authorization.savePermission).not.toHaveBeenCalled();
  });
  it('does not take a target tenant from the submitted body', async () => {
    principal = { ...principal, roles: ['tenant-admin'] };
    await controller.createPermission(request, {
      tenantId: 'tenant-b',
      name: 'Read',
      actionKeys: ['core.users.read'],
    });
    expect(
      identity.authorization.savePermission.mock.calls[0].slice(0, 2),
    ).toEqual(['tenant-a', 'user']);
  });
  it('gates legacy organization update and assignment independently', async () => {
    principal = { ...principal, permissions: ['core.organization.create'] };
    await expect(
      controller.createOrganizationResource(request, 'core', {
        action: 'update-node',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await controller.createOrganizationResource(request, 'core', {
      action: 'assign-user',
    });
    expect(identity.mutateCoreOrganization).toHaveBeenCalledTimes(1);
  });
  it('disables the legacy platform membership role assignment endpoint', async () => {
    principal = { ...principal, roles: ['tenant-admin'] };
    await expect(controller.assignRole(request)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('filters module launch and catalog by the user roles', async () => {
    expect(await controller.modules(request)).toEqual([
      { key: 'procedure-engine' },
    ]);
    expect(await controller.moduleCatalog(request)).toEqual({
      modules: [{ key: 'procedure-engine' }],
    });
  });
});
