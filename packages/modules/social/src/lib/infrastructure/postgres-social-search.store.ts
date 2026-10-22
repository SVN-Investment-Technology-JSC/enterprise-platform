import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type {
  SocialGroupColor,
  SocialGroupIcon,
  SocialGroupPrivacy,
  SocialGroupRole,
} from '@enterprise-platform/contracts-social';
import type { ExtendedPostRow } from '../application/ports/post-read-model.js';
import type { PostVisibilityScope } from '../application/ports/post-visibility.port.js';
import type {
  GroupSearchRow,
  SearchGroupsFilter,
  SearchPostsFilter,
  SocialSearchStore,
} from '../application/social-search-store.port.js';
import { buildLikePatterns, buildPrefixTsQuery } from '../domain/social-search-text.js';
import { DiscoveryQueryRunner, isoColumn } from './discovery-sql.js';
import { postVisibilitySql } from './post-visibility-sql.js';
import { EXTENDED_POST_SELECT, mapExtendedPost, type ExtendedPostRecord } from './publishing-sql.js';

interface GroupRecord {
  id: string;
  name: string;
  description: string | null;
  privacy: SocialGroupPrivacy;
  color: SocialGroupColor;
  icon: SocialGroupIcon;
  created_at: string;
  member_count: number;
  my_role: SocialGroupRole | null;
  my_joined_at: string | null;
  my_request_id: string | null;
}

function mapGroup(row: GroupRecord): GroupSearchRow {
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    privacy: row.privacy,
    color: row.color,
    icon: row.icon,
    memberCount: row.member_count,
    ...(row.my_role && row.my_joined_at ? { myRole: row.my_role, myJoinedAt: row.my_joined_at } : {}),
    ...(row.my_request_id ? { myJoinRequestId: row.my_request_id } : {}),
    createdAt: row.created_at,
  };
}

/**
 * Tìm kiếm bài/nhóm và đếm bài của một người, trên DB của tenant. Mọi giá trị từ người dùng đều là
 * tham số; từ khoá đã được gập và chỉ còn `[a-z0-9]` trước khi tới đây (xem `normalizeSearchQuery`).
 *
 * Bài: `to_tsvector('simple', search_text) @@ to_tsquery('simple', 'từ1:* & từ2:*')` khớp chỉ mục GIN
 * `idx_social_posts_search` (chỉ bài `published`). Nhóm: `groups.search_text LIKE ALL (...)`.
 */
export class PostgresSocialSearchStore implements SocialSearchStore {
  private readonly runner: DiscoveryQueryRunner;

  constructor(references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) {
    this.runner = new DiscoveryQueryRunner(references, pools);
  }

  searchPosts(tenantId: string, scope: PostVisibilityScope, filter: SearchPostsFilter): Promise<ExtendedPostRow[]> {
    return this.runner.run(tenantId, async (pool) => {
      const values: unknown[] = [];
      const visibility = postVisibilitySql(scope, { firstParam: 1 });
      values.push(...visibility.params);

      values.push(buildPrefixTsQuery(filter.tokens));
      let where =
        `p.status = 'published' AND p.kind <> 'activity' AND ${visibility.sql}` +
        ` AND to_tsvector('simple', p.search_text) @@ to_tsquery('simple', $${values.length})`;

      if (filter.topicId) {
        values.push(filter.topicId);
        where += ` AND p.topic_id = $${values.length}::uuid`;
      }
      if (filter.groupId) {
        values.push(filter.groupId);
        where += ` AND p.group_id = $${values.length}::uuid`;
      }
      if (filter.authorId) {
        values.push(filter.authorId);
        where += ` AND p.author_id = $${values.length}::uuid`;
      }
      if (filter.from) {
        values.push(filter.from);
        where += ` AND p.published_at >= $${values.length}::timestamptz`;
      }
      if (filter.to) {
        values.push(filter.to);
        where += ` AND p.published_at <= $${values.length}::timestamptz`;
      }
      if (filter.cursor) {
        values.push(filter.cursor.at, filter.cursor.id);
        where += ` AND (p.published_at, p.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
      }
      values.push(filter.limit);

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

  searchGroups(tenantId: string, scope: PostVisibilityScope, filter: SearchGroupsFilter): Promise<GroupSearchRow[]> {
    return this.runner.run(tenantId, async (pool) => {
      // $1 người xem, $2 mẫu LIKE; nhóm riêng tư chỉ hiện cho thành viên và quản trị toàn hệ thống.
      const values: unknown[] = [scope.viewerId, buildLikePatterns(filter.tokens)];
      let where =
        `g.deleted_at IS NULL` +
        ` AND (g.privacy = 'public' OR ${scope.seesAllGroups ? 'TRUE' : 'FALSE'} OR mm.user_id IS NOT NULL)` +
        ` AND g.search_text LIKE ALL ($2::text[])`;
      if (filter.cursor) {
        values.push(filter.cursor.at, filter.cursor.id);
        where += ` AND (g.created_at, g.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
      }
      values.push(filter.limit);

      const result = await pool.query<GroupRecord>(
        `SELECT g.id, g.name, g.description, g.privacy, g.color, g.icon,
                ${isoColumn('g.created_at')} AS created_at,
                (SELECT count(*) FROM social_schema.group_members m WHERE m.group_id = g.id)::int AS member_count,
                mm.role AS my_role, ${isoColumn('mm.joined_at')} AS my_joined_at,
                (SELECT r.id FROM social_schema.group_join_requests r
                  WHERE r.group_id = g.id AND r.user_id = $1::uuid AND r.status = 'pending'
                  LIMIT 1) AS my_request_id
           FROM social_schema.groups g
           LEFT JOIN social_schema.group_members mm ON mm.group_id = g.id AND mm.user_id = $1::uuid
          WHERE ${where}
          ORDER BY g.created_at DESC, g.id DESC
          LIMIT $${values.length}`,
        values,
      );
      return result.rows.map(mapGroup);
    });
  }

  countVisibleAuthorPosts(tenantId: string, scope: PostVisibilityScope, authorId: string): Promise<number> {
    return this.runner.run(tenantId, async (pool) => {
      const visibility = postVisibilitySql(scope, { firstParam: 1 });
      const result = await pool.query<{ total: number }>(
        `SELECT count(*)::int AS total
           FROM social_schema.posts p
           LEFT JOIN social_schema.groups g ON g.id = p.group_id
          WHERE p.status = 'published' AND p.kind <> 'activity'
            AND p.author_id = $4::uuid AND ${visibility.sql}`,
        [...visibility.params, authorId],
      );
      return result.rows[0]?.total ?? 0;
    });
  }
}
