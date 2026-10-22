import type { Pool } from 'pg';
import { PostgresRecipientDirectory } from './postgres-recipient-directory.js';

describe('PostgresRecipientDirectory.usersWithPermission', () => {
  it('includes users holding the action through role admin, role actions or direct grants', async () => {
    const query = jest.fn(async () => ({ rows: [{ id: 'u1' }, { id: 'u2' }] }));
    const directory = new PostgresRecipientDirectory({ query } as unknown as Pool);
    await expect(directory.usersWithPermission('core.users.update')).resolves.toEqual(['u1', 'u2']);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual(['core.users.update']);
    expect(sql).toContain("roles.key = 'tenant-admin'");
    expect(sql).toContain('permission_actions.action_key = $1');
    expect(sql).toContain('core_schema.user_permission_grants');
    expect(sql).toContain('grants.action_key = $1');
    expect(sql).toContain("users.status = 'active'");
    expect(sql).toContain('users.is_active = true');
  });
});

describe('PostgresRecipientDirectory.allActiveUsers', () => {
  it('lists only active users', async () => {
    const query = jest.fn(async () => ({ rows: [{ id: 'u1' }, { id: 'u2' }] }));
    const directory = new PostgresRecipientDirectory({ query } as unknown as Pool);
    await expect(directory.allActiveUsers()).resolves.toEqual(['u1', 'u2']);
    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain('is_active = true');
  });
});
