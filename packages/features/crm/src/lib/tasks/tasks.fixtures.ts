import type { CrmTask, CrmTaskList } from '@enterprise-platform/contracts-crm';

/** Dữ liệu mẫu cho spec của trang Việc cần xử lý và các khối liên quan. */
export function fixtureTask(patch: Partial<CrmTask> = {}): CrmTask {
  return {
    kind: 'QUOTE_APPROVAL',
    quoteId: 'q1',
    quoteCode: 'BG2600001',
    quoteName: 'Báo giá bơm',
    versionNo: 2,
    customerId: 'c1',
    customerName: 'Công ty A',
    ownerUserId: 'u1',
    ownerName: 'Nguyễn Văn An',
    actorUserId: 'u1',
    actorName: 'Nguyễn Văn An',
    at: '2026-11-09T03:05:00.000Z',
    totalAmount: 125000000,
    marginPercent: 8.5,
    reasons: ['Biên lợi nhuận dưới ngưỡng'],
    approval: { subject: 'QUOTE', mode: 'PROCEDURE', procedureInstanceId: 'inst-1', procedureInstanceCode: 'HS-0007' },
    ...patch,
  };
}

export function fixtureTaskList(patch: Partial<CrmTaskList> = {}): CrmTaskList {
  return { awaitingMe: [], mine: [], ...patch };
}
