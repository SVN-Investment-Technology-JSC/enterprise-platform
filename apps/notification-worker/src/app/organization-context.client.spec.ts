import { HttpOrganizationContext, OrganizationAwareRecipientDirectory } from './organization-context.client';

const organization = {
  units: [
    { id: 'unit-1', typeCategory: 'unit' },
    { id: 'head-1', typeCategory: 'position', parentId: 'unit-1' },
  ],
  members: [{ membershipId: 'm1', userId: 'user-head', unitId: 'head-1', isHead: true }],
  membershipSubjects: { m1: { organizationUnitIds: ['head-1'], positionIds: ['head-1'] } },
};

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe('HttpOrganizationContext', () => {
  it('sends the service token and caches the organization briefly per tenant', async () => {
    let now = 1_000;
    const fetcher = jest.fn().mockResolvedValue(response(organization));
    const client = new HttpOrganizationContext('http://core/org', 'token', fetcher, 30_000, 5_000, () => now);

    await client.load('tenant/1');
    await client.load('tenant/1');

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('http://core/org/tenant%2F1', expect.objectContaining({
      headers: { 'x-service-token': 'token' },
    }));

    now += 31_000;
    await client.load('tenant/1');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('throws when Tenant Core fails so the message is retried instead of losing recipients', async () => {
    const fetcher = jest.fn().mockResolvedValue(response({}, false, 503));
    const client = new HttpOrganizationContext('http://core/org', 'token', fetcher);

    await expect(client.load('tenant-1')).rejects.toThrow('returned 503');
  });
});

describe('OrganizationAwareRecipientDirectory', () => {
  const base = {
    activeUsers: jest.fn(async (ids: readonly string[]) => ids),
    usersWithPermission: jest.fn(async () => ['user-admin']),
  };

  it('resolves unit assignments through the organization of its tenant', async () => {
    const load = jest.fn().mockResolvedValue(organization);
    const directory = new OrganizationAwareRecipientDirectory(base, 'tenant-1', { load });

    await expect(
      directory.usersForProcedureAssignments([{ subjectType: 'organization_unit', subjectId: 'unit-1', role: 'A' }]),
    ).resolves.toEqual(['user-head']);
    expect(load).toHaveBeenCalledWith('tenant-1');
  });

  it('does not call Tenant Core when every assignment is already a user', async () => {
    const load = jest.fn();
    const directory = new OrganizationAwareRecipientDirectory(base, 'tenant-1', { load });

    await expect(
      directory.usersForProcedureAssignments([{ subjectType: 'user', subjectId: 'user-1', role: 'A' }]),
    ).resolves.toEqual(['user-1']);
    expect(load).not.toHaveBeenCalled();
    await expect(directory.usersWithPermission('x')).resolves.toEqual(['user-admin']);
  });
});
