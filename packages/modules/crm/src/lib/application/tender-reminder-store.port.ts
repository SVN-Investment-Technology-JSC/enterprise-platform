/** Token DI của `TenderReminderStore`. */
export const CRM_TENDER_REMINDER_STORE = Symbol('CRM_TENDER_REMINDER_STORE');

/** Phần của kho dữ liệu dành cho job nhắc hạn nộp thầu. */
export interface TenderReminderStore {
  /**
   * Ghi sự kiện nhắc (sắp đến hạn, quá hạn) vào outbox và đánh dấu hạn đã nhắc, cùng một transaction. Trả số sự kiện
   * đã ghi (cả hai mốc), tối đa `limit` cho mỗi mốc.
   */
  notifyDeadlines(tenantId: string, now: Date, limit: number): Promise<number>;
}
