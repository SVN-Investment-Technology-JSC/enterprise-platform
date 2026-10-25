import { randomUUID } from 'node:crypto';
import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import {
  SOCIAL_MEDIA_LAYOUT_DEFAULT,
  type SocialMediaLayout,
  type SocialPostKind,
  type SocialReactionType,
} from '@enterprise-platform/contracts-social';
import type { Pool, PoolClient } from 'pg';
import type {
  AttachmentInsert,
  AttachmentRow,
  CommentInsert,
  CommentListQuery,
  CommentRow,
  FeedFilter,
  FeedQuery,
  OrphanAttachment,
  PostInsert,
  PostPatch,
  PostRelations,
  PostRow,
  ReactionSummaryRow,
  ReactorRow,
  SocialOutboxEvent,
  SocialStore,
  TopicRow,
} from '../application/social-store.port.js';
import { attachmentFailure } from './publishing-sql.js';
import {
  SocialCommentNotFoundError,
  SocialNotProvisionedError,
  SocialPostNotFoundError,
  SocialTopicNameTakenError,
  SocialTopicNotFoundError,
} from '../domain/social.error.js';

/** Thời điểm UTC dạng ISO giữ nguyên micro giây, để con trỏ phân trang không bỏ sót dòng cùng mili giây. */
function isoColumn(expression: string): string {
  return `to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

const POST_SELECT = `SELECT p.id, p.author_id, p.kind, p.title, p.body_html, p.topic_id, t.name AS topic_name,
       p.pinned, p.mentions_all, p.media_layout,
       ${isoColumn('p.published_at')} AS published_at,
       ${isoColumn('p.edited_at')} AS edited_at,
       (SELECT count(*) FROM social_schema.comments c
         WHERE c.post_id = p.id AND c.deleted_at IS NULL)::int AS comment_count
  FROM social_schema.posts p
  LEFT JOIN social_schema.topics t ON t.id = p.topic_id`;

const COMMENT_SELECT = `SELECT c.id, c.post_id, c.parent_id, c.author_id, c.body,
       ${isoColumn('c.created_at')} AS created_at,
       ${isoColumn('c.edited_at')} AS edited_at,
       (c.deleted_at IS NOT NULL) AS deleted,
       (SELECT count(*) FROM social_schema.comments r
         WHERE r.parent_id = c.id AND r.deleted_at IS NULL)::int AS reply_count
  FROM social_schema.comments c`;

export const ATTACHMENT_COLUMNS = `a.id, a.post_id, a.comment_id, a.uploaded_by, a.file_name, a.content_type, a.size_bytes,
       a.storage_key, (a.completed_at IS NOT NULL) AS completed, a.purpose, a.processing_status, a.processing_error,
       a.source_key, a.poster_key, a.duration_ms, a.width, a.height`;

interface PostRecord {
  id: string;
  author_id: string;
  kind: SocialPostKind;
  title: string | null;
  body_html: string;
  topic_id: string | null;
  topic_name: string | null;
  pinned: boolean;
  mentions_all: boolean;
  media_layout: SocialMediaLayout;
  published_at: string;
  edited_at: string | null;
  comment_count: number;
}

interface CommentRecord {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  reply_count: number;
}

export interface AttachmentRecord {
  id: string;
  post_id: string | null;
  comment_id: string | null;
  uploaded_by: string;
  file_name: string;
  content_type: string;
  size_bytes: string | number;
  storage_key: string;
  completed: boolean;
  purpose: 'post' | 'comment';
  processing_status: AttachmentRow['processingStatus'];
  processing_error: string | null;
  source_key: string | null;
  poster_key: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
}

function mapPost(row: PostRecord): PostRow {
  return {
    id: row.id,
    authorId: row.author_id,
    kind: row.kind,
    ...(row.title ? { title: row.title } : {}),
    bodyHtml: row.body_html,
    ...(row.topic_id ? { topicId: row.topic_id, topicName: row.topic_name ?? '' } : {}),
    pinned: row.pinned,
    mentionsAll: row.mentions_all,
    mediaLayout: row.media_layout ?? SOCIAL_MEDIA_LAYOUT_DEFAULT,
    publishedAt: row.published_at,
    ...(row.edited_at ? { editedAt: row.edited_at } : {}),
    commentCount: row.comment_count,
  };
}

function mapComment(row: CommentRecord): CommentRow {
  return {
    id: row.id,
    postId: row.post_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at,
    ...(row.edited_at ? { editedAt: row.edited_at } : {}),
    deleted: row.deleted,
    replyCount: row.reply_count,
  };
}

export function mapAttachment(row: AttachmentRecord): AttachmentRow {
  return {
    id: row.id,
    ...(row.post_id ? { postId: row.post_id } : {}),
    ...(row.comment_id ? { commentId: row.comment_id } : {}),
    uploadedBy: row.uploaded_by,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key,
    completed: row.completed,
    purpose: row.purpose,
    processingStatus: row.processing_status,
    ...(row.processing_error ? { processingError: row.processing_error } : {}),
    ...(row.source_key ? { sourceKey: row.source_key } : {}),
    ...(row.poster_key ? { posterKey: row.poster_key } : {}),
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    ...(row.width !== null ? { width: row.width } : {}),
    ...(row.height !== null ? { height: row.height } : {}),
  };
}

/** Điều kiện lọc chung của bảng tin; trả mệnh đề `AND ...` và nối giá trị vào `values`. */
function filterClause(filter: FeedFilter, values: unknown[]): string {
  let clause = '';
  if (filter.topicId) {
    values.push(filter.topicId);
    clause += ` AND p.topic_id = $${values.length}`;
  }
  if (filter.kind) {
    values.push(filter.kind);
    clause += ` AND p.kind = $${values.length}`;
  }
  if (filter.authorId) {
    values.push(filter.authorId);
    clause += ` AND p.author_id = $${values.length}`;
  }
  return clause;
}

/**
 * Ghi sự kiện vào outbox bằng chính `client` của transaction đang mở: sự kiện
 * và thay đổi dữ liệu cùng commit hoặc cùng rollback (skill erp-events).
 */
export async function writeOutbox(client: PoolClient, tenantId: string, event: SocialOutboxEvent): Promise<void> {
  const id = randomUUID();
  const occurredAt = new Date().toISOString();
  const envelope = {
    id,
    type: event.type,
    version: 1,
    occurredAt,
    tenantId,
    source: 'social',
    correlationId: event.aggregateId,
    payload: event.payload,
  };
  await client.query(
    `INSERT INTO integration_schema.outbox_events
       (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [id, event.aggregateType, event.aggregateId, event.type, 1, JSON.stringify(envelope), occurredAt],
  );
}

async function writeOutboxAll(
  client: PoolClient,
  tenantId: string,
  events: readonly SocialOutboxEvent[],
): Promise<void> {
  for (const event of events) await writeOutbox(client, tenantId, event);
}

/**
 * Gắn tệp vào bài. Chỉ nhận tệp đã tải xong, không phải video `failed` (`queued`/`processing` gắn được) và hoặc đã thuộc bài này, hoặc
 * chưa gắn bài và do `uploaderId` tải; thiếu một tệp là lỗi cả thao tác. `position` là chỉ số trong `attachmentIds`.
 */
async function attachFiles(
  client: PoolClient,
  postId: string,
  attachmentIds: readonly string[],
  uploaderId: string,
): Promise<void> {
  if (attachmentIds.length === 0) return;
  const result = await client.query(
    `UPDATE social_schema.attachments a
        SET post_id = $1, position = o.ord::int - 1
       FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, ord)
      WHERE a.id = o.id
        AND a.completed_at IS NOT NULL
        AND a.processing_status <> 'failed'
        AND (a.post_id = $1 OR (a.post_id IS NULL AND a.comment_id IS NULL AND a.uploaded_by = $3))`,
    [postId, attachmentIds, uploaderId],
  );
  if (result.rowCount !== attachmentIds.length) throw await attachmentFailure(client, attachmentIds);
}

/**
 * Gắn tệp vào bình luận. Chỉ nhận tệp đã tải xong, không phải video `failed` (`queued`/`processing` gắn được) và hoặc đã thuộc bình
 * luận này, hoặc chưa gắn bài
 * lẫn bình luận nào và do `uploaderId` tải; thiếu một tệp là lỗi cả thao tác.
 */
async function attachToComment(
  client: PoolClient,
  commentId: string,
  attachmentIds: readonly string[],
  uploaderId: string,
): Promise<void> {
  if (attachmentIds.length === 0) return;
  const result = await client.query(
    `UPDATE social_schema.attachments
        SET comment_id = $1
      WHERE id = ANY($2::uuid[])
        AND completed_at IS NOT NULL
        AND processing_status <> 'failed'
        AND (comment_id = $1 OR (comment_id IS NULL AND post_id IS NULL AND uploaded_by = $3))`,
    [commentId, attachmentIds, uploaderId],
  );
  if (result.rowCount !== attachmentIds.length) throw await attachmentFailure(client, attachmentIds);
}

async function replacePostMentions(
  client: PoolClient,
  postId: string,
  userIds: readonly string[],
): Promise<void> {
  await client.query(`DELETE FROM social_schema.post_mentions WHERE post_id = $1`, [postId]);
  if (userIds.length === 0) return;
  await client.query(
    `INSERT INTO social_schema.post_mentions (post_id, user_id)
     SELECT $1, u FROM unnest($2::uuid[]) AS u
     ON CONFLICT DO NOTHING`,
    [postId, userIds],
  );
}

async function replaceCommentMentions(
  client: PoolClient,
  commentId: string,
  userIds: readonly string[],
): Promise<void> {
  await client.query(`DELETE FROM social_schema.comment_mentions WHERE comment_id = $1`, [commentId]);
  if (userIds.length === 0) return;
  await client.query(
    `INSERT INTO social_schema.comment_mentions (comment_id, user_id)
     SELECT $1, u FROM unnest($2::uuid[]) AS u
     ON CONFLICT DO NOTHING`,
    [commentId, userIds],
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/**
 * Store Postgres của phân hệ Mạng nội bộ, trên DB riêng của tenant (schema
 * `social_schema`). Mọi truy vấn tham số hoá; tên bảng và cột là chuỗi cố định
 * trong file này, không bao giờ lấy từ dữ liệu người dùng.
 */
export class PostgresSocialStore implements SocialStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  private poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  /** Bảng chưa có (`42P01`) hoặc schema chưa có (`3F000`) nghĩa là migration chưa chạy xong cho tenant này. */
  private async run<T>(tenantId: string, operation: (pool: Pool) => Promise<T>): Promise<T> {
    const pool = await this.poolFor(tenantId);
    try {
      return await operation(pool);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === '42P01' || code === '3F000') throw new SocialNotProvisionedError();
      throw error;
    }
  }

  readonly posts = {
    pinned: (tenantId: string, filter: FeedFilter, limit: number): Promise<PostRow[]> =>
      this.run(tenantId, async (pool) => {
        const values: unknown[] = [];
        const where = filterClause(filter, values);
        values.push(limit);
        const result = await pool.query<PostRecord>(
          `${POST_SELECT}
            WHERE p.status = 'published' AND p.pinned${where}
            ORDER BY p.published_at DESC, p.id DESC
            LIMIT $${values.length}`,
          values,
        );
        return result.rows.map(mapPost);
      }),

    feed: (tenantId: string, query: FeedQuery): Promise<PostRow[]> =>
      this.run(tenantId, async (pool) => {
        const values: unknown[] = [];
        let where = filterClause(query, values);
        if (query.cursor) {
          values.push(query.cursor.at, query.cursor.id);
          where += ` AND (p.published_at, p.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
        }
        values.push(query.limit);
        const result = await pool.query<PostRecord>(
          `${POST_SELECT}
            WHERE p.status = 'published' AND NOT p.pinned${where}
            ORDER BY p.published_at DESC, p.id DESC
            LIMIT $${values.length}`,
          values,
        );
        return result.rows.map(mapPost);
      }),

    findById: (tenantId: string, postId: string): Promise<PostRow | undefined> =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<PostRecord>(
          `${POST_SELECT} WHERE p.id = $1 AND p.status = 'published'`,
          [postId],
        );
        return result.rows[0] ? mapPost(result.rows[0]) : undefined;
      }),

    relations: (tenantId: string, postIds: readonly string[], viewerId: string): Promise<PostRelations> =>
      this.run(tenantId, async (pool) => {
        const mentions = new Map<string, string[]>();
        const attachments = new Map<string, AttachmentRow[]>();
        const reactions = new Map<string, ReactionSummaryRow>();
        if (postIds.length === 0) return { mentions, attachments, reactions };

        const [mentionRows, attachmentRows, countRows, mineRows] = await Promise.all([
          pool.query<{ post_id: string; user_id: string }>(
            `SELECT post_id, user_id FROM social_schema.post_mentions WHERE post_id = ANY($1::uuid[])`,
            [postIds],
          ),
          pool.query<AttachmentRecord>(
            `SELECT ${ATTACHMENT_COLUMNS}
               FROM social_schema.attachments a
              WHERE a.post_id = ANY($1::uuid[]) AND a.completed_at IS NOT NULL
              ORDER BY a.position, a.created_at, a.id`,
            [postIds],
          ),
          pool.query<{ post_id: string; type: SocialReactionType; n: number }>(
            `SELECT post_id, type, count(*)::int AS n
               FROM social_schema.post_reactions
              WHERE post_id = ANY($1::uuid[])
              GROUP BY post_id, type`,
            [postIds],
          ),
          pool.query<{ post_id: string; type: SocialReactionType }>(
            `SELECT post_id, type FROM social_schema.post_reactions
              WHERE post_id = ANY($1::uuid[]) AND user_id = $2`,
            [postIds, viewerId],
          ),
        ]);

        for (const row of mentionRows.rows) {
          mentions.set(row.post_id, [...(mentions.get(row.post_id) ?? []), row.user_id]);
        }
        for (const row of attachmentRows.rows) {
          const key = row.post_id as string;
          attachments.set(key, [...(attachments.get(key) ?? []), mapAttachment(row)]);
        }
        const mine = new Map(mineRows.rows.map((row) => [row.post_id, row.type]));
        const grouped = new Map<string, Partial<Record<SocialReactionType, number>>>();
        for (const row of countRows.rows) {
          grouped.set(row.post_id, { ...(grouped.get(row.post_id) ?? {}), [row.type]: row.n });
        }
        for (const postId of postIds) {
          const counts = grouped.get(postId) ?? {};
          const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
          const own = mine.get(postId);
          reactions.set(postId, { counts, total, ...(own ? { mine: own } : {}) });
        }
        return { mentions, attachments, reactions };
      }),

    insert: (tenantId: string, input: PostInsert): Promise<void> =>
      this.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          await client.query(
            `INSERT INTO social_schema.posts
               (id, author_id, kind, title, body_html, topic_id, pinned, mentions_all, media_layout)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              input.id,
              input.authorId,
              input.kind,
              input.title ?? null,
              input.bodyHtml,
              input.topicId ?? null,
              input.pinned,
              input.mentionsAll,
              input.mediaLayout ?? SOCIAL_MEDIA_LAYOUT_DEFAULT,
            ],
          );
          await replacePostMentions(client, input.id, input.mentionUserIds);
          await attachFiles(client, input.id, input.attachmentIds, input.uploaderId);
          await writeOutboxAll(client, tenantId, input.events);
        }),
      ),

    update: (tenantId: string, postId: string, patch: PostPatch): Promise<void> =>
      this.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          const assignments: string[] = [];
          const values: unknown[] = [postId];
          const set = (column: string, value: unknown) => {
            values.push(value);
            assignments.push(`${column} = $${values.length}`);
          };
          if (patch.title !== undefined) set('title', patch.title);
          if (patch.bodyHtml !== undefined) set('body_html', patch.bodyHtml);
          if (patch.topicId !== undefined) set('topic_id', patch.topicId);
          if (patch.mediaLayout !== undefined) set('media_layout', patch.mediaLayout);

          const result = await client.query(
            `UPDATE social_schema.posts
                SET ${[...assignments, 'edited_at = now()', 'updated_at = now()'].join(', ')}
              WHERE id = $1 AND status = 'published'`,
            values,
          );
          if (result.rowCount === 0) throw new SocialPostNotFoundError();

          if (patch.mentionUserIds !== undefined) {
            await replacePostMentions(client, postId, patch.mentionUserIds);
          }
          if (patch.attachmentIds !== undefined) {
            // Gắn trước rồi mới gỡ: tệp đã thuộc bài này vẫn hợp lệ dù do người khác tải.
            await attachFiles(client, postId, patch.attachmentIds, patch.uploaderId);
            await client.query(
              `UPDATE social_schema.attachments
                  SET post_id = NULL
                WHERE post_id = $1 AND NOT (id = ANY($2::uuid[]))`,
              [postId, patch.attachmentIds],
            );
          }
          await writeOutboxAll(client, tenantId, patch.events);
        }),
      ),

    softDelete: (tenantId: string, postId: string, userId: string): Promise<void> =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query(
          `UPDATE social_schema.posts
              SET status = 'deleted', deleted_at = now(), deleted_by = $2, pinned = false, updated_at = now()
            WHERE id = $1 AND status = 'published'`,
          [postId, userId],
        );
        if (result.rowCount === 0) throw new SocialPostNotFoundError();
      }),

    setPinned: (tenantId: string, postId: string, pinned: boolean): Promise<void> =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query(
          `UPDATE social_schema.posts SET pinned = $2, updated_at = now()
            WHERE id = $1 AND status = 'published'`,
          [postId, pinned],
        );
        if (result.rowCount === 0) throw new SocialPostNotFoundError();
      }),
  };

  readonly reactions = {
    set: (tenantId: string, postId: string, userId: string, type: SocialReactionType): Promise<void> =>
      this.run(tenantId, async (pool) => {
        await pool.query(
          `INSERT INTO social_schema.post_reactions (post_id, user_id, type)
           VALUES ($1, $2, $3)
           ON CONFLICT (post_id, user_id)
           DO UPDATE SET type = EXCLUDED.type, reacted_at = now()`,
          [postId, userId, type],
        );
      }),

    remove: (tenantId: string, postId: string, userId: string): Promise<void> =>
      this.run(tenantId, async (pool) => {
        await pool.query(`DELETE FROM social_schema.post_reactions WHERE post_id = $1 AND user_id = $2`, [
          postId,
          userId,
        ]);
      }),

    summary: (tenantId: string, postId: string, viewerId: string): Promise<ReactionSummaryRow> =>
      this.run(tenantId, async (pool) => {
        const [counts, mine] = await Promise.all([
          pool.query<{ type: SocialReactionType; n: number }>(
            `SELECT type, count(*)::int AS n FROM social_schema.post_reactions
              WHERE post_id = $1 GROUP BY type`,
            [postId],
          ),
          pool.query<{ type: SocialReactionType }>(
            `SELECT type FROM social_schema.post_reactions WHERE post_id = $1 AND user_id = $2`,
            [postId, viewerId],
          ),
        ]);
        const byType: Partial<Record<SocialReactionType, number>> = {};
        for (const row of counts.rows) byType[row.type] = row.n;
        const total = counts.rows.reduce((sum, row) => sum + row.n, 0);
        const own = mine.rows[0]?.type;
        return { counts: byType, total, ...(own ? { mine: own } : {}) };
      }),

    list: (tenantId: string, postId: string, limit: number): Promise<ReactorRow[]> =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<{ user_id: string; type: SocialReactionType; reacted_at: string }>(
          `SELECT user_id, type, ${isoColumn('reacted_at')} AS reacted_at
             FROM social_schema.post_reactions
            WHERE post_id = $1
            ORDER BY reacted_at DESC, user_id
            LIMIT $2`,
          [postId, limit],
        );
        return result.rows.map((row) => ({ userId: row.user_id, type: row.type, reactedAt: row.reacted_at }));
      }),
  };

  readonly comments = {
    findById: (tenantId: string, commentId: string): Promise<CommentRow | undefined> =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<CommentRecord>(`${COMMENT_SELECT} WHERE c.id = $1`, [commentId]);
        return result.rows[0] ? mapComment(result.rows[0]) : undefined;
      }),

    list: (tenantId: string, query: CommentListQuery): Promise<CommentRow[]> =>
      this.run(tenantId, async (pool) => {
        const values: unknown[] = [];
        let where: string;
        if (query.parentId) {
          values.push(query.parentId);
          where = `c.parent_id = $1 AND c.deleted_at IS NULL`;
        } else {
          values.push(query.postId);
          // Bình luận gốc đã xoá vẫn hiện nếu còn trả lời, để chuỗi không mất chỗ bám.
          where = `c.post_id = $1 AND c.parent_id IS NULL AND (c.deleted_at IS NULL OR EXISTS (
                     SELECT 1 FROM social_schema.comments r
                      WHERE r.parent_id = c.id AND r.deleted_at IS NULL))`;
        }
        if (query.cursor) {
          values.push(query.cursor.at, query.cursor.id);
          where += ` AND (c.created_at, c.id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
        }
        values.push(query.limit);
        const result = await pool.query<CommentRecord>(
          `${COMMENT_SELECT}
            WHERE ${where}
            ORDER BY c.created_at, c.id
            LIMIT $${values.length}`,
          values,
        );
        return result.rows.map(mapComment);
      }),

    mentions: (
      tenantId: string,
      commentIds: readonly string[],
    ): Promise<ReadonlyMap<string, readonly string[]>> =>
      this.run(tenantId, async (pool) => {
        const map = new Map<string, string[]>();
        if (commentIds.length === 0) return map;
        const result = await pool.query<{ comment_id: string; user_id: string }>(
          `SELECT comment_id, user_id FROM social_schema.comment_mentions WHERE comment_id = ANY($1::uuid[])`,
          [commentIds],
        );
        for (const row of result.rows) {
          map.set(row.comment_id, [...(map.get(row.comment_id) ?? []), row.user_id]);
        }
        return map;
      }),

    insert: (tenantId: string, input: CommentInsert): Promise<void> =>
      this.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          await client.query(
            `INSERT INTO social_schema.comments (id, post_id, parent_id, author_id, body)
             VALUES ($1, $2, $3, $4, $5)`,
            [input.id, input.postId, input.parentId ?? null, input.authorId, input.body],
          );
          await replaceCommentMentions(client, input.id, input.mentionUserIds);
          await attachToComment(client, input.id, input.attachmentIds ?? [], input.authorId);
          await writeOutboxAll(client, tenantId, input.events);
        }),
      ),

    update: (
      tenantId: string,
      commentId: string,
      patch: {
        readonly body: string;
        readonly mentionUserIds: readonly string[];
        readonly attachmentIds?: readonly string[];
        readonly uploaderId?: string;
        readonly events: readonly SocialOutboxEvent[];
      },
    ): Promise<void> =>
      this.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          const result = await client.query(
            `UPDATE social_schema.comments SET body = $2, edited_at = now()
              WHERE id = $1 AND deleted_at IS NULL`,
            [commentId, patch.body],
          );
          if (result.rowCount === 0) throw new SocialCommentNotFoundError();
          await replaceCommentMentions(client, commentId, patch.mentionUserIds);
          if (patch.attachmentIds && patch.uploaderId) {
            await attachToComment(client, commentId, patch.attachmentIds, patch.uploaderId);
          }
          await writeOutboxAll(client, tenantId, patch.events);
        }),
      ),

    softDelete: (tenantId: string, commentId: string, userId: string): Promise<void> =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query(
          `UPDATE social_schema.comments SET deleted_at = now(), deleted_by = $2
            WHERE id = $1 AND deleted_at IS NULL`,
          [commentId, userId],
        );
        if (result.rowCount === 0) throw new SocialCommentNotFoundError();
      }),
  };

  readonly topics = {
    list: (tenantId: string, includeInactive: boolean): Promise<TopicRow[]> =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<{ id: string; name: string; is_active: boolean; post_count: number }>(
          `SELECT t.id, t.name, t.is_active,
                  (SELECT count(*) FROM social_schema.posts p
                    WHERE p.topic_id = t.id AND p.status = 'published')::int AS post_count
             FROM social_schema.topics t
            WHERE ($1::boolean OR t.is_active)
            ORDER BY lower(t.name), t.id`,
          [includeInactive],
        );
        return result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          isActive: row.is_active,
          postCount: row.post_count,
        }));
      }),

    findById: (tenantId: string, topicId: string): Promise<TopicRow | undefined> =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<{ id: string; name: string; is_active: boolean; post_count: number }>(
          `SELECT t.id, t.name, t.is_active,
                  (SELECT count(*) FROM social_schema.posts p
                    WHERE p.topic_id = t.id AND p.status = 'published')::int AS post_count
             FROM social_schema.topics t
            WHERE t.id = $1`,
          [topicId],
        );
        const row = result.rows[0];
        return row
          ? { id: row.id, name: row.name, isActive: row.is_active, postCount: row.post_count }
          : undefined;
      }),

    insert: (tenantId: string, input: { id: string; name: string; createdBy: string }): Promise<void> =>
      this.run(tenantId, async (pool) => {
        try {
          await pool.query(`INSERT INTO social_schema.topics (id, name, created_by) VALUES ($1, $2, $3)`, [
            input.id,
            input.name,
            input.createdBy,
          ]);
        } catch (error) {
          if (isUniqueViolation(error)) throw new SocialTopicNameTakenError(input.name);
          throw error;
        }
      }),

    update: (
      tenantId: string,
      topicId: string,
      patch: { readonly name?: string; readonly isActive?: boolean },
    ): Promise<void> =>
      this.run(tenantId, async (pool) => {
        const assignments: string[] = [];
        const values: unknown[] = [topicId];
        if (patch.name !== undefined) {
          values.push(patch.name);
          assignments.push(`name = $${values.length}`);
        }
        if (patch.isActive !== undefined) {
          values.push(patch.isActive);
          assignments.push(`is_active = $${values.length}`);
        }
        if (assignments.length === 0) return;
        try {
          const result = await pool.query(
            `UPDATE social_schema.topics SET ${assignments.join(', ')}, updated_at = now() WHERE id = $1`,
            values,
          );
          if (result.rowCount === 0) throw new SocialTopicNotFoundError();
        } catch (error) {
          if (isUniqueViolation(error)) throw new SocialTopicNameTakenError(patch.name ?? '');
          throw error;
        }
      }),
  };

  readonly attachments = {
    insert: (tenantId: string, input: AttachmentInsert): Promise<void> =>
      this.run(tenantId, async (pool) => {
        await pool.query(
          `INSERT INTO social_schema.attachments
             (id, uploaded_by, file_name, content_type, size_bytes, storage_key, purpose)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [input.id, input.uploadedBy, input.fileName, input.contentType, input.sizeBytes, input.storageKey, input.purpose],
        );
      }),

    findById: (tenantId: string, attachmentId: string): Promise<AttachmentRow | undefined> =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<AttachmentRecord>(
          `SELECT ${ATTACHMENT_COLUMNS} FROM social_schema.attachments a WHERE a.id = $1`,
          [attachmentId],
        );
        return result.rows[0] ? mapAttachment(result.rows[0]) : undefined;
      }),

    markCompleted: (tenantId: string, attachmentId: string, sizeBytes: number): Promise<void> =>
      this.run(tenantId, async (pool) => {
        await pool.query(
          `UPDATE social_schema.attachments SET completed_at = now(), size_bytes = $2
            WHERE id = $1 AND completed_at IS NULL`,
          [attachmentId, sizeBytes],
        );
      }),

    setDimensions: (tenantId: string, attachmentId: string, width: number, height: number): Promise<void> =>
      this.run(tenantId, async (pool) => {
        await pool.query(
          `UPDATE social_schema.attachments SET width = $2, height = $3
            WHERE id = $1 AND width IS NULL AND height IS NULL`,
          [attachmentId, width, height],
        );
      }),

    listOrphans: (tenantId: string, olderThan: string, limit: number): Promise<OrphanAttachment[]> =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<{
          id: string;
          storage_key: string;
          poster_key: string | null;
          source_key: string | null;
          completed: boolean;
        }>(
          `SELECT id, storage_key, poster_key, source_key, (completed_at IS NOT NULL) AS completed
             FROM social_schema.attachments
            WHERE post_id IS NULL AND comment_id IS NULL AND created_at < $1::timestamptz
            ORDER BY created_at, id
            LIMIT $2`,
          [olderThan, limit],
        );
        return result.rows.map((row) => ({
          id: row.id,
          storageKey: row.storage_key,
          ...(row.poster_key ? { posterKey: row.poster_key } : {}),
          ...(row.source_key ? { sourceKey: row.source_key } : {}),
          completed: row.completed,
        }));
      }),

    deleteByIds: (tenantId: string, ids: readonly string[]): Promise<void> =>
      this.run(tenantId, async (pool) => {
        if (ids.length === 0) return;
        await pool.query(`DELETE FROM social_schema.attachments
            WHERE id = ANY($1::uuid[]) AND post_id IS NULL AND comment_id IS NULL`, [
          ids,
        ]);
      }),

    listForPost: (tenantId: string, postId: string): Promise<OrphanAttachment[]> =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<{
          id: string;
          storage_key: string;
          poster_key: string | null;
          source_key: string | null;
        }>(
          `SELECT id, storage_key, poster_key, source_key FROM social_schema.attachments
            WHERE post_id = $1
               OR comment_id IN (SELECT id FROM social_schema.comments WHERE post_id = $1)
            ORDER BY created_at, id`,
          [postId],
        );
        return result.rows.map((row) => ({
          id: row.id,
          storageKey: row.storage_key,
          ...(row.poster_key ? { posterKey: row.poster_key } : {}),
          ...(row.source_key ? { sourceKey: row.source_key } : {}),
        }));
      }),

    deleteAttachedByIds: (tenantId: string, ids: readonly string[]): Promise<void> =>
      this.run(tenantId, async (pool) => {
        if (ids.length === 0) return;
        await pool.query(`DELETE FROM social_schema.attachments WHERE id = ANY($1::uuid[])`, [ids]);
      }),

    countPending: (tenantId: string, uploaderId: string, sinceIso: string): Promise<number> =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<{ total: string }>(
          `SELECT count(*) AS total FROM social_schema.attachments
            WHERE uploaded_by = $1 AND completed_at IS NULL
              AND post_id IS NULL AND comment_id IS NULL
              AND created_at >= $2::timestamptz`,
          [uploaderId, sinceIso],
        );
        return Number(result.rows[0]?.total ?? 0);
      }),
  };
}
