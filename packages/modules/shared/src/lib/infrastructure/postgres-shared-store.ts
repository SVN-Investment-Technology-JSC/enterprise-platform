import {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
  inTransaction,
} from '@enterprise-platform/adapter-database';
import type {
  SharedAccessAction,
  SharedAccessLogEntry,
  SharedConfidentiality,
  SharedDocument,
  SharedDocumentKind,
  SharedDocumentStatus,
  SharedDocumentVersion,
  SharedFolder,
  SharedTrashItem,
  StorageModuleUsage,
} from '@enterprise-platform/contracts-shared';
import type { Pool, PoolClient } from 'pg';
import type {
  BranchRestoreTarget,
  DocumentInsert,
  DocumentListQuery,
  DocumentRow,
  DocumentUpdate,
  FolderInsert,
  FolderUpdate,
  PurgeResult,
  SharedStore,
  TrashedFolder,
  VersionInsert,
} from '../application/shared-store.port.js';
import { SharedNameTakenError, SharedNotProvisionedError } from '../domain/shared.error.js';

/**
 * Bảng tệp của mọi phân hệ trong DB tenant, để cộng dung lượng chung.
 *
 * Bảng nào chưa có (tenant chưa bật phân hệ đó) thì bỏ qua — kiểm bằng
 * `to_regclass` trước khi đưa vào câu truy vấn.
 */
const STORAGE_SOURCES: readonly { moduleKey: string; label: string; table: string }[] = [
  { moduleKey: 'shared', label: 'Tài liệu công ty', table: 'shared_schema.document_versions' },
  { moduleKey: 'workspace', label: 'Workspace · dự án, công việc', table: 'workspace_schema.document_versions' },
  { moduleKey: 'procedure-engine', label: 'Quy trình · đính kèm phiếu', table: 'procedure_schema.attachments' },
  { moduleKey: 'hrm', label: 'Nhân sự · hồ sơ, đơn từ', table: 'hrm_schema.attachments' },
  { moduleKey: 'inventory', label: 'Kho, tài sản', table: 'inventory_schema.asset_documents' },
  { moduleKey: 'maintenance', label: 'Bảo trì', table: 'maintenance_schema.occurrence_attachments' },
  // Chứng từ gỡ khỏi phiếu vẫn giữ đối tượng trong kho để truy vết, nên vẫn tính.
  { moduleKey: 'finance', label: 'Tài chính · chứng từ', table: 'finance_schema.voucher_attachments' },
];

interface FolderRecord {
  id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  is_active: boolean;
  doc_kind: string | null;
  doc_number: string | null;
  partner: string | null;
  issued_on: string | null;
  effective_to: string | null;
  note: string | null;
  document_count: string | number;
  total_document_count: string | number;
  total_bytes: string | number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

interface VersionRecord {
  id: string;
  document_id: string;
  version_no: number;
  file_name: string;
  content_type: string;
  size_bytes: string | number | null;
  change_note: string | null;
  uploaded_by: string;
  uploaded_by_name?: string | null;
  created_at: Date;
}

interface DocumentRecord {
  id: string;
  folder_id: string;
  name: string;
  description: string | null;
  doc_kind: string | null;
  doc_number: string | null;
  partner: string | null;
  issued_on: string | null;
  effective_from: string | null;
  effective_to: string | null;
  confidentiality: string;
  tags: string[] | null;
  source_label: string | null;
  current_version_id: string | null;
  status: string;
  locked_by_user_id: string | null;
  locked_at: Date | null;
  deleted_at?: Date | null;
  created_by: string;
  created_by_name?: string | null;
  created_at: Date;
  updated_at: Date;
  version_count?: string | number;
  cv_id?: string | null;
  cv_version_no?: number | null;
  cv_file_name?: string | null;
  cv_content_type?: string | null;
  cv_size_bytes?: string | number | null;
  cv_change_note?: string | null;
  cv_uploaded_by?: string | null;
  cv_uploaded_by_name?: string | null;
  cv_created_at?: Date | null;
}

/** Ngày dạng chuỗi: pg trả `date` thành chuỗi nhờ cast `::text` trong câu truy vấn. */
const FOLDER_COLUMNS = `f.id, f.parent_id, f.name, f.depth, f.is_active, f.doc_kind, f.doc_number,
  f.partner, f.issued_on::text AS issued_on, f.effective_to::text AS effective_to, f.note,
  f.created_by, f.created_at, f.updated_at`;

const DOCUMENT_COLUMNS = `d.id, d.folder_id, d.name, d.description, d.doc_kind, d.doc_number, d.partner,
  d.issued_on::text AS issued_on, d.effective_from::text AS effective_from,
  d.effective_to::text AS effective_to, d.confidentiality, d.tags, d.source_label,
  d.current_version_id, d.status, d.locked_by_user_id, d.locked_at, d.deleted_at, d.created_by,
  d.created_at, d.updated_at`;

/**
 * Tài liệu kèm phiên bản hiện hành và số phiên bản.
 *
 * `core_schema.users` luôn có trong DB tenant (migration lõi), nên tên người
 * tạo đọc thẳng ở đây thay vì hỏi Platform.
 */
const DOCUMENT_SELECT = `SELECT ${DOCUMENT_COLUMNS},
       creator.full_name AS created_by_name,
       (SELECT count(*) FROM shared_schema.document_versions vc WHERE vc.document_id = d.id) AS version_count,
       cv.id AS cv_id, cv.version_no AS cv_version_no, cv.file_name AS cv_file_name,
       cv.content_type AS cv_content_type, cv.size_bytes AS cv_size_bytes,
       cv.change_note AS cv_change_note, cv.uploaded_by AS cv_uploaded_by,
       uploader.full_name AS cv_uploaded_by_name, cv.created_at AS cv_created_at
  FROM shared_schema.documents d
  LEFT JOIN shared_schema.document_versions cv ON cv.id = d.current_version_id
  LEFT JOIN core_schema.users creator ON creator.id = d.created_by
  LEFT JOIN core_schema.users uploader ON uploader.id = cv.uploaded_by`;

export class PostgresSharedStore implements SharedStore {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  private poolFor(tenantId: string): Promise<Pool> {
    return this.pools.forTenant(this.references.require(tenantId));
  }

  /** Bảng chưa có (`42P01`) nghĩa là migration chưa chạy xong cho tenant này. */
  private async run<T>(tenantId: string, operation: (pool: Pool) => Promise<T>): Promise<T> {
    const pool = await this.poolFor(tenantId);
    try {
      return await operation(pool);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === '42P01' || code === '3F000') throw new SharedNotProvisionedError();
      throw error;
    }
  }

  readonly diagnostics = {
    schemaStatus: async (tenantId: string) => {
      const pool = await this.poolFor(tenantId);
      const result = await pool.query<{ schema_exists: boolean; tables_ready: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'shared_schema') AS schema_exists,
                to_regclass('shared_schema.documents') IS NOT NULL AS tables_ready`,
      );
      return {
        schemaExists: result.rows[0]?.schema_exists ?? false,
        tablesReady: result.rows[0]?.tables_ready ?? false,
      };
    },
  };

  readonly folders = {
    list: (tenantId: string) =>
      this.run(tenantId, async (pool) => {
        // `tree` ghép mỗi thư mục với chính nó và mọi con cháu, rồi cộng số
        // tài liệu, dung lượng của cả nhánh — một câu cho cả cây, không đệ quy
        // ở tầng ứng dụng.
        const result = await pool.query<FolderRecord>(
          `WITH RECURSIVE active AS (
               SELECT id, parent_id FROM shared_schema.folders WHERE is_active
             ),
             tree(ancestor, descendant) AS (
               SELECT id, id FROM active
               UNION ALL
               SELECT t.ancestor, c.id FROM tree t JOIN active c ON c.parent_id = t.descendant
             ),
             docs AS (
               SELECT d.folder_id, count(*) AS documents
                 FROM shared_schema.documents d
                WHERE d.status = 'active' AND d.deleted_at IS NULL
                GROUP BY d.folder_id
             ),
             bytes AS (
               SELECT d.folder_id, COALESCE(sum(v.size_bytes), 0) AS bytes
                 FROM shared_schema.documents d
                 JOIN shared_schema.document_versions v ON v.document_id = d.id
                WHERE d.status = 'active' AND d.deleted_at IS NULL
                GROUP BY d.folder_id
             ),
             totals AS (
               SELECT t.ancestor,
                      COALESCE(sum(docs.documents), 0) AS documents,
                      COALESCE(sum(bytes.bytes), 0) AS bytes
                 FROM tree t
                 LEFT JOIN docs ON docs.folder_id = t.descendant
                 LEFT JOIN bytes ON bytes.folder_id = t.descendant
                GROUP BY t.ancestor
             )
           SELECT ${FOLDER_COLUMNS},
                  COALESCE(direct.documents, 0) AS document_count,
                  COALESCE(totals.documents, 0) AS total_document_count,
                  COALESCE(totals.bytes, 0) AS total_bytes
             FROM shared_schema.folders f
             LEFT JOIN docs direct ON direct.folder_id = f.id
             LEFT JOIN totals ON totals.ancestor = f.id
            WHERE f.is_active`,
        );
        return result.rows.map(mapFolder);
      }),

    find: (tenantId: string, folderId: string) =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<FolderRecord>(
          `SELECT ${FOLDER_COLUMNS}, 0 AS document_count, 0 AS total_document_count, 0 AS total_bytes
             FROM shared_schema.folders f WHERE f.id = $1`,
          [folderId],
        );
        return result.rows[0] ? mapFolder(result.rows[0]) : undefined;
      }),

    create: (tenantId: string, userId: string, input: FolderInsert) =>
      this.run(tenantId, async (pool) => {
        try {
          const result = await pool.query<FolderRecord>(
            `INSERT INTO shared_schema.folders AS f
                    (parent_id, name, depth, note, doc_kind, doc_number, partner, issued_on, effective_to, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING ${FOLDER_COLUMNS}, 0 AS document_count, 0 AS total_document_count, 0 AS total_bytes`,
            [
              input.parentId,
              input.name,
              input.depth,
              input.note,
              input.docKind,
              input.docNumber,
              input.partner,
              input.issuedOn,
              input.effectiveTo,
              userId,
            ],
          );
          return mapFolder(first(result.rows));
        } catch (error) {
          throw nameTaken(error, input.name);
        }
      }),

    update: (tenantId: string, folderId: string, input: FolderUpdate) =>
      this.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          try {
            if (input.depthDelta !== 0) {
              // Cả nhánh dời theo: depth của thư mục và mọi con cháu cùng cộng.
              await client.query(
                `WITH RECURSIVE branch AS (
                     SELECT id FROM shared_schema.folders WHERE id = $1
                     UNION ALL
                     SELECT c.id FROM shared_schema.folders c JOIN branch b ON c.parent_id = b.id
                   )
                 UPDATE shared_schema.folders SET depth = depth + $2, updated_at = now()
                  WHERE id IN (SELECT id FROM branch)`,
                [folderId, input.depthDelta],
              );
            }
            const result = await client.query<FolderRecord>(
              `UPDATE shared_schema.folders AS f
                  SET name = $2, parent_id = $3, note = $4, doc_kind = $5, doc_number = $6,
                      partner = $7, issued_on = $8, effective_to = $9, updated_at = now()
                WHERE f.id = $1
                RETURNING ${FOLDER_COLUMNS}, 0 AS document_count, 0 AS total_document_count, 0 AS total_bytes`,
              [
                folderId,
                input.name,
                input.parentId,
                input.note,
                input.docKind,
                input.docNumber,
                input.partner,
                input.issuedOn,
                input.effectiveTo,
              ],
            );
            return mapFolder(first(result.rows));
          } catch (error) {
            throw nameTaken(error, input.name);
          }
        }),
      ),

    trash: (tenantId: string, folderId: string, userId: string) =>
      this.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          // Cả nhánh đang dùng của thư mục; `now()` cố định trong transaction nên
          // mọi dòng của lượt xoá mang cùng `deleted_at`.
          const branch = await client.query<{ id: string }>(
            `WITH RECURSIVE branch AS (
                 SELECT id FROM shared_schema.folders WHERE id = $1 AND is_active
                 UNION ALL
                 SELECT c.id FROM shared_schema.folders c JOIN branch b ON c.parent_id = b.id WHERE c.is_active
               )
             SELECT id FROM branch`,
            [folderId],
          );
          const ids = branch.rows.map((row) => row.id);
          if (ids.length === 0) return { folders: 0, documents: 0 };
          await client.query(
            `UPDATE shared_schema.folders
                SET is_active = false, deleted_at = now(), deleted_by = $2, deleted_batch = $3, updated_at = now()
              WHERE id = ANY($1::uuid[])`,
            [ids, userId, folderId],
          );
          const documents = await client.query(
            `UPDATE shared_schema.documents
                SET deleted_at = now(), deleted_by = $2, deleted_batch = $3,
                    locked_by_user_id = NULL, locked_at = NULL, updated_at = now()
              WHERE folder_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
            [ids, userId, folderId],
          );
          return { folders: ids.length - 1, documents: documents.rowCount ?? 0 };
        }),
      ),

    findTrashed: (tenantId: string, folderId: string) =>
      this.run(tenantId, async (pool): Promise<TrashedFolder | undefined> => {
        const result = await pool.query<
          FolderRecord & { deleted_at: Date; max_depth: number; branch_folders: string; branch_documents: string }
        >(
          `SELECT ${FOLDER_COLUMNS}, 0 AS document_count, 0 AS total_document_count, 0 AS total_bytes,
                  f.deleted_at,
                  (SELECT max(b.depth) FROM shared_schema.folders b WHERE b.deleted_batch = f.id) AS max_depth,
                  (SELECT count(*) FROM shared_schema.folders b WHERE b.deleted_batch = f.id) AS branch_folders,
                  (SELECT count(*) FROM shared_schema.documents d WHERE d.deleted_batch = f.id) AS branch_documents
             FROM shared_schema.folders f
            WHERE f.id = $1 AND f.deleted_batch = f.id`,
          [folderId],
        );
        const row = result.rows[0];
        if (!row) return undefined;
        return {
          folder: mapFolder(row),
          deletedAt: row.deleted_at.toISOString(),
          maxDepth: Number(row.max_depth),
          folders: Number(row.branch_folders) - 1,
          documents: Number(row.branch_documents),
        };
      }),

    restoreBranch: (tenantId: string, folderId: string, target: BranchRestoreTarget) =>
      this.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          try {
            // Gốc còn nằm trong Thùng rác (không tính vào chỉ mục tên) nên đổi chỗ
            // và tên trước; tên chỉ bị kiểm khi cả nhánh mở lại ở câu sau.
            await client.query(
              `UPDATE shared_schema.folders SET parent_id = $2, name = $3 WHERE id = $1 AND deleted_batch = $1`,
              [folderId, target.parentId, target.name],
            );
            await client.query(
              `UPDATE shared_schema.folders
                  SET depth = depth + $2, is_active = true, deleted_at = NULL, deleted_by = NULL,
                      deleted_batch = NULL, updated_at = now()
                WHERE deleted_batch = $1`,
              [folderId, target.depthDelta],
            );
            await client.query(
              `UPDATE shared_schema.documents
                  SET deleted_at = NULL, deleted_by = NULL, deleted_batch = NULL, updated_at = now()
                WHERE deleted_batch = $1`,
              [folderId],
            );
            const result = await client.query<FolderRecord>(
              `SELECT ${FOLDER_COLUMNS}, 0 AS document_count, 0 AS total_document_count, 0 AS total_bytes
                 FROM shared_schema.folders f WHERE f.id = $1`,
              [folderId],
            );
            return mapFolder(first(result.rows));
          } catch (error) {
            throw nameTaken(error, target.name);
          }
        }),
      ),

    purgeBranch: (tenantId: string, folderId: string, userId: string) =>
      this.run(tenantId, (pool) =>
        inTransaction(pool, async (client): Promise<PurgeResult> => {
          // Cả cây con dưới các thư mục của lượt xoá, kể cả thư mục từng bị xoá riêng
          // ở lượt trước (xoá lá rồi mới xoá tổ tiên): khoá ngoại cha RESTRICT không
          // cho xoá một thư mục khi còn thư mục con trỏ tới.
          const branch = await client.query<{
            id: string;
            name: string;
            parent_id: string | null;
            deleted_by: string | null;
            deleted_at: Date | null;
          }>(
            `WITH RECURSIVE subtree AS (
                 SELECT id FROM shared_schema.folders WHERE deleted_batch = $1
                 UNION
                 SELECT c.id FROM shared_schema.folders c JOIN subtree s ON c.parent_id = s.id
               )
             SELECT f.id, f.name, f.parent_id, f.deleted_by, f.deleted_at
               FROM shared_schema.folders f
              WHERE f.id IN (SELECT id FROM subtree)
                FOR UPDATE OF f`,
            [folderId],
          );
          const root = branch.rows.find((row) => row.id === folderId);
          if (!root) return { storageKeys: [], documents: 0, folders: 0 };
          const ids = branch.rows.map((row) => row.id);

          // Cả tài liệu từng bị xoá riêng khỏi các thư mục này: thư mục biến mất
          // thì chúng không còn chỗ để khôi phục về, và khoá ngoại cũng không cho
          // xoá thư mục còn tài liệu trỏ tới.
          const versions = await client.query<{ storage_key: string; size_bytes: string | null }>(
            `SELECT v.storage_key, v.size_bytes
               FROM shared_schema.document_versions v
               JOIN shared_schema.documents d ON d.id = v.document_id
              WHERE d.folder_id = ANY($1::uuid[])`,
            [ids],
          );
          const documentCount = Number(
            (
              await client.query<{ n: string }>(
                `SELECT count(*) AS n FROM shared_schema.documents WHERE folder_id = ANY($1::uuid[])`,
                [ids],
              )
            ).rows[0]?.n ?? 0,
          );
          const paths = await loadFolderPaths(client);
          await client.query(
            `INSERT INTO shared_schema.purge_log
                    (kind, name, location, document_count, version_count, total_bytes, deleted_by, deleted_at, purged_by)
             VALUES ('folder', $1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              root.name,
              root.parent_id ? (paths.get(root.parent_id) ?? '') : '',
              documentCount,
              versions.rowCount ?? 0,
              versions.rows.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0),
              root.deleted_by,
              root.deleted_at,
              userId,
            ],
          );

          await client.query(`DELETE FROM shared_schema.documents WHERE folder_id = ANY($1::uuid[])`, [ids]);
          // Khoá ngoại cha RESTRICT: xoá từ lá lên gốc, mỗi vòng bỏ những thư mục
          // không còn con trong lượt này.
          for (;;) {
            const removed = await client.query(
              `DELETE FROM shared_schema.folders f
                WHERE f.id = ANY($1::uuid[])
                  AND NOT EXISTS (SELECT 1 FROM shared_schema.folders c WHERE c.parent_id = f.id)`,
              [ids],
            );
            if (!removed.rowCount) break;
          }
          const left = await client.query<{ n: string }>(
            `SELECT count(*) AS n FROM shared_schema.folders WHERE id = ANY($1::uuid[])`,
            [ids],
          );
          if (Number(left.rows[0]?.n ?? 0) > 0) {
            throw new Error('Không xoá hết được các thư mục của nhánh trong Thùng rác.');
          }
          return {
            storageKeys: versions.rows.map((row) => row.storage_key),
            documents: documentCount,
            folders: ids.length - 1,
          };
        }),
      ),
  };

  readonly documents = {
    list: (tenantId: string, query: DocumentListQuery) =>
      this.run(tenantId, async (pool) => {
        const where = ['d.status = $1', 'd.deleted_at IS NULL'];
        const values: unknown[] = [query.status];
        if (query.folderId) {
          values.push(query.folderId);
          where.push(`d.folder_id = $${values.length}`);
        }
        if (query.kind) {
          values.push(query.kind);
          where.push(`d.doc_kind = $${values.length}`);
        }
        if (query.search) {
          values.push(`%${query.search}%`);
          const p = `$${values.length}`;
          where.push(`(d.name ILIKE ${p} OR d.doc_number ILIKE ${p} OR d.partner ILIKE ${p}
                       OR d.description ILIKE ${p} OR cv.file_name ILIKE ${p}
                       OR EXISTS (SELECT 1 FROM unnest(d.tags) tag WHERE tag ILIKE ${p}))`);
        }
        if (query.expiringWithinDays !== undefined) {
          values.push(query.expiringWithinDays);
          where.push(`d.effective_to IS NOT NULL
                      AND d.effective_to <= current_date + ($${values.length}::int * interval '1 day')`);
        }
        values.push(query.limit);
        const order =
          query.expiringWithinDays !== undefined ? 'd.effective_to ASC' : 'd.updated_at DESC';
        const result = await pool.query<DocumentRecord>(
          `${DOCUMENT_SELECT}
            WHERE ${where.join(' AND ')}
            ORDER BY ${order}
            LIMIT $${values.length}`,
          values,
        );
        return result.rows.map(mapDocumentRow);
      }),

    find: (tenantId: string, documentId: string) =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<DocumentRecord>(`${DOCUMENT_SELECT} WHERE d.id = $1`, [
          documentId,
        ]);
        return result.rows[0] ? mapDocumentRow(result.rows[0]) : undefined;
      }),

    create: (tenantId: string, userId: string, input: DocumentInsert) =>
      this.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          try {
            // Khoá ngoại `current_version_id` hoãn tới COMMIT, nên tạo tài liệu
            // trước rồi phiên bản sau trong cùng transaction.
            const documentId = (
              await client.query<{ id: string }>(
                `INSERT INTO shared_schema.documents
                        (folder_id, name, description, doc_kind, doc_number, partner, issued_on,
                         effective_from, effective_to, confidentiality, tags, source_label, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                 RETURNING id`,
                [
                  input.folderId,
                  input.name,
                  input.description,
                  input.docKind,
                  input.docNumber,
                  input.partner,
                  input.issuedOn,
                  input.effectiveFrom,
                  input.effectiveTo,
                  input.confidentiality,
                  [...input.tags],
                  input.sourceLabel,
                  userId,
                ],
              )
            ).rows[0]?.id ?? missingRow();
            const version = (
              await client.query<VersionRecord>(
                `INSERT INTO shared_schema.document_versions
                        (document_id, version_no, storage_key, file_name, content_type, change_note, uploaded_by)
                 VALUES ($1, 1, $2, $3, $4, $5, $6)
                 RETURNING id, document_id, version_no, file_name, content_type, size_bytes,
                           change_note, uploaded_by, created_at`,
                [documentId, input.storageKey, input.fileName, input.contentType, input.changeNote, userId],
              )
            ).rows[0] ?? missingRow();
            const document = (
              await client.query<DocumentRecord>(
                `UPDATE shared_schema.documents AS d SET current_version_id = $2
                  WHERE d.id = $1 RETURNING ${DOCUMENT_COLUMNS}`,
                [documentId, version.id],
              )
            ).rows[0] ?? missingRow();
            return { document: mapDocument(document), version: mapVersion(version) };
          } catch (error) {
            throw nameTaken(error, input.name);
          }
        }),
      ),

    update: (tenantId: string, documentId: string, input: DocumentUpdate) =>
      this.run(tenantId, async (pool) => {
        try {
          await pool.query(
            `UPDATE shared_schema.documents
                SET folder_id = $2, name = $3, description = $4, doc_kind = $5, doc_number = $6,
                    partner = $7, issued_on = $8, effective_from = $9, effective_to = $10,
                    confidentiality = $11, tags = $12, updated_at = now()
              WHERE id = $1`,
            [
              documentId,
              input.folderId,
              input.name,
              input.description,
              input.docKind,
              input.docNumber,
              input.partner,
              input.issuedOn,
              input.effectiveFrom,
              input.effectiveTo,
              input.confidentiality,
              [...input.tags],
            ],
          );
        } catch (error) {
          throw nameTaken(error, input.name);
        }
      }),

    setLock: (tenantId: string, documentId: string, userId: string | null) =>
      this.run(tenantId, async (pool) => {
        await pool.query(
          `UPDATE shared_schema.documents
              SET locked_by_user_id = $2::uuid,
                  locked_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END,
                  updated_at = now()
            WHERE id = $1`,
          [documentId, userId],
        );
      }),

    setStatus: (tenantId: string, documentId: string, status: SharedDocumentStatus) =>
      this.run(tenantId, async (pool) => {
        try {
          await pool.query(
            `UPDATE shared_schema.documents
                SET status = $2, locked_by_user_id = NULL, locked_at = NULL, updated_at = now()
              WHERE id = $1`,
            [documentId, status],
          );
        } catch (error) {
          // Khôi phục mà trong thư mục đã có tài liệu đang dùng trùng tên.
          throw nameTaken(error, 'tài liệu cùng tên');
        }
      }),

    trash: (tenantId: string, documentId: string, userId: string) =>
      this.run(tenantId, async (pool) => {
        await pool.query(
          `UPDATE shared_schema.documents
              SET deleted_at = now(), deleted_by = $2, deleted_batch = NULL,
                  locked_by_user_id = NULL, locked_at = NULL, updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL`,
          [documentId, userId],
        );
      }),

    restoreFromTrash: (tenantId: string, documentId: string, target: { folderId: string; name: string }) =>
      this.run(tenantId, async (pool) => {
        try {
          await pool.query(
            `UPDATE shared_schema.documents
                SET folder_id = $2, name = $3, deleted_at = NULL, deleted_by = NULL,
                    deleted_batch = NULL, updated_at = now()
              WHERE id = $1 AND deleted_at IS NOT NULL`,
            [documentId, target.folderId, target.name],
          );
        } catch (error) {
          throw nameTaken(error, target.name);
        }
      }),

    purge: (tenantId: string, documentId: string, userId: string) =>
      this.run(tenantId, (pool) =>
        inTransaction(pool, async (client): Promise<PurgeResult> => {
          const found = await client.query<{
            name: string;
            folder_id: string;
            deleted_by: string | null;
            deleted_at: Date | null;
          }>(
            `SELECT name, folder_id, deleted_by, deleted_at
               FROM shared_schema.documents WHERE id = $1 AND deleted_at IS NOT NULL FOR UPDATE`,
            [documentId],
          );
          const document = found.rows[0];
          if (!document) return { storageKeys: [], documents: 0, folders: 0 };
          const versions = await client.query<{ storage_key: string; size_bytes: string | null }>(
            `SELECT storage_key, size_bytes FROM shared_schema.document_versions WHERE document_id = $1`,
            [documentId],
          );
          const paths = await loadFolderPaths(client);
          await client.query(
            `INSERT INTO shared_schema.purge_log
                    (kind, name, location, document_count, version_count, total_bytes, deleted_by, deleted_at, purged_by)
             VALUES ('document', $1, $2, 1, $3, $4, $5, $6, $7)`,
            [
              document.name,
              paths.get(document.folder_id) ?? '',
              versions.rowCount ?? 0,
              versions.rows.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0),
              document.deleted_by,
              document.deleted_at,
              userId,
            ],
          );
          // Phiên bản và nhật ký truy cập đi theo tài liệu (ON DELETE CASCADE).
          await client.query(`DELETE FROM shared_schema.documents WHERE id = $1`, [documentId]);
          return { storageKeys: versions.rows.map((row) => row.storage_key), documents: 1, folders: 0 };
        }),
      ),

    countLockedByOthers: (tenantId: string, folderIds: readonly string[], userId: string) =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<{ n: string }>(
          `SELECT count(*) AS n FROM shared_schema.documents
            WHERE folder_id = ANY($1::uuid[]) AND deleted_at IS NULL
              AND locked_by_user_id IS NOT NULL AND locked_by_user_id <> $2`,
          [[...folderIds], userId],
        );
        return Number(result.rows[0]?.n ?? 0);
      }),

    countHiddenFrom: (
      tenantId: string,
      folderIds: readonly string[],
      viewer: { userId: string; canSeeRestricted: boolean },
    ) =>
      this.run(tenantId, async (pool) => {
        // Cùng luật với `canSee` của tầng application, viết bằng SQL để đếm cả nhánh.
        const result = await pool.query<{ n: string }>(
          `SELECT count(*) AS n FROM shared_schema.documents
            WHERE folder_id = ANY($1::uuid[]) AND deleted_at IS NULL AND created_by <> $2
              AND (confidentiality = 'confidential'
                   OR (confidentiality = 'restricted' AND NOT $3::boolean))`,
          [[...folderIds], viewer.userId, viewer.canSeeRestricted],
        );
        return Number(result.rows[0]?.n ?? 0);
      }),

    listVersions: (tenantId: string, documentId: string) =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<VersionRecord>(
          `SELECT v.id, v.document_id, v.version_no, v.file_name, v.content_type, v.size_bytes,
                  v.change_note, v.uploaded_by, u.full_name AS uploaded_by_name, v.created_at
             FROM shared_schema.document_versions v
             LEFT JOIN core_schema.users u ON u.id = v.uploaded_by
            WHERE v.document_id = $1
            ORDER BY v.version_no DESC`,
          [documentId],
        );
        return result.rows.map(mapVersion);
      }),

    findVersion: (tenantId: string, versionId: string) =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<VersionRecord>(
          `SELECT id, document_id, version_no, file_name, content_type, size_bytes, change_note,
                  uploaded_by, created_at
             FROM shared_schema.document_versions WHERE id = $1`,
          [versionId],
        );
        return result.rows[0] ? mapVersion(result.rows[0]) : undefined;
      }),

    addVersion: (tenantId: string, userId: string, input: VersionInsert) =>
      this.run(tenantId, (pool) =>
        inTransaction(pool, async (client) => {
          const version = (
            await client.query<VersionRecord>(
              `INSERT INTO shared_schema.document_versions
                      (document_id, version_no, storage_key, file_name, content_type, change_note, uploaded_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id, document_id, version_no, file_name, content_type, size_bytes,
                         change_note, uploaded_by, created_at`,
              [
                input.documentId,
                input.versionNo,
                input.storageKey,
                input.fileName,
                input.contentType,
                input.changeNote,
                userId,
              ],
            )
          ).rows[0] ?? missingRow();
          await client.query(
            `UPDATE shared_schema.documents SET current_version_id = $2, updated_at = now() WHERE id = $1`,
            [input.documentId, version.id],
          );
          return mapVersion(version);
        }),
      ),

    completeVersion: (tenantId: string, versionId: string, sizeBytes: number) =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<VersionRecord>(
          `UPDATE shared_schema.document_versions SET size_bytes = $2
            WHERE id = $1
            RETURNING id, document_id, version_no, file_name, content_type, size_bytes,
                      change_note, uploaded_by, created_at`,
          [versionId, sizeBytes],
        );
        return result.rows[0] ? mapVersion(result.rows[0]) : undefined;
      }),

    storageKeyOf: (tenantId: string, versionId: string) =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<{ storage_key: string }>(
          `SELECT storage_key FROM shared_schema.document_versions WHERE id = $1`,
          [versionId],
        );
        return result.rows[0]?.storage_key;
      }),

    log: (
      tenantId: string,
      userId: string,
      entry: { documentId: string; versionId?: string; action: SharedAccessAction },
    ) =>
      this.run(tenantId, async (pool) => {
        await pool.query(
          `INSERT INTO shared_schema.document_access_logs (document_id, version_id, action, created_by)
           VALUES ($1, $2, $3, $4)`,
          [entry.documentId, entry.versionId ?? null, entry.action, userId],
        );
      }),

    accessLog: (tenantId: string, documentId: string, limit: number) =>
      this.run(tenantId, async (pool) => {
        const result = await pool.query<{
          id: string;
          action: SharedAccessAction;
          version_no: number | null;
          created_by: string;
          full_name: string | null;
          created_at: Date;
        }>(
          `SELECT l.id, l.action, v.version_no, l.created_by, u.full_name, l.created_at
             FROM shared_schema.document_access_logs l
             LEFT JOIN shared_schema.document_versions v ON v.id = l.version_id
             LEFT JOIN core_schema.users u ON u.id = l.created_by
            WHERE l.document_id = $1
            ORDER BY l.created_at DESC
            LIMIT $2`,
          [documentId, limit],
        );
        return result.rows.map(
          (row): SharedAccessLogEntry => ({
            id: row.id,
            action: row.action,
            versionNo: row.version_no ?? undefined,
            userId: row.created_by,
            userName: row.full_name ?? undefined,
            createdAt: row.created_at.toISOString(),
          }),
        );
      }),
  };

  readonly trash = {
    list: (tenantId: string) =>
      this.run(tenantId, async (pool): Promise<SharedTrashItem[]> => {
        const paths = await loadFolderPaths(pool);
        const folders = await pool.query<{
          id: string;
          name: string;
          parent_id: string | null;
          doc_kind: string | null;
          doc_number: string | null;
          deleted_at: Date;
          deleted_by: string;
          deleted_by_name: string | null;
          branch_folders: string;
          branch_documents: string;
          branch_bytes: string;
          location_available: boolean;
        }>(
          `SELECT f.id, f.name, f.parent_id, f.doc_kind, f.doc_number, f.deleted_at, f.deleted_by,
                  u.full_name AS deleted_by_name,
                  (SELECT count(*) FROM shared_schema.folders b WHERE b.deleted_batch = f.id) AS branch_folders,
                  (SELECT count(*) FROM shared_schema.documents d WHERE d.deleted_batch = f.id) AS branch_documents,
                  (SELECT COALESCE(sum(v.size_bytes), 0)
                     FROM shared_schema.document_versions v
                     JOIN shared_schema.documents d ON d.id = v.document_id
                    WHERE d.deleted_batch = f.id) AS branch_bytes,
                  (f.parent_id IS NULL OR EXISTS (
                     SELECT 1 FROM shared_schema.folders p WHERE p.id = f.parent_id AND p.is_active
                  )) AS location_available
             FROM shared_schema.folders f
             LEFT JOIN core_schema.users u ON u.id = f.deleted_by
            WHERE f.deleted_batch = f.id
            ORDER BY f.deleted_at DESC
            LIMIT 5000`,
        );
        const documents = await pool.query<{
          id: string;
          name: string;
          folder_id: string;
          doc_kind: string | null;
          doc_number: string | null;
          confidentiality: string;
          created_by: string;
          deleted_at: Date;
          deleted_by: string;
          deleted_by_name: string | null;
          file_name: string | null;
          content_type: string | null;
          total_bytes: string;
          location_available: boolean;
        }>(
          `SELECT d.id, d.name, d.folder_id, d.doc_kind, d.doc_number, d.confidentiality, d.created_by,
                  d.deleted_at, d.deleted_by, u.full_name AS deleted_by_name,
                  cv.file_name, cv.content_type,
                  (SELECT COALESCE(sum(v.size_bytes), 0)
                     FROM shared_schema.document_versions v WHERE v.document_id = d.id) AS total_bytes,
                  EXISTS (
                    SELECT 1 FROM shared_schema.folders p WHERE p.id = d.folder_id AND p.is_active
                  ) AS location_available
             FROM shared_schema.documents d
             LEFT JOIN shared_schema.document_versions cv ON cv.id = d.current_version_id
             LEFT JOIN core_schema.users u ON u.id = d.deleted_by
            WHERE d.deleted_at IS NOT NULL AND d.deleted_batch IS NULL
            ORDER BY d.deleted_at DESC
            LIMIT 5000`,
        );
        const items: SharedTrashItem[] = [
          ...folders.rows.map(
            (row): SharedTrashItem => ({
              kind: 'folder',
              id: row.id,
              name: row.name,
              location: row.parent_id ? (paths.get(row.parent_id) ?? '') : '',
              locationAvailable: row.location_available,
              documentCount: Number(row.branch_documents),
              folderCount: Math.max(0, Number(row.branch_folders) - 1),
              totalBytes: Number(row.branch_bytes),
              deletedAt: row.deleted_at.toISOString(),
              deletedBy: row.deleted_by,
              deletedByName: row.deleted_by_name ?? undefined,
              docKind: (row.doc_kind as SharedDocumentKind | null) ?? undefined,
              docNumber: row.doc_number ?? undefined,
            }),
          ),
          ...documents.rows.map(
            (row): SharedTrashItem => ({
              kind: 'document',
              id: row.id,
              name: row.name,
              location: paths.get(row.folder_id) ?? '',
              locationAvailable: row.location_available,
              documentCount: 1,
              folderCount: 0,
              totalBytes: Number(row.total_bytes),
              deletedAt: row.deleted_at.toISOString(),
              deletedBy: row.deleted_by,
              deletedByName: row.deleted_by_name ?? undefined,
              fileName: row.file_name ?? undefined,
              contentType: row.content_type ?? undefined,
              docKind: (row.doc_kind as SharedDocumentKind | null) ?? undefined,
              docNumber: row.doc_number ?? undefined,
              confidentiality: row.confidentiality as SharedConfidentiality,
              createdBy: row.created_by,
            }),
          ),
        ];
        return items.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
      }),
  };

  readonly storage = {
    usageByModule: async (tenantId: string): Promise<StorageModuleUsage[]> => {
      const pool = await this.poolFor(tenantId);
      const exists = await pool.query<Record<string, boolean>>(
        `SELECT ${STORAGE_SOURCES.map(
          (source, index) => `to_regclass('${source.table}') IS NOT NULL AS s${index}`,
        ).join(', ')}`,
      );
      const present = STORAGE_SOURCES.filter((_, index) => exists.rows[0]?.[`s${index}`]);
      if (present.length === 0) return [];
      // Tên bảng lấy từ danh sách cố định ở trên, không bao giờ từ dữ liệu người dùng.
      const result = await pool.query<{ module_key: string; bytes: string; files: string }>(
        present
          .map(
            (source) =>
              `SELECT '${source.moduleKey}'::text AS module_key,
                      COALESCE(sum(size_bytes), 0)::bigint AS bytes,
                      count(size_bytes)::bigint AS files
                 FROM ${source.table}`,
          )
          .join(' UNION ALL '),
      );
      return result.rows.map((row) => ({
        moduleKey: row.module_key,
        label: STORAGE_SOURCES.find((source) => source.moduleKey === row.module_key)?.label ?? row.module_key,
        bytes: Number(row.bytes),
        files: Number(row.files),
      }));
    },
  };
}

/* ---------------------------------------------------------------- ánh xạ */

/** `INSERT … RETURNING` luôn trả một dòng; không có là lỗi hệ thống, không phải lỗi người dùng. */
function missingRow(): never {
  throw new Error('Câu lệnh ghi không trả về dòng nào.');
}

function first<T>(rows: readonly T[]): T {
  return rows[0] ?? missingRow();
}

/**
 * Đường dẫn "A / B / C" của mọi thư mục, kể cả thư mục đã vào Thùng rác — nơi
 * một mục bị xoá nằm trước đó có thể chính là một thư mục đã xoá.
 */
async function loadFolderPaths(db: Pick<Pool | PoolClient, 'query'>): Promise<Map<string, string>> {
  const result = await db.query<{ id: string; parent_id: string | null; name: string }>(
    `SELECT id, parent_id, name FROM shared_schema.folders`,
  );
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  const paths = new Map<string, string>();
  const resolve = (id: string, guard: number): string => {
    const cached = paths.get(id);
    if (cached !== undefined) return cached;
    const row = byId.get(id);
    if (!row) return '';
    const parent = row.parent_id && guard < 10 ? resolve(row.parent_id, guard + 1) : '';
    const path = parent ? `${parent} / ${row.name}` : row.name;
    paths.set(id, path);
    return path;
  };
  for (const row of result.rows) resolve(row.id, 0);
  return paths;
}

function nameTaken(error: unknown, name: string): unknown {
  return (error as { code?: string } | null)?.code === '23505' ? new SharedNameTakenError(name) : error;
}

function mapFolder(row: FolderRecord): SharedFolder {
  return {
    id: row.id,
    parentId: row.parent_id ?? undefined,
    name: row.name,
    depth: Number(row.depth),
    isActive: row.is_active,
    note: row.note ?? undefined,
    docKind: (row.doc_kind as SharedDocumentKind | null) ?? undefined,
    docNumber: row.doc_number ?? undefined,
    partner: row.partner ?? undefined,
    issuedOn: row.issued_on ?? undefined,
    effectiveTo: row.effective_to ?? undefined,
    documentCount: Number(row.document_count),
    totalDocumentCount: Number(row.total_document_count),
    totalBytes: Number(row.total_bytes),
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapVersion(row: VersionRecord): SharedDocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    versionNo: Number(row.version_no),
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes == null ? undefined : Number(row.size_bytes),
    changeNote: row.change_note ?? undefined,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

function mapDocument(row: DocumentRecord): SharedDocument {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    description: row.description ?? undefined,
    docKind: (row.doc_kind as SharedDocumentKind | null) ?? undefined,
    docNumber: row.doc_number ?? undefined,
    partner: row.partner ?? undefined,
    issuedOn: row.issued_on ?? undefined,
    effectiveFrom: row.effective_from ?? undefined,
    effectiveTo: row.effective_to ?? undefined,
    confidentiality: row.confidentiality as SharedConfidentiality,
    tags: row.tags ?? [],
    sourceLabel: row.source_label ?? undefined,
    currentVersionId: row.current_version_id ?? undefined,
    status: row.status as SharedDocumentStatus,
    lockedByUserId: row.locked_by_user_id ?? undefined,
    lockedAt: row.locked_at?.toISOString(),
    deletedAt: row.deleted_at?.toISOString(),
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapDocumentRow(row: DocumentRecord): DocumentRow {
  return {
    ...mapDocument(row),
    versionCount: Number(row.version_count ?? 0),
    currentVersion:
      row.cv_id && row.cv_created_at
        ? {
            id: row.cv_id,
            documentId: row.id,
            versionNo: Number(row.cv_version_no ?? 1),
            fileName: row.cv_file_name ?? '',
            contentType: row.cv_content_type ?? '',
            sizeBytes: row.cv_size_bytes == null ? undefined : Number(row.cv_size_bytes),
            changeNote: row.cv_change_note ?? undefined,
            uploadedBy: row.cv_uploaded_by ?? row.created_by,
            uploadedByName: row.cv_uploaded_by_name ?? undefined,
            createdAt: row.cv_created_at.toISOString(),
          }
        : undefined,
  };
}
