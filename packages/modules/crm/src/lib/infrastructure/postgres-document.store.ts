import type {
  CrmDocument,
  CrmDocumentAudience,
  CrmDocumentDetail,
  CrmDocumentEntityType,
  CrmDocumentFolder,
  CrmDocumentType,
  CrmDocumentVersion,
  DocumentListQuery,
} from '@enterprise-platform/contracts-crm';
import type { PoolClient } from 'pg';
import type { OpportunityDocumentChecker } from '../application/opportunity.service.js';
import type { CrmDataScope } from '../application/data-scope.js';
import type {
  DocumentFolderInput,
  DocumentStore,
  NewDocumentInput,
  NewVersionInput,
  StoredVersion,
} from '../application/document-store.port.js';
import type { CrmAuditEntry } from '../domain/audit-log.js';
import { CrmConflictError, CrmNotFoundError } from '../domain/crm.error.js';
import { writeAuditLog } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { opportunityScopeSql } from './opportunity-scope-sql.js';
import { ownerScopeSql, type ScopeSqlFragment } from './owner-scope-sql.js';
import { constraintViolation, toIso } from './sql-helpers.js';

/** Bảng của từng loại đối tượng gắn tài liệu và cách lọc phạm vi dữ liệu. */
const ENTITY_TABLES: Readonly<Record<CrmDocumentEntityType, { table: string; scope: 'owner' | 'opportunity' | 'quote' }>> = {
  customer: { table: 'customers', scope: 'owner' },
  lead: { table: 'leads', scope: 'owner' },
  opportunity: { table: 'opportunities', scope: 'opportunity' },
  quote: { table: 'quotes', scope: 'quote' },
  contract: { table: 'contracts', scope: 'owner' },
  sales_order: { table: 'sales_orders', scope: 'owner' },
  warranty_case: { table: 'warranty_cases', scope: 'owner' },
};

interface DocumentRow {
  id: string;
  entity_type: CrmDocumentEntityType;
  entity_id: string;
  folder_id: string | null;
  document_type_id: string | null;
  type_code: string | null;
  type_name: string | null;
  name: string;
  description: string | null;
  audience: CrmDocumentAudience;
  current_version_no: number | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: string | null;
  locked_by_user_id: string | null;
  locked_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  document_id: string;
  version_no: number;
  object_key: string;
  file_name: string;
  content_type: string;
  size_bytes: string | null;
  change_note: string | null;
  uploaded_at: Date | null;
  created_by: string;
  created_at: Date;
}

interface FolderRow {
  id: string;
  entity_type: CrmDocumentEntityType;
  entity_id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  created_by: string;
  created_at: Date;
}

interface TypeRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  sort_order: number;
}

/** Tài liệu kèm loại và phiên bản hiện hành (đã xác nhận). */
const DOCUMENT_SELECT = `
  SELECT d.id, d.entity_type, d.entity_id, d.folder_id, d.document_type_id, t.code AS type_code, t.name AS type_name,
         d.name, d.description, d.audience, d.current_version_no, v.file_name, v.content_type, v.size_bytes,
         d.locked_by_user_id, d.locked_at, d.created_by, d.created_at, d.updated_at
    FROM crm_schema.documents d
    LEFT JOIN crm_schema.document_types t ON t.id = d.document_type_id
    LEFT JOIN crm_schema.document_versions v ON v.document_id = d.id AND v.version_no = d.current_version_no`;

const VERSION_COLUMNS = `v.id, v.document_id, v.version_no, v.object_key, v.file_name, v.content_type, v.size_bytes,
         v.change_note, v.uploaded_at, v.created_by, v.created_at`;

const FOLDER_EXISTS = () => new CrmConflictError('FOLDER_EXISTS', 'Thư mục cùng tên đã tồn tại ở đây.');
const TYPE_CODE_EXISTS = () => new CrmConflictError('DOCUMENT_TYPE_CODE_EXISTS', 'Mã loại tài liệu đã tồn tại.');

const bytes = (value: string | null): number | null => (value === null ? null : Number(value));

function toDocument(row: DocumentRow): CrmDocument {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    folderId: row.folder_id,
    documentType: row.document_type_id
      ? { id: row.document_type_id, code: row.type_code ?? '', name: row.type_name ?? '' }
      : null,
    name: row.name,
    description: row.description,
    audience: row.audience,
    currentVersionNo: row.current_version_no,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: bytes(row.size_bytes),
    lockedByUserId: row.locked_by_user_id,
    lockedAt: toIso(row.locked_at),
    createdBy: row.created_by,
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
  };
}

function toVersion(row: VersionRow): CrmDocumentVersion {
  return {
    id: row.id,
    documentId: row.document_id,
    versionNo: row.version_no,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: bytes(row.size_bytes),
    changeNote: row.change_note,
    uploadedAt: toIso(row.uploaded_at),
    createdBy: row.created_by,
    createdAt: toIso(row.created_at) as string,
  };
}

function toFolder(row: FolderRow): CrmDocumentFolder {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    parentId: row.parent_id,
    name: row.name,
    depth: row.depth,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at) as string,
  };
}

const toType = (row: TypeRow): CrmDocumentType => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  active: row.active,
  sortOrder: row.sort_order,
});

async function documentOf(client: PoolClient, id: string): Promise<CrmDocument | null> {
  const result = await client.query<DocumentRow>(`${DOCUMENT_SELECT} WHERE d.id = $1`, [id]);
  return result.rows[0] ? toDocument(result.rows[0]) : null;
}

export class PostgresDocumentStore implements DocumentStore {
  constructor(private readonly database: CrmDatabase) {}

  async entityVisible(
    tenantId: string,
    scope: CrmDataScope,
    entityType: CrmDocumentEntityType,
    entityId: string,
  ): Promise<boolean> {
    const target = ENTITY_TABLES[entityType];
    let fragment: ScopeSqlFragment;
    if (target.scope === 'opportunity') fragment = opportunityScopeSql(scope, 'e.owner_user_id', 'e.id', 2);
    else if (target.scope === 'quote') fragment = opportunityScopeSql(scope, 'e.owner_user_id', 'e.opportunity_id', 2);
    else fragment = ownerScopeSql(scope, 'e.owner_user_id', 2);
    const pool = await this.database.pool(tenantId);
    // `table` lấy từ bảng hằng ở trên, không bao giờ từ dữ liệu người dùng.
    const result = await pool.query(
      `SELECT 1 FROM crm_schema.${target.table} e WHERE e.id = $1 AND ${fragment.sql}`,
      [entityId, ...fragment.params],
    );
    return result.rows.length > 0;
  }

  async listDocuments(tenantId: string, query: DocumentListQuery): Promise<CrmDocument[]> {
    const params: unknown[] = [query.entityType, query.entityId];
    const where = ['d.entity_type = $1', 'd.entity_id = $2'];
    if (query.folderId === 'root') where.push('d.folder_id IS NULL');
    else if (query.folderId) {
      params.push(query.folderId);
      where.push(`d.folder_id = $${params.length}`);
    }
    if (query.documentTypeId) {
      params.push(query.documentTypeId);
      where.push(`d.document_type_id = $${params.length}`);
    }
    if (query.audience) {
      params.push(query.audience);
      where.push(`d.audience = $${params.length}`);
    }
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<DocumentRow>(
      `${DOCUMENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC, d.id DESC LIMIT 500`,
      params,
    );
    return result.rows.map(toDocument);
  }

  async findDocument(tenantId: string, documentId: string): Promise<CrmDocument | null> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<DocumentRow>(`${DOCUMENT_SELECT} WHERE d.id = $1`, [documentId]);
    return result.rows[0] ? toDocument(result.rows[0]) : null;
  }

  async documentDetail(tenantId: string, documentId: string): Promise<CrmDocumentDetail | null> {
    const document = await this.findDocument(tenantId, documentId);
    if (!document) return null;
    const pool = await this.database.pool(tenantId);
    const versions = await pool.query<VersionRow>(
      `SELECT ${VERSION_COLUMNS} FROM crm_schema.document_versions v WHERE v.document_id = $1 ORDER BY v.version_no DESC`,
      [documentId],
    );
    return { ...document, versions: versions.rows.map(toVersion) };
  }

  async findVersion(tenantId: string, documentId: string, versionId: string): Promise<StoredVersion | null> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<VersionRow>(
      `SELECT ${VERSION_COLUMNS} FROM crm_schema.document_versions v WHERE v.document_id = $1 AND v.id = $2`,
      [documentId, versionId],
    );
    const row = result.rows[0];
    return row ? { version: toVersion(row), objectKey: row.object_key } : null;
  }

  async findDownloadVersion(tenantId: string, documentId: string, versionNo?: number): Promise<StoredVersion | null> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<VersionRow>(
      versionNo
        ? `SELECT ${VERSION_COLUMNS} FROM crm_schema.document_versions v
            WHERE v.document_id = $1 AND v.version_no = $2 AND v.uploaded_at IS NOT NULL`
        : `SELECT ${VERSION_COLUMNS} FROM crm_schema.document_versions v
             JOIN crm_schema.documents d ON d.id = v.document_id AND d.current_version_no = v.version_no
            WHERE v.document_id = $1 AND v.uploaded_at IS NOT NULL`,
      versionNo ? [documentId, versionNo] : [documentId],
    );
    const row = result.rows[0];
    return row ? { version: toVersion(row), objectKey: row.object_key } : null;
  }

  async createDocument(
    tenantId: string,
    actorId: string,
    input: NewDocumentInput,
    audit: CrmAuditEntry,
  ): Promise<{ document: CrmDocument; version: CrmDocumentVersion }> {
    return this.database.transaction(tenantId, async (client) => {
      try {
        await client.query(
          `INSERT INTO crm_schema.documents
             (id, entity_type, entity_id, folder_id, document_type_id, name, description, audience, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
          [
            input.id,
            input.entityType,
            input.entityId,
            input.folderId,
            input.documentTypeId,
            input.name,
            input.description,
            input.audience,
            actorId,
          ],
        );
      } catch (error) {
        if (constraintViolation(error, '23503')) throw new CrmNotFoundError('Không tìm thấy thư mục hoặc loại tài liệu.');
        throw error;
      }
      const version = await client.query<VersionRow>(
        `INSERT INTO crm_schema.document_versions
           (id, document_id, version_no, object_key, file_name, content_type, declared_size_bytes, change_note, created_by)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)
         RETURNING id, document_id, version_no, object_key, file_name, content_type, size_bytes, change_note, uploaded_at, created_by, created_at`,
        [input.versionId, input.id, input.objectKey, input.fileName, input.contentType, input.declaredSizeBytes, input.changeNote, actorId],
      );
      await writeAuditLog(client, audit);
      const document = await documentOf(client, input.id);
      return { document: document as CrmDocument, version: toVersion(version.rows[0]) };
    });
  }

  async addVersion(
    tenantId: string,
    actorId: string,
    documentId: string,
    input: NewVersionInput,
    audit: Omit<CrmAuditEntry, 'metadata'>,
  ): Promise<{ version: CrmDocumentVersion; objectKey: string }> {
    return this.database.transaction(tenantId, async (client) => {
      // Khoá dòng tài liệu: hai người cùng tải bản mới nhận hai số phiên bản khác nhau, kiểm khoá không đua.
      const locked = await client.query<{ locked_by_user_id: string | null }>(
        `SELECT locked_by_user_id FROM crm_schema.documents WHERE id = $1 FOR UPDATE`,
        [documentId],
      );
      if (!locked.rows[0]) throw new CrmNotFoundError('Không tìm thấy tài liệu.');
      const next = await client.query<{ next: number }>(
        `SELECT COALESCE(max(version_no), 0) + 1 AS next FROM crm_schema.document_versions WHERE document_id = $1`,
        [documentId],
      );
      const versionNo = Number(next.rows[0].next);
      const objectKey = input.objectKeyFor(versionNo);
      const result = await client.query<VersionRow>(
        `INSERT INTO crm_schema.document_versions
           (id, document_id, version_no, object_key, file_name, content_type, declared_size_bytes, change_note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, document_id, version_no, object_key, file_name, content_type, size_bytes, change_note, uploaded_at, created_by, created_at`,
        [input.id, documentId, versionNo, objectKey, input.fileName, input.contentType, input.declaredSizeBytes, input.changeNote, actorId],
      );
      await writeAuditLog(client, {
        ...audit,
        metadata: { versionNo, fileName: input.fileName, contentType: input.contentType },
      });
      return { version: toVersion(result.rows[0]), objectKey };
    });
  }

  async completeVersion(
    tenantId: string,
    actorId: string,
    documentId: string,
    versionId: string,
    sizeBytes: number,
    audit: Omit<CrmAuditEntry, 'metadata'>,
  ): Promise<CrmDocumentVersion | null> {
    return this.database.transaction(tenantId, async (client) => {
      await client.query(`SELECT 1 FROM crm_schema.documents WHERE id = $1 FOR UPDATE`, [documentId]);
      const result = await client.query<VersionRow>(
        `UPDATE crm_schema.document_versions v
            SET size_bytes = $3, uploaded_at = COALESCE(v.uploaded_at, now())
          WHERE v.document_id = $1 AND v.id = $2
          RETURNING ${VERSION_COLUMNS}`,
        [documentId, versionId, sizeBytes],
      );
      const row = result.rows[0];
      if (!row) return null;
      await client.query(
        `UPDATE crm_schema.documents
            SET current_version_no = GREATEST(COALESCE(current_version_no, 0), $2), updated_at = now(), updated_by = $3
          WHERE id = $1`,
        [documentId, row.version_no, actorId],
      );
      await writeAuditLog(client, { ...audit, metadata: { versionNo: row.version_no, sizeBytes } });
      return toVersion(row);
    });
  }

  async setLock(tenantId: string, documentId: string, userId: string | null, audit: CrmAuditEntry): Promise<CrmDocument | null> {
    return this.database.transaction(tenantId, async (client) => {
      const result = userId
        ? await client.query(
            `UPDATE crm_schema.documents SET locked_by_user_id = $2, locked_at = COALESCE(locked_at, now()), updated_at = now()
              WHERE id = $1 AND (locked_by_user_id IS NULL OR locked_by_user_id = $2)`,
            [documentId, userId],
          )
        : await client.query(
            `UPDATE crm_schema.documents SET locked_by_user_id = NULL, locked_at = NULL, updated_at = now() WHERE id = $1`,
            [documentId],
          );
      if (!result.rowCount) return null;
      await writeAuditLog(client, audit);
      return documentOf(client, documentId);
    });
  }

  async setAudience(
    tenantId: string,
    documentId: string,
    audience: CrmDocumentAudience,
    audit: CrmAuditEntry,
  ): Promise<CrmDocument | null> {
    return this.database.transaction(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE crm_schema.documents SET audience = $2, updated_at = now() WHERE id = $1`,
        [documentId, audience],
      );
      if (!result.rowCount) return null;
      await writeAuditLog(client, audit);
      return documentOf(client, documentId);
    });
  }

  async updateDocument(
    tenantId: string,
    documentId: string,
    actorId: string,
    patch: { readonly name?: string; readonly description?: string | null; readonly documentTypeId?: string | null },
    audit: CrmAuditEntry,
  ): Promise<CrmDocument | null> {
    return this.database.transaction(tenantId, async (client) => {
      const sets: string[] = ['updated_at = now()', 'updated_by = $2'];
      const params: unknown[] = [documentId, actorId];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (patch.name !== undefined) assign('name', patch.name);
      if (patch.description !== undefined) assign('description', patch.description);
      if (patch.documentTypeId !== undefined) assign('document_type_id', patch.documentTypeId);
      const result = await client.query(`UPDATE crm_schema.documents SET ${sets.join(', ')} WHERE id = $1`, params);
      if (!result.rowCount) return null;
      await writeAuditLog(client, audit);
      return documentOf(client, documentId);
    });
  }

  async deleteDocument(
    tenantId: string,
    documentId: string,
    audit: (objectKeys: readonly string[]) => CrmAuditEntry,
  ): Promise<boolean> {
    return this.database.transaction(tenantId, async (client) => {
      const keys = await client.query<{ object_key: string }>(
        `SELECT object_key FROM crm_schema.document_versions WHERE document_id = $1 ORDER BY version_no`,
        [documentId],
      );
      // Chỉ xoá bản ghi (phiên bản xoá theo ON DELETE CASCADE); object trên kho không bị đụng tới.
      const result = await client.query(`DELETE FROM crm_schema.documents WHERE id = $1`, [documentId]);
      if (!result.rowCount) return false;
      await writeAuditLog(client, audit(keys.rows.map((row) => row.object_key)));
      return true;
    });
  }

  async listFolders(tenantId: string, entityType: CrmDocumentEntityType, entityId: string): Promise<CrmDocumentFolder[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<FolderRow>(
      `SELECT id, entity_type, entity_id, parent_id, name, depth, created_by, created_at
         FROM crm_schema.document_folders WHERE entity_type = $1 AND entity_id = $2 ORDER BY depth, lower(name), id`,
      [entityType, entityId],
    );
    return result.rows.map(toFolder);
  }

  async findFolder(tenantId: string, folderId: string): Promise<CrmDocumentFolder | null> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<FolderRow>(
      `SELECT id, entity_type, entity_id, parent_id, name, depth, created_by, created_at
         FROM crm_schema.document_folders WHERE id = $1`,
      [folderId],
    );
    return result.rows[0] ? toFolder(result.rows[0]) : null;
  }

  async createFolder(tenantId: string, actorId: string, input: DocumentFolderInput): Promise<CrmDocumentFolder> {
    const pool = await this.database.pool(tenantId);
    try {
      const result = await pool.query<FolderRow>(
        `INSERT INTO crm_schema.document_folders (entity_type, entity_id, parent_id, name, depth, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, entity_type, entity_id, parent_id, name, depth, created_by, created_at`,
        [input.entityType, input.entityId, input.parentId, input.name, input.depth, actorId],
      );
      return toFolder(result.rows[0]);
    } catch (error) {
      if (constraintViolation(error, '23505', 'uq_crm_document_folders_name')) throw FOLDER_EXISTS();
      throw error;
    }
  }

  async listDocumentTypes(tenantId: string, includeInactive: boolean): Promise<CrmDocumentType[]> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<TypeRow>(
      `SELECT id, code, name, description, active, sort_order FROM crm_schema.document_types
        ${includeInactive ? '' : 'WHERE active'} ORDER BY sort_order, name, code`,
    );
    return result.rows.map(toType);
  }

  async findDocumentType(tenantId: string, id: string): Promise<CrmDocumentType | null> {
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<TypeRow>(
      `SELECT id, code, name, description, active, sort_order FROM crm_schema.document_types WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toType(result.rows[0]) : null;
  }

  async createDocumentType(
    tenantId: string,
    actorId: string,
    input: { readonly code: string; readonly name: string; readonly description: string | null; readonly sortOrder: number },
  ): Promise<CrmDocumentType> {
    const pool = await this.database.pool(tenantId);
    try {
      const result = await pool.query<TypeRow>(
        `INSERT INTO crm_schema.document_types (code, name, description, sort_order, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id, code, name, description, active, sort_order`,
        [input.code, input.name, input.description, input.sortOrder, actorId],
      );
      return toType(result.rows[0]);
    } catch (error) {
      if (constraintViolation(error, '23505', 'uq_crm_document_types_code')) throw TYPE_CODE_EXISTS();
      throw error;
    }
  }

  async updateDocumentType(
    tenantId: string,
    id: string,
    actorId: string,
    patch: { readonly name?: string; readonly description?: string | null; readonly active?: boolean; readonly sortOrder?: number },
  ): Promise<CrmDocumentType | null> {
    const pool = await this.database.pool(tenantId);
    const sets: string[] = ['updated_at = now()', 'updated_by = $2'];
    const params: unknown[] = [id, actorId];
    const assign = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (patch.name !== undefined) assign('name', patch.name);
    if (patch.description !== undefined) assign('description', patch.description);
    if (patch.active !== undefined) assign('active', patch.active);
    if (patch.sortOrder !== undefined) assign('sort_order', patch.sortOrder);
    const result = await pool.query<TypeRow>(
      `UPDATE crm_schema.document_types SET ${sets.join(', ')} WHERE id = $1
       RETURNING id, code, name, description, active, sort_order`,
      params,
    );
    return result.rows[0] ? toType(result.rows[0]) : null;
  }
}

/**
 * Cổng cho điều kiện DOCUMENT_TYPE của `OpportunityService` (P2C-11): `ref` của điều kiện là MÃ loại tài liệu
 * (`document_types.code`, ổn định khi đổi tên). Loại "còn hiệu lực" nghĩa là cơ hội có ít nhất một tài liệu
 * loại đó với phiên bản hiện hành đã tải lên xong. Loại bị tắt vẫn tính nếu tài liệu cũ còn.
 */
export class PostgresOpportunityDocumentChecker implements OpportunityDocumentChecker {
  constructor(private readonly database: CrmDatabase) {}

  async presentDocumentTypes(tenantId: string, opportunityId: string, refs: readonly string[]): Promise<ReadonlySet<string>> {
    if (!refs.length) return new Set();
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ code: string }>(
      `SELECT DISTINCT t.code
         FROM crm_schema.documents d
         JOIN crm_schema.document_types t ON t.id = d.document_type_id
        WHERE d.entity_type = 'opportunity' AND d.entity_id = $1
          AND d.current_version_no IS NOT NULL AND t.code = ANY($2::text[])`,
      [opportunityId, [...refs]],
    );
    return new Set(result.rows.map((row) => row.code));
  }

  /** Tên hiển thị của loại tài liệu theo mã, để thông báo thiếu tài liệu nêu đúng tên. */
  async documentTypeNames(tenantId: string, refs: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (!refs.length) return new Map();
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{ code: string; name: string }>(
      `SELECT code, name FROM crm_schema.document_types WHERE code = ANY($1::text[])`,
      [[...refs]],
    );
    return new Map(result.rows.map((row) => [row.code, row.name]));
  }
}
