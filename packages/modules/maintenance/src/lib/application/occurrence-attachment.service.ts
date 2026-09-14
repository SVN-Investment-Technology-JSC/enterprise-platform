import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { S3ObjectStorage, type ObjectStoragePort } from '@enterprise-platform/adapter-storage';
import { Injectable } from '@nestjs/common';
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

@Injectable()
export class OccurrenceAttachmentService {
  private readonly storage: ObjectStoragePort = new S3ObjectStorage({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9010',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'enterprise-platform',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'platform',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'platform-development-secret',
  });

  constructor(
    private readonly references: TenantDatabaseRegistry,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  async list(actor: MaintenanceActor, occurrenceId: string): Promise<OccurrenceAttachment[]> {
    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const result = await pool.query<Row>(
      `SELECT *
         FROM maintenance_schema.occurrence_attachments
        WHERE occurrence_id = $1
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
    const fileName = input?.fileName?.trim();
    const contentType = input?.contentType?.trim();
    if (!fileName || !contentType) {
      throw new MaintenanceError('validation', 'Tên tệp và loại tệp là bắt buộc.');
    }
    if ((input.sizeBytes ?? 0) > MAINTENANCE_ATTACHMENT_MAX_BYTES) {
      throw new MaintenanceError('validation', 'Tệp đính kèm không vượt quá 25 MB.');
    }

    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    const expected = MAINTENANCE_ATTACHMENT_TYPES[extension];
    if (!expected) {
      throw new MaintenanceError(
        'validation',
        `Định dạng .${extension || '?'} không được phép. Chấp nhận: ${Object.keys(MAINTENANCE_ATTACHMENT_TYPES).join(', ')}.`,
      );
    }

    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const id = randomUUID();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const objectKey = `tenants/${actor.tenantId}/maintenance/${occurrenceId}/${id}-${safeName}`;

    const result = await pool.query<Row>(
      `INSERT INTO maintenance_schema.occurrence_attachments
         (id, occurrence_id, object_key, file_name, content_type, size_bytes, note, uploaded_by)
       SELECT $1, o.id, $3, $4, $5, $6, $7, $8
         FROM maintenance_schema.occurrences o
        WHERE o.id = $2
    RETURNING *`,
      [id, occurrenceId, objectKey, fileName, contentType, input.sizeBytes ?? null, input.note?.trim() || null, actor.userId],
    );
    const row = result.rows[0];
    if (!row) throw new MaintenanceError('not_found', 'Không tìm thấy phiếu bảo trì.');

    const expiresInSeconds = 300;
    return {
      attachment: mapAttachment(row),
      uploadUrl: await this.storage.createUploadUrl({ key: objectKey, contentType, expiresInSeconds }),
      expiresInSeconds,
    };
  }

  async downloadUrl(actor: MaintenanceActor, occurrenceId: string, attachmentId: string): Promise<string> {
    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const result = await pool.query<Row>(
      `SELECT object_key
         FROM maintenance_schema.occurrence_attachments
        WHERE occurrence_id = $1 AND id = $2`,
      [occurrenceId, attachmentId],
    );
    const key = result.rows[0]?.object_key;
    if (!key) throw new MaintenanceError('not_found', 'Không tìm thấy tài liệu.');
    return this.storage.createDownloadUrl(String(key), 300);
  }

  async remove(actor: MaintenanceActor, occurrenceId: string, attachmentId: string): Promise<void> {
    const canHandle = actor.canHandleOccurrences ?? actor.canManage;
    if (!canHandle) {
      throw new MaintenanceError('forbidden', 'Bạn không có quyền xoá tệp đính kèm.');
    }
    const pool = await this.pools.forTenant(this.references.require(actor.tenantId));
    const result = await pool.query(
      `DELETE FROM maintenance_schema.occurrence_attachments
        WHERE occurrence_id = $1 AND id = $2`,
      [occurrenceId, attachmentId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new MaintenanceError('not_found', 'Không tìm thấy tài liệu cần xoá.');
    }
  }
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
