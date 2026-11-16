import type { Request } from 'express';
import {
  CRM_ROLE_TEMPLATES,
  HRM_ROLE_TEMPLATES,
  invalidCrmTemplateActions,
  type TenantUserPrincipal,
} from '@enterprise-platform/contracts-identity';
import { PlatformAccessController } from './platform-access.controller.js';
import type { PlatformIdentityService } from './platform-identity.service.js';
import {
  ROLE_TEMPLATE_SYSTEM_ACTOR_ID,
  TenantAuthorizationService,
  hrmTemplateId,
} from './tenant-authorization.js';

jest.mock('./platform-identity.service.js', () => ({ PlatformIdentityService: class {} }));

/** Kho giả của core_schema: roles, permissions, permission_actions, role_permissions và audit. */
function coreStore() {
  const roles = new Map<string, string>();
  const permissions = new Set<string>();
  const actions = new Map<string, Set<string>>();
  const rolePermissions = new Set<string>();
  const audits: { actor: unknown; operation: unknown; subject: unknown }[] = [];
  const statements: string[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      statements.push(sql);
      if (sql.includes('INSERT INTO core_schema.roles')) {
        if (roles.has(params[0] as string)) return { rowCount: 0, rows: [] };
        roles.set(params[0] as string, params[2] as string);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('INSERT INTO core_schema.permissions(')) {
        permissions.add(params[0] as string);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT id FROM core_schema.permissions'))
        return { rowCount: permissions.has(params[0] as string) ? 1 : 0, rows: [] };
      if (sql.includes('INSERT INTO core_schema.permission_actions')) {
        const set = actions.get(params[0] as string) ?? new Set<string>();
        set.add(params[1] as string);
        actions.set(params[0] as string, set);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT action_key FROM core_schema.permission_actions'))
        return { rowCount: 0, rows: [...(actions.get(params[0] as string) ?? [])].map((k) => ({ action_key: k })) };
      if (sql.includes('INSERT INTO core_schema.role_permissions')) {
        rolePermissions.add(`${params[0]}:${params[1]}`);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('INSERT INTO core_schema.authorization_audit')) {
        audits.push({ actor: params[1], operation: params[2], subject: params[3] });
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  return { client, roles, actions, rolePermissions, audits, statements };
}

function serviceOn(store: ReturnType<typeof coreStore>) {
  const service = new TenantAuthorizationService(async () => {
    throw new Error('unused');
  });
  jest.spyOn(service, 'mutate').mockImplementation(async (_t, _a, op) => op(store.client as never));
  return service;
}

const template = (key: string) => {
  const found = CRM_ROLE_TEMPLATES.find((t) => t.key === key);
  if (!found) throw new Error(`Thiếu vai trò mẫu ${key}`);
  return found;
};

describe('Vai trò mẫu Bán hàng (ISS-BE-011)', () => {
  it('đúng bộ quyền đã chốt, mọi khoá có trong TENANT_PERMISSION_ACTIONS', () => {
    expect(invalidCrmTemplateActions()).toEqual([]);
    expect(template('crm-sales-staff').name).toBe('Nhân viên kinh doanh');
    expect([...template('crm-sales-staff').actions].sort()).toEqual(
      ['crm.order.write', 'crm.opportunity.write', 'crm.quote.write', 'crm.read'].sort(),
    );
    expect(template('crm-sales-manager').name).toBe('Quản lý kinh doanh');
    expect([...template('crm-sales-manager').actions].sort()).toEqual(
      [
        'crm.order.write',
        'crm.opportunity.write',
        'crm.quote.write',
        'crm.read',
        'crm.read.all',
        'crm.quote.approve',
        'crm.report.read',
      ].sort(),
    );
    // Không trùng ID với vai trò mẫu HRM.
    const hrmIds = new Set(HRM_ROLE_TEMPLATES.map((t) => hrmTemplateId('role', t.key)));
    for (const t of CRM_ROLE_TEMPLATES) expect(hrmIds.has(hrmTemplateId('role', t.key))).toBe(false);
  });

  it('SEC-BE011-01: tạo đủ hai vai trò mẫu với đúng bộ quyền, có audit, không gán cho ai', async () => {
    const store = coreStore();
    const result = await serviceOn(store).seedCrmRoleTemplates('t', 'admin');
    expect(result.created).toEqual(['Nhân viên kinh doanh', 'Quản lý kinh doanh']);
    for (const t of CRM_ROLE_TEMPLATES) {
      const roleId = hrmTemplateId('role', t.key);
      const permissionId = hrmTemplateId('permission', t.key);
      expect(store.roles.get(roleId)).toBe(t.name);
      expect([...(store.actions.get(permissionId) ?? [])].sort()).toEqual([...t.actions].sort());
      expect(store.rolePermissions.has(`${roleId}:${permissionId}`)).toBe(true);
    }
    expect(store.audits.map((a) => a.operation)).toEqual(['role.template.crm.create', 'role.template.crm.create']);
    expect(store.statements.some((sql) => sql.includes('core_schema.user_roles'))).toBe(false);
  });

  it('SEC-BE011-02: chạy lại không tạo trùng', async () => {
    const store = coreStore();
    const service = serviceOn(store);
    await service.seedCrmRoleTemplates('t', 'admin');
    const again = await service.seedCrmRoleTemplates('t', 'admin');
    expect(again.created).toEqual([]);
    expect(again.skipped).toEqual(['Nhân viên kinh doanh', 'Quản lý kinh doanh']);
    expect(store.roles.size).toBe(CRM_ROLE_TEMPLATES.length);
  });

  it('hệ thống tự tạo khi bật Bán hàng: khoá authorization_state, audit bằng tác nhân hệ thống, chạy lại không trùng', async () => {
    const store = coreStore();
    const transactions: string[] = [];
    const pool = {
      connect: async () => ({
        query: async (sql: string, params?: unknown[]) => {
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
            transactions.push(sql);
            return { rowCount: 0, rows: [] };
          }
          return store.client.query(sql, params);
        },
        release: () => undefined,
      }),
    };
    const service = new TenantAuthorizationService(async (_tenant, operation) => operation(pool as never));
    const first = await service.seedCrmRoleTemplatesAsSystem('t');
    expect(first.created).toHaveLength(2);
    expect(store.statements[0]).toContain('core_schema.authorization_state WHERE id=true FOR UPDATE');
    expect(store.audits.every((a) => a.actor === ROLE_TEMPLATE_SYSTEM_ACTOR_ID)).toBe(true);
    const second = await service.seedCrmRoleTemplatesAsSystem('t');
    expect(second.created).toEqual([]);
    expect(transactions).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
  });

  it('vai trò mẫu HRM vẫn ghi audit role.template.hrm.create', async () => {
    const store = coreStore();
    await serviceOn(store).seedHrmRoleTemplates('t', 'admin');
    expect(new Set(store.audits.map((a) => a.operation))).toEqual(new Set(['role.template.hrm.create']));
  });
});

describe('POST v1/tenant-role-templates/crm', () => {
  const request = {
    headers: { 'x-csrf-token': 'csrf' },
    cookies: { ep_access: 'token', ep_csrf: 'csrf' },
  } as unknown as Request;
  function setup(roles: string[], entitled: boolean) {
    const principal = {
      kind: 'tenant-user',
      tenantId: 'tenant-a',
      tenantSlug: 'a',
      userId: 'admin',
      sessionId: 'session',
      membershipId: 'admin',
      email: 'admin@a.com',
      displayName: 'A',
      roles,
      permissions: [],
      moduleKeys: ['crm'],
    } as TenantUserPrincipal;
    const identity = {
      verifyAccessToken: jest.fn(async () => principal),
      moduleEntitled: jest.fn(async () => entitled),
      authorization: { seedCrmRoleTemplates: jest.fn(async () => ({ created: [], updated: [], skipped: [] })) },
    };
    return { identity, controller: new PlatformAccessController(identity as unknown as PlatformIdentityService) };
  }

  it('quản trị tenant, tenant đã bật Bán hàng: tạo vai trò mẫu', async () => {
    const { identity, controller } = setup(['tenant-admin'], true);
    await controller.seedCrmRoleTemplates(request);
    expect(identity.moduleEntitled).toHaveBeenCalledWith('tenant-a', 'crm');
    expect(identity.authorization.seedCrmRoleTemplates).toHaveBeenCalledWith('tenant-a', 'admin', false);
  });

  it('tenant chưa bật Bán hàng: 409, không tạo', async () => {
    const { identity, controller } = setup(['tenant-admin'], false);
    await expect(controller.seedCrmRoleTemplates(request)).rejects.toMatchObject({ status: 409 });
    expect(identity.authorization.seedCrmRoleTemplates).not.toHaveBeenCalled();
  });

  it('không phải quản trị tenant: 403', async () => {
    const { identity, controller } = setup(['tenant-user'], true);
    await expect(controller.seedCrmRoleTemplates(request)).rejects.toMatchObject({ status: 403 });
    expect(identity.authorization.seedCrmRoleTemplates).not.toHaveBeenCalled();
  });
});
