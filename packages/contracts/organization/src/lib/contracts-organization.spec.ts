import type { TenantOrganizationSnapshot } from './contracts-organization.js';

describe('organization contracts', () => {
  it('supports membership subject expansion', () => {
    const snapshot: TenantOrganizationSnapshot = {
      tenantId: 'tenant-1',
      generatedAt: new Date(0).toISOString(),
      unitTypes: [],
      units: [],
      positions: [],
      members: [],
      membershipSubjects: {
        membership: { organizationUnitIds: ['unit'], positionIds: ['position'] },
      },
    };
    expect(snapshot.membershipSubjects.membership?.positionIds).toEqual([
      'position',
    ]);
  });
});

