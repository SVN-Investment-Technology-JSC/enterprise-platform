import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import type {
  SocialReportStatus,
  SocialReportTargetType,
} from '@enterprise-platform/contracts-social';
import type {
  ReportInsert,
  ReportListRead,
  ReportQueue,
  ReportRow,
  SocialReportStore,
} from '../application/social-report-store.port.js';
import { SocialReportExistsError } from '../domain/social-group.error.js';
import { TenantQueryRunner, isUniqueViolation, isoColumn, writeOutboxAll } from './group-sql-support.js';

interface ReportRecord {
  id: string;
  target_type: SocialReportTargetType;
  target_id: string;
  group_id: string | null;
  group_privacy: 'public' | 'private' | null;
  group_deleted: boolean | null;
  post_id: string | null;
  reporter_id: string;
  reason: string;
  status: SocialReportStatus;
  created_at: string;
  handled_by: string | null;
  handled_at: string | null;
  handle_note: string | null;
}

const REPORT_SELECT = `SELECT r.id, r.target_type, r.target_id, r.group_id, g.privacy AS group_privacy,
       (g.deleted_at IS NOT NULL) AS group_deleted, r.post_id, r.reporter_id, r.reason, r.status,
       ${isoColumn('r.created_at')} AS created_at, r.handled_by,
       ${isoColumn('r.handled_at')} AS handled_at, r.handle_note
  FROM social_schema.reports r
  LEFT JOIN social_schema.groups g ON g.id = r.group_id`;

function mapReport(row: ReportRecord): ReportRow {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    ...(row.group_id ? { groupId: row.group_id } : {}),
    ...(row.group_privacy ? { groupPrivacy: row.group_privacy } : {}),
    ...(row.group_id ? { groupDeleted: row.group_deleted ?? true } : {}),
    ...(row.post_id ? { postId: row.post_id } : {}),
    reporterId: row.reporter_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    ...(row.handled_by ? { handledBy: row.handled_by } : {}),
    ...(row.handled_at ? { handledAt: row.handled_at } : {}),
    ...(row.handle_note ? { handleNote: row.handle_note } : {}),
  };
}

/**
 * Điều kiện SQL của một hàng đợi. Hàng đợi moderator: Tường công ty và nhóm công khai còn tồn tại;
 * nhóm riêng tư chỉ ở hàng đợi của chính nhóm (admin nhóm). Báo cáo của nhóm đã xoá không còn ở
 * hàng đợi nào. `values` nhận tham số nếu cần.
 */
function queueWhere(queue: ReportQueue, values: unknown[]): string {
  if (queue.kind === 'moderator') {
    return `(r.group_id IS NULL OR (g.privacy = 'public' AND g.deleted_at IS NULL))`;
  }
  values.push(queue.groupId);
  return `r.group_id = $${values.length}::uuid AND g.deleted_at IS NULL`;
}

/** Store Postgres của báo cáo (`social_schema.reports`). Sự kiện ghi vào outbox cùng transaction. */
export class PostgresSocialReportStore implements SocialReportStore {
  private readonly runner: TenantQueryRunner;

  constructor(references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) {
    this.runner = new TenantQueryRunner(references, pools);
  }

  insert(tenantId: string, input: ReportInsert): Promise<void> {
    return this.runner.run(tenantId, (pool) =>
      inTransaction(pool, async (client) => {
        try {
          await client.query(
            `INSERT INTO social_schema.reports (id, target_type, target_id, group_id, post_id, reporter_id, reason)
             VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7)`,
            [
              input.id,
              input.targetType,
              input.targetId,
              input.groupId ?? null,
              input.postId ?? null,
              input.reporterId,
              input.reason,
            ],
          );
        } catch (error) {
          if (isUniqueViolation(error)) throw new SocialReportExistsError();
          throw error;
        }
        await writeOutboxAll(client, tenantId, input.events);
      }),
    );
  }

  find(tenantId: string, reportId: string): Promise<ReportRow | undefined> {
    return this.runner.run(tenantId, async (pool) => {
      const result = await pool.query<ReportRecord>(`${REPORT_SELECT} WHERE r.id = $1::uuid`, [reportId]);
      return result.rows[0] ? mapReport(result.rows[0]) : undefined;
    });
  }

  list(tenantId: string, read: ReportListRead): Promise<ReportRow[]> {
    return this.runner.run(tenantId, async (pool) => {
      const values: unknown[] = [read.status];
      let where = `r.status = $1 AND ${queueWhere(read.queue, values)}`;
      if (read.targetType) {
        values.push(read.targetType);
        where += ` AND r.target_type = $${values.length}`;
      }
      if (read.cursor) {
        values.push(read.cursor.at, read.cursor.id);
        where += ` AND (r.created_at, r.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
      }
      values.push(read.limit);
      const result = await pool.query<ReportRecord>(
        `${REPORT_SELECT}
          WHERE ${where}
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT $${values.length}`,
        values,
      );
      return result.rows.map(mapReport);
    });
  }

  openCount(tenantId: string, queue: ReportQueue): Promise<number> {
    return this.runner.run(tenantId, async (pool) => {
      const values: unknown[] = [];
      const where = queueWhere(queue, values);
      const result = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM social_schema.reports r
           LEFT JOIN social_schema.groups g ON g.id = r.group_id
          WHERE r.status = 'open' AND ${where}`,
        values,
      );
      return result.rows[0]?.n ?? 0;
    });
  }

  resolve(
    tenantId: string,
    input: {
      readonly reportId: string;
      readonly status: Exclude<SocialReportStatus, 'open'>;
      readonly note?: string;
      readonly handledBy: string;
    },
  ): Promise<ReportRow | undefined> {
    return this.runner.run(tenantId, async (pool) => {
      // `status = 'open'` trong WHERE là phép "ai xử lý trước thì xong": người đến sau không cập nhật được dòng nào.
      const updated = await pool.query(
        `UPDATE social_schema.reports
            SET status = $2, handled_by = $3::uuid, handled_at = now(), handle_note = $4
          WHERE id = $1::uuid AND status = 'open'`,
        [input.reportId, input.status, input.handledBy, input.note ?? null],
      );
      if ((updated.rowCount ?? 0) === 0) return undefined;
      const result = await pool.query<ReportRecord>(`${REPORT_SELECT} WHERE r.id = $1::uuid`, [input.reportId]);
      return result.rows[0] ? mapReport(result.rows[0]) : undefined;
    });
  }
}
