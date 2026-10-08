import { hrmFetch } from './hrm-api';

export const MAX_ATTRIBUTE_FILE_BYTES = 10 * 1024 * 1024;

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
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
  txt: 'text/plain',
};

/**
 * Tải tệp lên kho đính kèm HRM theo cơ chế hiện có: tạo bản ghi -> PUT presigned
 * (MinIO) -> xác nhận hoàn tất. Trả về id đính kèm để lưu làm giá trị thuộc tính.
 */
export async function uploadHrmAttachment(
  employeeId: string,
  file: File,
  documentType?: 'PHOTO' | 'ID_CARD_FRONT' | 'ID_CARD_BACK' | 'QUALIFICATION',
): Promise<{ id: string; name: string }> {
  if (file.size <= 0) {
    throw new Error('Tệp rỗng, vui lòng chọn tệp hợp lệ');
  }
  if (file.size > MAX_ATTRIBUTE_FILE_BYTES)
    throw new Error('Tệp vượt quá dung lượng tối đa 10 MB');

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const contentType =
    EXTENSION_CONTENT_TYPES[ext] || file.type || 'application/octet-stream';

  const created = await hrmFetch<{
    data: { id: string; uploadUrl: string; contentType: string };
  }>('/attachments', {
    method: 'POST',
    body: JSON.stringify({
      employeeId,
      fileName: file.name,
      contentType,
      sizeBytes: file.size,
      ...(documentType ? { documentType } : {}),
    }),
  });
  const put = await fetch(created.data.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': created.data.contentType },
    body: file,
  });
  if (!put.ok) throw new Error('Không tải được tệp lên kho lưu trữ');
  await hrmFetch(`/attachments/${created.data.id}/complete`, {
    method: 'POST',
  });
  return { id: created.data.id, name: file.name };
}
