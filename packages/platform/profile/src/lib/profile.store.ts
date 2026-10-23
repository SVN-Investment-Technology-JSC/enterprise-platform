import type { ChatPerson, MyProfile } from '@enterprise-platform/contracts-chat';
import type { PoolClient } from 'pg';

/** Phần của `pg` mà kho cần: chạy được cả trên pool lẫn client trong giao dịch. */
export type ProfileDb = Pick<PoolClient, 'query'>;

interface PersonRow {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_key: string | null;
  avatar_version: number | null;
}

/** Người dùng đang hoạt động: cùng điều kiện mà các phân hệ dùng (`status='active' AND is_active`). */
const ACTIVE_USER = `u.status = 'active' AND u.is_active`;

function person(row: PersonRow): ChatPerson {
  return {
    id: row.id,
    fullName: row.full_name?.trim() || row.email || 'Người dùng',
    email: row.email ?? '',
    avatarVersion: row.avatar_key ? Number(row.avatar_version ?? 0) : null,
  };
}

export async function listPeople(db: ProfileDb): Promise<ChatPerson[]> {
  const result = await db.query<PersonRow>(
    `SELECT u.id, u.full_name, u.email, p.avatar_key, p.avatar_version
       FROM core_schema.users u
       LEFT JOIN core_schema.user_profiles p ON p.user_id = u.id
      WHERE ${ACTIVE_USER}
      ORDER BY lower(u.full_name), u.id`,
  );
  return result.rows.map(person);
}

export async function loadProfile(db: ProfileDb, userId: string): Promise<MyProfile | null> {
  const result = await db.query<PersonRow>(
    `SELECT u.id, u.full_name, u.email, p.avatar_key, p.avatar_version
       FROM core_schema.users u
       LEFT JOIN core_schema.user_profiles p ON p.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const view = person(row);
  return { userId: view.id, fullName: view.fullName, email: view.email, avatarVersion: view.avatarVersion };
}

export interface StoredAvatar {
  readonly key: string;
  readonly contentType: string;
  readonly version: number;
}

/** Ảnh hiện tại của một người (kể cả người đã nghỉ, để tin nhắn cũ vẫn hiện đúng ảnh). */
export async function loadAvatar(db: ProfileDb, userId: string): Promise<StoredAvatar | null> {
  const result = await db.query<{ avatar_key: string | null; avatar_content_type: string | null; avatar_version: number }>(
    `SELECT avatar_key, avatar_content_type, avatar_version FROM core_schema.user_profiles WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row?.avatar_key || !row.avatar_content_type) return null;
  return { key: row.avatar_key, contentType: row.avatar_content_type, version: Number(row.avatar_version) };
}

/**
 * Ghi ảnh mới (hoặc gỡ ảnh khi `next` là null), khoá dòng hồ sơ để hai lần đổi cùng lúc không lệch phiên bản.
 * Trả khoá ảnh cũ để xoá khỏi kho sau khi giao dịch xong.
 */
export async function replaceAvatar(
  db: ProfileDb,
  userId: string,
  next: { readonly key: string; readonly contentType: string; readonly sizeBytes: number } | null,
): Promise<{ readonly previousKey: string | null; readonly version: number }> {
  await db.query(
    `INSERT INTO core_schema.user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  const current = await db.query<{ avatar_key: string | null; avatar_version: number }>(
    `SELECT avatar_key, avatar_version FROM core_schema.user_profiles WHERE user_id = $1 FOR UPDATE`,
    [userId],
  );
  const previousKey = current.rows[0]?.avatar_key ?? null;
  if (!next && !previousKey) return { previousKey: null, version: Number(current.rows[0]?.avatar_version ?? 0) };
  const updated = await db.query<{ avatar_version: number }>(
    `UPDATE core_schema.user_profiles
        SET avatar_key = $2, avatar_content_type = $3, avatar_size_bytes = $4,
            avatar_version = avatar_version + 1, avatar_updated_at = now(), updated_at = now()
      WHERE user_id = $1
      RETURNING avatar_version`,
    [userId, next?.key ?? null, next?.contentType ?? null, next?.sizeBytes ?? null],
  );
  return { previousKey, version: Number(updated.rows[0].avatar_version) };
}

/** Sự kiện đổi ảnh đại diện vào outbox của tenant, cùng giao dịch với thay đổi (Mạng nội bộ nghe sự kiện này). */
export async function writeOutboxEvent(
  db: ProfileDb,
  event: { readonly id: string; readonly type: string; readonly aggregateType: string; readonly aggregateId: string; readonly occurredAt: string },
  envelope: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO integration_schema.outbox_events
       (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6)`,
    [event.id, event.aggregateType, event.aggregateId, event.type, JSON.stringify(envelope), event.occurredAt],
  );
}
