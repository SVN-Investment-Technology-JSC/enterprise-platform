import { randomUUID } from 'node:crypto';
import { S3ObjectStorage } from '@enterprise-platform/adapter-storage';
import type { FinanceAttachmentPurpose, FinanceVoucherAttachment } from '@enterprise-platform/contracts-finance';
import type { QueryResultRow } from 'pg';
import { canApprove, canCreate, type FinanceActor } from '../domain/finance.access.js';
import { FinanceError, conflict, invalid, notFound } from '../domain/finance.error.js';
import { iso, num, optStr, type Db } from './finance.database.js';
import type { FinanceVoucherKind } from '@enterprise-platform/contracts-finance';

type Row = QueryResultRow & Record<string, unknown>;

export const FINANCE_STORAGE = Symbol('FINANCE_STORAGE');

/** Phần của kho đối tượng mà Tài chính cần; tách ra để kiểm thử không phải dựng MinIO. */
export interface FinanceStoragePort {
  createUploadUrl(input: { key: string; contentType: string; expiresInSeconds?: number }): Promise<string>;
  createDownloadUrl(key: string, expiresInSeconds?: number, options?: { inline?: boolean; contentType?: string; fileName?: string }): Promise<string>;
  objectMetadata(key: string): Promise<{ sizeBytes: number; contentType: string }>;
}

/** Cấu hình kho từ biến môi trường (cùng tên biến với HRM). Chạy cục bộ không cấu hình thì dùng MinIO ở cổng 9010. */
function storageOptions() {
  const internalEndpoint = process.env['S3_INTERNAL_ENDPOINT'] ?? process.env['S3_ENDPOINT'];
  const publicEndpoint = process.env['S3_PUBLIC_ENDPOINT'] ?? process.env['S3_ENDPOINT'];
  const localDevelopment =
    process.env['NODE_ENV'] !== 'production' &&
    [internalEndpoint, publicEndpoint].every((endpoint) => !endpoint || /^http:\/\/(localhost|127\.0\.0\.1):9010\/?$/.test(endpoint));
  return {
    internalEndpoint: internalEndpoint ?? (localDevelopment ? 'http://localhost:9010' : undefined),
    publicEndpoint: publicEndpoint ?? (localDevelopment ? 'http://localhost:9010' : undefined),
    region: process.env['S3_REGION'] ?? 'us-east-1',
    bucket: process.env['S3_BUCKET'] ?? 'enterprise-platform',
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? (localDevelopment ? 'platform' : undefined),
    secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? (localDevelopment ? 'platform-development-secret' : undefined),
  };
}

/** Kho thật, tạo ở lần dùng đầu tiên: dịch vụ vẫn khởi động được khi chỉ thiếu cấu hình kho. */
export function createFinanceStorage(): FinanceStoragePort {
  let storage: S3ObjectStorage | undefined;
  const instance = () => (storage ??= new S3ObjectStorage(storageOptions()));
  return {
    createUploadUrl: (input) => instance().createUploadUrl(input),
    createDownloadUrl: (key, expires, options) => instance().createDownloadUrl(key, expires, options),
    objectMetadata: (key) => instance().objectMetadata(key),
  };
}

/** Định dạng chứng từ được nhận, theo đuôi tệp; nội dung khai báo phải khớp. */
export const ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_VOUCHER = 20;

/** Ảnh dán vào ô Ghi chú: chỉ nhận ảnh, nhẹ hơn và giới hạn số lượng riêng với chứng từ đính kèm. */
export const NOTE_IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
export const MAX_NOTE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_NOTE_IMAGES_PER_VOUCHER = 10;

export const mapAttachmentRow = (row: Row): FinanceVoucherAttachment => ({
  id: String(row.id),
  fileName: String(row.file_name),
  contentType: String(row.content_type),
  sizeBytes: num(row.size_bytes),
  uploadedBy: optStr(row.uploaded_by),
  uploadedByName: optStr(row.uploaded_by_name),
  uploadedAt: iso(row.uploaded_at),
  purpose: (row.purpose as FinanceAttachmentPurpose | undefined) ?? 'ATTACHMENT',
});

/** Tên tệp an toàn: bỏ đường dẫn và ký tự điều khiển, giữ tiếng Việt. */
export function cleanFileName(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  // Bỏ ký tự điều khiển (mã dưới 32 và 127) bằng mã ký tự, không dùng biểu thức chính quy chứa ký tự điều khiển.
  const base = text.split(/[\\/]/).pop() ?? '';
  const name = [...base].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127).join('').trim();
  if (!name || name.length > 255) throw invalid('Tên tệp không hợp lệ (tối đa 255 ký tự).');
  return name;
}

/** Chỉ người lập (có quyền lập loại phiếu) mới thêm/gỡ tệp, và chỉ khi phiếu còn sửa được (nháp hoặc bị từ chối). */
async function editableVoucher(db: Db, tenantId: string, actor: FinanceActor, voucherId: string): Promise<Row> {
  const voucher = (
    await db.query(`SELECT id, kind, status, created_by, approval_mode FROM finance_schema.vouchers WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, voucherId])
  ).rows[0] as Row | undefined;
  if (voucher?.approval_mode === 'INHERITED') {
    // Phiếu tạo từ hồ sơ: chứng từ do kế toán (người duyệt loại phiếu) đính kèm khi phiếu còn chờ ghi sổ.
    if (!canApprove(actor, voucher.kind as FinanceVoucherKind)) throw notFound('phiếu');
    const source = (await db.query(`SELECT status FROM finance_schema.voucher_sources WHERE tenant_id=$1 AND voucher_id=$2`, [tenantId, voucherId])).rows[0] as
      | Row
      | undefined;
    if (voucher.status !== 'DRAFT' || source?.status !== 'OPEN')
      throw conflict('FINANCE_VOUCHER_LOCKED', 'Chỉ đính kèm được khi phiếu còn chờ ghi sổ.');
    return voucher;
  }
  if (!voucher || voucher.created_by !== actor.userId || !canCreate(actor, voucher.kind as FinanceVoucherKind)) throw notFound('phiếu');
  if (voucher.status !== 'DRAFT' && voucher.status !== 'REJECTED') throw conflict('FINANCE_VOUCHER_LOCKED', 'Chỉ đính kèm được khi phiếu còn là nháp hoặc bị từ chối.');
  return voucher;
}

export async function createAttachment(
  db: Db,
  storage: FinanceStoragePort,
  tenantId: string,
  actor: FinanceActor,
  voucherId: string,
  input: { fileName?: unknown; contentType?: unknown; sizeBytes?: unknown; purpose?: unknown },
): Promise<{ id: string; uploadUrl: string; contentType: string }> {
  await editableVoucher(db, tenantId, actor, voucherId);
  const purpose: FinanceAttachmentPurpose = input.purpose === 'NOTE_IMAGE' ? 'NOTE_IMAGE' : 'ATTACHMENT';
  const isNoteImage = purpose === 'NOTE_IMAGE';
  const types = isNoteImage ? NOTE_IMAGE_TYPES : ATTACHMENT_TYPES;
  const maxBytes = isNoteImage ? MAX_NOTE_IMAGE_BYTES : MAX_ATTACHMENT_BYTES;
  const maxCount = isNoteImage ? MAX_NOTE_IMAGES_PER_VOUCHER : MAX_ATTACHMENTS_PER_VOUCHER;
  const fileName = cleanFileName(input.fileName);
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const size = Number(input.sizeBytes);
  if (types[extension] !== input.contentType || !Number.isInteger(size) || size < 1 || size > maxBytes)
    throw invalid(isNoteImage ? 'Ảnh ghi chú phải là PNG, JPEG hoặc WEBP, tối đa 5 MB.' : 'Chứng từ phải là PDF, ảnh (PNG, JPEG, WEBP), Word hoặc Excel, tối đa 10 MB.');
  const live = (
    await db.query(`SELECT count(*)::int AS n FROM finance_schema.voucher_attachments WHERE voucher_id=$1 AND purpose=$2 AND deleted_at IS NULL`, [voucherId, purpose])
  ).rows[0] as Row;
  if (num(live.n) >= maxCount) throw invalid(isNoteImage ? `Ghi chú tối đa ${maxCount} ảnh.` : `Mỗi phiếu đính kèm tối đa ${maxCount} tệp.`);

  const id = randomUUID();
  const key = `tenants/${tenantId}/finance/${voucherId}/${id}.${extension}`;
  const uploadUrl = await storage.createUploadUrl({ key, contentType: input.contentType as string, expiresInSeconds: 300 });
  await db.query(
    `INSERT INTO finance_schema.voucher_attachments (id, tenant_id, voucher_id, file_name, content_type, size_bytes, storage_key, uploaded_by, uploaded_by_name, purpose)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, tenantId, voucherId, fileName, input.contentType, size, key, actor.userId, actor.displayName, purpose],
  );
  return { id, uploadUrl, contentType: input.contentType as string };
}

/** Xác nhận tệp đã lên kho đúng kích thước và định dạng đã khai báo rồi mới cho hiện trên phiếu. */
export async function completeAttachment(
  db: Db,
  storage: FinanceStoragePort,
  tenantId: string,
  actor: FinanceActor,
  voucherId: string,
  attachmentId: string,
): Promise<FinanceVoucherAttachment> {
  await editableVoucher(db, tenantId, actor, voucherId);
  const row = (await db.query(`SELECT * FROM finance_schema.voucher_attachments WHERE tenant_id=$1 AND voucher_id=$2 AND id=$3 AND deleted_at IS NULL`, [tenantId, voucherId, attachmentId])).rows[0] as Row | undefined;
  if (!row) throw notFound('tệp đính kèm');
  if (row.status === 'READY') return mapAttachmentRow(row);
  let metadata: { sizeBytes: number; contentType: string };
  try {
    metadata = await storage.objectMetadata(String(row.storage_key));
  } catch {
    throw new FinanceError('FINANCE_ATTACHMENT_NOT_UPLOADED', 'Tệp chưa tải lên kho lưu trữ thành công.', 422);
  }
  if (Number(metadata.sizeBytes) !== num(row.size_bytes) || metadata.contentType !== row.content_type)
    throw new FinanceError('FINANCE_ATTACHMENT_MISMATCH', 'Kích thước hoặc định dạng tệp không khớp khai báo.', 422);
  const updated = (
    await db.query(`UPDATE finance_schema.voucher_attachments SET status='READY', verified_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [tenantId, attachmentId])
  ).rows[0] as Row;
  return mapAttachmentRow(updated);
}

/** Đường tải xuống có thời hạn ngắn; nơi gọi đã kiểm quyền xem phiếu. */
export async function attachmentDownload(
  db: Db,
  storage: FinanceStoragePort,
  tenantId: string,
  voucherId: string,
  attachmentId: string,
): Promise<{ fileName: string; url: string }> {
  const row = (await db.query(`SELECT * FROM finance_schema.voucher_attachments WHERE tenant_id=$1 AND voucher_id=$2 AND id=$3 AND deleted_at IS NULL AND status='READY'`, [tenantId, voucherId, attachmentId])).rows[0] as Row | undefined;
  if (!row) throw notFound('tệp đính kèm');
  return { fileName: String(row.file_name), url: await storage.createDownloadUrl(String(row.storage_key), 120, { fileName: String(row.file_name), contentType: String(row.content_type) }) };
}

/** Gỡ tệp (xoá mềm, ghi người gỡ) khi phiếu còn sửa được. */
export async function removeAttachment(db: Db, tenantId: string, actor: FinanceActor, voucherId: string, attachmentId: string): Promise<void> {
  await editableVoucher(db, tenantId, actor, voucherId);
  const updated = await db.query(
    `UPDATE finance_schema.voucher_attachments SET deleted_at=now(), deleted_by=$4 WHERE tenant_id=$1 AND voucher_id=$2 AND id=$3 AND deleted_at IS NULL RETURNING id`,
    [tenantId, voucherId, attachmentId, actor.userId],
  );
  if (!updated.rows.length) throw notFound('tệp đính kèm');
}
