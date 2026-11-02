import type { CrmDocumentType } from '@enterprise-platform/contracts-crm';

/** Mã loại tài liệu: chữ hoa, số, gạch dưới, 2 đến 32 ký tự (khớp server). */
export const DOCUMENT_TYPE_CODE_PATTERN = /^[A-Z0-9_]{2,32}$/;

/** Chuẩn hoá mã người gõ: bỏ khoảng trắng đầu cuối, đổi sang chữ hoa. */
export function normalizeDocumentTypeCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Lỗi nhập liệu (tiếng Việt) hoặc undefined nếu hợp lệ. `code` chỉ kiểm khi tạo mới. */
export function documentTypeFormError(input: { code?: string; name: string; sortOrder: string }): string | undefined {
  if (input.code !== undefined && !DOCUMENT_TYPE_CODE_PATTERN.test(normalizeDocumentTypeCode(input.code))) {
    return 'Mã gồm chữ hoa, số, gạch dưới, từ 2 đến 32 ký tự.';
  }
  if (!input.name.trim()) return 'Vui lòng nhập tên loại tài liệu.';
  if (input.sortOrder.trim() !== '' && !/^\d{1,6}$/.test(input.sortOrder.trim())) return 'Thứ tự phải là số nguyên không âm.';
  return undefined;
}

/** Xếp theo thứ tự rồi theo tên; loại đang dùng đứng trước loại đã tắt. */
export function sortDocumentTypes(items: readonly CrmDocumentType[]): CrmDocumentType[] {
  return [...items].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'),
  );
}
