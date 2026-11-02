/**
 * Chào thầu (GĐ E): hồ sơ thầu 1-1 với cơ hội của luồng có profile `TENDER`, danh sách đối tác liên danh, duyệt
 * phương án chào thầu (loại duyệt `TENDER_PLAN`) và kết quả thầu. Tiền là VND, làm tròn đến đồng.
 */
import type { ContractType } from './contracts.js';

/** Mã luồng mẫu "Chào thầu" nạp ở migration 0024. */
export const TENDER_PIPELINE_CODE = 'TENDER_STANDARD';

/** Mã giai đoạn của luồng mẫu "Chào thầu"; Trúng và Trượt mang nghĩa WON và LOST. */
export const TENDER_STAGE_CODES = {
  COLLECT: 'HSMT',
  PREPARE: 'PREPARE',
  PLAN_REVIEW: 'PLAN_REVIEW',
  SUBMITTED: 'SUBMITTED',
  WON: 'WON',
  LOST: 'LOST',
} as const;

export const TENDER_SUBMISSION_METHODS = ['ONLINE', 'IN_PERSON', 'POST'] as const;
export type TenderSubmissionMethod = (typeof TENDER_SUBMISSION_METHODS)[number];

export const TENDER_SUBMISSION_METHOD_LABELS: Readonly<Record<TenderSubmissionMethod, string>> = {
  ONLINE: 'Nộp qua mạng',
  IN_PERSON: 'Nộp trực tiếp',
  POST: 'Gửi bưu điện',
};

export const TENDER_PLAN_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type TenderPlanStatus = (typeof TENDER_PLAN_STATUSES)[number];

export const TENDER_PLAN_STATUS_LABELS: Readonly<Record<TenderPlanStatus, string>> = {
  DRAFT: 'Đang soạn',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Trả về sửa',
};

export const TENDER_RESULTS = ['WON', 'LOST'] as const;
export type TenderResult = (typeof TENDER_RESULTS)[number];

export const TENDER_RESULT_LABELS: Readonly<Record<TenderResult, string>> = { WON: 'Trúng thầu', LOST: 'Trượt thầu' };

/**
 * Trường hồ sơ thầu dùng được trong điều kiện chuyển giai đoạn `TENDER_FIELD` (`ref` là tên trường), kèm nhãn
 * tiếng Việt. `winningPrice` chỉ có sau khi ghi kết quả.
 */
export const TENDER_REQUIRED_FIELDS = {
  packageName: 'Tên gói thầu',
  inviterName: 'Bên mời thầu',
  packageCode: 'Mã gói thầu',
  submissionDeadline: 'Hạn nộp',
  submissionMethod: 'Hình thức nộp',
  submitterUserId: 'Người nộp',
  scenario: 'Kịch bản chọn',
  winningPrice: 'Giá trúng thầu',
} as const;
export type TenderRequiredField = keyof typeof TENDER_REQUIRED_FIELDS;

/** Sự kiện outbox của duyệt phương án chào thầu (skill `erp-events`); `aggregateType` `crm-tender`. */
export const CRM_TENDER_PLAN_APPROVAL_REQUESTED = 'crm.tender-plan.approval-requested';
export const CRM_TENDER_PLAN_APPROVAL_DECIDED = 'crm.tender-plan.approval-decided';

export interface CrmTenderPlanApprovalRequestedPayload {
  readonly opportunityId: string;
  readonly profileId: string;
  readonly packageName: string;
  readonly roundNo: number;
  readonly hasJointVenture: boolean;
  readonly requesterUserId: string;
  readonly actorUserId: string;
  /** Cấp trên của người trình khi duyệt trực tiếp; rỗng khi Quy trình tự giao bước. */
  readonly recipientUserIds: readonly string[];
  readonly mode: 'DIRECT' | 'PROCEDURE';
  readonly summary: string;
  readonly deepLink: string;
}

export interface CrmTenderPlanApprovalDecidedPayload {
  readonly opportunityId: string;
  readonly profileId: string;
  readonly packageName: string;
  readonly roundNo: number;
  readonly status: 'APPROVED' | 'REJECTED';
  readonly reason: string | null;
  readonly actorUserId: string | null;
  readonly recipientUserIds: readonly string[];
  readonly summary: string;
  readonly deepLink: string;
}

/** Đường dẫn mở cơ hội thầu trên giao diện (thông báo). */
export function tenderDeepLink(opportunityId: string): string {
  return `/modules/crm#opportunities/${encodeURIComponent(opportunityId)}`;
}

export interface TenderPartner {
  readonly id: string;
  readonly name: string;
  /** Phạm vi đảm nhận của đối tác trong liên danh. */
  readonly scope: string | null;
}

/** Một vòng duyệt phương án chào thầu; lịch sử các vòng được giữ. */
export interface TenderPlanRound {
  readonly id: string;
  readonly roundNo: number;
  readonly via: 'DIRECT' | 'PROCEDURE';
  readonly hasJointVenture: boolean;
  readonly scenario: string | null;
  readonly partnerCount: number;
  readonly submittedAt: string;
  readonly submittedBy: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly decision: 'APPROVED' | 'REJECTED' | null;
  readonly reason: string | null;
  /** Mã hồ sơ Quy trình khi duyệt qua Quy trình. */
  readonly procedureInstanceCode: string | null;
}

/** Gợi ý điền sẵn khi lập hợp đồng từ cơ hội thầu đã trúng (gửi tiếp `POST /v1/contracts`). */
export interface TenderContractDraft {
  readonly type: ContractType;
  readonly customerId: string;
  readonly title: string;
  /** Giá trúng thầu. */
  readonly value: number;
  /** Hôm nay (giờ Việt Nam); người dùng chỉnh theo ngày hiệu lực thật. */
  readonly validFrom: string;
  readonly ownerUserId: string;
}

export interface TenderProfile {
  readonly id: string;
  readonly opportunityId: string;
  readonly packageName: string;
  /** Bên mời thầu. */
  readonly inviterName: string;
  readonly packageCode: string | null;
  readonly submissionDeadline: string | null;
  readonly submissionMethod: TenderSubmissionMethod | null;
  readonly submitterUserId: string | null;
  readonly submittedAt: string | null;
  readonly hasJointVenture: boolean;
  /** Kịch bản chọn: nội dung phương án chào thầu đưa đi duyệt. */
  readonly scenario: string | null;
  readonly plan: {
    readonly status: TenderPlanStatus;
    readonly roundNo: number;
    readonly submittedAt: string | null;
    readonly submittedBy: string | null;
    readonly decidedAt: string | null;
    readonly decidedBy: string | null;
    readonly decisionReason: string | null;
    readonly via: 'DIRECT' | 'PROCEDURE' | null;
    readonly procedureInstanceCode: string | null;
  };
  readonly result: TenderResult | null;
  readonly winningPrice: number | null;
  /** Đơn vị trúng thầu. */
  readonly winnerName: string | null;
  readonly lostReason: string | null;
  readonly resultRecordedAt: string | null;
  readonly resultRecordedBy: string | null;
  readonly partners: readonly TenderPartner[];
  readonly rounds: readonly TenderPlanRound[];
  /** Có khi đã trúng thầu. */
  readonly contractDraft: TenderContractDraft | null;
  /** `false` khi cơ hội đã đóng (Trúng hoặc Trượt). */
  readonly editable: boolean;
  /** `true` khi phương án đang chờ duyệt: khoá sửa kịch bản, liên danh và đối tác. */
  readonly planLocked: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTenderProfileRequest {
  readonly packageName: string;
  readonly inviterName: string;
  readonly packageCode?: string | null;
  /** ISO 8601; không được ở quá khứ. */
  readonly submissionDeadline?: string | null;
  readonly submissionMethod?: TenderSubmissionMethod | null;
  readonly submitterUserId?: string | null;
  readonly hasJointVenture?: boolean;
  readonly scenario?: string | null;
}

/** Không gửi (`undefined`) thì giữ nguyên; `null` xoá giá trị (trừ trường bắt buộc). */
export interface UpdateTenderProfileRequest extends Partial<CreateTenderProfileRequest> {
  readonly version: number;
  readonly submittedAt?: string | null;
}

export interface TenderVersionRequest {
  readonly version: number;
}

export interface TenderDecisionRequest extends TenderVersionRequest {
  /** Bắt buộc khi từ chối. */
  readonly reason?: string | null;
}

export interface SaveTenderPartnerRequest {
  readonly name: string;
  readonly scope?: string | null;
}

/** Ghi kết quả thầu. Trúng bắt buộc `winningPrice`; Trượt bắt buộc `reason` (lý do trượt). */
export interface RecordTenderResultRequest extends TenderVersionRequest {
  readonly result: TenderResult;
  readonly winningPrice?: number | null;
  readonly winnerName?: string | null;
  readonly reason?: string | null;
}

/**
 * Nhắc hạn nộp thầu (P2E-05): job định kỳ của Bán hàng (skill `erp-events`) báo người phụ trách một lần cho mỗi mốc
 * của mỗi hạn nộp: sắp đến hạn (trong `TENDER_DEADLINE_REMINDER_HOURS` giờ tới) và quá hạn. Hồ sơ đã nộp, đã có kết
 * quả hoặc cơ hội đã đóng thì không nhắc; dời hạn thì nhắc lại theo hạn mới. `aggregateType` `crm-tender`.
 */
export const CRM_TENDER_DEADLINE_DUE_SOON = 'crm.tender.deadline-due-soon';
export const CRM_TENDER_DEADLINE_OVERDUE = 'crm.tender.deadline-overdue';

/** Nhắc trước hạn nộp bao nhiêu giờ. */
export const TENDER_DEADLINE_REMINDER_HOURS = 24;

export interface CrmTenderDeadlinePayload {
  readonly opportunityId: string;
  readonly profileId: string;
  readonly packageName: string;
  readonly inviterName: string;
  /** Hạn nộp (ISO UTC). */
  readonly submissionDeadline: string;
  readonly milestone: 'DUE_SOON' | 'OVERDUE';
  readonly ownerUserId: string;
  readonly submitterUserId: string | null;
  readonly actorUserId: null;
  /** Chủ dự án và người nộp (nếu có), không trùng. */
  readonly recipientUserIds: readonly string[];
  readonly summary: string;
  readonly deepLink: string;
}
