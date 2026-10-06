import { randomUUID } from 'node:crypto';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';

export function sessionRevokedEvent(input: {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly reason: string;
}) {
  return createIntegrationEvent({
    id: randomUUID(),
    type: 'identity.session.revoked',
    version: 1,
    tenantId: input.tenantId,
    source: 'platform-identity',
    correlationId: input.sessionId,
    payload: {
      userId: input.userId,
      sessionId: input.sessionId,
      reason: input.reason,
    },
  });
}
