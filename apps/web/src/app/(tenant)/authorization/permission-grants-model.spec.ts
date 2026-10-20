import {
  actionLock,
  buildRoleSections,
  buildRoleSources,
  buildUnassignedGroups,
  describeLock,
  diffGrants,
  GRANTABLE_ACTIONS,
  overlappingGrants,
  roleActionKeys,
  sameIds,
  summarizeRoles,
  toggleGrant,
  type GrantableAction,
} from './permission-grants-model';

const catalog: GrantableAction[] = [
  { key: 'inventory.read', label: 'Xem kho', group: 'Inventory' },
  { key: 'inventory.manage', label: 'Quản lý kho', group: 'Inventory' },
  { key: 'workspace.read', label: 'Xem workspace', group: 'Workspace' },
  { key: 'shared.read', label: 'Xem tài liệu', group: 'Hệ dùng chung' },
  { key: 'shared.document.delete', label: 'Xoá tài liệu', group: 'Hệ dùng chung' },
];

const permissions = [
  { id: 'p-inv', actionKeys: ['inventory.manage'] },
  { id: 'p-ws', actionKeys: ['workspace.read'] },
  { id: 'p-ws2', actionKeys: ['workspace.read', 'shared.read'] },
  { id: 'p-empty', actionKeys: [] },
];
const role = (id: string, key: string, permissionIds: string[]) => ({
  id,
  key,
  name: `Vai ${id}`,
  permissionIds,
});
const roles = [
  role('r1', 'inv', ['p-inv']),
  role('r2', 'ws-a', ['p-ws']),
  role('r3', 'ws-b', ['p-ws2']),
  role('r-admin', 'tenant-admin', []),
  role('r-empty', 'legacy-tenant-user', ['p-empty']),
];

describe('permission grants model', () => {
  it('danh mục cấp được không có tenant.manage hay ký tự đại diện', () => {
    expect(GRANTABLE_ACTIONS.length).toBeGreaterThan(0);
    expect(GRANTABLE_ACTIONS.some((a) => a.key === 'tenant.manage')).toBe(false);
    expect(GRANTABLE_ACTIONS.some((a) => a.key.includes('*'))).toBe(false);
  });

  it('lấy action của vai trò theo thứ tự danh mục và bỏ khóa ngoài danh mục', () => {
    expect(roleActionKeys(roles[2], permissions, catalog)).toEqual(['workspace.read', 'shared.read']);
    expect(roleActionKeys(roles[2], permissions, [catalog[3]])).toEqual(['shared.read']);
  });

  it('liệt kê mọi vai trò có action, bỏ tenant-admin và vai trò rỗng', () => {
    const sections = buildRoleSections(roles, permissions, catalog);
    expect(sections.map((s) => s.role.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('một action nằm ở nhiều vai trò vẫn xuất hiện ở từng vai trò', () => {
    const sections = buildRoleSections(roles, permissions, catalog);
    const holders = sections.filter((s) => s.actionKeys.includes('workspace.read'));
    expect(holders.map((s) => s.role.id)).toEqual(['r2', 'r3']);
  });

  it('khóa action đã có đích danh từ nhiều vai trò đang chọn', () => {
    const sources = buildRoleSources([roles[1], roles[2]], permissions);
    expect(actionLock('workspace.read', sources)).toEqual({
      kind: 'role',
      roleNames: ['Vai r2', 'Vai r3'],
    });
    expect(actionLock('shared.document.delete', sources)).toBeUndefined();
  });

  it('khóa action được bao hàm và nêu action bao hàm', () => {
    const sources = buildRoleSources([roles[0]], permissions);
    expect(actionLock('inventory.manage', sources)?.kind).toBe('role');
    const lock = actionLock('inventory.read', sources);
    expect(lock).toEqual({ kind: 'implied', byKeys: ['inventory.manage'], roleNames: ['Vai r1'] });
    if (!lock) throw new Error('thiếu khóa');
    expect(describeLock(lock, (k) => catalog.find((a) => a.key === k)?.label ?? k)).toBe(
      'Đã được bao hàm bởi Quản lý kho (vai trò Vai r1)',
    );
  });

  it('vai trò chưa gán thì không khóa gì', () => {
    const sources = buildRoleSources([], permissions);
    expect(actionLock('inventory.read', sources)).toBeUndefined();
  });

  it('action đích danh thắng action được bao hàm', () => {
    const extra = [{ id: 'p-both', actionKeys: ['inventory.manage', 'inventory.read'] }];
    const sources = buildRoleSources([role('r9', 'x', ['p-both'])], extra);
    expect(actionLock('inventory.read', sources)?.kind).toBe('role');
  });

  it('nhóm action chưa gắn vào vai trò nào theo group', () => {
    const groups = buildUnassignedGroups(roles, permissions, catalog);
    expect(groups).toEqual([
      { group: 'Inventory', actions: [catalog[0]] },
      { group: 'Hệ dùng chung', actions: [catalog[4]] },
    ]);
  });

  it('quyền bổ sung trùng với vai trò đang chọn bị đánh dấu trùng', () => {
    const sources = buildRoleSources([roles[0]], permissions);
    expect(overlappingGrants(['inventory.read', 'shared.document.delete', 'inventory.manage'], sources)).toEqual([
      'inventory.read',
      'inventory.manage',
    ]);
  });

  it('tính tập thay đổi và đổi chọn', () => {
    const draft = toggleGrant(toggleGrant(new Set(['a', 'b']), 'b'), 'c');
    expect([...draft].sort()).toEqual(['a', 'c']);
    expect(diffGrants(['a', 'b'], draft)).toEqual({ added: ['c'], removed: ['b'], changed: true });
    expect(diffGrants(['a'], ['a']).changed).toBe(false);
  });

  it('so sánh danh sách vai trò không kể thứ tự', () => {
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameIds(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('summarizeRoles', () => {
  const withModules = (r: ReturnType<typeof role>, moduleKeys: string[]) => ({ ...r, moduleKeys });

  it('gộp module và action không trùng từ các vai trò đang chọn', () => {
    const summary = summarizeRoles(
      [withModules(roles[1], ['workspace']), withModules(roles[2], ['workspace', 'shared'])],
      permissions,
    );
    expect(summary.admin).toBe(false);
    expect(summary.moduleKeys).toEqual(['workspace', 'shared']);
    expect(summary.actionKeys).toEqual(['workspace.read', 'shared.read']);
  });

  it('nhận ra tenant-admin và chưa chọn vai trò thì rỗng', () => {
    expect(summarizeRoles([withModules(roles[3], ['*'])], permissions).admin).toBe(true);
    expect(summarizeRoles([], permissions)).toEqual({ admin: false, moduleKeys: [], actionKeys: [] });
  });
});
