/**
 * Định dạng dùng chung cho hai dòng thời gian: Trao đổi và Lịch sử thao tác.
 *
 * Tách ra một chỗ để hai panel không trôi dạt về màu sắc và cách ghi ngày —
 * chúng đứng cạnh nhau trong cùng một cột chi tiết nên lệch nhau là thấy ngay.
 */

export const activityTime = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
});

const activityDay = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * Màu theo loại hành động, để quét mắt nhanh trên dòng thời gian dài.
 *
 * Dùng chấm màu chứ không dùng emoji: emoji hiển thị khác nhau tuỳ hệ điều hành,
 * không đổi màu theo giao diện sáng/tối, và không mang thêm nghĩa nào so với
 * dòng chữ ngay bên cạnh.
 */
export const ACTION_TONE: Record<string, string> = {
  start: 'toneStart',
  approve: 'toneOk',
  complete: 'toneOk',
  return: 'toneWarn',
  reject: 'toneBad',
  cancel: 'toneBad',
  comment: 'toneNeutral',
  publish: 'toneNeutral',
};

export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
  return sameDay ? 'Hôm nay' : activityDay.format(date);
}
