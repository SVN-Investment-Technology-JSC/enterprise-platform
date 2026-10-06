import { sessionRevokedEvent } from './identity-notification-events.js';

describe('sessionRevokedEvent', () => {
  it('targets the tenant user and session room', () => {
    expect(
      sessionRevokedEvent({
        tenantId: '80000000-0000-4000-8000-000000000001',
        userId: '80000000-0000-4000-8000-000000000002',
        sessionId: '80000000-0000-4000-8000-000000000003',
        reason: 'logout',
      }),
    ).toMatchObject({
      type: 'identity.session.revoked',
      tenantId: '80000000-0000-4000-8000-000000000001',
      correlationId: '80000000-0000-4000-8000-000000000003',
      payload: {
        userId: '80000000-0000-4000-8000-000000000002',
        sessionId: '80000000-0000-4000-8000-000000000003',
        reason: 'logout',
      },
    });
  });
});
