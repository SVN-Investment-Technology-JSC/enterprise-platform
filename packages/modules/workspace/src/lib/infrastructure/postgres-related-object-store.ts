import type { Pool, QueryResultRow } from 'pg';
import { WorkspaceSchemaNotReadyError } from '../domain/workspace.error.js';
import type {
  NewRelatedObject,
  RelatedObjectSnapshotUpdate,
  RelatedObjectStore,
  StoredRelatedObject,
} from '../application/related-object.port.js';

type Row = QueryResultRow & Record<string, unknown>;

const opt = (value: unknown) => (value == null ? undefined : String(value));
const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

const COLUMNS = `r.id, r.entity_type, r.entity_id, r.project_id, r.kind, r.module_key, r.kind_label, r.module_label,
       r.object_id, r.object_code, r.label, r.status, r.launch_url, r.created_by, r.created_by_name, r.created_at,
       w.code AS work_item_code, w.title AS work_item_title`;

/** Kèm mã và tên công việc; dòng của công việc đã bị xoá bị lọc bỏ (trigger cũng xoá theo, đây là lớp phòng hờ). */
const FROM = `FROM workspace_schema.related_objects r
  LEFT JOIN workspace_schema.work_items w ON r.entity_type = 'work_item' AND w.id = r.entity_id`;
const LIVE = `(r.entity_type = 'project' OR w.id IS NOT NULL)`;

function map(row: Row): StoredRelatedObject {
  const workItem =
    row['work_item_code'] != null ? `${String(row['work_item_code'])} — ${String(row['work_item_title'] ?? '')}` : undefined;
  return {
    id: String(row['id']),
    entityType: String(row['entity_type']) as StoredRelatedObject['entityType'],
    entityId: String(row['entity_id']),
    projectId: String(row['project_id']),
    entityLabel: workItem,
    kind: String(row['kind']),
    moduleKey: String(row['module_key']),
    kindLabel: opt(row['kind_label']),
    moduleLabel: opt(row['module_label']),
    objectId: String(row['object_id']),
    code: opt(row['object_code']),
    label: String(row['label']),
    status: opt(row['status']),
    launchUrl: String(row['launch_url']),
    createdBy: String(row['created_by']),
    createdByName: opt(row['created_by_name']),
    createdAt: iso(row['created_at']),
  };
}

/** Bảng chưa có (migration 0042 chưa chạy ở tenant này): báo "đang khởi tạo" thay vì lỗi 500. */
async function guard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '42P01') throw new WorkspaceSchemaNotReadyError();
    throw error;
  }
}

/** Kho `workspace_schema.related_objects`; tách khỏi `PostgresWorkspaceStore` để không đụng code cũ. */
export class PostgresRelatedObjectStore implements RelatedObjectStore {
  constructor(private readonly poolFor: (tenantId: string) => Promise<Pool>) {}

  listByProject(tenantId: string, projectId: string): Promise<readonly StoredRelatedObject[]> {
    return guard(async () => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${COLUMNS} ${FROM} WHERE r.project_id = $1 AND ${LIVE} ORDER BY r.created_at, r.id`,
        [projectId],
      );
      return result.rows.map(map);
    });
  }

  listByEntity(
    tenantId: string,
    entityType: 'project' | 'work_item',
    entityId: string,
  ): Promise<readonly StoredRelatedObject[]> {
    return guard(async () => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `SELECT ${COLUMNS} ${FROM} WHERE r.entity_type = $1 AND r.entity_id = $2 AND ${LIVE}
          ORDER BY r.created_at, r.id`,
        [entityType, entityId],
      );
      return result.rows.map(map);
    });
  }

  findById(tenantId: string, id: string): Promise<StoredRelatedObject | undefined> {
    return guard(async () => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE r.id = $1`, [id]);
      const row = result.rows[0];
      return row ? map(row) : undefined;
    });
  }

  upsert(tenantId: string, input: NewRelatedObject): Promise<StoredRelatedObject> {
    return guard(async () => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<Row>(
        `INSERT INTO workspace_schema.related_objects
           (entity_type, entity_id, project_id, kind, module_key, kind_label, module_label, object_id, object_code,
            label, status, launch_url, created_by, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (entity_type, entity_id, kind, object_id) DO UPDATE
           SET object_code = EXCLUDED.object_code, label = EXCLUDED.label, status = EXCLUDED.status,
               launch_url = EXCLUDED.launch_url,
               kind_label = COALESCE(EXCLUDED.kind_label, workspace_schema.related_objects.kind_label),
               module_label = COALESCE(EXCLUDED.module_label, workspace_schema.related_objects.module_label),
               updated_at = now()
         RETURNING id`,
        [
          input.entityType,
          input.entityId,
          input.projectId,
          input.kind,
          input.moduleKey,
          input.kindLabel ?? null,
          input.moduleLabel ?? null,
          input.objectId,
          input.code ?? null,
          input.label,
          input.status ?? null,
          input.launchUrl,
          input.createdBy,
          input.createdByName ?? null,
        ],
      );
      const saved = await this.findById(tenantId, String(result.rows[0]?.['id']));
      if (!saved) throw new Error('Không đọc lại được liên kết vừa lưu.');
      return saved;
    });
  }

  refreshSnapshots(tenantId: string, updates: readonly RelatedObjectSnapshotUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    return guard(async () => {
      const pool = await this.poolFor(tenantId);
      // Một câu cho cả lô; chỉ ghi khi có gì đổi để không tăng updated_at vô ích.
      await pool.query(
        `UPDATE workspace_schema.related_objects AS r
            SET object_code = v.code, label = v.label, status = v.status, launch_url = v.launch_url, updated_at = now()
           FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS code, unnest($3::text[]) AS label,
                        unnest($4::text[]) AS status, unnest($5::text[]) AS launch_url) AS v
          WHERE r.id = v.id
            AND (r.object_code IS DISTINCT FROM v.code OR r.label IS DISTINCT FROM v.label
                 OR r.status IS DISTINCT FROM v.status OR r.launch_url IS DISTINCT FROM v.launch_url)`,
        [
          updates.map((entry) => entry.id),
          updates.map((entry) => entry.code ?? null),
          updates.map((entry) => entry.label),
          updates.map((entry) => entry.status ?? null),
          updates.map((entry) => entry.launchUrl),
        ],
      );
    });
  }

  remove(tenantId: string, id: string): Promise<void> {
    return guard(async () => {
      const pool = await this.poolFor(tenantId);
      // Xoá cứng có chủ đích: dòng này chỉ là một liên kết, hồ sơ gốc ở module kia không bị đụng tới.
      await pool.query(`DELETE FROM workspace_schema.related_objects WHERE id = $1`, [id]);
    });
  }
}
