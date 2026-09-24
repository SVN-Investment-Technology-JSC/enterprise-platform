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
    createdAt: new Date().toISOString(),
  },
];
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
  if (viewer) return send({ message: 'Không có quyền.' }, 403);
  if (req.method !== 'GET' && req.headers['x-csrf-token'] !== 'test-csrf')
    return send({ message: 'CSRF_INVALID' }, 403);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const assignment = url.pathname.match(/\/tenant-users\/([^/]+)\/roles$/);
  if (assignment) {
    const user = users.find((u) => u.id === assignment[1]);
    if (!user) return send({}, 404);
    if (req.method === 'PUT') {
      user.roleIds = body.roleIds;
      sync();
    }
    return send({ roleIds: user.roleIds });
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
