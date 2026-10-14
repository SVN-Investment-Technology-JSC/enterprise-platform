/**
 * Dự án và công việc của Workspace để hạch toán và gắn đối tượng liên quan, đọc qua API của Tài chính (Tài chính tra Workspace
 * bằng dịch vụ, cả tenant). Kiểu dữ liệu khai tại chỗ: gói `feature-finance` không phụ thuộc hợp đồng của module khác.
 *
 * Workspace tắt hoặc chưa kết nối thì các hàm ném lỗi; màn hình bắt lại và chỉ báo "chưa chọn được dự án", phiếu vẫn lưu được
 * (hạch toán là tuỳ chọn), nên tắt Workspace không làm hỏng Tài chính.
 */
import { financeFetch, toQuery } from './finance-api';

export interface WorkspaceProjectOption {
  id: string;
  code: string;
  name: string;
  status: string;
}

export interface WorkspaceWorkItemOption {
  id: string;
  code: string;
  title: string;
  status: string;
  depth: number;
}

export const projectLabel = (project: { code: string; name: string }) => `${project.code} - ${project.name}`;
export const workItemLabel = (item: { code: string; title: string }) => `${item.code} - ${item.title}`;

export const PROJECT_STATUS_LABELS: Readonly<Record<string, string>> = {
  planning: 'Đang lập kế hoạch',
  active: 'Đang triển khai',
  on_hold: 'Tạm dừng',
  completed: 'Đã hoàn thành',
  cancelled: 'Đã huỷ',
};

export const WORK_ITEM_STATUS_LABELS: Readonly<Record<string, string>> = {
  todo: 'Chưa làm',
  in_progress: 'Đang làm',
  blocked: 'Bị chặn',
  review: 'Chờ duyệt',
  done: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

export async function loadWorkspaceProjects(search?: string): Promise<{ items: WorkspaceProjectOption[]; truncated: boolean }> {
  return financeFetch(`/workspace/projects${toQuery({ search })}`);
}

export async function loadWorkspaceWorkItems(projectId: string): Promise<WorkspaceWorkItemOption[]> {
  return (await financeFetch<{ items: WorkspaceWorkItemOption[] }>(`/workspace/projects/${encodeURIComponent(projectId)}/work-items`)).items;
}
