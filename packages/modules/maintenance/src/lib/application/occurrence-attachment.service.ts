import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import {
  S3ObjectStorage,
  TENANT_UPLOAD_URL_TTL_SECONDS,
  UploadFileRejectedError,
  checkUploadFile,
  downloadContentTypeFor,
  readObjectSize,
  type ObjectStorageManagementPort,
  type ObjectStorageMetadataPort,
} from '@enterprise-platform/adapter-storage';
import { Logger } from '@nestjs/common';
import {
  MAINTENANCE_ATTACHMENT_MAX_BYTES,
  MAINTENANCE_ATTACHMENT_TYPES,
  type CreateOccurrenceAttachmentRequest,
  type CreateOccurrenceAttachmentResponse,
  type OccurrenceAttachment,
} from '@enterprise-platform/contracts-maintenance';
import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { MaintenanceError } from '../domain/maintenance.error.js';
import type { MaintenanceActor } from './maintenance-store.port.js';

type Row = QueryResultRow & Record<string, unknown>;

/** Thời hạn URL tải xuống đính kèm. */
const DOWNLOAD_URL_TTL_SECONDS = 300;

export class OccurrenceAttachmentService {
  private readonly logger = new Logger(OccurrenceAttachmentService.name);

  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
    private readonly storage: ObjectStorageManagementPort & ObjectStorageMetadataPort = new S3ObjectStorage({
      internalEndpoint: process.env.S3_INTERNAL_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:9010',
      publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:9010',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'enterprise-platform',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'platform',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'platform-development-secret',
    }),
  ) {}

  /** Chỉ tệp đã hoàn tất tải lên; dòng PENDING (trình duyệt chưa PUT xong) không hiện. */
  async list(actor: MaintenanceActor, occurrenceId: string): Promise<OccurrenceAttachment[]> {
    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const result = await pool.query<Row>(
      `SELECT *
         FROM maintenance_schema.occurrence_attachments
        WHERE occurrence_id = $1 AND upload_status = 'COMPLETED'
        ORDER BY created_at DESC`,
      [occurrenceId],
    );
    return result.rows.map(mapAttachment);
  }

  async create(
    actor: MaintenanceActor,
    occurrenceId: string,
    input: CreateOccurrenceAttachmentRequest,
  ): Promise<CreateOccurrenceAttachmentResponse> {
    const canHandle = actor.canHandleOccurrences ?? actor.canManage;
    if (!canHandle) {
      throw new MaintenanceError('forbidden', 'Bạn không có quyền đính kèm tệp vào phiếu bảo trì.');
    }
    if (!input?.fileName?.trim()) {
      throw new MaintenanceError('validation', 'Tên tệp và loại tệp là bắt buộc.');
    }
    // Đuôi tệp phải khớp loại khai báo; loại lưu và ký URL do server quyết theo
    // đuôi. Trình duyệt không nhận ra kiểu tệp (`application/octet-stream`) thì
    // dùng loại chuẩn của đuôi — giao diện PUT bằng đúng loại server trả về.
    let file: { fileName: string; contentType: string; sizeBytes?: number };
    try {
      file = checkUploadFile(
        { fileName: input.fileName, contentType: input.contentType, sizeBytes: input.sizeBytes },
        { allowed: MAINTENANCE_ATTACHMENT_TYPES, acceptUnknownContentType: true },
      );
    } catch (error) {
      if (error instanceof UploadFileRejectedError) throw new MaintenanceError('validation', error.message);
      throw error;
    }
    if ((file.sizeBytes ?? 0) > MAINTENANCE_ATTACHMENT_MAX_BYTES) {
      throw new MaintenanceError('validation', 'Tệp đính kèm không vượt quá 25 MB.');
    }
    const { fileName, contentType } = file;

    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const id = randomUUID();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const objectKey = `tenants/${actor.tenantId}/maintenance/${occurrenceId}/${id}-${safeName}`;

    // Dòng mới ở PENDING: chỉ hiện sau khi trình duyệt PUT xong và gọi `complete`.
    const result = await pool.query<Row>(
      `INSERT INTO maintenance_schema.occurrence_attachments
         (id, occurrence_id, object_key, file_name, content_type, size_bytes, note, uploaded_by, upload_status)
       SELECT $1, o.id, $3, $4, $5, $6, $7, $8, 'PENDING'
         FROM maintenance_schema.occurrences o
        WHERE o.id = $2
    RETURNING *`,
      [id, occurrenceId, objectKey, fileName, contentType, file.sizeBytes ?? null, input.note?.trim() || null, actor.userId],
    );
    const row = result.rows[0];
    if (!row) throw new MaintenanceError('not_found', 'Không tìm thấy phiếu bảo trì.');

    const expiresInSeconds = TENANT_UPLOAD_URL_TTL_SECONDS;
    return {
      attachment: mapAttachment(row),
      uploadUrl: await this.storage.createUploadUrl({ key: objectKey, contentType, expiresInSeconds }),
      expiresInSeconds,
    };
  }

  /**
   * Trình duyệt báo đã PUT xong tệp lên kho. Server không tin lời báo: hỏi kho
   * (`HEAD`) xem object có thật không, ghi dung lượng thật và chuyển dòng sang
   * COMPLETED. Chỉ từ lúc này tệp mới hiện trong danh sách và tải xuống được.
   *
   * Mỗi tệp hoàn tất một lần: chưa có tệp trên kho, hoặc đã hoàn tất rồi, thì
   * 409. Chỉ người tạo đính kèm, hoặc người có quyền quản lý Bảo trì, báo xong được.
   */
  async complete(actor: MaintenanceActor, occurrenceId: string, attachmentId: string): Promise<OccurrenceAttachment> {
    const canHandle = actor.canHandleOccurrences ?? actor.canManage;
    if (!canHandle) {
      throw new MaintenanceError('forbidden', 'Bạn không có quyền đính kèm tệp vào phiếu bảo trì.');
    }
    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const found = await pool.query<Row>(
      `SELECT id, object_key, uploaded_by, upload_status
         FROM maintenance_schema.occurrence_attachments
        WHERE occurrence_id = $1 AND id = $2`,
      [occurrenceId, attachmentId],
    );
    const row = found.rows[0];
    if (!row) throw new MaintenanceError('not_found', 'Không tìm thấy tệp đính kèm.');
    if (String(row.uploaded_by) !== actor.userId && !actor.canManage) {
      throw new MaintenanceError('forbidden', 'Chỉ người tải tệp lên mới xác nhận được tệp này.');
    }
    if (row.upload_status !== 'PENDING') throw uploadAlreadyCompleted();
    const size = await readObjectSize(this.storage, String(row.object_key));
    if (size === null || size <= 0) {
      throw new MaintenanceError(
        'conflict',
        'Chưa thấy tệp trên kho lưu trữ, hãy tải lên lại.',
        'UPLOAD_NOT_FOUND',
      );
    }
    if (size > MAINTENANCE_ATTACHMENT_MAX_BYTES) {
      throw new MaintenanceError('validation', 'Tệp đính kèm không vượt quá 25 MB.');
    }
    // Một câu UPDATE có điều kiện (tự là một transaction): hai lượt báo xong
    // chạy song song thì lượt thua không khớp dòng nào và nhận 409.
    const updated = await pool.query<Row>(
      `UPDATE maintenance_schema.occurrence_attachments
          SET upload_status = 'COMPLETED', size_bytes = $3
        WHERE occurrence_id = $1 AND id = $2 AND upload_status = 'PENDING'
    RETURNING *`,
      [occurrenceId, attachmentId, size],
    );
    const completed = updated.rows[0];
    if (!completed) throw uploadAlreadyCompleted();
    return mapAttachment(completed);
  }

  async downloadUrl(actor: MaintenanceActor, occurrenceId: string, attachmentId: string): Promise<string> {
    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const result = await pool.query<Row>(
      `SELECT object_key, file_name
         FROM maintenance_schema.occurrence_attachments
        WHERE occurrence_id = $1 AND id = $2 AND upload_status = 'COMPLETED'`,
      [occurrenceId, attachmentId],
    );
    const row = result.rows[0];
    if (!row?.object_key) throw new MaintenanceError('not_found', 'Không tìm thấy tài liệu.');
    const fileName = String(row.file_name ?? '');
    // Luôn tải về (`attachment`) với loại server quyết theo đuôi tệp, không
    // theo loại client đã khai lúc tải lên: tệp cũ khai `text/html` cũng không
    // mở thành trang trên tên miền kho.
    return this.storage.createDownloadUrl(String(row.object_key), DOWNLOAD_URL_TTL_SECONDS, {
      attachment: true,
      contentType: downloadContentTypeFor(fileName, MAINTENANCE_ATTACHMENT_TYPES),
      fileName,
    });
  }

  async remove(actor: MaintenanceActor, occurrenceId: string, attachmentId: string): Promise<void> {
    const canHandle = actor.canHandleOccurrences ?? actor.canManage;
    if (!canHandle) {
      throw new MaintenanceError('forbidden', 'Bạn không có quyền xoá tệp đính kèm.');
    }
    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const result = await pool.query<Row>(
      `DELETE FROM maintenance_schema.occurrence_attachments
        WHERE occurrence_id = $1 AND id = $2
    RETURNING object_key`,
      [occurrenceId, attachmentId],
    );
    const key = result.rows[0]?.object_key;
    if ((result.rowCount ?? 0) === 0 || !key) {
      throw new MaintenanceError('not_found', 'Không tìm thấy tài liệu cần xoá.');
    }
    // Xoá cả tệp trong kho; không thì link tải cũ (và dung lượng) vẫn còn sau
    // khi đính kèm đã biến mất. Kho lỗi thì chỉ ghi nhận: dòng đã xoá, tệp mồ
    // côi dọn sau, người dùng không phải bấm lại.
    try {
      const { failed } = await this.storage.deleteObjects([String(key)]);
      if (failed.length > 0) this.logger.warn(`Không xoá được tệp đính kèm bảo trì ${attachmentId} khỏi kho.`);
    } catch (error) {
      this.logger.warn(
        `Không xoá được tệp đính kèm bảo trì ${attachmentId} khỏi kho: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function uploadAlreadyCompleted(): MaintenanceError {
  return new MaintenanceError('conflict', 'Tệp này đã được xác nhận tải lên.', 'UPLOAD_ALREADY_COMPLETED');
}

function mapAttachment(row: Row): OccurrenceAttachment {
  return {
    id: String(row.id),
    occurrenceId: String(row.occurrence_id),
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
