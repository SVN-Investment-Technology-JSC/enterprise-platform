import type { createPostgresPool } from '@enterprise-platform/adapter-database';
import { TenantAuthorizationService } from './tenant-authorization.js';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const OTHER_ADMIN = '00000000-0000-4000-8000-000000000003';
const MISSING = '00000000-0000-4000-8000-000000000009';

/** Cơ sở dữ liệu giả trong bộ nhớ, chỉ hiểu đúng các câu truy vấn của luồng quyền bổ sung. */
function fakeDatabase() {
  const state = {
    revision: 1,
    users: new Set([ADMIN, USER, OTHER_ADMIN]),
    admins: new Set([ADMIN, OTHER_ADMIN]),
    roleActions: new Map<string, string[]>(),
    grants: new Map<string, Map<string, { by: string; at: string }>>(),
    audit: [] as { operation: string; subject: string; before: unknown; after: unknown; actor?: string; at?: string }[],
    names: new Map<string, string>([[ADMIN, 'Quản trị A']]),
    clock: 0,
  };
  const userGrants = (id: string) => {
    if (!state.grants.has(id)) state.grants.set(id, new Map());
    return state.grants.get(id) as Map<string, { by: string; at: string }>;
  };
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, ' ');
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text)) return { rows: [], rowCount: 0 };
    if (text.includes('FOR UPDATE')) return { rows: [{ revision: state.revision }], rowCount: 1 };
    if (text.includes('s.revision')) {
      const id = params[0] as string;
      return state.users.has(id)
        ? { rows: [{ revision: String(state.revision), id, email: 'u@x.vn', fullName: 'U', systemRole: 'tenant-user' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (text.startsWith('SELECT r.key, r.name')) {
      const rows = state.admins.has(params[0] as string) ? [{ key: 'tenant-admin', name: 'Admin' }] : [];
      return { rows, rowCount: rows.length };
    }
    if (text.includes('UNION')) {
      const id = params[0] as string;
      const keys = [...new Set([...(state.roleActions.get(id) ?? []), ...userGrants(id).keys()])];
      return { rows: keys.map((key) => ({ key })), rowCount: keys.length };
    }
    if (text.includes('FROM core_schema.users u WHERE u.id=$1')) {
      // Kiểm requiredAction của người không phải admin: vai trò hoặc quyền bổ sung.
      const [id, action] = params as [string, string];
      const ok = state.users.has(id) && ((state.roleActions.get(id) ?? []).includes(action) || userGrants(id).has(action));
      return { rows: ok ? [{}] : [], rowCount: ok ? 1 : 0 };
    }
    if (text.includes("r.key='tenant-admin'")) {
      const ok = state.admins.has(params[0] as string);
      return { rows: ok ? [{}] : [], rowCount: ok ? 1 : 0 };
    }
    if (text.startsWith('SELECT id FROM core_schema.users') || text.startsWith('SELECT 1 FROM core_schema.users WHERE id=$1')) {
      const ok = state.users.has(params[0] as string);
      return { rows: ok ? [{}] : [], rowCount: ok ? 1 : 0 };
    }
    if (text.startsWith('SELECT action_key FROM core_schema.user_permission_grants')) {
      const rows = [...userGrants(params[0] as string).keys()].sort().map((action_key) => ({ action_key }));
      return { rows, rowCount: rows.length };
    }
    if (text.includes('granted_by::text')) {
      const rows = [...userGrants(params[0] as string).entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([actionKey, g]) => ({ actionKey, grantedBy: g.by, grantedAt: g.at }));
      return { rows, rowCount: rows.length };
    }
    if (text.startsWith('DELETE FROM core_schema.user_permission_grants')) {
      for (const key of params[1] as string[]) userGrants(params[0] as string).delete(key);
      state.revision += 1;
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith('INSERT INTO core_schema.user_permission_grants')) {
      const [id, key, by] = params as [string, string, string];
      userGrants(id).set(key, { by, at: `2026-01-01T00:00:${String(++state.clock).padStart(2, '0')}.000Z` });
      state.revision += 1;
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('FROM core_schema.authorization_audit a')) {
      const rows = state.audit
        .filter((e) => e.subject === params[0] && ['user.roles.replace', 'user.permissions.replace'].includes(e.operation))
        .sort((x, y) => ((x.at ?? '') < (y.at ?? '') ? 1 : -1))
        .slice(0, 100)
        .map((e, i) => ({
          id: `e${i}`,
          operation: e.operation,
          actorId: e.actor,
          actorName: state.names.get(e.actor as string) ?? null,
          createdAt: new Date(e.at as string),
          before: e.before,
          after: e.after,
        }));
      return { rows, rowCount: rows.length };
    }
    if (text.startsWith('INSERT INTO core_schema.authorization_audit')) {
      const [, actor, operation, subject, before, after] = params as string[];
      state.audit.push({
        operation,
        subject,
        before: JSON.parse(before),
        after: JSON.parse(after),
        actor,
        at: `2026-02-01T00:00:${String(++state.clock).padStart(2, '0')}.000Z`,
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  const service = new TenantAuthorizationService(async (_tenant, operation) =>
    operation(pool as unknown as ReturnType<typeof createPostgresPool>),
  );
  return { state, service, query };
}

describe('Quyền bổ sung gán thẳng cho người dùng', () => {
  it('hợp quyền từ vai trò và quyền bổ sung, rồi mở rộng quyền bao hàm', async () => {
    const { state, service } = fakeDatabase();
    state.roleActions.set(USER, ['core.users.read']);
    await service.setUserPermissionGrants('t', ADMIN, USER, ['inventory.manage']);
    const access = await service.resolve('t', USER);
    expect(access.permissions).toEqual(
      expect.arrayContaining(['core.users.read', 'inventory.manage', 'inventory.read']),
    );
    expect(access.moduleKeys).toContain('inventory');
    expect(access.permissions).not.toContain('tenant.manage');
  });

  it('cache theo revision: cấp rồi gỡ quyền có hiệu lực ngay ở lần resolve sau', async () => {
    const { service } = fakeDatabase();
    expect((await service.resolve('t', USER)).permissions).toEqual([]);
    await service.setUserPermissionGrants('t', ADMIN, USER, ['core.users.update']);
    expect((await service.resolve('t', USER)).permissions).toContain('core.users.update');
    await service.setUserPermissionGrants('t', ADMIN, USER, []);
    expect((await service.resolve('t', USER)).permissions).not.toContain('core.users.update');
  });

  it('chỉ quản trị tenant được đọc/ghi: người thường, kể cả có core.users.update, bị 403', async () => {
    const { state, service } = fakeDatabase();
    state.roleActions.set(USER, ['core.users.update']);
    await expect(
      service.setUserPermissionGrants('t', USER, USER, ['core.users.read']),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.grants.get(USER)?.size ?? 0).toBe(0);
  });

  it('từ chối khoá lạ, tenant.manage, wildcard và dữ liệu sai kiểu bằng 400', async () => {
    const { service } = fakeDatabase();
    for (const bad of [['tenant.manage'], ['*'], ['unknown.action'], ['platform.manage'], 'core.users.read', null, [1]])
      await expect(
        service.setUserPermissionGrants('t', ADMIN, USER, bad),
      ).rejects.toMatchObject({ status: 400 });
  });

  it('từ chối user đích là quản trị tenant (409) và user không tồn tại (404)', async () => {
    const { service } = fakeDatabase();
    await expect(
      service.setUserPermissionGrants('t', ADMIN, OTHER_ADMIN, ['core.users.read']),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.setUserPermissionGrants('t', ADMIN, MISSING, ['core.users.read']),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.userPermissionGrants('t', MISSING)).rejects.toMatchObject({ status: 404 });
    await expect(service.userPermissionGrants('t', 'khong-phai-uuid')).rejects.toMatchObject({ status: 400 });
  });

  it('thay toàn bộ tập, giữ granted_by/granted_at của khoá không đổi và gỡ khoá bị bỏ', async () => {
    const { state, service } = fakeDatabase();
    const first = await service.setUserPermissionGrants('t', ADMIN, USER, ['core.users.read', 'core.users.update']);
    expect(first.actionKeys).toEqual(['core.users.read', 'core.users.update']);
    const kept = first.grants.find((g) => g.actionKey === 'core.users.read');
    const second = await service.setUserPermissionGrants('t', OTHER_ADMIN, USER, ['core.users.read', 'core.organization.read']);
    expect(second.actionKeys).toEqual(['core.organization.read', 'core.users.read']);
    expect(second.grants.find((g) => g.actionKey === 'core.users.read')).toEqual(kept);
    expect(second.grants.find((g) => g.actionKey === 'core.organization.read')?.grantedBy).toBe(OTHER_ADMIN);
    expect(state.grants.get(USER)?.has('core.users.update')).toBe(false);
    expect((await service.setUserPermissionGrants('t', ADMIN, USER, [])).actionKeys).toEqual([]);
    expect((await service.userPermissionGrants('t', USER)).grants).toEqual([]);
  });

  it('ghi audit user.permissions.replace với trước và sau', async () => {
    const { state, service } = fakeDatabase();
    await service.setUserPermissionGrants('t', ADMIN, USER, ['core.users.read']);
    await service.setUserPermissionGrants('t', ADMIN, USER, ['core.users.update']);
    expect(state.audit.map(({ operation, subject, before, after }) => ({ operation, subject, before, after }))).toEqual([
      { operation: 'user.permissions.replace', subject: USER, before: { actionKeys: [] }, after: { actionKeys: ['core.users.read'] } },
      { operation: 'user.permissions.replace', subject: USER, before: { actionKeys: ['core.users.read'] }, after: { actionKeys: ['core.users.update'] } },
    ]);
  });

  it('người thường có quyền bổ sung core.users.update qua được mutate, thiếu quyền thì 403', async () => {
    const { service } = fakeDatabase();
    const run = () => service.mutate('t', USER, async () => 'ok', 'core.users.update');
    await expect(run()).rejects.toMatchObject({ status: 403 });
    await service.setUserPermissionGrants('t', ADMIN, USER, ['core.users.update']);
    await expect(run()).resolves.toBe('ok');
    await expect(
      service.mutate('t', USER, async () => 'ok', 'core.users.delete'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.mutate('t', USER, async () => 'ok')).rejects.toMatchObject({ status: 403 });
  });

  it('lịch sử phân quyền: mới nhất trước, lọc theo operation, tên người thao tác null khi đã xoá', async () => {
    const { state, service } = fakeDatabase();
    await service.setUserPermissionGrants('t', ADMIN, USER, ['core.users.read']);
    state.audit.push({ operation: 'user.roles.replace', subject: USER, before: { roleIds: [] }, after: { roleIds: ['r1'] }, actor: ADMIN, at: '2026-02-02T00:00:00.000Z' });
    state.audit.push({ operation: 'role.save', subject: USER, before: {}, after: {}, actor: ADMIN, at: '2026-02-03T00:00:00.000Z' });
    state.audit.push({ operation: 'user.permissions.replace', subject: USER, before: { actionKeys: ['core.users.read'] }, after: { actionKeys: [] }, actor: OTHER_ADMIN, at: '2026-02-04T00:00:00.000Z' });
    state.audit.push({ operation: 'user.roles.replace', subject: OTHER_ADMIN, before: {}, after: {}, actor: ADMIN, at: '2026-02-05T00:00:00.000Z' });
    const entries = await service.userAuthorizationHistory('t', USER);
    expect(entries.map((e) => e.operation)).toEqual([
      'user.permissions.replace',
      'user.roles.replace',
      'user.permissions.replace',
    ]);
    expect(entries[0]).toMatchObject({
      actorId: OTHER_ADMIN,
      actorName: null,
      before: { actionKeys: ['core.users.read'] },
      after: { actionKeys: [] },
      createdAt: '2026-02-04T00:00:00.000Z',
    });
    expect(entries[2]).toMatchObject({ actorId: ADMIN, actorName: 'Quản trị A' });
  });

  it('lịch sử phân quyền: tối đa 100 dòng, 404 user lạ, 400 id sai', async () => {
    const { state, service } = fakeDatabase();
    for (let i = 0; i < 120; i += 1)
      state.audit.push({
        operation: 'user.roles.replace',
        subject: USER,
        before: { roleIds: [] },
        after: { roleIds: [] },
        actor: ADMIN,
        at: new Date(Date.UTC(2026, 3, 1, 0, 0, i)).toISOString(),
      });
    const entries = await service.userAuthorizationHistory('t', USER);
    expect(entries).toHaveLength(100);
    expect(entries[0].createdAt).toBe(new Date(Date.UTC(2026, 3, 1, 0, 0, 119)).toISOString());
    await expect(service.userAuthorizationHistory('t', MISSING)).rejects.toMatchObject({ status: 404 });
    await expect(service.userAuthorizationHistory('t', 'khong-phai-uuid')).rejects.toMatchObject({ status: 400 });
  });
});
