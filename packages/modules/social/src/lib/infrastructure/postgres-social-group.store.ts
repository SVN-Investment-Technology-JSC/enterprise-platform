import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import type {
  SocialGroupColor,
  SocialGroupCoverPreset,
  SocialGroupIcon,
  SocialGroupMembershipMode,
  SocialGroupPostPermission,
  SocialGroupPrivacy,
  SocialGroupRole,
  SocialJoinRequestStatus,
} from '@enterprise-platform/contracts-social';
import type { PoolClient } from 'pg';
import type {
  GroupInsert,
  GroupMemberAddedVia,
  GroupListRead,
  GroupMemberListRead,
  GroupMemberRow,
  GroupOutboxEvent,
  GroupPatch,
  GroupRow,
  JoinRequestListRead,
  JoinRequestRow,
  JoinRequestWithGroupRow,
  SocialGroupStore,
} from '../application/social-group-store.port.js';
import {
  SocialGroupJoinRequestExistsError,
  SocialGroupLastAdminError,
  SocialGroupNameTakenError,
} from '../domain/social-group.error.js';
import { TenantQueryRunner, isUniqueViolation, isoColumn, writeOutboxAll } from './group-sql-support.js';

const GROUP_SELECT = `SELECT g.id, g.name, g.description, g.privacy, g.color, g.icon, g.created_by,
       ${isoColumn('g.created_at')} AS created_at,
       (g.deleted_at IS NOT NULL) AS deleted,
       (SELECT count(*) FROM social_schema.group_members m WHERE m.group_id = g.id)::int AS member_count,
       (SELECT count(*) FROM social_schema.group_members m
         WHERE m.group_id = g.id AND m.role = 'admin')::int AS admin_count,
       (SELECT count(*) FROM social_schema.group_join_requests r
         WHERE r.group_id = g.id AND r.status = 'pending')::int AS pending_count,
       me.role AS my_role,
       ${isoColumn('me.joined_at')} AS my_joined_at,
       (SELECT r.id FROM social_schema.group_join_requests r
         WHERE r.group_id = g.id AND r.user_id = $1::uuid AND r.status = 'pending') AS my_request_id,
       g.description_html, g.cover_preset, g.post_permission, g.membership_mode,
       ${isoColumn('g.last_synced_at')} AS last_synced_at,
       ${isoColumn('pr.pinned_at')} AS my_priority_at,
       EXISTS (SELECT 1 FROM social_schema.group_post_permitted pp
                WHERE pp.group_id = g.id AND pp.user_id = $1::uuid) AS my_post_permitted
  FROM social_schema.groups g
  LEFT JOIN social_schema.group_members me ON me.group_id = g.id AND me.user_id = $1::uuid
  LEFT JOIN social_schema.group_priorities pr ON pr.group_id = g.id AND pr.user_id = $1::uuid`;

/** Số nhóm ưu tiên đọc tối đa một lần (trần an toàn, luật thật là SOCIAL_GROUP_PRIORITY_MAX). */
const PINNED_READ_CAP = 50;

const REQUEST_SELECT = `SELECT r.id, r.group_id, r.user_id, r.message, r.status,
       ${isoColumn('r.created_at')} AS created_at`;

interface GroupRecord {
  id: string;
  name: string;
  description: string | null;
  privacy: SocialGroupPrivacy;
  color: SocialGroupColor;
  icon: SocialGroupIcon;
  created_by: string;
  created_at: string;
  deleted: boolean;
  member_count: number;
  admin_count: number;
  pending_count: number;
  my_role: SocialGroupRole | null;
  my_joined_at: string | null;
  my_request_id: string | null;
  description_html: string | null;
  cover_preset: SocialGroupCoverPreset | null;
  post_permission: SocialGroupPostPermission;
  membership_mode: SocialGroupMembershipMode;
  last_synced_at: string | null;
  my_priority_at: string | null;
  my_post_permitted: boolean;
}

interface MemberRecord {
  user_id: string;
  role: SocialGroupRole;
  joined_at: string;
}

interface RequestRecord {
  id: string;
  group_id: string;
  user_id: string;
  message: string | null;
  status: SocialJoinRequestStatus;
  created_at: string;
  group_name?: string;
}

function mapGroup(row: GroupRecord): GroupRow {
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    privacy: row.privacy,
    color: row.color,
    icon: row.icon,
    createdBy: row.created_by,
    createdAt: row.created_at,
    deleted: row.deleted,
    memberCount: row.member_count,
    adminCount: row.admin_count,
    pendingRequestCount: row.pending_count,
    ...(row.my_role ? { myRole: row.my_role } : {}),
    ...(row.my_joined_at ? { myJoinedAt: row.my_joined_at } : {}),
    ...(row.my_request_id ? { myPendingRequestId: row.my_request_id } : {}),
    ...(row.description_html ? { descriptionHtml: row.description_html } : {}),
    ...(row.cover_preset ? { coverPreset: row.cover_preset } : {}),
    postPermission: row.post_permission,
    membershipMode: row.membership_mode,
    ...(row.last_synced_at ? { lastSyncedAt: row.last_synced_at } : {}),
    ...(row.my_priority_at ? { myPriorityAt: row.my_priority_at } : {}),
    myPostPermitted: row.my_post_permitted,
  };
}

function mapMember(row: MemberRecord): GroupMemberRow {
  return { userId: row.user_id, role: row.role, joinedAt: row.joined_at };
}

function mapRequest(row: RequestRecord): JoinRequestRow {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    ...(row.message ? { message: row.message } : {}),
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * Store Postgres của nhóm trên DB riêng của tenant (schema `social_schema`: `groups`,
 * `group_members`, `group_join_requests`). Mọi truy vấn tham số hoá; tên bảng và cột là chuỗi cố
 * định trong file này. Sự kiện ghi vào outbox cùng transaction.
 */
export class PostgresSocialGroupStore implements SocialGroupStore {
  private readonly runner: TenantQueryRunner;

  constructor(references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) {
    this.runner = new TenantQueryRunner(references, pools);
  }

  readonly groups = {
    find: (tenantId: string, groupId: string, viewerId?: string): Promise<GroupRow | undefined> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<GroupRecord>(`${GROUP_SELECT} WHERE g.id = $2::uuid`, [
          viewerId ?? null,
          groupId,
        ]);
        return result.rows[0] ? mapGroup(result.rows[0]) : undefined;
      }),

    refs: (tenantId: string, groupIds: readonly string[]): Promise<GroupRow[]> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<GroupRecord>(
          `${GROUP_SELECT} WHERE g.id = ANY($2::uuid[]) AND g.deleted_at IS NULL`,
          [null, groupIds],
        );
        return result.rows.map(mapGroup);
      }),

    list: (tenantId: string, read: GroupListRead): Promise<GroupRow[]> =>
      this.runner.run(tenantId, async (pool) => {
        const values: unknown[] = [read.viewerId];
        let where = `g.deleted_at IS NULL`;
        if (read.scope === 'mine') {
          where += ` AND me.user_id IS NOT NULL`;
        } else {
          // `seesAllGroups` là boolean của TypeScript, không phải chuỗi người dùng.
          where += ` AND (g.privacy = 'public' OR me.user_id IS NOT NULL OR ${read.seesAllGroups ? 'TRUE' : 'FALSE'})`;
        }
        if (read.query) {
          values.push(read.query);
          where += ` AND position(social_schema.fold_text($${values.length}) in g.search_text) > 0`;
        }

        // `mine`: nhóm ưu tiên đứng đầu trang đầu (tối đa SOCIAL_GROUP_PRIORITY_MAX), phần còn lại
        // phân trang theo thời điểm tạo; các trang sau không lặp lại nhóm ưu tiên.
        let pinned: GroupRow[] = [];
        if (read.scope === 'mine') {
          if (!read.cursor) {
            const pinnedResult = await pool.query<GroupRecord>(
              `${GROUP_SELECT}
                WHERE ${where} AND pr.group_id IS NOT NULL
                ORDER BY pr.pinned_at DESC, g.id DESC
                LIMIT ${PINNED_READ_CAP}`,
              values,
            );
            pinned = pinnedResult.rows.map(mapGroup);
          }
          where += ` AND pr.group_id IS NULL`;
        }

        if (read.cursor) {
          values.push(read.cursor.at, read.cursor.id);
          where += ` AND (g.created_at, g.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
        }
        values.push(read.limit);
        const result = await pool.query<GroupRecord>(
          `${GROUP_SELECT}
            WHERE ${where}
            ORDER BY g.created_at DESC, g.id DESC
            LIMIT $${values.length}`,
          values,
        );
        return [...pinned, ...result.rows.map(mapGroup)];
      }),

    suggestions: (tenantId: string, viewerId: string, limit: number): Promise<GroupRow[]> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<GroupRecord>(
          `${GROUP_SELECT}
            WHERE g.deleted_at IS NULL AND g.privacy = 'public' AND me.user_id IS NULL
            ORDER BY (SELECT count(*) FROM social_schema.group_members m WHERE m.group_id = g.id) DESC,
                     g.created_at DESC, g.id DESC
            LIMIT $2`,
          [viewerId, limit],
        );
        return result.rows.map(mapGroup);
      }),

    memberGroupIds: (tenantId: string, userId: string): Promise<string[]> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<{ group_id: string }>(
          `SELECT m.group_id
             FROM social_schema.group_members m
             JOIN social_schema.groups g ON g.id = m.group_id AND g.deleted_at IS NULL
            WHERE m.user_id = $1::uuid`,
          [userId],
        );
        return result.rows.map((row) => row.group_id);
      }),

    insert: (tenantId: string, input: GroupInsert): Promise<void> =>
      this.runner.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          try {
            await client.query(
              `INSERT INTO social_schema.groups
                 (id, name, description, description_html, cover_preset, privacy, color, icon, created_by,
                  post_permission, membership_mode, last_synced_at, last_synced_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10, $11::varchar,
                       CASE WHEN $11::varchar = 'org' THEN now() END,
                       CASE WHEN $11::varchar = 'org' THEN $9::uuid END)`,
              [
                input.id,
                input.name,
                input.description ?? null,
                input.descriptionHtml ?? null,
                input.coverPreset ?? null,
                input.privacy,
                input.color,
                input.icon,
                input.createdBy,
                input.postPermission,
                input.membershipMode,
              ],
            );
          } catch (error) {
            if (isUniqueViolation(error)) throw new SocialGroupNameTakenError(input.name);
            throw error;
          }
          await client.query(
            `INSERT INTO social_schema.group_members (group_id, user_id, role, added_via)
             VALUES ($1, $2, 'admin', 'creator')`,
            [input.id, input.createdBy],
          );
          // Thứ tự quan trọng: người đã có (ON CONFLICT) giữ vai trò và cách vào của lần thêm đầu,
          // nên quản lý đứng trước thành viên thường, thêm tay đứng trước nở từ phòng ban.
          await insertMembers(client, input.id, input.adminUserIds, 'admin', input.createdBy, 'manual');
          await insertMembers(client, input.id, input.memberUserIds, 'member', input.createdBy, 'manual');
          await insertMembers(client, input.id, input.syncedUserIds, 'member', input.createdBy, 'sync');
          if (input.sources.length > 0) {
            await client.query(
              `INSERT INTO social_schema.group_member_sources
                 (group_id, source_type, source_id, source_name, include_descendants)
               SELECT $1::uuid, t, i, n, d
                 FROM unnest($2::varchar[], $3::uuid[], $4::varchar[], $5::boolean[]) AS s(t, i, n, d)`,
              [
                input.id,
                input.sources.map((source) => source.type),
                input.sources.map((source) => source.sourceId),
                input.sources.map((source) => source.name),
                input.sources.map((source) => source.includeDescendants),
              ],
            );
          }
          if (input.postPermittedUserIds.length > 0) {
            await client.query(
              `INSERT INTO social_schema.group_post_permitted (group_id, user_id)
               SELECT $1::uuid, u FROM unnest($2::uuid[]) AS u
               ON CONFLICT DO NOTHING`,
              [input.id, input.postPermittedUserIds],
            );
          }
          await writeOutboxAll(client, tenantId, input.events);
        }),
      ),

    update: (tenantId: string, groupId: string, patch: GroupPatch): Promise<void> =>
      this.runner.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          const sets: string[] = [];
          const values: unknown[] = [groupId];
          const set = (column: string, value: unknown): void => {
            values.push(value);
            sets.push(`${column} = $${values.length}`);
          };
          if (patch.name !== undefined) set('name', patch.name);
          if (patch.description !== undefined) set('description', patch.description);
          if (patch.descriptionHtml !== undefined) set('description_html', patch.descriptionHtml);
          if (patch.coverPreset !== undefined) set('cover_preset', patch.coverPreset);
          if (patch.privacy !== undefined) set('privacy', patch.privacy);
          if (patch.color !== undefined) set('color', patch.color);
          if (patch.icon !== undefined) set('icon', patch.icon);
          if (patch.postPermission !== undefined) set('post_permission', patch.postPermission);
          if (sets.length > 0) {
            try {
              await client.query(
                `UPDATE social_schema.groups SET ${sets.join(', ')}, updated_at = now()
                  WHERE id = $1 AND deleted_at IS NULL`,
                values,
              );
            } catch (error) {
              if (isUniqueViolation(error)) throw new SocialGroupNameTakenError(patch.name ?? '');
              throw error;
            }
          }
          if (patch.postPermittedUserIds !== undefined) {
            await client.query(`DELETE FROM social_schema.group_post_permitted WHERE group_id = $1::uuid`, [groupId]);
            if (patch.postPermittedUserIds.length > 0) {
              // Chỉ người đang là thành viên mới ở lại danh sách.
              await client.query(
                `INSERT INTO social_schema.group_post_permitted (group_id, user_id)
                 SELECT $1::uuid, m.user_id
                   FROM social_schema.group_members m
                  WHERE m.group_id = $1::uuid AND m.user_id = ANY($2::uuid[])
                 ON CONFLICT DO NOTHING`,
                [groupId, patch.postPermittedUserIds],
              );
            }
          }
        }),
      ),

    softDelete: (tenantId: string, groupId: string, userId: string): Promise<void> =>
      this.runner.run(tenantId, async (pool) => {
        await pool.query(
          `UPDATE social_schema.groups
              SET deleted_at = now(), deleted_by = $2, updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL`,
          [groupId, userId],
        );
      }),
  };

  readonly members = {
    find: (tenantId: string, groupId: string, userId: string): Promise<GroupMemberRow | undefined> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<MemberRecord>(
          `SELECT m.user_id, m.role, ${isoColumn('m.joined_at')} AS joined_at
             FROM social_schema.group_members m
             JOIN social_schema.groups g ON g.id = m.group_id AND g.deleted_at IS NULL
            WHERE m.group_id = $1::uuid AND m.user_id = $2::uuid`,
          [groupId, userId],
        );
        return result.rows[0] ? mapMember(result.rows[0]) : undefined;
      }),

    list: (tenantId: string, read: GroupMemberListRead): Promise<GroupMemberRow[]> =>
      this.runner.run(tenantId, async (pool) => {
        const values: unknown[] = [read.groupId];
        let where = `m.group_id = $1::uuid`;
        if (read.role) {
          values.push(read.role);
          where += ` AND m.role = $${values.length}`;
        }
        if (read.userIds) {
          values.push(read.userIds);
          where += ` AND m.user_id = ANY($${values.length}::uuid[])`;
        }
        if (read.cursor) {
          values.push(read.cursor.at, read.cursor.id);
          where += ` AND (m.joined_at, m.user_id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
        }
        values.push(read.limit);
        const result = await pool.query<MemberRecord>(
          `SELECT m.user_id, m.role, ${isoColumn('m.joined_at')} AS joined_at
             FROM social_schema.group_members m
             JOIN social_schema.groups g ON g.id = m.group_id AND g.deleted_at IS NULL
            WHERE ${where}
            ORDER BY m.joined_at, m.user_id
            LIMIT $${values.length}`,
          values,
        );
        return result.rows.map(mapMember);
      }),

    listIds: (tenantId: string, groupId: string, limit?: number): Promise<string[]> =>
      this.runner.run(tenantId, async (pool) => {
        const values: unknown[] = [groupId];
        let tail = '';
        if (limit !== undefined) {
          values.push(limit);
          tail = ` LIMIT $2`;
        }
        const result = await pool.query<{ user_id: string }>(
          `SELECT m.user_id
             FROM social_schema.group_members m
             JOIN social_schema.groups g ON g.id = m.group_id AND g.deleted_at IS NULL
            WHERE m.group_id = $1::uuid
            ORDER BY (m.role = 'admin') DESC, m.joined_at, m.user_id${tail}`,
          values,
        );
        return result.rows.map((row) => row.user_id);
      }),

    listAdminIds: (tenantId: string, groupId: string): Promise<string[]> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<{ user_id: string }>(
          `SELECT m.user_id
             FROM social_schema.group_members m
             JOIN social_schema.groups g ON g.id = m.group_id AND g.deleted_at IS NULL
            WHERE m.group_id = $1::uuid AND m.role = 'admin'
            ORDER BY m.joined_at, m.user_id`,
          [groupId],
        );
        return result.rows.map((row) => row.user_id);
      }),

    add: (
      tenantId: string,
      groupId: string,
      userIds: readonly string[],
      role: SocialGroupRole,
      addedBy: string | null,
      events: (inserted: readonly string[]) => readonly GroupOutboxEvent[],
      addedVia?: GroupMemberAddedVia,
    ): Promise<string[]> =>
      this.runner.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          const via = addedVia ?? (addedBy === null ? 'join' : 'manual');
          const result = await client.query<{ user_id: string }>(
            `INSERT INTO social_schema.group_members (group_id, user_id, role, added_by, added_via)
             SELECT g.id, u, $3::varchar, $4::uuid, $5::varchar
               FROM social_schema.groups g
              CROSS JOIN unnest($2::uuid[]) AS u
              WHERE g.id = $1::uuid AND g.deleted_at IS NULL
             ON CONFLICT DO NOTHING
             RETURNING user_id`,
            [groupId, userIds, role, addedBy, via],
          );
          const inserted = result.rows.map((row) => row.user_id);
          if (via === 'manual') {
            // Người do đồng bộ mang vào mà được thêm tay thì từ nay là "thêm tay": đồng bộ không gỡ nữa.
            await client.query(
              `UPDATE social_schema.group_members SET added_via = 'manual'
                WHERE group_id = $1::uuid AND user_id = ANY($2::uuid[]) AND added_via = 'sync'`,
              [groupId, userIds],
            );
          }
          await writeOutboxAll(client, tenantId, events(inserted));
          return inserted;
        }),
      ),

    setRole: (tenantId: string, groupId: string, userId: string, role: SocialGroupRole): Promise<boolean> =>
      this.runner.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          const current = await lockedRole(client, groupId, userId);
          if (current === undefined) return false;
          if (current === 'admin' && role !== 'admin') await assertAnotherAdmin(client, groupId);
          await client.query(
            `UPDATE social_schema.group_members
                SET role = $3::varchar,
                    added_via = CASE WHEN $3::varchar = 'admin' AND added_via = 'sync' THEN 'manual' ELSE added_via END
              WHERE group_id = $1::uuid AND user_id = $2::uuid`,
            [groupId, userId, role],
          );
          return true;
        }),
      ),

    remove: (tenantId: string, groupId: string, userId: string): Promise<boolean> =>
      this.runner.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          const current = await lockedRole(client, groupId, userId);
          if (current === undefined) return false;
          if (current === 'admin') await assertAnotherAdmin(client, groupId);
          await client.query(
            `DELETE FROM social_schema.group_members WHERE group_id = $1::uuid AND user_id = $2::uuid`,
            [groupId, userId],
          );
          await client.query(
            `DELETE FROM social_schema.group_priorities WHERE group_id = $1::uuid AND user_id = $2::uuid`,
            [groupId, userId],
          );
          await client.query(
            `DELETE FROM social_schema.group_post_permitted WHERE group_id = $1::uuid AND user_id = $2::uuid`,
            [groupId, userId],
          );
          return true;
        }),
      ),
  };

  readonly requests = {
    findPending: (tenantId: string, groupId: string, userId: string): Promise<JoinRequestRow | undefined> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<RequestRecord>(
          `${REQUEST_SELECT}
             FROM social_schema.group_join_requests r
            WHERE r.group_id = $1::uuid AND r.user_id = $2::uuid AND r.status = 'pending'`,
          [groupId, userId],
        );
        return result.rows[0] ? mapRequest(result.rows[0]) : undefined;
      }),

    findPendingById: (tenantId: string, groupId: string, requestId: string): Promise<JoinRequestRow | undefined> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<RequestRecord>(
          `${REQUEST_SELECT}
             FROM social_schema.group_join_requests r
            WHERE r.id = $2::uuid AND r.group_id = $1::uuid AND r.status = 'pending'`,
          [groupId, requestId],
        );
        return result.rows[0] ? mapRequest(result.rows[0]) : undefined;
      }),

    create: (
      tenantId: string,
      input: {
        readonly id: string;
        readonly groupId: string;
        readonly userId: string;
        readonly message?: string;
        readonly events: readonly GroupOutboxEvent[];
      },
    ): Promise<void> =>
      this.runner.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          try {
            await client.query(
              `INSERT INTO social_schema.group_join_requests (id, group_id, user_id, message)
               VALUES ($1, $2, $3, $4)`,
              [input.id, input.groupId, input.userId, input.message ?? null],
            );
          } catch (error) {
            if (isUniqueViolation(error)) throw new SocialGroupJoinRequestExistsError();
            throw error;
          }
          await writeOutboxAll(client, tenantId, input.events);
        }),
      ),

    cancel: (tenantId: string, groupId: string, userId: string): Promise<boolean> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query(
          `UPDATE social_schema.group_join_requests
              SET status = 'cancelled', decided_by = $2::uuid, decided_at = now()
            WHERE group_id = $1::uuid AND user_id = $2::uuid AND status = 'pending'`,
          [groupId, userId],
        );
        return (result.rowCount ?? 0) > 0;
      }),

    decide: (
      tenantId: string,
      input: {
        readonly groupId: string;
        readonly requestId: string;
        readonly decision: 'approved' | 'rejected';
        readonly decidedBy: string;
        readonly events: readonly GroupOutboxEvent[];
      },
    ): Promise<{ readonly member?: GroupMemberRow } | undefined> =>
      this.runner.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          const decided = await client.query<{ user_id: string }>(
            `UPDATE social_schema.group_join_requests
                SET status = $3, decided_by = $4::uuid, decided_at = now()
              WHERE id = $1::uuid AND group_id = $2::uuid AND status = 'pending'
              RETURNING user_id`,
            [input.requestId, input.groupId, input.decision, input.decidedBy],
          );
          const requester = decided.rows[0]?.user_id;
          if (!requester) return undefined;

          let member: GroupMemberRow | undefined;
          if (input.decision === 'approved') {
            await client.query(
              `INSERT INTO social_schema.group_members (group_id, user_id, role, added_by, added_via)
               VALUES ($1::uuid, $2::uuid, 'member', $3::uuid, 'join')
               ON CONFLICT DO NOTHING`,
              [input.groupId, requester, input.decidedBy],
            );
            const row = await client.query<MemberRecord>(
              `SELECT m.user_id, m.role, ${isoColumn('m.joined_at')} AS joined_at
                 FROM social_schema.group_members m
                WHERE m.group_id = $1::uuid AND m.user_id = $2::uuid`,
              [input.groupId, requester],
            );
            member = row.rows[0] ? mapMember(row.rows[0]) : undefined;
          }
          await writeOutboxAll(client, tenantId, input.events);
          return member ? { member } : {};
        }),
      ),

    listPending: (tenantId: string, groupId: string, read: JoinRequestListRead): Promise<JoinRequestRow[]> =>
      this.runner.run(tenantId, async (pool) => {
        const values: unknown[] = [groupId];
        let where = `r.group_id = $1::uuid AND r.status = 'pending'`;
        if (read.cursor) {
          values.push(read.cursor.at, read.cursor.id);
          where += ` AND (r.created_at, r.id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
        }
        values.push(read.limit);
        const result = await pool.query<RequestRecord>(
          `${REQUEST_SELECT}
             FROM social_schema.group_join_requests r
            WHERE ${where}
            ORDER BY r.created_at, r.id
            LIMIT $${values.length}`,
          values,
        );
        return result.rows.map(mapRequest);
      }),

    inbox: (tenantId: string, adminUserId: string, read: JoinRequestListRead): Promise<JoinRequestWithGroupRow[]> =>
      this.runner.run(tenantId, async (pool) => {
        const values: unknown[] = [adminUserId];
        let where = `r.status = 'pending'`;
        if (read.cursor) {
          values.push(read.cursor.at, read.cursor.id);
          where += ` AND (r.created_at, r.id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
        }
        values.push(read.limit);
        const result = await pool.query<RequestRecord>(
          `${REQUEST_SELECT}, g.name AS group_name
             FROM social_schema.group_join_requests r
             JOIN social_schema.group_members me
               ON me.group_id = r.group_id AND me.user_id = $1::uuid AND me.role = 'admin'
             JOIN social_schema.groups g ON g.id = r.group_id AND g.deleted_at IS NULL
            WHERE ${where}
            ORDER BY r.created_at, r.id
            LIMIT $${values.length}`,
          values,
        );
        return result.rows.map((row) => ({ ...mapRequest(row), groupName: row.group_name ?? '' }));
      }),

    inboxCount: (tenantId: string, adminUserId: string): Promise<number> =>
      this.runner.run(tenantId, async (pool) => {
        const result = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n
             FROM social_schema.group_join_requests r
             JOIN social_schema.group_members me
               ON me.group_id = r.group_id AND me.user_id = $1::uuid AND me.role = 'admin'
             JOIN social_schema.groups g ON g.id = r.group_id AND g.deleted_at IS NULL
            WHERE r.status = 'pending'`,
          [adminUserId],
        );
        return result.rows[0]?.n ?? 0;
      }),
  };
}

/**
 * Khoá dòng nhóm (tuần tự hoá mọi thay đổi vai trò/thành viên của nhóm) rồi đọc vai trò hiện tại
 * của người này. `undefined` nếu nhóm đã xoá hoặc người này không phải thành viên.
 */
async function lockedRole(
  client: PoolClient,
  groupId: string,
  userId: string,
): Promise<SocialGroupRole | undefined> {
  const locked = await client.query(
    `SELECT 1 FROM social_schema.groups WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
    [groupId],
  );
  if (locked.rowCount === 0) return undefined;
  const row = await client.query<{ role: SocialGroupRole }>(
    `SELECT role FROM social_schema.group_members WHERE group_id = $1::uuid AND user_id = $2::uuid`,
    [groupId, userId],
  );
  return row.rows[0]?.role;
}

/** Gọi khi sắp bỏ một admin: phải còn admin khác (đã giữ khoá dòng nhóm). */
async function assertAnotherAdmin(client: PoolClient, groupId: string): Promise<void> {
  const result = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM social_schema.group_members WHERE group_id = $1::uuid AND role = 'admin'`,
    [groupId],
  );
  if ((result.rows[0]?.n ?? 0) <= 1) throw new SocialGroupLastAdminError();
}

/** Thêm hàng loạt thành viên; người đã có thì giữ nguyên (ON CONFLICT DO NOTHING). */
async function insertMembers(
  client: PoolClient,
  groupId: string,
  userIds: readonly string[],
  role: SocialGroupRole,
  addedBy: string,
  via: GroupMemberAddedVia,
): Promise<void> {
  if (userIds.length === 0) return;
  await client.query(
    `INSERT INTO social_schema.group_members (group_id, user_id, role, added_by, added_via)
     SELECT $1::uuid, u, $3::varchar, $4::uuid, $5::varchar FROM unnest($2::uuid[]) AS u
     ON CONFLICT DO NOTHING`,
    [groupId, userIds, role, addedBy, via],
  );
}
