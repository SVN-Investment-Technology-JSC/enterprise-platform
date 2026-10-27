import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import { CrmOrganizationUnavailableError } from '../domain/crm.error.js';
import type { ReportingLineSnapshot } from '../domain/reporting-line.js';
import type { CrmActor } from './crm-actor.js';
import { CrmDataScopeService, scopeIncludes } from './data-scope.js';
import type { ReportingLineReader } from './organization-scope.port.js';

const SNAPSHOT: ReportingLineSnapshot = {
  positions: [
    { id: 'TP', reportsToPositionId: null },
    { id: 'NV', reportsToPositionId: 'TP' },
  ],
  assignments: [
    { userId: 'truong-nhom', positionId: 'TP' },
    { userId: 'nv-b', positionId: 'NV' },
    { userId: 'nv-a', positionId: 'NV' },
  ],
};

function actor(userId: string, over: Partial<CrmActor> = {}): CrmActor {
  return { ...CRM_NO_CAPABILITIES, tenantId: 't1', userId, displayName: userId, ...over };
}

function reader(result: ReportingLineSnapshot | Error) {
  const snapshot = jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { reader: { snapshot } satisfies ReportingLineReader, snapshot };
}

describe('CrmDataScopeService', () => {
  it.each([
    ['crm.read.all', { canReadAll: true }],
    ['crm.manage', { canManage: true }],
    ['quản trị tenant', { isTenantAdmin: true }],
  ])('%s thì thấy toàn bộ, không hỏi Tenant Core', async (_label, flags) => {
    const { reader: port, snapshot } = reader(new Error('không được gọi'));
    await expect(new CrmDataScopeService(port).resolve(actor('u', flags))).resolves.toEqual({ kind: 'all' });
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('người có cấp dưới thấy mình và nhóm', async () => {
    const { reader: port, snapshot } = reader(SNAPSHOT);
    await expect(new CrmDataScopeService(port).resolve(actor('truong-nhom'))).resolves.toEqual({
      kind: 'users',
      userIds: ['truong-nhom', 'nv-a', 'nv-b'],
    });
    expect(snapshot).toHaveBeenCalledWith('t1');
  });

  it('người không có cấp dưới chỉ thấy của mình', async () => {
    const { reader: port } = reader(SNAPSHOT);
    await expect(new CrmDataScopeService(port).resolve(actor('nv-a'))).resolves.toEqual({
      kind: 'users',
      userIds: ['nv-a'],
    });
  });

  it('Tenant Core lỗi thì 503, không mở rộng phạm vi', async () => {
    const { reader: port } = reader(new CrmOrganizationUnavailableError());
    await expect(new CrmDataScopeService(port).resolve(actor('nv-a'))).rejects.toMatchObject({
      statusCode: 503,
      code: 'ORGANIZATION_UNAVAILABLE',
    });
  });
});

describe('scopeIncludes', () => {
  it('toàn bộ thì gồm cả bản ghi chưa có người phụ trách', () => {
    expect(scopeIncludes({ kind: 'all' }, null)).toBe(true);
  });

  it('danh sách người thì chỉ gồm người trong danh sách', () => {
    const scope = { kind: 'users', userIds: ['a', 'b'] } as const;
    expect(scopeIncludes(scope, 'a')).toBe(true);
    expect(scopeIncludes(scope, 'c')).toBe(false);
    expect(scopeIncludes(scope, null)).toBe(false);
  });
});
