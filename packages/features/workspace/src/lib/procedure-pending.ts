import type { WorkItemProcedureRequest } from '@enterprise-platform/contracts-workspace';

/**
 * Công việc "Theo quy trình" chưa có hồ sơ, kèm nhãn hiển thị trên cây.
 *
 * Workspace không tự mở hồ sơ: nó gửi yêu cầu qua sự kiện và Quy trình báo
 * về. Trong lúc chờ là "đang mở"; bị từ chối thì hiện lý do để người dùng
 * Thử lại (có thể chọn quy trình khác).
 */
export interface PendingProcedure {
  readonly status: 'pending' | 'rejected' | 'missing';
  readonly label: string;
  readonly hint: string;
}

export function pendingProcedureOf(request: WorkItemProcedureRequest | undefined): PendingProcedure {
  if (request?.status === 'pending') {
    return {
      status: 'pending',
      label: 'Đang mở quy trình…',
      hint: 'Module Quy trình đang mở hồ sơ cho công việc này; trang tự cập nhật sau ít giây.',
    };
  }
  if (request?.status === 'rejected') {
    return {
      status: 'rejected',
      label: 'Không mở được quy trình',
      hint: `Quy trình từ chối: ${request.error ?? 'lỗi không rõ'}. Bấm chuột phải vào công việc và chọn "Thử mở lại quy trình".`,
    };
  }
  return {
    status: 'missing',
    label: 'Chưa mở được quy trình',
    hint: 'Công việc đã tạo nhưng chưa có hồ sơ bên Quy trình. Bấm chuột phải vào công việc và chọn "Thử mở lại quy trình".',
  };
}
