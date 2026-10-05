import { hrmFetch } from './hrm-api';

export const MAX_ATTRIBUTE_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Tải tệp lên kho đính kèm HRM theo cơ chế hiện có: tạo bản ghi -> PUT presigned
 * (MinIO) -> xác nhận hoàn tất. Trả về id đính kèm để lưu làm giá trị thuộc tính.
 */
export async function uploadHrmAttachment(
  employeeId: string,
  file: File,
  documentType?: 'PHOTO' | 'ID_CARD_FRONT' | 'ID_CARD_BACK' | 'QUALIFICATION',
): Promise<{ id: string; name: string }> {
  if (file.size > MAX_ATTRIBUTE_FILE_BYTES)
    throw new Error('Tệp vượt quá dung lượng tối đa 10 MB');
  const created = await hrmFetch<{
    data: { id: string; uploadUrl: string; contentType: string };
  }>('/attachments', {
    method: 'POST',
    body: JSON.stringify({
      employeeId,
      fileName: file.name,
      contentType: file.type,
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
