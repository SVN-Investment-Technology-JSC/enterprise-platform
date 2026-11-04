import { MAX_PROJECT_TEMPLATE_TASKS, MAX_PROJECT_TEMPLATE_TITLE_LENGTH } from '@enterprise-platform/contracts-workspace';
import { WorkspaceValidationError } from './workspace.error.js';

/** Bỏ dấu và hoa thường để "Hợp đồng" và "hop dong" bị coi là một. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd');
}

/**
 * Làm sạch danh sách tên công việc tạo sẵn cho dự án mới (mẫu của tenant hoặc danh sách người dùng gửi lúc tạo):
 * bỏ khoảng trắng thừa, bỏ dòng trống, gộp tên trùng (giữ lần xuất hiện đầu để thứ tự không đổi). Quá dài hoặc quá
 * nhiều thì báo lỗi thay vì cắt lặng lẽ.
 */
export function cleanTaskTitles(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new WorkspaceValidationError('Danh sách công việc tạo sẵn phải là một mảng tên.');
  }
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      throw new WorkspaceValidationError('Tên công việc tạo sẵn phải là chữ.');
    }
    const title = entry.replace(/\s+/g, ' ').trim();
    if (!title) continue;
    if (title.length > MAX_PROJECT_TEMPLATE_TITLE_LENGTH) {
      throw new WorkspaceValidationError(
        `Tên công việc tạo sẵn dài tối đa ${MAX_PROJECT_TEMPLATE_TITLE_LENGTH} ký tự ("${title.slice(0, 30)}…").`,
      );
    }
    const key = fold(title);
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }
  if (titles.length > MAX_PROJECT_TEMPLATE_TASKS) {
    throw new WorkspaceValidationError(`Tạo sẵn tối đa ${MAX_PROJECT_TEMPLATE_TASKS} công việc cho một dự án.`);
  }
  return titles;
}
