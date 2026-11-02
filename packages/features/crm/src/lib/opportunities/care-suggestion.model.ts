import type { CreateActivityRequest, OpportunityDetail } from '@enterprise-platform/contracts-crm';

/** Số ngày mặc định từ lúc Thua đến lịch chăm sóc lại (P2F-01). */
export const CARE_FOLLOW_UP_DAYS = 30;
/** Giờ hẹn mặc định của hoạt động chăm sóc (giờ địa phương). */
export const CARE_DUE_HOUR = 9;

/** Có hiện gợi ý chăm sóc lại sau khi lưu đổi giai đoạn không (server đã tính theo luồng và cờ). */
export function shouldOfferCareFollowUp(saved: Pick<OpportunityDetail, 'careSuggestion'>): boolean {
  return saved.careSuggestion?.enabled === true;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Ngày mặc định `YYYY-MM-DD` (giờ địa phương) cách `now` đúng `days` ngày. */
export function defaultCareDate(now: Date = new Date(), days: number = CARE_FOLLOW_UP_DAYS): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function defaultCareSubject(opportunityName: string): string {
  return `Chăm sóc lại khách sau dự án "${opportunityName}"`.slice(0, 300);
}

export function defaultCareDescription(): string {
  return 'Dự án đã Thua. Liên hệ hỏi thăm khách, tìm hiểu nhu cầu mới và khả năng hợp tác lần sau.';
}

/**
 * Yêu cầu tạo hoạt động chăm sóc: gắn cơ hội (server tự lấy đúng khách của cơ hội), giao cho `assigneeUserId`,
 * hạn vào `CARE_DUE_HOUR` giờ của `date`. Hạn là mốc nhắc của hoạt động.
 */
export function buildCareActivityRequest(input: {
  readonly opportunityId: string;
  readonly subject: string;
  readonly description: string;
  readonly assigneeUserId: string;
  readonly date: string;
}): CreateActivityRequest | { readonly error: string } {
  const subject = input.subject.trim();
  if (!subject) return { error: 'Vui lòng nhập nội dung chăm sóc.' };
  if (!input.assigneeUserId) return { error: 'Vui lòng chọn người phụ trách chăm sóc.' };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date);
  if (!match) return { error: 'Vui lòng chọn ngày chăm sóc.' };
  const due = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), CARE_DUE_HOUR, 0, 0);
  if (Number.isNaN(due.getTime())) return { error: 'Ngày chăm sóc không hợp lệ.' };
  return {
    type: 'CALL',
    subject,
    description: input.description.trim() || null,
    opportunityId: input.opportunityId,
    assigneeUserId: input.assigneeUserId,
    dueAt: due.toISOString(),
  };
}
