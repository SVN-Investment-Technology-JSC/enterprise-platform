import { revokeTenantUserSessions } from './identity-session-revocation.js';

const TENANT = '80000000-0000-4000-8000-000000000001';
const USER = '80000000-0000-4000-8000-000000000002';

function fakeDb(sessionIds: readonly string[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  return {
    calls,
    query: jest.fn(async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return { rows: text.includes('UPDATE identity_schema.tenant_auth_sessions') ? sessionIds.map((id) => ({ id })) : [] };
    }),
  };
}

describe('revokeTenantUserSessions', () => {
  it('writes one session-revoked event per revoked session', async () => {
    const db = fakeDb(['s1', 's2']);

    const count = await revokeTenantUserSessions(db, { tenantId: TENANT, userId: USER, reason: 'user-deleted' });

    expect(count).toBe(2);
    const inserts = db.calls.filter((call) => call.text.includes('INSERT INTO integration_schema.outbox_events'));
    expect(inserts).toHaveLength(2);
    expect(inserts.map((call) => call.values[1])).toEqual(['s1', 's2']);
    const payload = JSON.parse(String(inserts[0].values[4])) as { type: string; payload: Record<string, unknown> };
    expect(payload.type).toBe('identity.session.revoked');
    expect(payload.payload).toMatchObject({ userId: USER, sessionId: 's1', reason: 'user-deleted' });
  });

  it('only touches the given tenant and user, and only live sessions', async () => {
    const db = fakeDb([]);

    await revokeTenantUserSessions(db, { tenantId: TENANT, userId: USER, reason: 'password-reset' });

    expect(db.calls[0].text).toContain('revoked_at IS NULL');
    expect(db.calls[0].values).toEqual([TENANT, USER, null]);
  });

  it('keeps the excepted session alive', async () => {
    const db = fakeDb(['s2']);
    const current = '80000000-0000-4000-8000-000000000003';

    await revokeTenantUserSessions(db, { tenantId: TENANT, userId: USER, reason: 'password-changed', exceptSessionId: current });

    expect(db.calls[0].text).toContain('id <> $3::uuid');
    expect(db.calls[0].values).toEqual([TENANT, USER, current]);
  });

  it('emits nothing when the user has no live session', async () => {
    const db = fakeDb([]);

    expect(await revokeTenantUserSessions(db, { tenantId: TENANT, userId: USER, reason: 'user-disabled' })).toBe(0);
    expect(db.calls).toHaveLength(1);
  });
});
