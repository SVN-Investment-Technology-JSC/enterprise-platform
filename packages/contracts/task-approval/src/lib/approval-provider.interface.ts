import type { ExecuteTaskActionDto, TaskActionResultDto } from './task-action-dto.js';
import type { UniversalTaskDto } from './task-dto.js';

/**
 * Tùy chọn truy vấn danh sách công việc chờ duyệt
 */
export interface TaskQueryOptions {
  limit?: number;
  offset?: number;
  priority?: string;
  sourceModule?: string;
}

/**
 * Kết quả phân trang danh sách tác vụ
 */
export interface TaskPageResult {
  items: UniversalTaskDto[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Giao diện nhà cung cấp phê duyệt (Universal Approval Provider Port).
 * Mọi phân hệ có tính năng phê duyệt (HRM, Kho, Bảo trì, Quy trình) đều hiện thực interface này.
 */
export interface UniversalApprovalProvider {
  /**
   * Lấy danh sách việc đang chờ người dùng hiện tại xử lý.
   * LƯU Ý QUAN TRỌNG: Module tự chịu trách nhiệm truy vấn theo đúng phạm vi duyệt
   * (chuỗi báo cáo, chức danh, kiêm nhiệm, quyền hạn). Task Router KHÔNG tự lọc lại.
   */
  getPendingTasks(
    tenantId: string,
    actorId: string,
    options?: TaskQueryOptions,
  ): Promise<TaskPageResult>;

  /**
   * Lấy chi tiết đầy đủ của một tác vụ để Universal Drawer hiển thị các blocks
   */
  getTaskDetail(
    tenantId: string,
    actorId: string,
    taskId: string,
  ): Promise<UniversalTaskDto>;

  /**
   * Thực thi hành động phê duyệt, từ chối hoặc yêu cầu bổ sung
   */
  executeAction(
    tenantId: string,
    actorId: string,
    taskId: string,
    dto: ExecuteTaskActionDto,
  ): Promise<TaskActionResultDto>;
}
