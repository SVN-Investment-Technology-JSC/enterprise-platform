import { randomUUID } from 'node:crypto';
import {
  SOCIAL_MEDIA_LAYOUT_DEFAULT,
  type SocialActivityType,
  type SocialGroupColor,
  type SocialGroupIcon,
  type SocialGroupPrivacy,
  type SocialMediaLayout,
  type SocialPostKind,
  type SocialPostStatus,
  type SocialPostVisibility,
} from '@enterprise-platform/contracts-social';
import type { PoolClient } from 'pg';
import type { ExtendedPostRow } from '../application/ports/post-read-model.js';
import type { SocialOutboxEvent } from '../application/social-store.port.js';
import { SocialAttachmentUnavailableError, SocialVideoFailedError } from '../domain/social.error.js';

/** Thời điểm UTC dạng ISO giữ nguyên micro giây, để con trỏ phân trang không bỏ sót dòng cùng mili giây. */
export function isoColumn(expression: string): string {
  return `to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Cột của `ExtendedPostRow`. Truy vấn dùng bí danh `p` (posts), `t` (topics), `g` (groups) và nối bằng
 * `EXTENDED_POST_JOINS`. Bài `kind = 'activity'` hiện là `post` (kiểu API không đổi).
 */
export const EXTENDED_POST_COLUMNS = `p.id, p.author_id,
       CASE WHEN p.kind = 'activity' THEN 'post' ELSE p.kind END AS kind,
       p.title, p.body_html, p.topic_id, t.name AS topic_name, p.pinned, p.mentions_all, p.media_layout,
       ${isoColumn('p.published_at')} AS published_at,
       ${isoColumn('p.edited_at')} AS edited_at,
       (SELECT count(*) FROM social_schema.comments c
         WHERE c.post_id = p.id AND c.deleted_at IS NULL)::int AS comment_count,
       p.status, p.group_id, g.name AS group_name, g.privacy AS group_privacy,
       g.color AS group_color, g.icon AS group_icon, (g.deleted_at IS NOT NULL) AS group_deleted,
       ${isoColumn('p.scheduled_at')} AS scheduled_at,
       p.moderated_by, ${isoColumn('p.moderated_at')} AS moderated_at, p.reject_reason,
       p.requires_read_confirmation, p.activity_type, p.activity_payload,
       p.visibility, p.author_unit_id, p.comments_disabled, p.edit_count, p.group_topic_id`;

export const EXTENDED_POST_JOINS = `LEFT JOIN social_schema.topics t ON t.id = p.topic_id
  LEFT JOIN social_schema.groups g ON g.id = p.group_id`;

export const EXTENDED_POST_SELECT = `SELECT ${EXTENDED_POST_COLUMNS}
  FROM social_schema.posts p
  ${EXTENDED_POST_JOINS}`;

export interface ExtendedPostRecord {
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
  status: SocialPostStatus;
  group_id: string | null;
  group_name: string | null;
  group_privacy: SocialGroupPrivacy | null;
  group_color: SocialGroupColor | null;
  group_icon: SocialGroupIcon | null;
  group_deleted: boolean;
  scheduled_at: string | null;
  moderated_by: string | null;
  moderated_at: string | null;
  reject_reason: string | null;
  requires_read_confirmation: boolean;
  activity_type: SocialActivityType | null;
  activity_payload: Record<string, unknown> | null;
  visibility: SocialPostVisibility;
  author_unit_id: string | null;
  comments_disabled: boolean;
  edit_count: number;
  group_topic_id: string | null;
}

/**
 * Danh sách chia sẻ của bài `custom` (rỗng với quyền khác), để `canViewPostInScope` quyết định trên MỘT
 * bài (`findForWrite`). Truy vấn danh sách không cần: SQL đã lọc bằng `postVisibilitySql`.
 */
export const AUDIENCE_COLUMNS = `CASE WHEN p.visibility = 'custom' THEN ARRAY(
         SELECT a.principal_id::text FROM social_schema.post_audience a
          WHERE a.post_id = p.id AND a.principal_type = 'user' ORDER BY a.principal_id) END AS audience_user_ids,
       CASE WHEN p.visibility = 'custom' THEN ARRAY(
         SELECT a.principal_id::text FROM social_schema.post_audience a
          WHERE a.post_id = p.id AND a.principal_type = 'unit' ORDER BY a.principal_id) END AS audience_unit_ids`;

export interface AudienceRecord {
  audience_user_ids: string[] | null;
  audience_unit_ids: string[] | null;
}

export function mapExtendedPost(row: ExtendedPostRecord): ExtendedPostRow {
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
    status: row.status,
    ...(row.group_id
      ? {
          groupId: row.group_id,
          groupName: row.group_name ?? '',
          ...(row.group_privacy ? { groupPrivacy: row.group_privacy } : {}),
          ...(row.group_color ? { groupColor: row.group_color } : {}),
          ...(row.group_icon ? { groupIcon: row.group_icon } : {}),
          groupDeleted: row.group_deleted,
        }
      : {}),
    ...(row.scheduled_at ? { scheduledAt: row.scheduled_at } : {}),
    ...(row.moderated_by ? { moderatedBy: row.moderated_by } : {}),
    ...(row.moderated_at ? { moderatedAt: row.moderated_at } : {}),
    ...(row.reject_reason ? { rejectReason: row.reject_reason } : {}),
    requiresReadConfirmation: row.requires_read_confirmation,
    ...(row.activity_type ? { activityType: row.activity_type } : {}),
    ...(row.activity_payload ? { activityPayload: row.activity_payload } : {}),
    visibility: row.visibility ?? 'company',
    ...(row.author_unit_id ? { authorUnitId: row.author_unit_id } : {}),
    commentsDisabled: row.comments_disabled === true,
    editCount: row.edit_count ?? 0,
    ...(row.group_topic_id ? { groupTopicId: row.group_topic_id } : {}),
  };
}

/**
 * Ghi sự kiện vào outbox bằng chính `client` của transaction đang mở: sự kiện và thay đổi dữ liệu
 * cùng commit hoặc cùng rollback (skill erp-events).
 */
export async function writeOutboxAll(
  client: PoolClient,
  tenantId: string,
  events: readonly SocialOutboxEvent[],
): Promise<void> {
  for (const event of events) {
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
}

/**
 * Lý do một lần gắn tệp không đủ số dòng: có tệp video xử lý lỗi thì `SocialVideoFailedError`, còn lại
 * (thiếu, chưa tải xong, của người khác, đã gắn nơi khác) là `SocialAttachmentUnavailableError`. Người gọi ném lỗi
 * này trong transaction nên mọi thay đổi trước đó được huỷ.
 */
export async function attachmentFailure(
  client: PoolClient,
  attachmentIds: readonly string[],
): Promise<SocialAttachmentUnavailableError | SocialVideoFailedError> {
  const pending = await client.query(
    `SELECT 1 FROM social_schema.attachments
      WHERE id = ANY($1::uuid[]) AND completed_at IS NOT NULL AND processing_status = 'failed'
      LIMIT 1`,
    [attachmentIds],
  );
  return (pending.rowCount ?? 0) > 0 ? new SocialVideoFailedError() : new SocialAttachmentUnavailableError();
}

/**
 * Gắn tệp vào bài: chỉ tệp đã tải xong, không phải video `failed` (video `queued`/`processing` gắn được) và của bài này hoặc chưa gắn bài
 * do `uploaderId` tải. `position` là chỉ số của tệp trong `attachmentIds` (thứ tự tác giả sắp): gọi lại với cùng tập tệp
 * nhưng thứ tự khác thì đổi `position`, nên sửa bài đổi được thứ tự hiển thị.
 */
export async function attachFiles(
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

export async function replacePostMentions(
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
