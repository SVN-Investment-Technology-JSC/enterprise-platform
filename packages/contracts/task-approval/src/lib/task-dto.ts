import type { TaskRenderingBlocks } from './task-blocks.js';

/**
 * Chế độ phê duyệt của tác vụ:
 * - LOCAL: Module nghiệp vụ tự quản lý và quyết định bước duyệt.
 * - WORKFLOW: Procedure Engine (PE) quản lý luồng quy trình và quyết định bước duyệt.
 */
export type TaskApprovalMode = 'LOCAL' | 'WORKFLOW';

/**
 * Trạng thái của tác vụ phê duyệt
 */
export type TaskStatus =
  | 'PENDING'      // Đang chờ người dùng xử lý
  | 'APPROVED'     // Đã được chấp thuận
  | 'REJECTED'     // Đã bị từ chối
  | 'RETURNED'     // Yêu cầu bổ sung / chỉnh sửa
  | 'CANCELLED';   // Người tạo đơn đã rút / hủy đơn

/**
 * Các hành động phê duyệt trong phiên bản v1.
 * (Đã loại bỏ DELEGATE khỏi v1 theo phản biện thực tế để giữ tinh gọn).
 */
export type TaskActionType = 'APPROVE' | 'REJECT' | 'RETURN';

/**
 * Mức độ ưu tiên của công việc
 */
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

/**
 * Thông tin người nộp đơn / người yêu cầu (chủ thể của đơn)
 */
export interface TaskRequester {
  userId: string;
  fullName: string;
  email?: string;
  avatarUrl?: string;
  departmentName?: string;
  positionName?: string;
}

/**
 * Thông tin người thực tế nộp đơn khi đơn được tạo hộ
 */
export interface TaskSubmitter {
  userId?: string;
  fullName: string;
  email?: string;
  avatarUrl?: string;
  departmentName?: string;
  positionName?: string;
}

/**
 * DTO dữ liệu của một tác vụ phê duyệt hoàn chỉnh hiển thị trên Dashboard & Universal Task Drawer
 */
export interface UniversalTaskDto {
  /** Định danh duy nhất của tác vụ trong hệ thống */
  taskId: string;

  /** Định danh tenant */
  tenantId: string;

  /** Phân hệ phát sinh yêu cầu */
  sourceModule: 'hrm' | 'inventory' | 'maintenance' | 'procedure' | 'finance' | 'workspace' | string;

  /** Loại thực thể nghiệp vụ (ví dụ: 'LEAVE_REQUEST', 'STOCK_EXPORT', 'WORK_ORDER') */
  entityType: string;

  /** ID của bản ghi nghiệp vụ gốc trong schema của module */
  entityId: string;

  /** Tiêu đề ngắn gọn hiển thị trên danh sách và Drawer */
  title: string;

  /** Mã tham chiếu nghiệp vụ dễ đọc (ví dụ: 'ĐN-2026-0042', 'XK-0812') */
  code?: string;

  /** Người đứng tên đơn / người yêu cầu (chủ thể nghiệp vụ) */
  requester: TaskRequester;

  /** Đánh dấu đơn được nộp hộ bởi người khác */
  createdOnBehalf?: boolean;

  /** Người thực tế nộp đơn (nếu createdOnBehalf = true) */
  submitter?: TaskSubmitter;

  /** Lý do tạo hộ */
  onBehalfReason?: string;

  /** Thời điểm tạo tác vụ (ISO 8601 UTC) */
  createdAt: string;

  /** Mức độ ưu tiên */
  priority?: TaskPriority;

  /** Chế độ thực thi phê duyệt */
  approvalMode: TaskApprovalMode;

  /** Đơn vị/Phân hệ sở hữu thẩm quyền quyết định bước hiện tại */
  approvalOwner: string;

  /** ID của phiên quy trình PE (nếu approvalMode === 'WORKFLOW') */
  workflowInstanceId?: string;

  /** ID của bước quy trình hiện tại (nếu approvalMode === 'WORKFLOW') */
  stepId?: string;

  /** Trạng thái hiện tại của tác vụ */
  status: TaskStatus;

  /**
   * Danh sách hành động mà người duyệt hiện tại ĐƯỢC PHÉP thực hiện.
   * QUY TẮC: Module chỉ trả về các hành động mình hỗ trợ.
   * - HRM hiện tại chỉ hỗ trợ ['APPROVE', 'REJECT'].
   * - Kho / PE có thể hỗ trợ ['APPROVE', 'REJECT', 'RETURN'].
   * Universal Drawer CHỈ RENDER các nút có trong danh sách này.
   */
  availableActions: TaskActionType[];

  /**
   * Phiên bản dữ liệu phục vụ kiểm soát tranh chấp (tùy chọn theo module).
   */
  version?: number;

  /** Đường dẫn an toàn để mở toàn màn hình chi tiết trong phân hệ gốc */
  detailUrl: string;

  /** Các khối dữ liệu hiển thị động trong Drawer */
  blocks: TaskRenderingBlocks;
}
