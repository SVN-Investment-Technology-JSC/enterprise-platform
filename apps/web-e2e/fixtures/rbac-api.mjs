// Disposable in-memory API fixture for UI interaction tests; backend security is
// covered separately against PostgreSQL. Never connects to application databases.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
let permissions = [];
const adminId = 'a0000000-0000-4000-8000-000000000001';
const memberId = 'b0000000-0000-4000-8000-000000000002';
let roles = [
  {
    id: adminId,
    key: 'tenant-admin',
    name: 'Quản trị tenant',
    description: '',
    isSystem: true,
    permissionIds: [],
    moduleKeys: ['*'],
    userIds: ['admin'],
  },
];
const users = [
  {
    id: memberId,
    fullName: 'Nguyễn Văn Minh',
    email: 'minh@demo.com',
    systemRole: 'tenant-user',
    status: 'active',
    isActive: true,
    roleIds: [],
    roles: [],
    directActionKeys: [],
    createdAt: new Date().toISOString(),
  },
];
// Quyền bổ sung theo user: memberId -> [{ actionKey, grantedBy, grantedAt }].
const grantsByUser = new Map();
// Lịch sử thay đổi quyền theo user, mới nhất ở cuối (API trả đảo ngược).
const historyByUser = new Map();
function record(userId, operation, before, after) {
  const list = historyByUser.get(userId) ?? [];
  list.push({
    id: 'h' + (list.length + 1),
    operation,
    actorId: 'admin',
    actorName: 'Demo',
    createdAt: new Date().toISOString(),
    before,
    after,
  });
  historyByUser.set(userId, list);
}
const grantableActions = new Set([
  'core.users.read',
  'core.users.create',
  'core.users.update',
  'core.users.delete',
  'core.organization.read',
  'core.organization.create',
  'core.organization.update',
  'core.organization.delete',
]);
function sync() {
  for (const r of roles)
    r.userIds = users.filter((u) => u.roleIds.includes(r.id)).map((u) => u.id);
  for (const p of permissions)
    p.roleIds = roles
      .filter((r) => r.permissionIds.includes(p.id))
      .map((r) => r.id);
  for (const u of users)
    u.roles = roles
      .filter((r) => u.roleIds.includes(r.id))
      .map((r) => ({ id: r.id, name: r.name }));
}
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (value, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  if (url.pathname === '/health') return send({ ok: true });
  const viewer = req.headers.cookie?.includes('ep_access=viewer');
  if (url.pathname === '/api/auth/v1/me')
    return send({
      kind: 'tenant-user',
      tenantId: 'demo',
      tenantSlug: 'demo',
      userId: viewer ? memberId : 'admin',
      sessionId: 'session',
      membershipId: 'admin',
      email: 'admin@demo.com',
      displayName: 'Demo',
      roles: viewer ? ['tenant-user'] : ['tenant-user', 'tenant-admin'],
      permissions: viewer ? ['core.users.read'] : ['tenant.manage'],
      moduleKeys: ['*'],
    });
  if (url.pathname === '/api/platform/v1/modules/catalog')
    return send({
      modules: [
        {
          key: 'procedure-engine',
          name: 'Quy trình',
          entitlementStatus: 'active',
        },
      ],
    });
  if (url.pathname === '/api/platform/v1/tenant-users' && req.method === 'GET')
    return send({ users });
  const detail = url.pathname.match(/\/tenant-users\/([^/]+)$/);
  if (detail && req.method === 'GET') {
    const user = users.find((u) => u.id === detail[1]);
    return user
      ? send({ user })
      : send({ message: 'Không tìm thấy người dùng.' }, 404);
  }
  if (viewer) return send({ message: 'Không có quyền.' }, 403);
  if (req.method !== 'GET' && req.headers['x-csrf-token'] !== 'test-csrf')
    return send({ message: 'CSRF_INVALID' }, 403);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const historyRoute = url.pathname.match(
    /\/tenant-users\/([^/]+)\/authorization-history$/,
  );
  if (historyRoute)
    return send({
      entries: [...(historyByUser.get(historyRoute[1]) ?? [])].reverse(),
    });
  const assignment = url.pathname.match(/\/tenant-users\/([^/]+)\/roles$/);
  if (assignment) {
    const user = users.find((u) => u.id === assignment[1]);
    if (!user) return send({}, 404);
    if (req.method === 'PUT') {
      record(user.id, 'user.roles.replace', { roleIds: user.roleIds }, { roleIds: body.roleIds });
      user.roleIds = body.roleIds;
      sync();
    }
    return send({ roleIds: user.roleIds });
  }
  const grantsRoute = url.pathname.match(
    /\/tenant-users\/([^/]+)\/permission-grants$/,
  );
  if (grantsRoute) {
    const user = users.find((u) => u.id === grantsRoute[1]);
    if (!user) return send({ message: 'Không tìm thấy người dùng.' }, 404);
    if (req.method === 'PUT') {
      const keys = body.actionKeys;
      if (
        !Array.isArray(keys) ||
        keys.some((k) => typeof k !== 'string' || !grantableActions.has(k))
      )
        return send({ message: 'Action quyền không hợp lệ.' }, 400);
      const previous = grantsByUser.get(user.id) ?? [];
      grantsByUser.set(
        user.id,
        [...new Set(keys)].map(
          (actionKey) =>
            previous.find((g) => g.actionKey === actionKey) ?? {
              actionKey,
              grantedBy: 'admin',
              grantedAt: new Date().toISOString(),
            },
        ),
      );
      record(
        user.id,
        'user.permissions.replace',
        { actionKeys: previous.map((g) => g.actionKey) },
        { actionKeys: [...new Set(keys)] },
      );
      user.directActionKeys = [...new Set(keys)];
    }
    const grants = grantsByUser.get(user.id) ?? [];
    return send({ actionKeys: grants.map((g) => g.actionKey), grants });
  }
  const match = url.pathname.match(
    /\/tenant-(roles|permissions)(?:\/([^/]+))?$/,
  );
  if (!match) return send({}, 404);
  const [, kind, id] = match;
  const items = kind === 'roles' ? roles : permissions;
  if (req.method === 'GET') return send({ [kind]: items });
  if (req.method === 'POST') {
    const item =
      kind === 'roles'
        ? {
            ...body,
            id: randomUUID(),
            key: randomUUID(),
            isSystem: false,
            moduleKeys: [],
            userIds: [],
          }
        : { ...body, id: randomUUID(), roleIds: [] };
    items.push(item);
    sync();
    return send({ id: item.id }, 201);
  }
  const item = items.find((i) => i.id === id);
  if (!item) return send({}, 404);
  if (req.method === 'PATCH') {
    Object.assign(item, body);
    sync();
    return send({ id });
  }
  if (req.method === 'DELETE') {
    if (item.userIds?.length || item.roleIds?.length || item.isSystem)
      return send({ message: 'Gỡ liên kết trước khi xóa.' }, 409);
    if (kind === 'roles') roles = items.filter((i) => i.id !== id);
    else permissions = items.filter((i) => i.id !== id);
    sync();
    return send({ status: 'deleted' });
  }
  return send({}, 400);
}).listen(44331, '127.0.0.1');
