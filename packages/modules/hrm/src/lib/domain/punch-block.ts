/** Giới hạn chặn chấm công trong giờ ca của danh mục ca; null = không chặn. */
export interface PunchBlockLimits {
  readonly lateInMinutes: number | null;
  readonly earlyOutMinutes: number | null;
}

const hhmm = (ms: number, timezone: string) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);

/**
 * Lý do từ chối một lượt chấm công nằm trong giờ ca, hoặc null nếu được phép.
 *  - Chấm VÀO muộn hơn giờ bắt đầu quá `lateInMinutes` phút thì bị chặn: ca 7:30 chặn 30 phút thì 8:00 còn chấm được
 *    (tính trễ 30 phút), 8:01 trở đi không chấm được.
 *  - Chấm RA sớm hơn giờ kết thúc quá `earlyOutMinutes` phút thì bị chặn.
 * Chấm vào sớm bao nhiêu cũng được; chấm ra sau ca do khung `checkOutAfterMinutes` của ca quyết định.
 */
export function punchBlockReason(
  kind: 'IN' | 'OUT',
  atMs: number,
  window: { readonly start: string; readonly end: string },
  limits: PunchBlockLimits,
  timezone: string,
): string | null {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (kind === 'IN' && limits.lateInMinutes !== null) {
    const latest = start + limits.lateInMinutes * 60000;
    if (atMs > latest)
      return `Đã quá giờ được chấm vào của ca (muộn nhất ${hhmm(latest, timezone)}, tức ${limits.lateInMinutes} phút sau giờ bắt đầu ca). Liên hệ quản lý để được xử lý công.`;
  }
  if (kind === 'OUT' && limits.earlyOutMinutes !== null) {
    const earliest = end - limits.earlyOutMinutes * 60000;
    if (atMs < earliest)
      return `Chưa đến giờ được chấm ra của ca (sớm nhất ${hhmm(earliest, timezone)}, tức ${limits.earlyOutMinutes} phút trước giờ kết thúc ca).`;
  }
  return null;
}
