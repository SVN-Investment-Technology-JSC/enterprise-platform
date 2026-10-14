import {
  TENANT_ACTION_IMPLIES,
  TENANT_PERMISSION_ACTIONS,
  expandTenantActions,
  tenantActionHeld,
  tenantModulePermissions,
} from '@enterprise-platform/contracts-identity';

describe('luật manage bao hàm quyền hẹp', () => {
  const catalog = new Set<string>(TENANT_PERMISSION_ACTIONS.map((a) => a.key));

  it('mọi action trong bảng bao hàm đều có trong catalog', () => {
    for (const [manager, implied] of Object.entries(TENANT_ACTION_IMPLIES)) {
      expect(catalog.has(manager)).toBe(true);
      for (const key of implied) expect(catalog.has(key)).toBe(true);
    }
  });

  it('expandTenantActions và tenantActionHeld cho cùng kết quả', () => {
    for (const [manager, implied] of Object.entries(TENANT_ACTION_IMPLIES)) {
      const effective = expandTenantActions([manager]);
      for (const key of implied) {
        expect(effective).toContain(key);
        expect(tenantActionHeld([manager], key)).toBe(true);
      }
    }
  });

  it('workspace.manage không kéo theo quyền xóa tài liệu', () => {
    expect(expandTenantActions(['workspace.manage'])).not.toContain(
      'workspace.document.delete',
    );
    expect(tenantActionHeld(['workspace.manage'], 'workspace.document.delete')).toBe(
      false,
    );
    expect(
      tenantActionHeld(['workspace.document.delete'], 'workspace.document.delete'),
    ).toBe(true);
  });

  it('quyền hẹp không kéo ngược lên manage', () => {
    expect(tenantActionHeld(['inventory.read'], 'inventory.manage')).toBe(false);
    expect(
      tenantActionHeld(['inventory.transaction.write'], 'inventory.read'),
    ).toBe(false);
  });
});

describe('tenantModulePermissions', () => {
  it('lấy action theo tiền tố của module, gồm cả action mới thêm', () => {
    expect(tenantModulePermissions('inventory')).toEqual(
      expect.arrayContaining([
        'inventory.read',
        'inventory.stocktake.create',
        'inventory.stocktake.approve',
      ]),
    );
    expect(tenantModulePermissions('inventory')).not.toContain('module.access');
  });

  it('module có cổng vào thì nhận module.access', () => {
    for (const module of ['assistant', 'hrm', 'procedure-engine', 'workspace'])
      expect(tenantModulePermissions(module)).toContain('module.access');
    expect(tenantModulePermissions('assistant')).toEqual(['module.access']);
  });

  it('module lạ không có quyền nào', () => {
    expect(tenantModulePermissions('unknown')).toEqual([]);
  });
});
