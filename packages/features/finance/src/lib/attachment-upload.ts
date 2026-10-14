import type { FinanceVoucherAttachment } from '@enterprise-platform/contracts-finance';
import { financeDelete, financeFetch, financePost } from './finance-api';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

/** Đuôi tệp được nhận và loại nội dung tương ứng; phải khớp với máy chủ (attachments.store.ts). */
export const ATTACHMENT_CONTENT_TYPES: Readonly<Record<string, string>> = {
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

export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_CONTENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

/** Lý do tệp không đính kèm được (null nếu hợp lệ), kiểm ngay ở trình duyệt để báo sớm trước khi tải lên. */
export function attachmentProblem(file: Pick<File, 'name' | 'size'>): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ATTACHMENT_CONTENT_TYPES[extension]) return `${file.name}: chỉ nhận PDF, ảnh (PNG, JPEG, WEBP), Word hoặc Excel.`;
  if (file.size <= 0) return `${file.name}: tệp rỗng.`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name}: vượt quá 10 MB.`;
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`.replace('.', ',');
  return `${Math.round(bytes / 104857.6) / 10} MB`.replace('.', ',');
}

/**
 * Tải một tệp lên phiếu: tạo bản ghi và nhận URL ký sẵn, PUT thẳng lên kho (MinIO), rồi xác nhận để tệp hiện trên phiếu.
 * Lỗi ở bước nào cũng ném ra thông báo tiếng Việt để màn hình hiện cho người dùng.
 */
export async function uploadFinanceAttachment(voucherId: string, file: File): Promise<FinanceVoucherAttachment> {
  const problem = attachmentProblem(file);
  if (problem) throw new Error(problem);
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const contentType = ATTACHMENT_CONTENT_TYPES[extension];
  const created = await financePost<{ id: string; uploadUrl: string; contentType: string }>(`/vouchers/${voucherId}/attachments`, {
    fileName: file.name,
    contentType,
    sizeBytes: file.size,
  });
  const put = await fetch(created.uploadUrl, { method: 'PUT', headers: { 'content-type': created.contentType }, body: file });
  if (!put.ok) throw new Error(`${file.name}: không tải được tệp lên kho lưu trữ.`);
  return financePost<FinanceVoucherAttachment>(`/vouchers/${voucherId}/attachments/${created.id}/complete`);
}

export async function removeFinanceAttachment(voucherId: string, attachmentId: string): Promise<void> {
  await financeDelete(`/vouchers/${voucherId}/attachments/${attachmentId}`);
}

/** Mở tệp trong thẻ mới bằng URL tải xuống có thời hạn ngắn (máy chủ kiểm quyền xem phiếu). */
export async function openFinanceAttachment(voucherId: string, attachmentId: string): Promise<void> {
  const { url } = await financeFetch<{ fileName: string; url: string }>(`/vouchers/${voucherId}/attachments/${attachmentId}/download`);
  window.open(url, '_blank', 'noopener,noreferrer');
}
