import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { S3ObjectStorage, type ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import {
  ASSET_DOCUMENT_MAX_BYTES,
  ASSET_DOCUMENT_TYPES,
  type AssetDocument,
  type CreateAssetDocumentRequest,
  type CreateAssetDocumentResponse,
} from '@enterprise-platform/contracts-inventory';
import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { AssetNotFoundError, InventoryError } from '../domain/inventory.error.js';
import type { InventoryActor } from './inventory.application.js';

type Row = QueryResultRow & Record<string, unknown>;

/**
 * Tài liệu đính kèm theo thiết bị.
 *
 * Tách khỏi InventoryApplication vì nó cần object storage — thứ mà phần còn lại
 * của module không dùng tới. Cùng khuôn với ProcedureAttachmentService: server
 * chỉ ký URL và giữ siêu dữ liệu, tệp đi thẳng từ trình duyệt lên kho lưu trữ.
 */
export class AssetDocumentService {
  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
    private readonly storage: ObjectStoragePort = new S3ObjectStorage({
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9010',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'enterprise-platform',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'platform',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'platform-development-secret',
    }),
  ) {}

  async list(actor: InventoryActor, assetCode: string): Promise<AssetDocument[]> {
    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const result = await pool.query<Row>(
      `SELECT d.*, a.code AS asset_code
         FROM inventory_schema.asset_documents d
         JOIN inventory_schema.assets a ON a.id = d.asset_id
        WHERE a.code = $1
        ORDER BY d.created_at DESC`,
      [assetCode],
    );
    return result.rows.map(mapDocument);
  }

  async create(
    actor: InventoryActor,
    assetCode: string,
    input: CreateAssetDocumentRequest,
  ): Promise<CreateAssetDocumentResponse> {
    if (!actor.canManage) {
      throw new InventoryError('FORBIDDEN', 'Bạn không có quyền đính kèm tài liệu.', 403);
    }
    const fileName = input?.fileName?.trim();
    const contentType = input?.contentType?.trim();
    if (!fileName || !contentType) {
      throw new InventoryError('VALIDATION', 'Tên tệp và loại tệp là bắt buộc.');
    }
    if ((input.sizeBytes ?? 0) > ASSET_DOCUMENT_MAX_BYTES) {
      throw new InventoryError('VALIDATION', 'Tệp đính kèm không vượt quá 50 MB.');
    }

    // Đuôi tệp và content-type phải cùng nói một thứ. `sizeBytes` do client khai
    // và KHÔNG kiểm chứng được: URL ký trước chỉ ghim bucket/key/content-type,
    // không ghim độ dài.
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    const expected = ASSET_DOCUMENT_TYPES[extension];
    if (!expected) {
      throw new InventoryError(
        'VALIDATION',
        `Định dạng .${extension || '?'} không được phép. Chấp nhận: ${Object.keys(ASSET_DOCUMENT_TYPES).join(', ')}.`,
      );
    }
    if (contentType !== expected) {
      throw new InventoryError(
        'VALIDATION',
        `Loại tệp khai báo (${contentType}) không khớp đuôi .${extension}.`,
      );
    }

    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const id = randomUUID();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const objectKey = `tenants/${actor.tenantId}/inventory/${assetCode}/${id}-${safeName}`;

    // Chèn bằng SELECT để mã thiết bị được phân giải trong cùng câu lệnh; sai mã
    // thì không dòng nào được chèn.
    const result = await pool.query<Row>(
      `INSERT INTO inventory_schema.asset_documents
         (id, asset_id, object_key, file_name, content_type, size_bytes, note, uploaded_by)
       SELECT $1, a.id, $3, $4, $5, $6, $7, $8
         FROM inventory_schema.assets a
        WHERE a.code = $2
    RETURNING *, $2::text AS asset_code`,
      [id, assetCode, objectKey, fileName, contentType, input.sizeBytes ?? null, input.note?.trim() || null, actor.userId],
    );
    const row = result.rows[0];
    if (!row) throw new AssetNotFoundError(assetCode);

    const expiresInSeconds = 300;
    return {
      document: mapDocument(row),
      uploadUrl: await this.storage.createUploadUrl({ key: objectKey, contentType, expiresInSeconds }),
      expiresInSeconds,
    };
  }

  /** URL tải về có hạn; không trả `object_key` ra ngoài để client không tự dựng link. */
  async downloadUrl(actor: InventoryActor, assetCode: string, documentId: string): Promise<string> {
    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const result = await pool.query<Row>(
      `SELECT d.object_key
         FROM inventory_schema.asset_documents d
         JOIN inventory_schema.assets a ON a.id = d.asset_id
        WHERE a.code = $1 AND d.id = $2`,
      [assetCode, documentId],
    );
    const key = result.rows[0]?.object_key;
    if (!key) throw new InventoryError('DOCUMENT_NOT_FOUND', 'Không tìm thấy tài liệu.', 404);
    return this.storage.createDownloadUrl(String(key), 300);
  }

  async remove(actor: InventoryActor, assetCode: string, documentId: string): Promise<void> {
    if (!actor.canManage) {
      throw new InventoryError('FORBIDDEN', 'Bạn không có quyền xoá tài liệu.', 403);
    }
    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    // Chỉ xoá bản ghi; object trong kho lưu trữ để lại và dọn riêng, vì xoá tệp
    // là thao tác không hoàn tác được.
    const result = await pool.query(
      `DELETE FROM inventory_schema.asset_documents d
        USING inventory_schema.assets a
        WHERE d.asset_id = a.id AND a.code = $1 AND d.id = $2`,
      [assetCode, documentId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new InventoryError('DOCUMENT_NOT_FOUND', 'Không tìm thấy tài liệu cần xoá.', 404);
    }
  }
}

function mapDocument(row: Row): AssetDocument {
  return {
    id: String(row.id),
    assetCode: String(row.asset_code),
    fileName: String(row.file_name),
    contentType: String(row.content_type),
    sizeBytes: row.size_bytes == null ? undefined : Number(row.size_bytes),
    note: row.note == null ? undefined : String(row.note),
    uploadedBy: String(row.uploaded_by),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(String(row.created_at)).toISOString(),
  };
}
