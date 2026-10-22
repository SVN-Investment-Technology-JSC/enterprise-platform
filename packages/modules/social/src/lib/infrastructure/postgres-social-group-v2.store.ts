import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import {
  SOCIAL_GROUP_TOPICS_MAX,
  type SocialGroupPostPermission,
  type SocialGroupRole,
} from '@enterprise-platform/contracts-social';
import type { PoolClient } from 'pg';
import type { GroupSourceInsert } from '../application/social-group-store.port.js';
import type {
  GroupPostingInfo,
  GroupSourceRow,
  GroupSyncInput,
  GroupSyncResult,
  GroupTopicRefRow,
  GroupTopicRow,
  SocialGroupV2Store,
} from '../application/social-group-v2-store.port.js';
import {
  SocialGroupPriorityLimitError,
  SocialGroupTopicLimitError,
  SocialGroupTopicNameTakenError,
} from '../domain/social-group.error.js';
import { TenantQueryRunner, isUniqueViolation, isoColumn, writeOutboxAll } from './group-sql-support.js';

interface TopicRecord {
  id: string;
  group_id: string;
  name: string;
  position: number;
  post_count: number;
}

function mapTopic(row: TopicRecord): GroupTopicRow {
  return { id: row.id, groupId: row.group_id, name: row.name, position: row.position, postCount: row.post_count };
}

const TOPIC_SELECT = `SELECT t.id, t.group_id, t.name, t.position,
       (SELECT count(*) FROM social_schema.posts p
         WHERE p.group_topic_id = t.id AND p.status = 'published' AND p.deleted_at IS NULL)::int AS post_count
  FROM social_schema.group_topics t`;

/**
 * Store Postgres của nhóm đợt 2: `group_post_permitted`, `group_topics`, `group_priorities`,
 * `group_member_sources` và đồng bộ thành viên. Mọi truy vấn tham số hoá; mọi thay đổi nhiều bước
 * chạy trong một transaction dưới khoá dòng nhóm (hoặc khoá cố vấn theo người với ưu tiên).
 */
export class PostgresSocialGroupV2Store implements SocialGroupV2Store {
  private readonly runner: TenantQueryRunner;

  constructor(references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) {
    this.runner = new TenantQueryRunner(references, pools);
  }

  readonly posting = {
    info: (tenantId: string, groupId: string, userId: string): Promise<GroupPostingInfo | undefined> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<{
          deleted: boolean;
          post_permission: SocialGroupPostPermission;
          role: SocialGroupRole | null;
          permitted: boolean;
        }>(
          `SELECT (g.deleted_at IS NOT NULL) AS deleted, g.post_permission, m.role,
                  EXISTS (SELECT 1 FROM social_schema.group_post_permitted pp
                           WHERE pp.group_id = g.id AND pp.user_id = $2::uuid) AS permitted
             FROM social_schema.groups g
             LEFT JOIN social_schema.group_members m ON m.group_id = g.id AND m.user_id = $2::uuid
            WHERE g.id = $1::uuid`,
          [groupId, userId],
        );
        const row = result.rows[0];
        if (!row) return undefined;
        return {
          deleted: row.deleted,
          postPermission: row.post_permission,
          ...(row.role ? { role: row.role } : {}),
          permitted: row.permitted,
        };
      }),

    permittedUserIds: (tenantId: string, groupId: string): Promise<string[]> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<{ user_id: string }>(
          `SELECT pp.user_id
             FROM social_schema.group_post_permitted pp
             JOIN social_schema.group_members m ON m.group_id = pp.group_id AND m.user_id = pp.user_id
            WHERE pp.group_id = $1::uuid
            ORDER BY m.joined_at, pp.user_id`,
          [groupId],
        );
        return result.rows.map((row) => row.user_id);
      }),
  };

  readonly topics = {
    list: (tenantId: string, groupId: string): Promise<GroupTopicRow[]> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<TopicRecord>(
          `${TOPIC_SELECT}
            WHERE t.group_id = $1::uuid
            ORDER BY t.position, t.created_at, t.id`,
          [groupId],
        );
        return result.rows.map(mapTopic);
      }),

    create: (
      tenantId: string,
      input: { readonly id: string; readonly groupId: string; readonly name: string; readonly createdBy: string },
    ): Promise<GroupTopicRow> =>
      this.runner.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          // Khoá dòng nhóm để hai người cùng thêm chủ đề không vượt giới hạn.
          await client.query(`SELECT 1 FROM social_schema.groups WHERE id = $1::uuid FOR UPDATE`, [input.groupId]);
          const counted = await client.query<{ n: number; next_position: number }>(
            `SELECT count(*)::int AS n, COALESCE(max(position) + 1, 0)::int AS next_position
               FROM social_schema.group_topics WHERE group_id = $1::uuid`,
            [input.groupId],
          );
          const stats = counted.rows[0];
          if ((stats?.n ?? 0) >= SOCIAL_GROUP_TOPICS_MAX) throw new SocialGroupTopicLimitError(SOCIAL_GROUP_TOPICS_MAX);
          try {
            await client.query(
              `INSERT INTO social_schema.group_topics (id, group_id, name, position, created_by)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid)`,
              [input.id, input.groupId, input.name, stats?.next_position ?? 0, input.createdBy],
            );
          } catch (error) {
            if (isUniqueViolation(error)) throw new SocialGroupTopicNameTakenError(input.name);
            throw error;
          }
          const row = await client.query<TopicRecord>(`${TOPIC_SELECT} WHERE t.id = $1::uuid`, [input.id]);
          return mapTopic(row.rows[0] as TopicRecord);
        }),
      ),

    update: (
      tenantId: string,
      groupId: string,
      topicId: string,
      patch: { readonly name?: string; readonly position?: number },
    ): Promise<GroupTopicRow | undefined> =>
      this.runner.run(tenantId, async (pool) => {
        const sets: string[] = [];
        const values: unknown[] = [groupId, topicId];
        if (patch.name !== undefined) {
          values.push(patch.name);
          sets.push(`name = $${values.length}`);
        }
        if (patch.position !== undefined) {
          values.push(patch.position);
          sets.push(`position = $${values.length}`);
        }
        if (sets.length > 0) {
          try {
            const updated = await pool.query(
              `UPDATE social_schema.group_topics SET ${sets.join(', ')}, updated_at = now()
                WHERE group_id = $1::uuid AND id = $2::uuid`,
              values,
            );
            if ((updated.rowCount ?? 0) === 0) return undefined;
          } catch (error) {
            if (isUniqueViolation(error)) throw new SocialGroupTopicNameTakenError(patch.name ?? '');
            throw error;
          }
        }
        const row = await pool.query<TopicRecord>(`${TOPIC_SELECT} WHERE t.group_id = $1::uuid AND t.id = $2::uuid`, [
          groupId,
          topicId,
        ]);
        return row.rows[0] ? mapTopic(row.rows[0]) : undefined;
      }),

    remove: (tenantId: string, groupId: string, topicId: string): Promise<boolean> =>
      this.runner.run(tenantId, async (pool) => {
        // `posts.group_topic_id` có `ON DELETE SET NULL`: bài giữ nguyên, chỉ về "không chủ đề".
        const result = await pool.query(
          `DELETE FROM social_schema.group_topics WHERE group_id = $1::uuid AND id = $2::uuid`,
          [groupId, topicId],
        );
        return (result.rowCount ?? 0) > 0;
      }),

    byIds: (tenantId: string, topicIds: readonly string[], groupId?: string): Promise<GroupTopicRefRow[]> =>
      this.runner.run(tenantId, async (pool) => {
        if (topicIds.length === 0) return [];
        const values: unknown[] = [topicIds];
        let where = `t.id = ANY($1::uuid[])`;
        if (groupId) {
          values.push(groupId);
          where += ` AND t.group_id = $2::uuid`;
        }
        const result = await pool.query<{ id: string; group_id: string; name: string }>(
          `SELECT t.id, t.group_id, t.name
             FROM social_schema.group_topics t
             JOIN social_schema.groups g ON g.id = t.group_id AND g.deleted_at IS NULL
            WHERE ${where}`,
          values,
        );
        return result.rows.map((row) => ({ id: row.id, groupId: row.group_id, name: row.name }));
      }),
  };

  readonly priorities = {
    set: (
      tenantId: string,
      groupId: string,
      userId: string,
      pinned: boolean,
      max: number,
    ): Promise<{ readonly pinned: boolean; readonly pinnedAt?: string }> =>
      this.runner.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          // Khoá theo người: hai lần ghim đồng thời của cùng một người không vượt `max`.
          await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [
            `social-group-priority:${userId}`,
          ]);
          if (!pinned) {
            await client.query(
              `DELETE FROM social_schema.group_priorities WHERE group_id = $1::uuid AND user_id = $2::uuid`,
              [groupId, userId],
            );
            return { pinned: false };
          }
          const existing = await client.query<{ pinned_at: string }>(
            `SELECT ${isoColumn('pinned_at')} AS pinned_at
               FROM social_schema.group_priorities WHERE group_id = $1::uuid AND user_id = $2::uuid`,
            [groupId, userId],
          );
          if (existing.rows[0]) return { pinned: true, pinnedAt: existing.rows[0].pinned_at };
          const counted = await client.query<{ n: number }>(
            `SELECT count(*)::int AS n
               FROM social_schema.group_priorities pr
               JOIN social_schema.groups g ON g.id = pr.group_id AND g.deleted_at IS NULL
              WHERE pr.user_id = $1::uuid`,
            [userId],
          );
          if ((counted.rows[0]?.n ?? 0) >= max) throw new SocialGroupPriorityLimitError(max);
          const inserted = await client.query<{ pinned_at: string }>(
            `INSERT INTO social_schema.group_priorities (user_id, group_id) VALUES ($1::uuid, $2::uuid)
             RETURNING ${isoColumn('pinned_at')} AS pinned_at`,
            [userId, groupId],
          );
          return { pinned: true, pinnedAt: inserted.rows[0]?.pinned_at };
        }),
      ),
  };

  readonly sources = {
    list: (tenantId: string, groupId: string): Promise<GroupSourceRow[]> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<{
          id: string;
          source_type: GroupSourceRow['type'];
          source_id: string;
          source_name: string;
          include_descendants: boolean;
        }>(
          `SELECT id, source_type, source_id, source_name, include_descendants
             FROM social_schema.group_member_sources
            WHERE group_id = $1::uuid
            ORDER BY created_at, id`,
          [groupId],
        );
        return result.rows.map((row) => ({
          id: row.id,
          type: row.source_type,
          sourceId: row.source_id,
          name: row.source_name,
          includeDescendants: row.include_descendants,
        }));
      }),

    replace: (
      tenantId: string,
      groupId: string,
      sources: readonly GroupSourceInsert[],
      mode: 'manual' | 'org',
    ): Promise<void> =>
      this.runner.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          await lockGroup(client, groupId);
          await client.query(`DELETE FROM social_schema.group_member_sources WHERE group_id = $1::uuid`, [groupId]);
          if (sources.length > 0) {
            await client.query(
              `INSERT INTO social_schema.group_member_sources
                 (group_id, source_type, source_id, source_name, include_descendants)
               SELECT $1::uuid, t, i, n, d
                 FROM unnest($2::varchar[], $3::uuid[], $4::varchar[], $5::boolean[]) AS s(t, i, n, d)`,
              [
                groupId,
                sources.map((source) => source.type),
                sources.map((source) => source.sourceId),
                sources.map((source) => source.name),
                sources.map((source) => source.includeDescendants),
              ],
            );
          }
          await client.query(
            `UPDATE social_schema.groups SET membership_mode = $2::varchar, updated_at = now() WHERE id = $1::uuid`,
            [groupId, mode],
          );
        }),
      ),
  };

  readonly sync = {
    apply: (tenantId: string, input: GroupSyncInput): Promise<GroupSyncResult | undefined> =>
      this.runner.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          if (!(await lockGroup(client, input.groupId))) return undefined;

          const inserted = await client.query<{ user_id: string }>(
            `INSERT INTO social_schema.group_members (group_id, user_id, role, added_by, added_via)
             SELECT $1::uuid, u, 'member', $3::uuid, 'sync' FROM unnest($2::uuid[]) AS u
             ON CONFLICT DO NOTHING
             RETURNING user_id`,
            [input.groupId, input.desiredUserIds, input.actorId],
          );
          const added = inserted.rows.map((row) => row.user_id);

          let removedCount = 0;
          if (input.prune) {
            // Chỉ người do đồng bộ mang vào và vẫn là thành viên thường; admin, người thêm tay, người
            // tự tham gia, người tạo nhóm không bao giờ bị gỡ ở đây.
            const removed = await client.query<{ user_id: string }>(
              `DELETE FROM social_schema.group_members
                WHERE group_id = $1::uuid AND added_via = 'sync' AND role = 'member'
                  AND NOT (user_id = ANY($2::uuid[]))
                RETURNING user_id`,
              [input.groupId, input.desiredUserIds],
            );
            removedCount = removed.rows.length;
            const removedIds = removed.rows.map((row) => row.user_id);
            if (removedIds.length > 0) {
              await client.query(
                `DELETE FROM social_schema.group_priorities WHERE group_id = $1::uuid AND user_id = ANY($2::uuid[])`,
                [input.groupId, removedIds],
              );
              await client.query(
                `DELETE FROM social_schema.group_post_permitted WHERE group_id = $1::uuid AND user_id = ANY($2::uuid[])`,
                [input.groupId, removedIds],
              );
            }
          }

          const stamped = await client.query<{ synced_at: string }>(
            `UPDATE social_schema.groups
                SET last_synced_at = now(), last_synced_by = $2::uuid, updated_at = now()
              WHERE id = $1::uuid
              RETURNING ${isoColumn('last_synced_at')} AS synced_at`,
            [input.groupId, input.actorId],
          );
          const count = await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM social_schema.group_members WHERE group_id = $1::uuid`,
            [input.groupId],
          );
          await writeOutboxAll(client, tenantId, input.events(added));
          return {
            added,
            removedCount,
            memberCount: count.rows[0]?.n ?? 0,
            syncedAt: stamped.rows[0]?.synced_at ?? new Date().toISOString(),
          };
        }),
      ),
  };
}

/** Khoá dòng nhóm chưa xoá; `false` nếu nhóm không còn. */
async function lockGroup(client: PoolClient, groupId: string): Promise<boolean> {
  const locked = await client.query(
    `SELECT 1 FROM social_schema.groups WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
    [groupId],
  );
  return (locked.rowCount ?? 0) > 0;
}
