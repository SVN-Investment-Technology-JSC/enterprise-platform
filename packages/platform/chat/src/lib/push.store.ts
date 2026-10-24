import type { ChatDb } from './chat.store.js';

/** Mỗi người tối đa ngần này trình duyệt nhận push; đăng ký mới hơn đẩy đăng ký cũ nhất ra. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;
/** Gửi lỗi liên tiếp ngần này lần (không phải 404/410) thì coi đăng ký là hỏng và xoá. */
export const MAX_PUSH_FAILURES = 20;

export interface PushSubscriptionRecord {
  readonly id: string;
  readonly userId: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/**
 * Lưu đăng ký của một trình duyệt cho người dùng. Endpoint đã thuộc người khác (đăng nhập người khác trên cùng trình
 * duyệt) thì chuyển sang người mới: một trình duyệt chỉ nhận tin của người đang dùng nó.
 */
export async function saveSubscription(
  db: ChatDb,
  input: { readonly userId: string; readonly endpoint: string; readonly p256dh: string; readonly auth: string; readonly userAgent: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO core_schema.web_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent, updated_at = now(), failure_count = 0`,
    [input.userId, input.endpoint, input.p256dh, input.auth, input.userAgent],
  );
  await db.query(
    `DELETE FROM core_schema.web_push_subscriptions
      WHERE user_id = $1 AND id NOT IN (
        SELECT id FROM core_schema.web_push_subscriptions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2)`,
    [input.userId, MAX_PUSH_SUBSCRIPTIONS_PER_USER],
  );
}

/** Chỉ xoá được đăng ký của chính mình. */
export async function deleteSubscription(db: ChatDb, userId: string, endpoint: string): Promise<boolean> {
  const result = await db.query(`DELETE FROM core_schema.web_push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [userId, endpoint]);
  return (result.rowCount ?? 0) > 0;
}

/** Đăng ký của những người nhận còn đang hoạt động. */
export async function subscriptionsOf(db: ChatDb, userIds: readonly string[]): Promise<PushSubscriptionRecord[]> {
  if (userIds.length === 0) return [];
  const result = await db.query<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth
       FROM core_schema.web_push_subscriptions s
       JOIN core_schema.users u ON u.id = s.user_id AND u.status = 'active' AND u.is_active
      WHERE s.user_id = ANY($1::uuid[])`,
    [userIds],
  );
  return result.rows.map((row) => ({ id: row.id, userId: row.user_id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }));
}

export async function markSent(db: ChatDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.query(
    `UPDATE core_schema.web_push_subscriptions SET last_success_at = now(), failure_count = 0 WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

export async function removeSubscriptions(db: ChatDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.query(`DELETE FROM core_schema.web_push_subscriptions WHERE id = ANY($1::uuid[])`, [ids]);
}

/** Tăng số lần lỗi; quá ngưỡng thì xoá. */
export async function markFailed(db: ChatDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.query(`UPDATE core_schema.web_push_subscriptions SET failure_count = failure_count + 1 WHERE id = ANY($1::uuid[])`, [ids]);
  await db.query(`DELETE FROM core_schema.web_push_subscriptions WHERE id = ANY($1::uuid[]) AND failure_count >= $2`, [ids, MAX_PUSH_FAILURES]);
}
