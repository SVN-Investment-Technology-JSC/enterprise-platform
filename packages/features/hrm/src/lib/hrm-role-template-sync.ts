/** Kết quả tạo/đồng bộ vai trò mẫu HRM từ POST /api/platform/v1/tenant-role-templates/hrm. */
export interface RoleTemplateSeedResult {
  created: string[];
  updated: { name: string; added: string[]; removed: string[] }[];
  skipped: string[];
}

export const ROLE_TEMPLATE_URL = '/api/platform/v1/tenant-role-templates/hrm';
export const ROLE_TEMPLATE_SYNC_URL = `${ROLE_TEMPLATE_URL}?sync=true`;

/** Chuẩn hóa phản hồi (thiếu trường thì coi là rỗng) để giao diện không lỗi khi API trả thiếu. */
export function normalizeSeedResult(body: unknown): RoleTemplateSeedResult {
  const raw = (body && typeof body === 'object' ? body : {}) as Partial<RoleTemplateSeedResult>;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  return {
    created: strings(raw.created),
    skipped: strings(raw.skipped),
    updated: Array.isArray(raw.updated)
      ? raw.updated
          .filter((u) => u && typeof u.name === 'string')
          .map((u) => ({ name: u.name, added: strings(u.added), removed: strings(u.removed) }))
      : [],
  };
}

/** Câu tóm tắt một dòng cho kết quả tạo/đồng bộ. */
export function summarizeSeedResult(result: RoleTemplateSeedResult): string {
  return `Đã tạo ${result.created.length} vai trò mẫu, cập nhật ${result.updated.length}, giữ nguyên ${result.skipped.length}.`;
}
