// Bước `tenant` (T0-18): tạo tenant, bật phân hệ, vai trò và quyền, 10 tài khoản, cơ cấu tổ chức.
// Chỉ gọi API Platform (như màn Platform Admin và màn Phân quyền, Sơ đồ tổ chức của Tenant Portal).
import { ACCOUNTS, ENTITLEMENTS, POSITIONS, ROLES, UNITS, accountEmail, adminEmail } from './config.mjs';
import { Session, request, sleep } from './http.mjs';

const PROVISION_TIMEOUT_MS = Number(process.env.SVN_SEED_PROVISION_TIMEOUT_MS ?? 5 * 60_000);

export async function loginPlatformAdmin(config) {
  return Session.login(config.platformApi, {
    email: config.superadmin.email,
    password: config.superadmin.password,
    portal: 'platform',
  });
}

export async function findTenant(config, platform) {
  const { tenants } = await platform.get(`${config.platformApi}/platform/v1/tenants`);
  return tenants.find((tenant) => tenant.slug === config.tenantSlug);
}

export async function loginTenantAdmin(config) {
  return Session.login(config.platformApi, { email: adminEmail(config), password: config.password, portal: 'tenant' });
}

async function ensureTenant(config, platform, log) {
  const existing = await findTenant(config, platform);
  if (existing) {
    log.skip(`Tenant ${config.tenantSlug} đã có (id ${existing.id}).`);
    return existing;
  }
  const identifier = config.tenantSlug.replaceAll('-', '_');
  const { tenant } = await platform.post(`${config.platformApi}/platform/v1/tenants`, {
    slug: config.tenantSlug,
    name: config.tenantName,
    admin: { email: adminEmail(config), displayName: 'QTV - Quản trị tenant', initialPassword: config.password },
    database: {
      databaseName: identifier,
      host: config.tenantDatabase.host,
      port: config.tenantDatabase.port,
      secretRef: `TENANT_${identifier.toUpperCase()}_DATABASE_URL`,
      ssl: false,
    },
  });
  log.created(`Tenant ${config.tenantSlug} "${config.tenantName}" (id ${tenant.id}), QTV ${adminEmail(config)}.`);
  return tenant;
}

async function ensureEntitlements(config, platform, tenantId, log) {
  const url = `${config.platformApi}/platform/v1/tenants/${tenantId}/modules`;
  const { modules } = await platform.get(url);
  const byKey = new Map(modules.map((module) => [module.key, module]));
  for (const key of ENTITLEMENTS) {
    const module = byKey.get(key);
    if (!module) throw new Error(`Phân hệ ${key} chưa được đăng ký trong module registry.`);
    if (module.entitlementStatus === 'active' || module.entitlementStatus === 'provisioning') {
      log.skip(`Phân hệ ${key}: ${module.entitlementStatus}.`);
      continue;
    }
    await platform.put(`${config.platformApi}/platform/v1/tenants/${tenantId}/entitlements/${key}`, { enabled: true });
    log.created(`Bật phân hệ ${key} (đang khởi tạo).`);
  }

  const deadline = Date.now() + PROVISION_TIMEOUT_MS;
  for (;;) {
    const { modules: current } = await platform.get(url);
    const wanted = current.filter((module) => ENTITLEMENTS.includes(module.key));
    const failed = wanted.filter((module) => module.entitlementStatus === 'failed' || module.latestJob?.status === 'failed');
    if (failed.length) {
      throw new Error(
        `Khởi tạo phân hệ lỗi: ${failed.map((m) => `${m.key} (${m.latestJob?.error ?? m.entitlementStatus})`).join('; ')}`,
      );
    }
    const pending = wanted.filter((module) => module.entitlementStatus !== 'active');
    if (!pending.length) {
      log.info(`Đủ ${wanted.length} phân hệ ở trạng thái active: ${wanted.map((m) => `${m.key}@${m.provisionedVersion}`).join(', ')}.`);
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Hết thời gian chờ khởi tạo phân hệ: ${pending.map((m) => `${m.key} (${m.entitlementStatus}/${m.latestJob?.status})`).join('; ')}. Worker có đang chạy không?`,
      );
    }
    log.info(`Chờ worker khởi tạo: ${pending.map((m) => `${m.key}=${m.latestJob?.status ?? m.entitlementStatus}`).join(', ')}`);
    await sleep(3000);
  }
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

async function ensureRoles(config, admin, log) {
  const api = `${config.platformApi}/platform/v1`;
  const { actions } = await admin.get(`${api}/tenant-permission-actions`);
  const known = new Set(actions.map((action) => action.key));
  const missing = [...new Set(Object.values(ROLES).flatMap((role) => role.actions))].filter((key) => !known.has(key));
  if (missing.length) {
    throw new Error(`Platform đang chạy chưa có action quyền: ${missing.join(', ')} (TENANT_PERMISSION_ACTIONS). Khởi động lại API?`);
  }

  let { permissions } = await admin.get(`${api}/tenant-permissions`);
  let { roles } = await admin.get(`${api}/tenant-roles`);
  const roleIds = {};
  for (const [key, role] of Object.entries(ROLES)) {
    const permissionName = `Quyền - ${role.name}`;
    let permission = permissions.find((item) => item.name === permissionName);
    if (!permission) {
      const { id } = await admin.post(`${api}/tenant-permissions`, {
        name: permissionName,
        description: 'Tạo bởi tools/crm/seed-svn.mjs',
        actionKeys: role.actions,
      });
      permission = { id };
      log.created(`Permission "${permissionName}": ${role.actions.join(', ')}.`);
    } else if (!sameSet(permission.actionKeys, role.actions)) {
      await admin.patch(`${api}/tenant-permissions/${permission.id}`, { name: permissionName, actionKeys: role.actions });
      log.created(`Cập nhật permission "${permissionName}": ${role.actions.join(', ')}.`);
    } else {
      log.skip(`Permission "${permissionName}" đã đúng.`);
    }

    let existing = roles.find((item) => item.name === role.name);
    if (!existing) {
      const { id } = await admin.post(`${api}/tenant-roles`, {
        name: role.name,
        description: 'Tạo bởi tools/crm/seed-svn.mjs',
        permissionIds: [permission.id],
      });
      existing = { id };
      log.created(`Vai trò "${role.name}".`);
    } else if (!sameSet(existing.permissionIds, [permission.id])) {
      await admin.patch(`${api}/tenant-roles/${existing.id}`, { name: role.name, permissionIds: [permission.id] });
      log.created(`Cập nhật vai trò "${role.name}".`);
    } else {
      log.skip(`Vai trò "${role.name}" đã đúng.`);
    }
    roleIds[key] = existing.id;
  }
  return roleIds;
}

async function ensureUsers(config, admin, roleIds, log) {
  const api = `${config.platformApi}/platform/v1`;
  const { users } = await admin.get(`${api}/tenant-users`);
  const userIds = {};
  for (const account of ACCOUNTS) {
    const email = accountEmail(config, account.code);
    let user = users.find((item) => item.email?.toLowerCase() === email);
    if (!user) {
      ({ user } = await admin.post(`${api}/tenant-users`, { fullName: account.fullName, email, password: config.password }));
      log.created(`Tài khoản ${email} (${account.fullName}).`);
    } else {
      log.skip(`Tài khoản ${email} đã có.`);
    }
    userIds[account.code] = user.id;
    const wanted = [roleIds[account.role]];
    const { roleIds: current } = await admin.get(`${api}/tenant-users/${user.id}/roles`);
    if (!sameSet(current ?? [], wanted)) {
      await admin.put(`${api}/tenant-users/${user.id}/roles`, { roleIds: wanted });
      log.created(`Gán vai trò "${ROLES[account.role].name}" cho ${email}.`);
    }
  }
  return userIds;
}

async function ensureOrganization(config, admin, userIds, log) {
  const api = `${config.platformApi}/platform/v1/tenant-organization`;
  let core = await admin.get(`${api}/core-snapshot`);

  let tree = core.trees.find((item) => item.isPrimary) ?? core.trees[0];
  if (!tree) {
    tree = await admin.post(`${api}/trees`, { code: 'SVN', name: `Sơ đồ tổ chức ${config.tenantName}`, isPrimary: true });
    log.created(`Sơ đồ tổ chức "${tree.name}".`);
  }
  const nodesInTree = () => core.nodes.filter((node) => node.treeId === tree.id);
  let root = nodesInTree().find((node) => !node.parentId);
  if (!root) {
    root = await admin.post(`${api}/nodes`, { treeId: tree.id, code: 'SVN-ROOT', name: config.tenantName, category: 'unit' });
    log.created(`Node gốc "${root.name}".`);
  }

  const findNode = (code) => nodesInTree().find((node) => node.code === code);
  const unitIds = {};
  for (const unit of UNITS) {
    let node = findNode(unit.code);
    if (!node) {
      node = await admin.post(`${api}/nodes`, { treeId: tree.id, parentId: root.id, code: unit.code, name: unit.name, category: 'unit' });
      log.created(`Đơn vị ${unit.code} "${unit.name}".`);
    } else log.skip(`Đơn vị ${unit.code} đã có.`);
    unitIds[unit.key] = node.id;
  }

  const positionIds = {};
  for (const position of POSITIONS) {
    let node = findNode(position.code);
    if (!node) {
      node = await admin.post(`${api}/nodes`, {
        treeId: tree.id,
        parentId: unitIds[position.unit],
        code: position.code,
        name: position.name,
        category: 'position',
      });
      log.created(`Chức danh ${position.code} "${position.name}".`);
    } else log.skip(`Chức danh ${position.code} đã có.`);
    positionIds[position.key] = node.id;
  }

  core = await admin.get(`${api}/core-snapshot`);
  for (const position of POSITIONS.filter((item) => item.head)) {
    const unitId = unitIds[position.unit];
    const unit = core.nodes.find((node) => node.id === unitId);
    if (unit?.headPositionId !== positionIds[position.key]) {
      await admin.patch(`${api}/nodes/${unitId}`, { headPositionId: positionIds[position.key] });
      log.created(`Đặt ${position.code} là chức danh trưởng đơn vị ${position.unit}.`);
    }
  }

  const snapshot = await admin.get(`${api}/snapshot`);
  for (const position of POSITIONS) {
    const target = position.reportsTo ? positionIds[position.reportsTo] : null;
    const current = snapshot.positions.find((item) => item.id === positionIds[position.key])?.reportsToPositionId ?? null;
    if (current === target) continue;
    await admin.put(`${api}/positions/${positionIds[position.key]}/reports-to`, { reportsToPositionId: target });
    log.created(`${position.code} báo cáo cho ${position.reportsTo ?? '(không)'}.`);
  }

  for (const account of ACCOUNTS) {
    const userId = userIds[account.code];
    const nodeId = positionIds[account.position];
    const assigned = core.assignments.some(
      (item) => item.userId === userId && item.nodeId === nodeId && item.status === 'active',
    );
    if (assigned) {
      log.skip(`${account.code} đã giữ chức danh ${account.position}.`);
      continue;
    }
    await admin.post(`${api}/assignments`, { nodeId, userId, isPrimary: true, note: 'seed-svn' });
    log.created(`Bổ nhiệm ${account.code} vào chức danh ${account.position}.`);
  }
  return { treeId: tree.id, unitIds, positionIds };
}

async function verify(config, tenantId, userIds, log) {
  const nv1 = await Session.login(config.platformApi, {
    email: accountEmail(config, 'NV1'),
    password: config.password,
    portal: 'tenant',
  });
  const status = await nv1.get(`${config.crmApi}/v1/status`);
  const caps = status.capabilities ?? {};
  log.info(`NV1 GET /crm/v1/status: canWriteOpportunity=${caps.canWriteOpportunity}, canReadAll=${caps.canReadAll}.`);
  if (caps.canWriteOpportunity !== true || caps.canReadAll !== false) {
    throw new Error(`Kiểm tra quyền NV1 sai: ${JSON.stringify(caps)}`);
  }

  const { data: context } = await request(
    'GET',
    `${config.platformApi}/platform/internal/v1/organization-contexts/${tenantId}`,
    { headers: { 'x-service-token': config.serviceToken } },
  );
  const reportsTo = new Map(
    [...(context.units ?? []), ...(context.positions ?? [])].map((node) => [node.id, node.reportsToPositionId ?? null]),
  );
  const tnUser = userIds.TN;
  const tnPositions = new Set(
    context.members.filter((m) => m.userId === tnUser).map((m) => m.positionId ?? m.unitId),
  );
  const subordinates = new Set();
  for (const member of context.members) {
    if (member.userId === tnUser) continue;
    let cursor = member.reportsToPositionOverrideId ?? reportsTo.get(member.positionId ?? member.unitId);
    const seen = new Set();
    while (cursor && !seen.has(cursor)) {
      if (tnPositions.has(cursor)) {
        subordinates.add(member.userId);
        break;
      }
      seen.add(cursor);
      cursor = reportsTo.get(cursor);
    }
  }
  const codeOf = new Map(Object.entries(userIds).map(([code, id]) => [id, code]));
  const names = [...subordinates].map((id) => codeOf.get(id) ?? id).sort();
  log.info(`Cấp dưới của TN theo organization-context: ${names.join(', ') || '(không có)'}.`);
  if (names.join(',') !== 'NV1,NV2') throw new Error(`Cấp dưới của TN phải là NV1, NV2; nhận được ${names.join(', ')}.`);
}

export async function runTenantStep(config, log) {
  log.section(`Bước tenant cho ${config.tenantSlug}`);
  const platform = await loginPlatformAdmin(config);
  const tenant = await ensureTenant(config, platform, log);
  await ensureEntitlements(config, platform, tenant.id, log);

  const admin = await loginTenantAdmin(config);
  const roleIds = await ensureRoles(config, admin, log);
  const userIds = await ensureUsers(config, admin, roleIds, log);
  await ensureOrganization(config, admin, userIds, log);
  await verify(config, tenant.id, userIds, log);
  log.info(`Xong bước tenant. Tenant id ${tenant.id}.`);
}
