import type { ReportGranularity } from '@enterprise-platform/contracts-workspace';

const MS_PER_DAY = 86_400_000;

/**
 * Độ mịn của biểu đồ xu hướng theo độ dài kỳ: tới một tháng thì theo ngày, tới một quý thì theo tuần, dài hơn thì
 * theo tháng — để biểu đồ luôn chừng vài chục cột, không dày đặc mà cũng không trơ trọi.
 */
export function granularityFor(from: Date, to: Date): ReportGranularity {
  const days = (to.getTime() - from.getTime()) / MS_PER_DAY;
  if (days <= 31) return 'day';
  if (days <= 92) return 'week';
  return 'month';
}

/**
 * Kỳ liền trước, dài bằng kỳ đang xem và kết thúc ngay trước nó; dùng để so tăng / giảm. Kỳ là đoạn đóng
 * `[from, to]` tính tới giây (vd thứ Hai 00:00:00 tới Chủ nhật 23:59:59), nên kỳ trước kết thúc trước `from` một giây.
 */
export function previousWindow(from: Date, to: Date): { from: Date; to: Date } {
  const length = to.getTime() - from.getTime();
  const previousTo = new Date(from.getTime() - 1000);
  return { from: new Date(previousTo.getTime() - length), to: previousTo };
}
