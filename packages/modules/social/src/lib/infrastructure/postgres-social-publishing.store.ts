import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import { SOCIAL_MEDIA_LAYOUT_DEFAULT, type SocialReactionType } from '@enterprise-platform/contracts-social';
import type { Pool, PoolClient } from 'pg';
import type {
  ExtendedPostRow,
  PollOptionRow,
  PollRow,
  PostAudienceRow,
  PostEngagementRelations,
  ReadConfirmationRow,
} from '../application/ports/post-read-model.js';
import type { PostVisibilityScope } from '../application/ports/post-visibility.port.js';
import type {
  BookmarkedPostRow,
  DueDecision,
  InboxCountsRow,
  PollVoterRow,
  PostListQuery,
  PostAudienceWrite,
  PostTransition,
  PublishingPostInsert,
  PublishingPostPatch,
  ReadConfirmationRecord,
  SocialPublishingStore,
  WritablePostRow,
} from '../application/social-publishing-store.port.js';
import type { SocialOutboxEvent } from '../application/social-store.port.js';
import { SocialPollClosedError, SocialPostStateError } from '../domain/social-publishing.error.js';
import {
  SocialNotProvisionedError,
  SocialPostNotFoundError,
  SocialValidationError,
} from '../domain/social.error.js';
import { postVisibilitySql } from './post-visibility-sql.js';
import {
  AUDIENCE_COLUMNS,
  EXTENDED_POST_COLUMNS,
  EXTENDED_POST_JOINS,
  EXTENDED_POST_SELECT,
  attachFiles,
  isoColumn,
  mapExtendedPost,
  replacePostMentions,
  writeOutboxAll,
  type AudienceRecord,
  type ExtendedPostRecord,
} from './publishing-sql.js';

/** Số bản cũ giữ lại trong `post_edits` cho mỗi bài. */
const POST_EDIT_KEEP = 50;

/** Thêm mệnh đề nhìn thấy bài vào truy vấn; tham số của nó nối vào cuối `values`. */
function visibilityClause(scope: PostVisibilityScope, values: unknown[]): string {
  const clause = postVisibilitySql(scope, { firstParam: values.length + 1 });
  values.push(...clause.params);
  return clause.sql;
}

interface PollRecord {
  id: string;
  post_id: string;
  question: string;
  allow_multiple: boolean;
  anonymous: boolean;
  closes_at: string | null;
  closed_at: string | null;
}

/**
 * Store Postgres của đường ghi bài trên DB riêng của tenant (schema `social_schema`). Mọi truy vấn
 * tham số hoá; tên bảng, cột là chuỗi cố định trong file này. Sự kiện ghi vào outbox cùng transaction.
 */
export class PostgresSocialPublishingStore implements SocialPublishingStore {
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

  findForWrite(tenantId: string, postId: string): Promise<WritablePostRow | undefined> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<ExtendedPostRecord & AudienceRecord>(
        `SELECT ${EXTENDED_POST_COLUMNS}, ${AUDIENCE_COLUMNS}
           FROM social_schema.posts p
           ${EXTENDED_POST_JOINS}
          WHERE p.id = $1 AND p.status <> 'deleted'`,
        [postId],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      return {
        ...mapExtendedPost(row),
        ...(row.audience_user_ids ? { audienceUserIds: row.audience_user_ids } : {}),
        ...(row.audience_unit_ids ? { audienceUnitIds: row.audience_unit_ids } : {}),
      };
    });
  }

  mentionsOf(tenantId: string, postId: string): Promise<readonly string[]> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM social_schema.post_mentions WHERE post_id = $1`,
        [postId],
      );
      return result.rows.map((row) => row.user_id);
    });
  }

  insert(tenantId: string, input: PublishingPostInsert): Promise<void> {
    return this.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        const marker = input.status === 'scheduled' && input.exemptFromApproval ? input.authorId : null;
        await client.query(
          `INSERT INTO social_schema.posts
             (id, author_id, kind, title, body_html, topic_id, group_id, pinned, mentions_all, status,
              published_at, scheduled_at, requires_read_confirmation, moderated_by, moderated_at,
              visibility, author_unit_id, comments_disabled, group_topic_id, media_layout)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   COALESCE($11::timestamptz, now()), $11::timestamptz, $12, $13::uuid,
                   CASE WHEN $13::uuid IS NULL THEN NULL ELSE now() END,
                   $14, $15::uuid, $16, $17::uuid, $18)`,
          [
            input.id,
            input.authorId,
            input.kind,
            input.title ?? null,
            input.bodyHtml,
            input.topicId ?? null,
            input.groupId ?? null,
            input.pinned,
            input.mentionsAll,
            input.status,
            input.scheduledAt ?? null,
            input.requiresReadConfirmation,
            marker,
            input.visibility ?? 'company',
            input.authorUnitId ?? null,
            input.commentsDisabled === true,
            input.groupTopicId ?? null,
            input.mediaLayout ?? SOCIAL_MEDIA_LAYOUT_DEFAULT,
          ],
        );
        if (input.visibility === 'custom' && input.audience) await replaceAudience(client, input.id, input.audience);
        await replacePostMentions(client, input.id, input.mentionUserIds);
        await attachFiles(client, input.id, input.attachmentIds, input.uploaderId);
        if (input.poll) {
          await client.query(
            `INSERT INTO social_schema.polls (id, post_id, question, allow_multiple, anonymous, closes_at)
             VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
            [
              input.poll.id,
              input.id,
              input.poll.question,
              input.poll.allowMultiple,
              input.poll.anonymous,
              input.poll.closesAt ?? null,
            ],
          );
          for (const [position, option] of input.poll.options.entries()) {
            await client.query(
              `INSERT INTO social_schema.poll_options (id, poll_id, position, text) VALUES ($1, $2, $3, $4)`,
              [option.id, input.poll.id, position, option.text],
            );
          }
        }
        await writeOutboxAll(client, tenantId, input.events);
      }),
    );
  }

  update(tenantId: string, postId: string, patch: PublishingPostPatch): Promise<void> {
    return this.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        const assignments: string[] = [];
        const values: unknown[] = [postId, patch.expectedStatus];
        // Khoá dòng để bản lịch sử luôn là bản đang bị ghi đè, kể cả khi hai lần sửa chen nhau.
        const before = await client.query<{ title: string | null; body_html: string; edit_count: number }>(
          `SELECT title, body_html, edit_count FROM social_schema.posts WHERE id = $1 AND status = $2 FOR UPDATE`,
          [postId, patch.expectedStatus],
        );
        const old = before.rows[0];
        if (!old) throw new SocialPostStateError();
        const set = (column: string, value: unknown, cast = '') => {
          values.push(value);
          assignments.push(`${column} = $${values.length}${cast}`);
        };
        if (patch.title !== undefined) set('title', patch.title);
        if (patch.bodyHtml !== undefined) set('body_html', patch.bodyHtml);
        if (patch.topicId !== undefined) set('topic_id', patch.topicId);
        if (patch.mediaLayout !== undefined) set('media_layout', patch.mediaLayout);
        if (patch.scheduledAt !== undefined) {
          // Bài hẹn giờ xếp theo giờ hẹn trong danh sách của tác giả.
          set('scheduled_at', patch.scheduledAt, '::timestamptz');
          set('published_at', patch.scheduledAt, '::timestamptz');
        }
        if (patch.requiresReadConfirmation !== undefined) {
          set('requires_read_confirmation', patch.requiresReadConfirmation);
        }
        // Đổi quyền xem, tắt bình luận, đổi chủ đề nhóm không tính là "đã sửa": không đặt edited_at.
        if (patch.visibility !== undefined) set('visibility', patch.visibility);
        if (patch.authorUnitId !== undefined) set('author_unit_id', patch.authorUnitId, '::uuid');
        if (patch.commentsDisabled !== undefined) set('comments_disabled', patch.commentsDisabled);
        if (patch.groupTopicId !== undefined) set('group_topic_id', patch.groupTopicId, '::uuid');

        // Tiêu đề/nội dung chỉ tính là sửa khi thực sự khác bản hiện tại. Đổi quyền xem kéo theo chỉnh danh sách
        // người được nhắc: việc đó không phải người dùng "sửa bài".
        const textChanged =
          (patch.title !== undefined && (patch.title ?? null) !== (old.title ?? null)) ||
          (patch.bodyHtml !== undefined && patch.bodyHtml !== old.body_html);
        const contentEdited =
          textChanged ||
          patch.topicId !== undefined ||
          patch.mediaLayout !== undefined ||
          (patch.mentionUserIds !== undefined && patch.visibility === undefined) ||
          patch.attachmentIds !== undefined;
        if (patch.resubmitAs) {
          set('status', patch.resubmitAs);
          assignments.push(
            'published_at = now()',
            'reject_reason = NULL',
            'moderated_by = NULL',
            'moderated_at = NULL',
          );
        } else if (patch.expectedStatus === 'published' && contentEdited) {
          assignments.push('edited_at = now()');
        }
        assignments.push('updated_at = now()');

        // Lịch sử sửa: chỉ khi tiêu đề hoặc nội dung của bài đã đăng thực sự đổi. Lưu bản hiện tại (version =
        // edit_count + 1) trước khi bị ghi đè; giữ `POST_EDIT_KEEP` bản gần nhất.
        if (patch.expectedStatus === 'published' && !patch.resubmitAs && textChanged) {
          assignments.push('edit_count = edit_count + 1');
          const version = old.edit_count + 1;
          await client.query(
            `INSERT INTO social_schema.post_edits (post_id, version, title, body_html, edited_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (post_id, version) DO NOTHING`,
            [postId, version, old.title, old.body_html, patch.editorId ?? patch.uploaderId],
          );
          await client.query(`DELETE FROM social_schema.post_edits WHERE post_id = $1 AND version <= $2`, [
            postId,
            version - POST_EDIT_KEEP,
          ]);
        }

        const result = await client.query(
          `UPDATE social_schema.posts SET ${assignments.join(', ')} WHERE id = $1 AND status = $2`,
          values,
        );
        if (result.rowCount === 0) throw new SocialPostStateError();

        if (patch.audience !== undefined) await replaceAudience(client, postId, patch.audience);
        if (patch.mentionUserIds !== undefined) await replacePostMentions(client, postId, patch.mentionUserIds);
        if (patch.attachmentIds !== undefined) {
          // Gắn trước rồi mới gỡ: tệp đã thuộc bài này vẫn hợp lệ dù do người khác tải.
          await attachFiles(client, postId, patch.attachmentIds, patch.uploaderId);
          await client.query(
            `UPDATE social_schema.attachments SET post_id = NULL
              WHERE post_id = $1 AND NOT (id = ANY($2::uuid[]))`,
            [postId, patch.attachmentIds],
          );
        }
        if (patch.pollClosesAt !== undefined) {
          await client.query(`UPDATE social_schema.polls SET closes_at = $2::timestamptz WHERE post_id = $1`, [
            postId,
            patch.pollClosesAt,
          ]);
        }
        await writeOutboxAll(client, tenantId, patch.events);
      }),
    );
  }

  transition(tenantId: string, postId: string, transition: PostTransition): Promise<void> {
    return this.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE social_schema.posts
              SET status = $3::varchar,
                  published_at = CASE WHEN $3::varchar IN ('published', 'pending') THEN now() ELSE published_at END,
                  moderated_by = COALESCE($4::uuid, moderated_by),
                  moderated_at = CASE WHEN $4::uuid IS NULL THEN moderated_at ELSE now() END,
                  reject_reason = CASE WHEN $3::varchar = 'rejected' THEN $5::varchar ELSE NULL END,
                  updated_at = now()
            WHERE id = $1 AND status = ANY($2::text[])`,
          [postId, transition.from, transition.to, transition.moderatedBy ?? null, transition.rejectReason ?? null],
        );
        if (result.rowCount === 0) throw new SocialPostStateError();
        await writeOutboxAll(client, tenantId, transition.events);
      }),
    );
  }

  softDelete(
    tenantId: string,
    postId: string,
    userId: string,
    events: readonly SocialOutboxEvent[],
  ): Promise<void> {
    return this.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE social_schema.posts
              SET status = 'deleted', deleted_at = now(), deleted_by = $2, pinned = false, updated_at = now()
            WHERE id = $1 AND status <> 'deleted'`,
          [postId, userId],
        );
        if (result.rowCount === 0) throw new SocialPostNotFoundError();
        await writeOutboxAll(client, tenantId, events);
      }),
    );
  }

  setPinned(
    tenantId: string,
    postId: string,
    pinned: boolean,
    events: readonly SocialOutboxEvent[],
  ): Promise<void> {
    return this.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE social_schema.posts SET pinned = $2, updated_at = now()
            WHERE id = $1 AND status = 'published'`,
          [postId, pinned],
        );
        if (result.rowCount === 0) throw new SocialPostStateError();
        await writeOutboxAll(client, tenantId, events);
      }),
    );
  }

  publishNextDue(
    tenantId: string,
    now: string,
    excludeIds: readonly string[],
    decide: (post: ExtendedPostRow) => Promise<DueDecision>,
  ): Promise<{ readonly postId: string; readonly outcome: DueDecision['to'] } | undefined> {
    return this.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        const found = await client.query<ExtendedPostRecord>(
          `SELECT ${EXTENDED_POST_COLUMNS}
             FROM social_schema.posts p
             ${EXTENDED_POST_JOINS}
            WHERE p.status = 'scheduled' AND p.scheduled_at <= $1::timestamptz
              AND NOT (p.id = ANY($2::uuid[]))
            ORDER BY p.scheduled_at, p.id
            LIMIT 1
            FOR UPDATE OF p SKIP LOCKED`,
          [now, excludeIds],
        );
        if (!found.rows[0]) return undefined;
        const post = mapExtendedPost(found.rows[0]);
        const decision = await decide(post);

        if (decision.to === 'deleted') {
          await client.query(
            `UPDATE social_schema.posts
                SET status = 'deleted', deleted_at = now(), deleted_by = author_id, pinned = false, updated_at = now()
              WHERE id = $1 AND status = 'scheduled'`,
            [post.id],
          );
        } else {
          await client.query(
            `UPDATE social_schema.posts
                SET status = $2::varchar, published_at = now(), updated_at = now()
              WHERE id = $1 AND status = 'scheduled'`,
            [post.id, decision.to],
          );
        }
        await writeOutboxAll(client, tenantId, decision.events);
        return { postId: post.id, outcome: decision.to };
      }),
    );
  }

  listByAuthor(
    tenantId: string,
    authorId: string,
    status: 'pending' | 'scheduled' | 'rejected',
    scope: PostVisibilityScope,
    query: PostListQuery,
  ): Promise<ExtendedPostRow[]> {
    return this.run(tenantId, async (pool) => {
      const values: unknown[] = [authorId, status];
      let where = `p.author_id = $1 AND p.status = $2 AND ${visibilityClause(scope, values)}`;
      if (query.cursor) {
        values.push(query.cursor.at, query.cursor.id);
        where += ` AND (p.published_at, p.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
      }
      values.push(query.limit);
      const result = await pool.query<ExtendedPostRecord>(
        `${EXTENDED_POST_SELECT}
          WHERE ${where}
          ORDER BY p.published_at DESC, p.id DESC
          LIMIT $${values.length}`,
        values,
      );
      return result.rows.map(mapExtendedPost);
    });
  }

  listPending(tenantId: string, scope: PostVisibilityScope, query: PostListQuery): Promise<ExtendedPostRow[]> {
    return this.run(tenantId, async (pool) => {
      const values: unknown[] = [];
      let where = `p.status = 'pending' AND p.group_id IS NULL AND ${visibilityClause(scope, values)}`;
      if (query.cursor) {
        values.push(query.cursor.at, query.cursor.id);
        where += ` AND (p.published_at, p.id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
      }
      values.push(query.limit);
      const result = await pool.query<ExtendedPostRecord>(
        `${EXTENDED_POST_SELECT}
          WHERE ${where}
          ORDER BY p.published_at, p.id
          LIMIT $${values.length}`,
        values,
      );
      return result.rows.map(mapExtendedPost);
    });
  }

  counts(
    tenantId: string,
    userId: string,
    canModerate: boolean,
    scope: PostVisibilityScope,
  ): Promise<InboxCountsRow> {
    return this.run(tenantId, async (pool) => {
      const postValues: unknown[] = [userId, canModerate];
      const postVisible = visibilityClause(scope, postValues);
      const bookmarkValues: unknown[] = [userId];
      const bookmarkVisible = visibilityClause(scope, bookmarkValues);

      const [posts, bookmarks] = await Promise.all([
        pool.query<{ my_pending: number; my_scheduled: number; my_rejected: number; to_moderate: number }>(
          `SELECT count(*) FILTER (WHERE p.author_id = $1 AND p.status = 'pending')::int AS my_pending,
                  count(*) FILTER (WHERE p.author_id = $1 AND p.status = 'scheduled')::int AS my_scheduled,
                  count(*) FILTER (WHERE p.author_id = $1 AND p.status = 'rejected')::int AS my_rejected,
                  count(*) FILTER (WHERE $2::boolean AND p.status = 'pending' AND p.group_id IS NULL)::int AS to_moderate
             FROM social_schema.posts p
             LEFT JOIN social_schema.groups g ON g.id = p.group_id
            WHERE p.status IN ('pending', 'scheduled', 'rejected')
              AND (p.author_id = $1 OR ($2::boolean AND p.status = 'pending' AND p.group_id IS NULL))
              AND ${postVisible}`,
          postValues,
        ),
        pool.query<{ n: number }>(
          `SELECT count(*)::int AS n
             FROM social_schema.post_bookmarks b
             JOIN social_schema.posts p ON p.id = b.post_id
             LEFT JOIN social_schema.groups g ON g.id = p.group_id
            WHERE b.user_id = $1 AND p.status = 'published' AND ${bookmarkVisible}`,
          bookmarkValues,
        ),
      ]);
      const row = posts.rows[0];
      return {
        myPending: row?.my_pending ?? 0,
        myScheduled: row?.my_scheduled ?? 0,
        myRejected: row?.my_rejected ?? 0,
        toModerate: row?.to_moderate ?? 0,
        bookmarks: bookmarks.rows[0]?.n ?? 0,
      };
    });
  }

  engagement(tenantId: string, postIds: readonly string[], viewerId: string): Promise<PostEngagementRelations> {
    return this.run(tenantId, async (pool) => {
      const polls = new Map<string, PollRow>();
      const readConfirmations = new Map<string, ReadConfirmationRow>();
      const bookmarkedPostIds = new Set<string>();
      const audiences = new Map<string, PostAudienceRow>();
      if (postIds.length === 0) return { polls, readConfirmations, bookmarkedPostIds, audiences };

      const [pollRows, confirmationRows, bookmarkRows, audienceRows] = await Promise.all([
        pool.query<PollRecord>(
          `SELECT po.id, po.post_id, po.question, po.allow_multiple, po.anonymous,
                  ${isoColumn('po.closes_at')} AS closes_at, ${isoColumn('po.closed_at')} AS closed_at
             FROM social_schema.polls po
            WHERE po.post_id = ANY($1::uuid[])`,
          [postIds],
        ),
        pool.query<{ post_id: string; n: number; mine: boolean; mine_at: string | null }>(
          `SELECT p.id AS post_id, count(rc.user_id)::int AS n,
                  coalesce(bool_or(rc.user_id = $2::uuid), false) AS mine,
                  ${isoColumn('max(rc.confirmed_at) FILTER (WHERE rc.user_id = $2::uuid)')} AS mine_at
             FROM social_schema.posts p
             LEFT JOIN social_schema.read_confirmations rc ON rc.post_id = p.id
            WHERE p.id = ANY($1::uuid[]) AND p.requires_read_confirmation
            GROUP BY p.id`,
          [postIds, viewerId],
        ),
        pool.query<{ post_id: string }>(
          `SELECT post_id FROM social_schema.post_bookmarks WHERE user_id = $2 AND post_id = ANY($1::uuid[])`,
          [postIds, viewerId],
        ),
        // Danh sách chia sẻ chỉ cho tác giả của bài `custom` (người khác không biết bài chia sẻ cho ai).
        pool.query<{ post_id: string; principal_type: 'user' | 'unit'; principal_id: string }>(
          `SELECT a.post_id, a.principal_type, a.principal_id::text AS principal_id
             FROM social_schema.post_audience a
             JOIN social_schema.posts p ON p.id = a.post_id
            WHERE a.post_id = ANY($1::uuid[]) AND p.author_id = $2::uuid AND p.visibility = 'custom'
            ORDER BY a.principal_type, a.principal_id`,
          [postIds, viewerId],
        ),
      ]);

      const pollIds = pollRows.rows.map((row) => row.id);
      const options = new Map<string, PollOptionRow[]>();
      const voters = new Map<string, number>();
      const mine = new Map<string, string[]>();
      if (pollIds.length > 0) {
        const [optionRows, voterRows, mineRows] = await Promise.all([
          pool.query<{ id: string; poll_id: string; text: string; position: number; votes: number }>(
            `SELECT o.id, o.poll_id, o.text, o.position::int AS position, count(v.user_id)::int AS votes
               FROM social_schema.poll_options o
               LEFT JOIN social_schema.poll_votes v ON v.option_id = o.id
              WHERE o.poll_id = ANY($1::uuid[])
              GROUP BY o.id
              ORDER BY o.position`,
            [pollIds],
          ),
          pool.query<{ poll_id: string; n: number }>(
            `SELECT poll_id, count(DISTINCT user_id)::int AS n
               FROM social_schema.poll_votes WHERE poll_id = ANY($1::uuid[]) GROUP BY poll_id`,
            [pollIds],
          ),
          pool.query<{ poll_id: string; option_id: string }>(
            `SELECT poll_id, option_id FROM social_schema.poll_votes
              WHERE poll_id = ANY($1::uuid[]) AND user_id = $2`,
            [pollIds, viewerId],
          ),
        ]);
        for (const row of optionRows.rows) {
          options.set(row.poll_id, [
            ...(options.get(row.poll_id) ?? []),
            { id: row.id, text: row.text, position: row.position, voteCount: row.votes },
          ]);
        }
        for (const row of voterRows.rows) voters.set(row.poll_id, row.n);
        for (const row of mineRows.rows) mine.set(row.poll_id, [...(mine.get(row.poll_id) ?? []), row.option_id]);
      }

      for (const row of pollRows.rows) {
        polls.set(row.post_id, {
          id: row.id,
          postId: row.post_id,
          question: row.question,
          allowMultiple: row.allow_multiple,
          anonymous: row.anonymous,
          ...(row.closes_at ? { closesAt: row.closes_at } : {}),
          ...(row.closed_at ? { closedAt: row.closed_at } : {}),
          options: options.get(row.id) ?? [],
          totalVoters: voters.get(row.id) ?? 0,
          myOptionIds: mine.get(row.id) ?? [],
        });
      }
      for (const row of confirmationRows.rows) {
        readConfirmations.set(row.post_id, {
          confirmedByMe: row.mine,
          ...(row.mine_at ? { confirmedAt: row.mine_at } : {}),
          confirmedCount: row.n,
        });
      }
      for (const row of bookmarkRows.rows) bookmarkedPostIds.add(row.post_id);
      for (const row of audienceRows.rows) {
        const current = audiences.get(row.post_id) ?? { userIds: [], unitIds: [] };
        audiences.set(row.post_id, {
          userIds: row.principal_type === 'user' ? [...current.userIds, row.principal_id] : current.userIds,
          unitIds: row.principal_type === 'unit' ? [...current.unitIds, row.principal_id] : current.unitIds,
        });
      }
      return { polls, readConfirmations, bookmarkedPostIds, audiences };
    });
  }

  vote(
    tenantId: string,
    input: {
      readonly postId: string;
      readonly pollId: string;
      readonly userId: string;
      readonly optionIds: readonly string[];
      readonly events: readonly SocialOutboxEvent[];
    },
  ): Promise<void> {
    return this.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        // Khoá bình chọn để đổi phiếu và đóng bình chọn không chen nhau.
        const poll = await client.query<{ closed: boolean }>(
          `SELECT (closed_at IS NOT NULL OR (closes_at IS NOT NULL AND closes_at <= now())) AS closed
             FROM social_schema.polls WHERE id = $1 AND post_id = $2 FOR UPDATE`,
          [input.pollId, input.postId],
        );
        if (!poll.rows[0]) throw new SocialPostNotFoundError();
        if (poll.rows[0].closed) throw new SocialPollClosedError();

        await client.query(`DELETE FROM social_schema.poll_votes WHERE poll_id = $1 AND user_id = $2`, [
          input.pollId,
          input.userId,
        ]);
        if (input.optionIds.length > 0) {
          const inserted = await client.query(
            `INSERT INTO social_schema.poll_votes (option_id, poll_id, user_id)
             SELECT o.id, o.poll_id, $3::uuid
               FROM social_schema.poll_options o
              WHERE o.poll_id = $1 AND o.id = ANY($2::uuid[])`,
            [input.pollId, input.optionIds, input.userId],
          );
          if (inserted.rowCount !== input.optionIds.length) {
            throw new SocialValidationError('Có lựa chọn không thuộc bình chọn này.');
          }
        }
        await writeOutboxAll(client, tenantId, input.events);
      }),
    );
  }

  closePoll(
    tenantId: string,
    pollId: string,
    userId: string,
    events: readonly SocialOutboxEvent[],
  ): Promise<void> {
    return this.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        const result = await client.query(
          `UPDATE social_schema.polls SET closed_at = now(), closed_by = $2
            WHERE id = $1 AND closed_at IS NULL`,
          [pollId, userId],
        );
        if (result.rowCount === 0) throw new SocialPollClosedError();
        await writeOutboxAll(client, tenantId, events);
      }),
    );
  }

  listVoters(
    tenantId: string,
    pollId: string,
    optionId: string | undefined,
    limit: number,
    offset: number,
  ): Promise<PollVoterRow[]> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<{ user_id: string; option_id: string; voted_at: string }>(
        `SELECT v.user_id, v.option_id, ${isoColumn('v.voted_at')} AS voted_at
           FROM social_schema.poll_votes v
          WHERE v.poll_id = $1 AND ($2::uuid IS NULL OR v.option_id = $2::uuid)
          ORDER BY v.voted_at, v.user_id, v.option_id
          LIMIT $3 OFFSET $4`,
        [pollId, optionId ?? null, limit, offset],
      );
      return result.rows.map((row) => ({ userId: row.user_id, optionId: row.option_id, votedAt: row.voted_at }));
    });
  }

  confirmRead(tenantId: string, postId: string, userId: string): Promise<void> {
    return this.run(tenantId, async (pool) => {
      await pool.query(
        `INSERT INTO social_schema.read_confirmations (post_id, user_id) VALUES ($1, $2)
         ON CONFLICT (post_id, user_id) DO NOTHING`,
        [postId, userId],
      );
    });
  }

  listConfirmations(tenantId: string, postId: string): Promise<ReadConfirmationRecord[]> {
    return this.run(tenantId, async (pool) => {
      const result = await pool.query<{ user_id: string; confirmed_at: string }>(
        `SELECT user_id, ${isoColumn('confirmed_at')} AS confirmed_at
           FROM social_schema.read_confirmations
          WHERE post_id = $1
          ORDER BY confirmed_at, user_id`,
        [postId],
      );
      return result.rows.map((row) => ({ userId: row.user_id, confirmedAt: row.confirmed_at }));
    });
  }

  setBookmark(tenantId: string, postId: string, userId: string, bookmarked: boolean): Promise<void> {
    return this.run(tenantId, async (pool) => {
      if (bookmarked) {
        await pool.query(
          `INSERT INTO social_schema.post_bookmarks (user_id, post_id) VALUES ($1, $2)
           ON CONFLICT (user_id, post_id) DO NOTHING`,
          [userId, postId],
        );
      } else {
        await pool.query(`DELETE FROM social_schema.post_bookmarks WHERE user_id = $1 AND post_id = $2`, [
          userId,
          postId,
        ]);
      }
    });
  }

  listBookmarks(
    tenantId: string,
    userId: string,
    scope: PostVisibilityScope,
    query: PostListQuery,
  ): Promise<BookmarkedPostRow[]> {
    return this.run(tenantId, async (pool) => {
      const values: unknown[] = [userId];
      let where = `b.user_id = $1 AND p.status = 'published' AND ${visibilityClause(scope, values)}`;
      if (query.cursor) {
        values.push(query.cursor.at, query.cursor.id);
        where += ` AND (b.created_at, b.post_id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
      }
      values.push(query.limit);
      const result = await pool.query<ExtendedPostRecord & { bookmarked_at: string }>(
        `SELECT ${EXTENDED_POST_COLUMNS}, ${isoColumn('b.created_at')} AS bookmarked_at
           FROM social_schema.post_bookmarks b
           JOIN social_schema.posts p ON p.id = b.post_id
           ${EXTENDED_POST_JOINS}
          WHERE ${where}
          ORDER BY b.created_at DESC, b.post_id DESC
          LIMIT $${values.length}`,
        values,
      );
      return result.rows.map((row) => ({ post: mapExtendedPost(row), bookmarkedAt: row.bookmarked_at }));
    });
  }

  setReaction(
    tenantId: string,
    input: {
      readonly postId: string;
      readonly userId: string;
      readonly type: SocialReactionType | null;
      readonly events: readonly SocialOutboxEvent[];
    },
  ): Promise<void> {
    return this.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        if (input.type === null) {
          await client.query(`DELETE FROM social_schema.post_reactions WHERE post_id = $1 AND user_id = $2`, [
            input.postId,
            input.userId,
          ]);
        } else {
          await client.query(
            `INSERT INTO social_schema.post_reactions (post_id, user_id, type)
             VALUES ($1, $2, $3)
             ON CONFLICT (post_id, user_id)
             DO UPDATE SET type = EXCLUDED.type, reacted_at = now()`,
            [input.postId, input.userId, input.type],
          );
        }
        await writeOutboxAll(client, tenantId, input.events);
      }),
    );
  }
}

/** Thay toàn bộ danh sách chia sẻ của bài (xoá hết rồi ghi lại). Rỗng cả hai mảng là chỉ xoá. */
async function replaceAudience(client: PoolClient, postId: string, audience: PostAudienceWrite): Promise<void> {
  await client.query(`DELETE FROM social_schema.post_audience WHERE post_id = $1`, [postId]);
  if (audience.userIds.length > 0) {
    await client.query(
      `INSERT INTO social_schema.post_audience (post_id, principal_type, principal_id)
       SELECT $1, 'user', u FROM unnest($2::uuid[]) AS u
       ON CONFLICT DO NOTHING`,
      [postId, audience.userIds],
    );
  }
  if (audience.unitIds.length > 0) {
    await client.query(
      `INSERT INTO social_schema.post_audience (post_id, principal_type, principal_id)
       SELECT $1, 'unit', u FROM unnest($2::uuid[]) AS u
       ON CONFLICT DO NOTHING`,
      [postId, audience.unitIds],
    );
  }
}
