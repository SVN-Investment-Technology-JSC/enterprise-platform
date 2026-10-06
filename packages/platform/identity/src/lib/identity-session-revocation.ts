import { sessionRevokedEvent } from './identity-notification-events.js';

/** Lý do gắn vào `identity.session.revoked`; client dùng để quyết định có báo người dùng hay không. */
export type SessionRevocationReason =
  | 'logout'
  | 'user-deleted'
  | 'user-disabled'
  | 'password-reset';

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Ghi sự kiện thu hồi vào outbox để realtime-api ngắt socket của phiên đó. */
export async function appendSessionRevokedEvent(
  db: Queryable,
  input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly reason: SessionRevocationReason;
  },
): Promise<void> {
  const event = sessionRevokedEvent(input);
  await db.query(
    `INSERT INTO integration_schema.outbox_events
       (id, aggregate_type, aggregate_id, event_type, event_version,
        payload, occurred_at)
     VALUES ($1, 'identity-session', $2, $3, $4, $5::jsonb, $6)`,
    [
      event.id,
      input.sessionId,
      event.type,
      event.version,
      JSON.stringify(event),
      event.occurredAt,
    ],
  );
}

/**
 * Thu hồi mọi phiên còn hiệu lực của một người dùng tenant và phát sự kiện cho từng phiên.
 * Chỉ ngắt kết nối; không tạo thông báo cho người dùng đó (xem notification-catalog).
 * Gọi bên trong transaction của người gọi để cập nhật phiên và sự kiện cùng thành công hoặc cùng huỷ.
 */
export async function revokeTenantUserSessions(
  db: Queryable,
  input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly reason: SessionRevocationReason;
  },
): Promise<number> {
  const revoked = await db.query(
    `UPDATE identity_schema.tenant_auth_sessions
        SET revoked_at = now()
      WHERE tenant_id = $1 AND core_user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [input.tenantId, input.userId],
  );
  for (const session of revoked.rows as { id: string }[]) {
    await appendSessionRevokedEvent(db, { ...input, sessionId: session.id });
  }
  return revoked.rows.length;
}
