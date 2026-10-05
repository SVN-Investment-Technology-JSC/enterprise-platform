/**
 * Lọc danh sách đơn theo tiến độ duyệt của Procedure (FIX-E-02):
 * - assignee: "đang chờ ai duyệt" (khớp một phần, không phân biệt hoa thường);
 * - currentStep: tên bước hiện tại (khớp chính xác, không phân biệt hoa thường).
 * Không truyền bộ lọc nào thì trả `TRUE` và không đụng cột mới (migration 0029 chưa chạy vẫn đọc được danh sách).
 */
export interface WorkflowProgressQuery {
  assignee?: string;
  currentStep?: string;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** `qualifier` là bí danh/tên bảng đứng trước cột; `nextIndex` là số thứ tự tham số `$n` kế tiếp. */
export function workflowProgressFilter(
  qualifier: string,
  nextIndex: number,
  query: WorkflowProgressQuery,
): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const assignee = query.assignee?.trim();
  if (assignee) {
    params.push(`%${escapeLike(assignee.slice(0, 200))}%`);
    clauses.push(
      `COALESCE(${qualifier}.current_assignee_name,'') ILIKE $${nextIndex + params.length - 1}`,
    );
  }
  const step = query.currentStep?.trim();
  if (step) {
    params.push(step.slice(0, 200));
    clauses.push(
      `lower(COALESCE(${qualifier}.current_step_name,'')) = lower($${nextIndex + params.length - 1})`,
    );
  }
  return { sql: clauses.length ? clauses.join(' AND ') : 'TRUE', params };
}
