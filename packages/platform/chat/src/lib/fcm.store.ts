import type { FcmPlatform } from '@enterprise-platform/contracts-chat';
import type { ChatDb } from './chat.store.js';

/** Mỗi người tối đa ngần này thiết bị nhận FCM; đăng ký mới hơn đẩy thiết bị cũ nhất ra. */
export const MAX_FCM_TOKENS_PER_USER = 10;
/** Gửi lỗi tạm thời liên tiếp ngần này lần thì coi token là hỏng và xoá. */
export const MAX_FCM_FAILURES = 20;

export interface FcmDeviceTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly token: string;
  readonly platform: FcmPlatform;
}

export async function fcmTableReady(db: ChatDb): Promise<boolean> {
  const result = await db.query<{ relation: string | null }>(
    `SELECT to_regclass('core_schema.fcm_device_tokens')::text AS relation`,
  );
  return Boolean(result.rows[0]?.relation);
}

/**
 * Lưu FCM token của thiết bị cho người đang đăng nhập.
 * - Nếu cùng `deviceId` trên cùng người dùng vừa đổi token mới, dọn bản ghi token cũ của thiết bị đó.
 * - Nếu token từng thuộc người khác trên cùng máy (đăng nhập tài khoản mới), chuyển chủ sang người mới.
 */
export async function saveFcmDeviceToken(
  db: ChatDb,
  input: {
    readonly userId: string;
    readonly sessionId: string | null;
    readonly token: string;
    readonly platform: FcmPlatform;
    readonly deviceId: string | null;
    readonly userAgent: string | null;
  },
): Promise<void> {
  if (input.deviceId) {
    await db.query(
      `DELETE FROM core_schema.fcm_device_tokens
        WHERE user_id = $1 AND platform = $2 AND device_id = $3 AND token <> $4`,
      [input.userId, input.platform, input.deviceId, input.token],
    );
  }
  await db.query(
    `INSERT INTO core_schema.fcm_device_tokens (user_id, session_id, token, platform, device_id, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           session_id = EXCLUDED.session_id,
           platform = EXCLUDED.platform,
           device_id = EXCLUDED.device_id,
           user_agent = EXCLUDED.user_agent,
           updated_at = now(),
           failure_count = 0`,
    [input.userId, input.sessionId, input.token, input.platform, input.deviceId, input.userAgent],
  );
  await db.query(
    `DELETE FROM core_schema.fcm_device_tokens
      WHERE user_id = $1 AND id NOT IN (
        SELECT id FROM core_schema.fcm_device_tokens WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2)`,
    [input.userId, MAX_FCM_TOKENS_PER_USER],
  );
}

/**
 * Xoá FCM token của chính người đang đăng nhập:
 * ưu tiên theo `token`, không có thì theo `deviceId`, bỏ trống cả hai thì xoá theo `sessionId` hiện tại.
 */
export async function deleteFcmDeviceToken(
  db: ChatDb,
  input: {
    readonly userId: string;
    readonly sessionId: string | null;
    readonly token?: string | null;
    readonly deviceId?: string | null;
  },
): Promise<number> {
  if (input.token) {
    const result = await db.query(
      `DELETE FROM core_schema.fcm_device_tokens WHERE user_id = $1 AND token = $2`,
      [input.userId, input.token],
    );
    return result.rowCount ?? 0;
  }
  if (input.deviceId) {
    const result = await db.query(
      `DELETE FROM core_schema.fcm_device_tokens WHERE user_id = $1 AND device_id = $2`,
      [input.userId, input.deviceId],
    );
    return result.rowCount ?? 0;
  }
  if (input.sessionId) {
    const result = await db.query(
      `DELETE FROM core_schema.fcm_device_tokens WHERE user_id = $1 AND session_id = $2`,
      [input.userId, input.sessionId],
    );
    return result.rowCount ?? 0;
  }
  return 0;
}

/** Dọn token khi phiên đăng nhập bị thu hồi (`identity.session.revoked`). */
export async function revokeFcmDeviceTokens(
  db: ChatDb,
  input: { readonly userId: string; readonly sessionId: string; readonly reason: string },
): Promise<number> {
  if (input.reason === 'user-deleted' || input.reason === 'user-disabled') {
    const result = await db.query(`DELETE FROM core_schema.fcm_device_tokens WHERE user_id = $1`, [input.userId]);
    return result.rowCount ?? 0;
  }
  const result = await db.query(
    `DELETE FROM core_schema.fcm_device_tokens WHERE user_id = $1 AND session_id = $2`,
    [input.userId, input.sessionId],
  );
  return result.rowCount ?? 0;
}

export async function countUserFcmTokens(db: ChatDb, userId: string): Promise<number> {
  if (!(await fcmTableReady(db))) return 0;
  const result = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM core_schema.fcm_device_tokens WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0]?.total ?? 0;
}

/** Danh sách FCM token của những người nhận đang hoạt động. */
export async function fcmTokensOf(db: ChatDb, userIds: readonly string[]): Promise<FcmDeviceTokenRecord[]> {
  if (userIds.length === 0) return [];
  const result = await db.query<{ id: string; user_id: string; token: string; platform: FcmPlatform }>(
    `SELECT t.id, t.user_id, t.token, t.platform
       FROM core_schema.fcm_device_tokens t
       JOIN core_schema.users u ON u.id = t.user_id AND u.status = 'active' AND u.is_active
      WHERE t.user_id = ANY($1::uuid[])`,
    [userIds],
  );
  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    token: row.token,
    platform: row.platform,
  }));
}

export async function markFcmSent(db: ChatDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.query(
    `UPDATE core_schema.fcm_device_tokens SET last_success_at = now(), failure_count = 0 WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

export async function removeFcmTokens(db: ChatDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.query(`DELETE FROM core_schema.fcm_device_tokens WHERE id = ANY($1::uuid[])`, [ids]);
}

export async function markFcmFailed(db: ChatDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.query(
    `UPDATE core_schema.fcm_device_tokens SET failure_count = failure_count + 1 WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  await db.query(
    `DELETE FROM core_schema.fcm_device_tokens WHERE id = ANY($1::uuid[]) AND failure_count >= $2`,
    [ids, MAX_FCM_FAILURES],
  );
}
