import {
  CHAT_COMPANY_TITLE,
  isChatReaction,
  type ChatAttachmentView,
  type ChatConversationKind,
  type ChatConversationView,
  type ChatMemberView,
  type ChatMessagePreview,
  type ChatMessageView,
  type ChatReaction,
  type ChatReactionSummary,
  type ChatSystemEvent,
} from '@enterprise-platform/contracts-chat';
import type { PoolClient } from 'pg';

/** Phần của `pg` mà kho cần: chạy được cả trên pool lẫn client trong giao dịch. */
export type ChatDb = Pick<PoolClient, 'query'>;

/** Tin chưa đọc đếm tối đa tới đây (giao diện hiện "99+"), để danh sách không phải đếm hết lịch sử. */
const UNREAD_COUNT_CAP = 100;
const EXCERPT_LENGTH = 160;

const ACTIVE_USER = `u.status = 'active' AND u.is_active`;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

export function excerptOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
}

/* ------------------------------- Người dùng ------------------------------- */

export interface ChatUser {
  readonly id: string;
  readonly fullName: string;
}

/** Người dùng đang hoạt động trong số id cho trước (id lạ hoặc đã nghỉ bị bỏ). */
export async function activeUsers(db: ChatDb, userIds: readonly string[]): Promise<ChatUser[]> {
  if (userIds.length === 0) return [];
  const result = await db.query<{ id: string; full_name: string | null; email: string | null }>(
    `SELECT u.id, u.full_name, u.email FROM core_schema.users u WHERE u.id = ANY($1::uuid[]) AND ${ACTIVE_USER}`,
    [userIds],
  );
  return result.rows.map((row) => ({ id: row.id, fullName: row.full_name?.trim() || row.email || 'Người dùng' }));
}

export async function activeUserCount(db: ChatDb): Promise<number> {
  const result = await db.query<{ n: string }>(`SELECT count(*) AS n FROM core_schema.users u WHERE ${ACTIVE_USER}`);
  return Number(result.rows[0]?.n ?? 0);
}

/* ----------------------------- Cuộc trò chuyện ----------------------------- */

export interface ConversationRecord {
  readonly id: string;
  readonly kind: ChatConversationKind;
  readonly title: string | null;
  readonly createdAt: string;
  readonly lastMessageAt: string | null;
}

export interface MembershipRecord {
  readonly userId: string;
  readonly role: 'owner' | 'member';
  readonly joinedAt: string;
  readonly leftAt: string | null;
  readonly lastReadAt: string | null;
  readonly lastDeliveredAt: string | null;
  readonly muted: boolean;
}

interface ConversationRow {
  id: string;
  kind: ChatConversationKind;
  title: string | null;
  created_at: Date;
  last_message_at: Date | null;
}

function conversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    kind: row.kind,
    title: row.kind === 'company' ? CHAT_COMPANY_TITLE : row.title,
    createdAt: iso(row.created_at),
    lastMessageAt: isoOrNull(row.last_message_at),
  };
}

interface MemberRow {
  user_id: string;
  role: 'owner' | 'member';
  joined_at: Date;
  left_at: Date | null;
  last_read_at: Date | null;
  last_delivered_at: Date | null;
  muted: boolean;
}

function membership(row: MemberRow): MembershipRecord {
  return {
    userId: row.user_id,
    role: row.role,
    joinedAt: iso(row.joined_at),
    leftAt: isoOrNull(row.left_at),
    lastReadAt: isoOrNull(row.last_read_at),
    lastDeliveredAt: isoOrNull(row.last_delivered_at),
    muted: row.muted,
  };
}

export async function findConversation(db: ChatDb, id: string, lock = false): Promise<ConversationRecord | null> {
  const result = await db.query<ConversationRow>(
    `SELECT id, kind, title, created_at, last_message_at FROM chat_schema.conversations WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return result.rows[0] ? conversation(result.rows[0]) : null;
}

/** Cuộc trò chuyện chung toàn công ty; tạo lần đầu khi có người mở (an toàn khi hai người mở cùng lúc). */
export async function ensureCompanyConversation(db: ChatDb, actorId: string): Promise<ConversationRecord> {
  await db.query(
    `INSERT INTO chat_schema.conversations (kind, created_by) VALUES ('company', $1)
     ON CONFLICT ((kind)) WHERE kind = 'company' DO NOTHING`,
    [actorId],
  );
  const result = await db.query<ConversationRow>(
    `SELECT id, kind, title, created_at, last_message_at FROM chat_schema.conversations WHERE kind = 'company'`,
  );
  return conversation(result.rows[0]);
}

/** Chat 1-1 của một cặp; tạo nếu chưa có. Cả hai người là thành viên (không rời được). */
export async function ensureDirectConversation(
  db: ChatDb,
  directKey: string,
  actorId: string,
  peerId: string,
): Promise<ConversationRecord> {
  await db.query(
    `INSERT INTO chat_schema.conversations (kind, direct_key, created_by) VALUES ('direct', $1, $2)
     ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO NOTHING`,
    [directKey, actorId],
  );
  const result = await db.query<ConversationRow>(
    `SELECT id, kind, title, created_at, last_message_at FROM chat_schema.conversations WHERE direct_key = $1`,
    [directKey],
  );
  const record = conversation(result.rows[0]);
  await db.query(
    `INSERT INTO chat_schema.members (conversation_id, user_id, role)
     SELECT $1, unnest($2::uuid[]), 'member'
     ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL`,
    [record.id, [actorId, peerId]],
  );
  return record;
}

export async function createGroupConversation(
  db: ChatDb,
  title: string,
  ownerId: string,
  memberIds: readonly string[],
): Promise<ConversationRecord> {
  const result = await db.query<ConversationRow>(
    `INSERT INTO chat_schema.conversations (kind, title, created_by) VALUES ('group', $1, $2)
     RETURNING id, kind, title, created_at, last_message_at`,
    [title, ownerId],
  );
  const record = conversation(result.rows[0]);
  await db.query(
    `INSERT INTO chat_schema.members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [record.id, ownerId],
  );
  await addMembers(db, record.id, memberIds);
  return record;
}

/** Thêm (hoặc thêm lại người đã rời) vào nhóm; trả những người thật sự mới vào. */
export async function addMembers(db: ChatDb, conversationId: string, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const result = await db.query<{ user_id: string }>(
    `INSERT INTO chat_schema.members (conversation_id, user_id, role)
     SELECT $1, unnest($2::uuid[]), 'member'
     ON CONFLICT (conversation_id, user_id) DO UPDATE
       SET left_at = NULL, joined_at = now(), role = 'member'
       WHERE chat_schema.members.left_at IS NOT NULL
     RETURNING user_id`,
    [conversationId, userIds],
  );
  return result.rows.map((row) => row.user_id);
}

export async function membershipOf(db: ChatDb, conversationId: string, userId: string): Promise<MembershipRecord | null> {
  const result = await db.query<MemberRow>(
    `SELECT user_id, role, joined_at, left_at, last_read_at, last_delivered_at, muted
       FROM chat_schema.members WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId],
  );
  return result.rows[0] ? membership(result.rows[0]) : null;
}

/** Thành viên đang ở trong cuộc trò chuyện (cuộc chung toàn công ty: những ai đã từng mở). */
export async function activeMembers(db: ChatDb, conversationId: string): Promise<MembershipRecord[]> {
  const result = await db.query<MemberRow>(
    `SELECT user_id, role, joined_at, left_at, last_read_at, last_delivered_at, muted
       FROM chat_schema.members WHERE conversation_id = $1 AND left_at IS NULL
      ORDER BY joined_at, user_id`,
    [conversationId],
  );
  return result.rows.map(membership);
}

export async function setMemberLeft(db: ChatDb, conversationId: string, userId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE chat_schema.members SET left_at = now(), role = 'member'
      WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [conversationId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function setMemberRole(db: ChatDb, conversationId: string, userId: string, role: 'owner' | 'member'): Promise<void> {
  await db.query(`UPDATE chat_schema.members SET role = $3 WHERE conversation_id = $1 AND user_id = $2`, [conversationId, userId, role]);
}

/** Cuộc chung toàn công ty không có sẵn dòng thành viên: tạo khi người đó lần đầu đọc, tắt thông báo... */
export async function ensureMemberRow(db: ChatDb, conversationId: string, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO chat_schema.members (conversation_id, user_id, role) VALUES ($1, $2, 'member')
     ON CONFLICT (conversation_id, user_id) DO NOTHING`,
    [conversationId, userId],
  );
}

/**
 * Người nhận thông báo đẩy của một tin: thành viên đang trong cuộc (cuộc chung: mọi người đang hoạt động), trừ người
 * gửi và người đã tắt thông báo cuộc này; người được nhắc tên vẫn nhận dù đã tắt (như Zalo).
 */
export async function pushRecipients(
  db: ChatDb,
  conversation: { readonly id: string; readonly kind: ChatConversationKind },
  senderId: string,
  mentioned: readonly string[],
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    conversation.kind === 'company'
      ? `SELECT u.id FROM core_schema.users u
           LEFT JOIN chat_schema.members m ON m.conversation_id = $1 AND m.user_id = u.id
          WHERE ${ACTIVE_USER} AND u.id <> $2 AND (COALESCE(m.muted, false) = false OR u.id = ANY($3::uuid[]))`
      : `SELECT m.user_id AS id FROM chat_schema.members m
           JOIN core_schema.users u ON u.id = m.user_id AND ${ACTIVE_USER}
          WHERE m.conversation_id = $1 AND m.left_at IS NULL AND m.user_id <> $2
            AND (m.muted = false OR m.user_id = ANY($3::uuid[]))`,
    [conversation.id, senderId, mentioned],
  );
  return result.rows.map((row) => row.id);
}

export async function setMuted(db: ChatDb, conversationId: string, userId: string, muted: boolean): Promise<void> {
  await db.query(`UPDATE chat_schema.members SET muted = $3 WHERE conversation_id = $1 AND user_id = $2`, [conversationId, userId, muted]);
}

export async function setTitle(db: ChatDb, conversationId: string, title: string): Promise<void> {
  await db.query(`UPDATE chat_schema.conversations SET title = $2, updated_at = now() WHERE id = $1`, [conversationId, title]);
}

/**
 * Dời mốc đã đọc (và đã nhận) tới thời điểm của tin `messageId`; chỉ tiến, không lùi. Trả `true` khi mốc thật sự
 * đổi, để chỉ phát tín hiệu "đã xem" khi cần.
 */
export async function markRead(db: ChatDb, conversationId: string, userId: string, messageId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE chat_schema.members m
        SET last_read_at = msg.created_at,
            last_delivered_at = GREATEST(COALESCE(m.last_delivered_at, msg.created_at), msg.created_at)
       FROM chat_schema.messages msg
      WHERE msg.id = $3 AND msg.conversation_id = $1
        AND m.conversation_id = $1 AND m.user_id = $2
        AND (m.last_read_at IS NULL OR m.last_read_at < msg.created_at)`,
    [conversationId, userId, messageId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * "Đã nhận": dời mốc đã nhận của người dùng tới tin mới nhất ở mọi cuộc 1-1 và nhóm của họ (gọi khi trình duyệt của
 * họ tải danh sách). Trả các cuộc có mốc vừa tiến để báo cho người gửi.
 */
export async function markDelivered(db: ChatDb, userId: string): Promise<string[]> {
  const result = await db.query<{ conversation_id: string }>(
    `UPDATE chat_schema.members m
        SET last_delivered_at = c.last_message_at
       FROM chat_schema.conversations c
      WHERE m.conversation_id = c.id AND m.user_id = $1 AND m.left_at IS NULL
        AND c.kind <> 'company' AND c.last_message_at IS NOT NULL
        AND (m.last_delivered_at IS NULL OR m.last_delivered_at < c.last_message_at)
      RETURNING m.conversation_id`,
    [userId],
  );
  return result.rows.map((row) => row.conversation_id);
}

interface ListRow extends ConversationRow {
  role: 'owner' | 'member' | null;
  muted: boolean | null;
  member_ids: string[] | null;
  member_count: string;
  unread_count: string;
  unread_mentions: string;
  m_id: string | null;
  m_sender_id: string | null;
  m_kind: 'text' | 'system' | null;
  m_body: string | null;
  m_is_deleted: boolean | null;
  m_system_event: ChatSystemEvent | null;
  m_created_at: Date | null;
  m_attachments: string | null;
  m_has_image: boolean | null;
}

/**
 * Mọi cuộc trò chuyện của một người: cuộc chung toàn công ty cộng các cuộc 1-1 và nhóm đang tham gia, kèm tin mới
 * nhất, số tin chưa đọc (đếm tới `UNREAD_COUNT_CAP`) và số tin chưa đọc có nhắc tên mình.
 * Mốc tính chưa đọc khi chưa từng đọc: lúc vào nhóm, hoặc lúc tài khoản được tạo (cuộc chung).
 */
export async function listConversations(db: ChatDb, userId: string, conversationId?: string): Promise<ChatConversationView[]> {
  const result = await db.query<ListRow>(
    `WITH me AS (SELECT created_at FROM core_schema.users WHERE id = $1),
     mine AS (
       SELECT c.id, c.kind, c.title, c.created_at, c.last_message_at, m.role, m.muted,
              COALESCE(m.last_read_at, m.joined_at) AS read_mark
         FROM chat_schema.conversations c
         JOIN chat_schema.members m ON m.conversation_id = c.id AND m.user_id = $1 AND m.left_at IS NULL
        WHERE c.kind <> 'company'
       UNION ALL
       SELECT c.id, c.kind, c.title, c.created_at, c.last_message_at, NULL::varchar, m.muted,
              COALESCE(m.last_read_at, (SELECT created_at FROM me), c.created_at)
         FROM chat_schema.conversations c
         LEFT JOIN chat_schema.members m ON m.conversation_id = c.id AND m.user_id = $1
        WHERE c.kind = 'company'
     )
     SELECT mine.id, mine.kind, mine.title, mine.created_at, mine.last_message_at, mine.role, mine.muted,
            members.ids AS member_ids,
            CASE WHEN mine.kind = 'company'
                 THEN (SELECT count(*) FROM core_schema.users u WHERE ${ACTIVE_USER})
                 ELSE COALESCE(array_length(members.ids, 1), 0) END AS member_count,
            (SELECT count(*) FROM (
               SELECT 1 FROM chat_schema.messages x
                WHERE x.conversation_id = mine.id AND x.created_at > mine.read_mark AND x.sender_id <> $1
                  AND x.kind = 'text' AND NOT x.is_deleted
                LIMIT ${UNREAD_COUNT_CAP}) unread) AS unread_count,
            (SELECT count(*) FROM (
               SELECT 1 FROM chat_schema.messages x
                WHERE x.conversation_id = mine.id AND x.created_at > mine.read_mark AND x.sender_id <> $1
                  AND x.kind = 'text' AND NOT x.is_deleted AND $1 = ANY(x.mentions)
                LIMIT ${UNREAD_COUNT_CAP}) mentioned) AS unread_mentions,
            last.id AS m_id, last.sender_id AS m_sender_id, last.kind AS m_kind, last.body AS m_body,
            last.is_deleted AS m_is_deleted, last.system_event AS m_system_event, last.created_at AS m_created_at,
            (SELECT count(*) FROM chat_schema.attachments a WHERE a.message_id = last.id) AS m_attachments,
            (SELECT bool_or(a.is_image) FROM chat_schema.attachments a WHERE a.message_id = last.id) AS m_has_image
       FROM mine
       LEFT JOIN LATERAL (
         SELECT array_agg(mm.user_id ORDER BY mm.joined_at) AS ids
           FROM chat_schema.members mm
          WHERE mm.conversation_id = mine.id AND mm.left_at IS NULL AND mine.kind <> 'company'
       ) members ON true
       LEFT JOIN LATERAL (
         SELECT x.id, x.sender_id, x.kind, x.body, x.is_deleted, x.system_event, x.created_at
           FROM chat_schema.messages x
          WHERE x.conversation_id = mine.id
          ORDER BY x.created_at DESC, x.id DESC
          LIMIT 1
       ) last ON true
      WHERE ($2::uuid IS NULL OR mine.id = $2::uuid)
      ORDER BY (mine.kind = 'company') DESC, COALESCE(mine.last_message_at, mine.created_at) DESC, mine.id`,
    [userId, conversationId ?? null],
  );
  return result.rows.map((row) => conversationView(row, userId));
}

function conversationView(row: ListRow, userId: string): ChatConversationView {
  const memberIds = row.kind === 'company' ? [] : (row.member_ids ?? []);
  const lastMessage: ChatMessagePreview | null = row.m_id
    ? {
        id: row.m_id,
        senderId: row.m_sender_id as string,
        kind: row.m_kind ?? 'text',
        excerpt: row.m_is_deleted ? '' : excerptOf(row.m_body ?? ''),
        attachmentCount: row.m_is_deleted ? 0 : Number(row.m_attachments ?? 0),
        hasImage: !row.m_is_deleted && Boolean(row.m_has_image),
        isDeleted: Boolean(row.m_is_deleted),
        systemEvent: row.m_system_event ?? null,
        createdAt: iso(row.m_created_at),
      }
    : null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.kind === 'company' ? CHAT_COMPANY_TITLE : row.kind === 'group' ? row.title : null,
    peerUserId: row.kind === 'direct' ? (memberIds.find((id) => id.toLowerCase() !== userId.toLowerCase()) ?? null) : null,
    memberIds,
    memberCount: Number(row.member_count ?? 0),
    myRole: row.kind === 'company' ? null : (row.role ?? 'member'),
    muted: Boolean(row.muted),
    unreadCount: Number(row.unread_count ?? 0),
    unreadMentionCount: Number(row.unread_mentions ?? 0),
    lastMessage,
    lastMessageAt: isoOrNull(row.last_message_at),
    createdAt: iso(row.created_at),
  };
}

/* --------------------------------- Tin nhắn --------------------------------- */

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: 'text' | 'system';
  body: string;
  mentions: string[];
  reply_to_id: string | null;
  client_id: string | null;
  system_event: ChatSystemEvent | null;
  is_edited: boolean;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
  r_id: string | null;
  r_sender_id: string | null;
  r_body: string | null;
  r_is_deleted: boolean | null;
  r_attachments: string | null;
}

const MESSAGE_SELECT = `
  SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.body, m.mentions, m.reply_to_id, m.client_id,
         m.system_event, m.is_edited, m.is_deleted, m.created_at, m.updated_at,
         r.id AS r_id, r.sender_id AS r_sender_id, r.body AS r_body, r.is_deleted AS r_is_deleted,
         (SELECT count(*) FROM chat_schema.attachments ra WHERE ra.message_id = r.id) AS r_attachments
    FROM chat_schema.messages m
    LEFT JOIN chat_schema.messages r ON r.id = m.reply_to_id`;

export interface MessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly kind: 'text' | 'system';
  readonly body: string;
  readonly mentions: readonly string[];
  readonly isDeleted: boolean;
  readonly createdAt: string;
}

export async function findMessage(db: ChatDb, id: string, lock = false): Promise<MessageRecord | null> {
  const result = await db.query<MessageRow>(
    `SELECT id, conversation_id, sender_id, kind, body, mentions, is_deleted, created_at
       FROM chat_schema.messages WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    kind: row.kind,
    body: row.body,
    mentions: row.mentions ?? [],
    isDeleted: row.is_deleted,
    createdAt: iso(row.created_at),
  };
}

/** Một trang tin, mới nhất trước, `before` là id tin làm mốc (lấy các tin cũ hơn nó). Trả cả cờ còn trang cũ hơn. */
export async function listMessages(
  db: ChatDb,
  conversationId: string,
  before: string | null,
  limit: number,
): Promise<{ messages: ChatMessageView[]; hasMore: boolean }> {
  const result = await db.query<MessageRow>(
    `${MESSAGE_SELECT}
      WHERE m.conversation_id = $1
        AND ($2::uuid IS NULL OR (m.created_at, m.id) < (
              SELECT b.created_at, b.id FROM chat_schema.messages b WHERE b.id = $2::uuid AND b.conversation_id = $1))
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $3`,
    [conversationId, before, limit + 1],
  );
  const rows = result.rows.slice(0, limit).reverse();
  return { messages: await hydrate(db, rows), hasMore: result.rows.length > limit };
}

export async function loadMessageView(db: ChatDb, id: string): Promise<ChatMessageView | null> {
  const result = await db.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = $1`, [id]);
  const views = await hydrate(db, result.rows);
  return views[0] ?? null;
}

async function hydrate(db: ChatDb, rows: readonly MessageRow[]): Promise<ChatMessageView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [attachments, reactions] = await Promise.all([
    db.query<{ id: string; message_id: string; file_name: string; content_type: string; size_bytes: string; is_image: boolean }>(
      `SELECT id, message_id, file_name, content_type, size_bytes, is_image
         FROM chat_schema.attachments WHERE message_id = ANY($1::uuid[]) ORDER BY created_at, id`,
      [ids],
    ),
    db.query<{ message_id: string; reaction: string; user_ids: string[] }>(
      `SELECT message_id, reaction, array_agg(user_id ORDER BY created_at) AS user_ids
         FROM chat_schema.reactions WHERE message_id = ANY($1::uuid[])
        GROUP BY message_id, reaction`,
      [ids],
    ),
  ]);
  const filesOf = new Map<string, ChatAttachmentView[]>();
  for (const row of attachments.rows) {
    const list = filesOf.get(row.message_id) ?? [];
    list.push({ id: row.id, fileName: row.file_name, contentType: row.content_type, sizeBytes: Number(row.size_bytes), isImage: row.is_image });
    filesOf.set(row.message_id, list);
  }
  const reactionsOf = new Map<string, ChatReactionSummary[]>();
  for (const row of reactions.rows) {
    if (!isChatReaction(row.reaction)) continue;
    const list = reactionsOf.get(row.message_id) ?? [];
    list.push({ reaction: row.reaction, userIds: row.user_ids });
    reactionsOf.set(row.message_id, list);
  }
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    kind: row.kind,
    body: row.is_deleted ? '' : row.body,
    mentions: row.is_deleted ? [] : (row.mentions ?? []),
    replyTo: row.r_id
      ? {
          id: row.r_id,
          senderId: row.r_sender_id as string,
          excerpt: row.r_is_deleted ? '' : excerptOf(row.r_body ?? ''),
          isDeleted: Boolean(row.r_is_deleted),
          hasAttachments: !row.r_is_deleted && Number(row.r_attachments ?? 0) > 0,
        }
      : null,
    attachments: row.is_deleted ? [] : (filesOf.get(row.id) ?? []),
    reactions: row.is_deleted ? [] : (reactionsOf.get(row.id) ?? []),
    systemEvent: row.system_event ?? null,
    clientId: row.client_id,
    isEdited: row.is_edited,
    isDeleted: row.is_deleted,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }));
}

export async function findByClientId(db: ChatDb, conversationId: string, senderId: string, clientId: string): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM chat_schema.messages WHERE conversation_id = $1 AND sender_id = $2 AND client_id = $3`,
    [conversationId, senderId, clientId],
  );
  return result.rows[0]?.id ?? null;
}

export async function insertMessage(
  db: ChatDb,
  input: {
    readonly conversationId: string;
    readonly senderId: string;
    readonly kind: 'text' | 'system';
    readonly body: string;
    readonly mentions: readonly string[];
    readonly replyToId: string | null;
    readonly clientId: string | null;
    readonly systemEvent: ChatSystemEvent | null;
  },
): Promise<{ id: string; createdAt: string }> {
  const result = await db.query<{ id: string; created_at: Date }>(
    `INSERT INTO chat_schema.messages (conversation_id, sender_id, kind, body, mentions, reply_to_id, client_id, system_event)
     VALUES ($1, $2, $3, $4, $5::uuid[], $6, $7, $8::jsonb)
     RETURNING id, created_at`,
    [
      input.conversationId,
      input.senderId,
      input.kind,
      input.body,
      input.mentions,
      input.replyToId,
      input.clientId,
      input.systemEvent ? JSON.stringify(input.systemEvent) : null,
    ],
  );
  const row = result.rows[0];
  await db.query(
    `UPDATE chat_schema.conversations SET last_message_at = GREATEST(COALESCE(last_message_at, $2), $2), updated_at = now() WHERE id = $1`,
    [input.conversationId, row.created_at],
  );
  return { id: row.id, createdAt: iso(row.created_at) };
}

/** Người gửi coi như đã đọc và đã nhận tin của chính mình. */
export async function markOwnMessage(db: ChatDb, conversationId: string, userId: string, createdAt: string): Promise<void> {
  await db.query(
    `UPDATE chat_schema.members
        SET last_read_at = GREATEST(COALESCE(last_read_at, $3::timestamptz), $3::timestamptz),
            last_delivered_at = GREATEST(COALESCE(last_delivered_at, $3::timestamptz), $3::timestamptz)
      WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId, createdAt],
  );
}

export async function updateMessageBody(db: ChatDb, id: string, body: string, mentions: readonly string[]): Promise<void> {
  await db.query(
    `UPDATE chat_schema.messages SET body = $2, mentions = $3::uuid[], is_edited = true, updated_at = now() WHERE id = $1`,
    [id, body, mentions],
  );
}

/** Thu hồi: xoá hẳn nội dung, nhắc tên, cảm xúc và tệp đính kèm; trả khoá tệp để xoá khỏi kho sau giao dịch. */
export async function recallMessage(db: ChatDb, id: string): Promise<string[]> {
  await db.query(
    `UPDATE chat_schema.messages SET body = '', mentions = '{}', is_deleted = true, updated_at = now() WHERE id = $1`,
    [id],
  );
  await db.query(`DELETE FROM chat_schema.reactions WHERE message_id = $1`, [id]);
  const removed = await db.query<{ storage_key: string }>(
    `DELETE FROM chat_schema.attachments WHERE message_id = $1 RETURNING storage_key`,
    [id],
  );
  return removed.rows.map((row) => row.storage_key);
}

export async function setReaction(db: ChatDb, messageId: string, userId: string, reaction: ChatReaction | null): Promise<void> {
  if (reaction === null) {
    await db.query(`DELETE FROM chat_schema.reactions WHERE message_id = $1 AND user_id = $2`, [messageId, userId]);
    return;
  }
  await db.query(
    `INSERT INTO chat_schema.reactions (message_id, user_id, reaction) VALUES ($1, $2, $3)
     ON CONFLICT (message_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = now()`,
    [messageId, userId, reaction],
  );
}

/** Mốc đã đọc/đã nhận để hiện "đã nhận", "đã xem". Cuộc chung: những người đã đọc gần nhất (tối đa 200). */
export async function memberWatermarks(db: ChatDb, conversationId: string, kind: ChatConversationKind): Promise<ChatMemberView[]> {
  const result = await db.query<MemberRow>(
    kind === 'company'
      ? `SELECT user_id, role, joined_at, left_at, last_read_at, last_delivered_at, muted
           FROM chat_schema.members WHERE conversation_id = $1 AND last_read_at IS NOT NULL
          ORDER BY last_read_at DESC LIMIT 200`
      : `SELECT user_id, role, joined_at, left_at, last_read_at, last_delivered_at, muted
           FROM chat_schema.members WHERE conversation_id = $1 AND left_at IS NULL
          ORDER BY joined_at, user_id`,
    [conversationId],
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    role: row.role,
    lastReadAt: isoOrNull(row.last_read_at),
    lastDeliveredAt: isoOrNull(row.last_delivered_at),
  }));
}

/* ------------------------------- Tệp đính kèm ------------------------------- */

export interface AttachmentRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId: string | null;
  readonly uploadedBy: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly isImage: boolean;
  readonly completed: boolean;
  readonly messageDeleted: boolean;
}

export async function insertAttachment(
  db: ChatDb,
  input: {
    readonly id: string;
    readonly conversationId: string;
    readonly uploadedBy: string;
    readonly fileName: string;
    readonly contentType: string;
    readonly sizeBytes: number;
    readonly storageKey: string;
    readonly isImage: boolean;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO chat_schema.attachments (id, conversation_id, uploaded_by, file_name, content_type, size_bytes, storage_key, is_image)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.id, input.conversationId, input.uploadedBy, input.fileName, input.contentType, input.sizeBytes, input.storageKey, input.isImage],
  );
}

export async function findAttachment(db: ChatDb, id: string): Promise<AttachmentRecord | null> {
  const result = await db.query<{
    id: string;
    conversation_id: string;
    message_id: string | null;
    uploaded_by: string;
    file_name: string;
    content_type: string;
    size_bytes: string;
    storage_key: string;
    is_image: boolean;
    completed_at: Date | null;
    message_deleted: boolean | null;
  }>(
    `SELECT a.id, a.conversation_id, a.message_id, a.uploaded_by, a.file_name, a.content_type, a.size_bytes,
            a.storage_key, a.is_image, a.completed_at, m.is_deleted AS message_deleted
       FROM chat_schema.attachments a
       LEFT JOIN chat_schema.messages m ON m.id = a.message_id
      WHERE a.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    uploadedBy: row.uploaded_by,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key,
    isImage: row.is_image,
    completed: Boolean(row.completed_at),
    messageDeleted: Boolean(row.message_deleted),
  };
}

export async function completeAttachment(db: ChatDb, id: string): Promise<void> {
  await db.query(`UPDATE chat_schema.attachments SET completed_at = now() WHERE id = $1 AND completed_at IS NULL`, [id]);
}

/** Gắn các tệp đã tải lên (của chính người gửi, cùng cuộc, chưa gắn tin nào) vào tin; trả số tệp gắn được. */
export async function attachToMessage(
  db: ChatDb,
  input: { readonly messageId: string; readonly conversationId: string; readonly uploadedBy: string; readonly attachmentIds: readonly string[] },
): Promise<number> {
  if (input.attachmentIds.length === 0) return 0;
  const result = await db.query(
    `UPDATE chat_schema.attachments SET message_id = $1
      WHERE id = ANY($4::uuid[]) AND conversation_id = $2 AND uploaded_by = $3
        AND message_id IS NULL AND completed_at IS NOT NULL`,
    [input.messageId, input.conversationId, input.uploadedBy, input.attachmentIds],
  );
  return result.rowCount ?? 0;
}

/** Tệp tải lên mà không gửi kèm tin nào sau một ngày: xoá dòng, trả khoá để xoá khỏi kho. */
export async function takeStaleUploads(db: ChatDb, uploadedBy: string, olderThanHours = 24): Promise<string[]> {
  const result = await db.query<{ storage_key: string }>(
    `DELETE FROM chat_schema.attachments
      WHERE uploaded_by = $1 AND message_id IS NULL AND created_at < now() - make_interval(hours => $2)
      RETURNING storage_key`,
    [uploadedBy, olderThanHours],
  );
  return result.rows.map((row) => row.storage_key);
}
