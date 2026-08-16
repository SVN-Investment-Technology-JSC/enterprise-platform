import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';

describe('platform organization', () => {
  it('models organization data as Platform Core data', () => {
    const snapshot: TenantOrganizationSnapshot = {
      tenantId: 'tenant',
      generatedAt: new Date(0).toISOString(),
      unitTypes: [],
      units: [],
      positions: [],
      members: [],
      membershipSubjects: {},
    };
    expect(snapshot.tenantId).toBe('tenant');
  });
});
