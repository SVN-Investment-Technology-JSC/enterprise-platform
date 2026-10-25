import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { ExtendedPostRow } from '../application/ports/post-read-model.js';
import type { FeedPageRead, FeedRead, SocialFeedStore } from '../application/social-feed-store.port.js';
import { TenantQueryRunner } from './group-sql-support.js';
import { postVisibilitySql } from './post-visibility-sql.js';
import { EXTENDED_POST_SELECT, mapExtendedPost, type ExtendedPostRecord } from './publishing-sql.js';

/**
 * Điều kiện chung của bảng tin: luật nhìn thấy bài + phạm vi + bộ lọc. Trả mệnh đề (không có
 * `WHERE`) và nối giá trị vào `values`. Bài ở đây luôn `published`; bài chưa đăng có đường đọc riêng.
 */
export function whereClause(read: FeedRead, values: unknown[]): string {
  const visibility = postVisibilitySql(read.visibility, { firstParam: values.length + 1 });
  values.push(...visibility.params);
  let clause = `p.status = 'published' AND ${visibility.sql}`;

  if (read.groupId) {
    values.push(read.groupId);
    clause += ` AND p.group_id = $${values.length}::uuid`;
  } else if (read.source === 'wall') {
    clause += ` AND p.group_id IS NULL`;
  } else if (read.source === 'groups') {
    values.push([...read.visibility.memberGroupIds]);
    clause += ` AND p.group_id = ANY($${values.length}::uuid[])`;
  }

  if (read.topicId) {
    values.push(read.topicId);
    clause += ` AND EXISTS (SELECT 1 FROM social_schema.post_topics pt WHERE pt.post_id = p.id AND pt.topic_id = $${values.length}::uuid)`;
  }
  if (read.groupTopicId) {
    values.push(read.groupTopicId);
    clause += ` AND p.group_topic_id = $${values.length}::uuid`;
  }
  if (read.kind === 'announcement') {
    clause += ` AND p.kind = 'announcement'`;
  } else if (read.kind === 'post') {
    clause += ` AND p.kind IN ('post', 'activity')`;
  }
  if (read.authorId) {
    values.push(read.authorId);
    clause += ` AND p.author_id = $${values.length}::uuid`;
  }
  return clause;
}

/** Truy vấn bảng tin P2 trên DB của tenant. Mọi giá trị người dùng đều là tham số. */
export class PostgresSocialFeedStore implements SocialFeedStore {
  private readonly runner: TenantQueryRunner;

  constructor(references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) {
    this.runner = new TenantQueryRunner(references, pools);
  }

  pinned(tenantId: string, read: FeedRead, limit: number): Promise<ExtendedPostRow[]> {
    return this.runner.run(tenantId, async (pool) => {
      const values: unknown[] = [];
      const where = whereClause(read, values);
      values.push(limit);
      const result = await pool.query<ExtendedPostRecord>(
        `${EXTENDED_POST_SELECT}
          WHERE ${where} AND p.pinned
          ORDER BY p.published_at DESC, p.id DESC
          LIMIT $${values.length}`,
        values,
      );
      return result.rows.map(mapExtendedPost);
    });
  }

  page(tenantId: string, read: FeedPageRead): Promise<ExtendedPostRow[]> {
    return this.runner.run(tenantId, async (pool) => {
      const values: unknown[] = [];
      let where = whereClause(read, values);
      if (read.cursor) {
        values.push(read.cursor.at, read.cursor.id);
        where += ` AND (p.published_at, p.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
      }
      values.push(read.limit);
      const result = await pool.query<ExtendedPostRecord>(
        `${EXTENDED_POST_SELECT}
          WHERE ${where} AND NOT p.pinned
          ORDER BY p.published_at DESC, p.id DESC
          LIMIT $${values.length}`,
        values,
      );
      return result.rows.map(mapExtendedPost);
    });
  }
}
