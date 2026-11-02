import type { TenderReminderStore } from './tender-reminder-store.port.js';

/**
 * Nhắc hạn nộp thầu (P2E-05): mỗi hồ sơ chưa nộp, chưa có kết quả được báo người phụ trách một lần khi còn
 * `TENDER_DEADLINE_REMINDER_HOURS` giờ tới hạn và một lần khi quá hạn (khoá theo hồ sơ + hạn + mốc). Worker gọi
 * cùng nhịp với các việc định kỳ khác của Bán hàng; mỗi lượt tối đa `limit` hồ sơ cho mỗi mốc, lượt sau làm tiếp.
 */
export async function notifyTenderDeadlines(
  store: Pick<TenderReminderStore, 'notifyDeadlines'>,
  tenantId: string,
  now: Date,
  limit: number,
): Promise<number> {
  let total = 0;
  for (let round = 0; round < 5; round += 1) {
    const sent = await store.notifyDeadlines(tenantId, now, limit);
    total += sent;
    if (sent < limit) break;
  }
  return total;
}
