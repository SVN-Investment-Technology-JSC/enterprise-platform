import type { ProjectProgressMethod, WorkItemProgressMethod } from '@enterprise-platform/contracts-workspace';

/** Nhãn và mô tả các cách tính tiến độ dự án, dùng chung cho form dự án và Cài đặt chung. */
export const PROGRESS_METHOD_INFO: Readonly<Record<ProjectProgressMethod, { label: string; description: string }>> = {
  avg_tasks: {
    label: 'Bình quân tiến độ các công việc',
    description: 'Mỗi công việc cấp gốc nặng như nhau: tiến độ dự án là trung bình cộng % của các công việc đó.',
  },
  weighted_days: {
    label: 'Bình quân theo số ngày thực hiện',
    description:
      'Công việc dài ngày nặng hơn: trọng số là số ngày từ ngày bắt đầu đến ngày kết thúc dự kiến. Công việc chưa có đủ hai ngày tính bằng mức trung bình.',
  },
  weighted_weight: {
    label: 'Bình quân theo tỷ trọng công việc',
    description:
      'Mỗi công việc cấp gốc có ô "Tỷ trọng" do bạn đặt. Công việc chưa đặt tỷ trọng tính bằng mức trung bình của các việc đã đặt.',
  },
  weighted_hours: {
    label: 'Theo giờ ước lượng (cách cũ)',
    description: 'Công thức có từ trước: trọng số là tổng giờ ước lượng của các việc nhỏ nhất. Chỉ còn ở dự án đã tạo trước đây.',
  },
};

export const PROGRESS_METHOD_ORDER: readonly ProjectProgressMethod[] = ['avg_tasks', 'weighted_days', 'weighted_weight'];

export function progressMethodLabel(method: ProjectProgressMethod): string {
  return PROGRESS_METHOD_INFO[method].label;
}

/** Nhãn và mô tả các cách tính tiến độ của công việc. */
export const WORK_ITEM_PROGRESS_METHOD_INFO: Readonly<Record<WorkItemProgressMethod, { label: string; description: string }>> = {
  manual: {
    label: 'Theo % người dùng tự cập nhật',
    description: 'Người làm báo tiến độ ở thanh tiến độ. Công việc có việc con thì tự tính từ các việc con.',
  },
  quantity: {
    label: 'Theo tỷ lệ hoàn thành khối lượng',
    description: 'Người làm báo khối lượng đã hoàn thành; tiến độ là khối lượng đã làm chia cho khối lượng cần làm.',
  },
  checklist: {
    label: 'Theo tỷ lệ hoàn thành đầu việc',
    description: 'Tiến độ là số đầu việc đã tích chia cho tổng số đầu việc. Đủ đầu việc thì công việc theo cài đặt báo hoàn thành.',
  },
  child_weight: {
    label: 'Theo tỷ trọng công việc con',
    description: 'Tiến độ của việc cha là bình quân tiến độ các việc con theo tỷ trọng (hoặc chia đều).',
  },
};
