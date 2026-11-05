import type {
  TenderPartner,
  TenderPlanRound,
  TenderPlanStatus,
  TenderRequiredField,
  TenderResult,
  TenderSubmissionMethod,
} from '@enterprise-platform/contracts-crm';
import type { TenderProfileFields, TenderProfilePatch } from '../domain/tender.js';
import type { StageChangeTransaction } from './sales-store.port.js';

/** Token DI của `TenderStore`. */
export const CRM_TENDER_STORE = Symbol('CRM_TENDER_STORE');

/** Hồ sơ thầu như lưu trong DB (thời điểm là chuỗi ISO), kèm đối tác và các vòng duyệt. */
export interface TenderProfileRecord {
  readonly id: string;
  readonly opportunityId: string;
  readonly packageName: string;
  readonly inviterName: string;
  readonly packageCode: string | null;
  readonly submissionDeadline: string | null;
  readonly submissionMethod: TenderSubmissionMethod | null;
  readonly submitterUserId: string | null;
  readonly submittedAt: string | null;
  readonly hasJointVenture: boolean;
  readonly scenario: string | null;
  readonly planStatus: TenderPlanStatus;
  readonly planRoundNo: number;
  readonly planSubmittedAt: string | null;
  readonly planSubmittedBy: string | null;
  readonly planDecidedAt: string | null;
  readonly planDecidedBy: string | null;
  readonly planDecisionReason: string | null;
  readonly result: TenderResult | null;
  readonly winningPrice: number | null;
  readonly winnerName: string | null;
  readonly lostReason: string | null;
  readonly resultRecordedAt: string | null;
  readonly resultRecordedBy: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly partners: readonly TenderPartner[];
  readonly rounds: readonly TenderPlanRound[];
}

/** Liên kết Quy trình của vòng duyệt đang chờ (nếu duyệt qua Quy trình). */
export interface TenderRoundLink {
  readonly status: string;
  readonly instanceId: string | null;
}

export interface SubmitTenderPlanInput {
  readonly profileId: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  /** Có thì duyệt qua Quy trình: tạo liên kết cho vòng mới. */
  readonly procedure: { readonly definitionId: string; readonly title: string } | null;
  readonly recipientUserIds: readonly string[];
}

export interface DecideTenderPlanInput {
  readonly profileId: string;
  readonly expectedVersion: number;
  readonly decision: 'APPROVED' | 'REJECTED';
  readonly reason: string | null;
  readonly actorId: string;
}

export interface WriteTenderResultInput {
  readonly profileId: string;
  readonly expectedVersion: number;
  readonly result: TenderResult;
  readonly winningPrice: number | null;
  readonly winnerName: string | null;
  readonly lostReason: string | null;
  readonly actorId: string;
}

export interface TenderStore {
  findByOpportunity(tenantId: string, opportunityId: string): Promise<TenderProfileRecord | undefined>;
  /** Tạo hồ sơ; cơ hội đã có hồ sơ thì 409 `TENDER_PROFILE_EXISTS`. Trả id. */
  create(tenantId: string, opportunityId: string, fields: TenderProfileFields, actorId: string): Promise<string>;
  /**
   * Sửa hồ sơ khi `version` khớp (không thì 409 `STALE_VERSION`). `resetApproval` đưa phương án về Đang soạn
   * (đã duyệt rồi mà sửa kịch bản, liên danh).
   */
  update(
    tenantId: string,
    profileId: string,
    expectedVersion: number,
    patch: TenderProfilePatch,
    actorId: string,
    resetApproval: boolean,
  ): Promise<void>;
  addPartner(
    tenantId: string,
    profileId: string,
    expectedVersion: number,
    partner: { readonly name: string; readonly scope: string | null },
    actorId: string,
    resetApproval: boolean,
  ): Promise<void>;
  updatePartner(
    tenantId: string,
    profileId: string,
    partnerId: string,
    expectedVersion: number,
    partner: { readonly name: string; readonly scope: string | null },
    actorId: string,
    resetApproval: boolean,
  ): Promise<void>;
  removePartner(
    tenantId: string,
    profileId: string,
    partnerId: string,
    expectedVersion: number,
    actorId: string,
    resetApproval: boolean,
  ): Promise<void>;
  /** Trình duyệt phương án: tạo vòng mới, phương án sang Chờ duyệt. Trả id liên kết Quy trình (nếu có) để khởi tạo phiên sau commit. */
  submitPlan(tenantId: string, input: SubmitTenderPlanInput): Promise<{ linkId: string | null }>;
  /** Quyết định vòng đang chờ (duyệt hoặc trả về sửa); giữ lịch sử vòng. */
  decidePlan(tenantId: string, input: DecideTenderPlanInput): Promise<void>;
  /** Liên kết Quy trình của vòng hiện tại. */
  currentRoundLink(tenantId: string, profileId: string): Promise<TenderRoundLink | undefined>;
  /**
   * Ghi kết quả vào hồ sơ trong transaction đang mở của lần đổi giai đoạn (`ChangeStageOptions.inTransaction`);
   * `version` không khớp thì 409 và cả lần đổi giai đoạn rollback. Đồng thời đặt giá trị dự kiến của cơ hội
   * thành giá trúng khi Trúng.
   */
  writeResult(client: StageChangeTransaction, tenantId: string, input: WriteTenderResultInput): Promise<void>;
  /** Trạng thái dùng cho điều kiện chuyển giai đoạn; `null` khi cơ hội chưa có hồ sơ thầu. */
  requirementState(
    tenantId: string,
    opportunityId: string,
  ): Promise<{ readonly planApproved: boolean; readonly fields: Readonly<Partial<Record<TenderRequiredField, unknown>>> } | null>;
}
