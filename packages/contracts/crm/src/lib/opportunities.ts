/**
 * Lead, cơ hội, hoạt động và dòng thời gian khách hàng (GĐ2).
 */

/** Mã luồng mặc định nạp sẵn ở migration 0017. */
export const DEFAULT_PIPELINE_CODE = 'SALES_STANDARD';

/** Nghĩa của giai đoạn: báo cáo và dashboard gom theo nghĩa, không theo mã. */
export const STAGE_SEMANTICS = ['OPEN', 'WON', 'LOST'] as const;
export type StageSemantic = (typeof STAGE_SEMANTICS)[number];

export const STAGE_SEMANTIC_LABELS: Readonly<Record<StageSemantic, string>> = {
  OPEN: 'Đang chạy',
  WON: 'Thắng',
  LOST: 'Thua',
};

export const PIPELINE_PROFILES = ['STANDARD', 'TENDER'] as const;
export type PipelineProfile = (typeof PIPELINE_PROFILES)[number];

/**
 * Loại điều kiện chuyển VÀO một giai đoạn:
 * - `FIELD`: `ref` là tên trường cơ hội (`OPPORTUNITY_REQUIRED_FIELDS`), phải có giá trị;
 * - `QUOTE_APPROVED`: có báo giá Khách chấp nhận;
 * - `REASON`: phải ghi lý do;
 * - `DOCUMENT_TYPE`: `ref` là mã loại tài liệu (chỗ cắm cho GĐ C);
 * - `TENDER_PLAN_APPROVED`: hồ sơ thầu của cơ hội có phương án chào thầu đã duyệt (GĐ E);
 * - `TENDER_FIELD`: `ref` là tên trường hồ sơ thầu (`TENDER_REQUIRED_FIELDS`), phải có giá trị (GĐ E).
 */
export const STAGE_REQUIREMENT_KINDS = [
  'FIELD',
  'QUOTE_APPROVED',
  'REASON',
  'DOCUMENT_TYPE',
  'TENDER_PLAN_APPROVED',
  'TENDER_FIELD',
] as const;
export type StageRequirementKind = (typeof STAGE_REQUIREMENT_KINDS)[number];

/** Trường cơ hội dùng được trong điều kiện `FIELD`, kèm nhãn tiếng Việt. */
export const OPPORTUNITY_REQUIRED_FIELDS = {
  need: 'Nhu cầu',
  budget: 'Ngân sách',
  expectedValue: 'Giá trị dự kiến',
  expectedCloseDate: 'Ngày chốt dự kiến',
} as const;
export type OpportunityRequiredField = keyof typeof OPPORTUNITY_REQUIRED_FIELDS;

export interface StageRequirement {
  readonly kind: StageRequirementKind;
  /** Tên trường (FIELD), mã loại tài liệu (DOCUMENT_TYPE); chuỗi rỗng với loại khác. */
  readonly ref: string;
  /** `false`: không chặn, chỉ vào danh sách "cần có" (gợi ý). */
  readonly required: boolean;
  /** Thông báo tiếng Việt khi thiếu. */
  readonly message: string;
  readonly sortOrder: number;
}

/**
 * Quy tắc gán người đảm nhận mặc định của giai đoạn: `FIXED_USER` (param = id người dùng),
 * `PROJECT_OWNER`, `DIRECT_MANAGER`, `MANAGER_LEVEL` (param = số bậc cấp trên), `POSITION`
 * (param = id chức danh trong sơ đồ tổ chức; người đang giữ chức danh được gán).
 */
export const STAGE_ASSIGNEE_RULES = [
  'NONE',
  'FIXED_USER',
  'PROJECT_OWNER',
  'DIRECT_MANAGER',
  'MANAGER_LEVEL',
  'POSITION',
] as const;
export type StageAssigneeRule = (typeof STAGE_ASSIGNEE_RULES)[number];

export interface PipelineStage {
  readonly id: string;
  readonly pipelineId: string;
  /** Mã giai đoạn, duy nhất trong luồng; là giá trị của `OpportunitySummary.stage`. */
  readonly code: string;
  readonly name: string;
  readonly semantic: StageSemantic;
  readonly sortOrder: number;
  readonly defaultProbability: number;
  /** `false` là đã tắt: cơ hội đang ở đó vẫn xem và chuyển đi được, không chuyển mới vào. */
  readonly active: boolean;
  readonly skippable: boolean;
  readonly assigneeRule: StageAssigneeRule;
  readonly assigneeParam: string | null;
  /** Id các giai đoạn đích được phép chuyển tới từ giai đoạn này (cùng luồng). */
  readonly nextStageIds: readonly string[];
  /** Điều kiện chuyển vào giai đoạn này. */
  readonly requirements: readonly StageRequirement[];
}

export interface Pipeline {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly profile: PipelineProfile;
  readonly isDefault: boolean;
  readonly active: boolean;
  readonly sortOrder: number;
  /** Gợi ý tạo lịch chăm sóc lại khi cơ hội Thua (P2F-02). Luồng `TENDER` không bao giờ gợi ý. */
  readonly careSuggestion: boolean;
  /** Theo `sortOrder`, gồm cả giai đoạn đã tắt. */
  readonly stages: readonly PipelineStage[];
}

/** Bật hoặc tắt gợi ý chăm sóc lại của một luồng. */
export interface UpdatePipelineCareSuggestionRequest {
  readonly careSuggestion: boolean;
}

/** Kết quả đánh giá gợi ý chăm sóc lại sau khi cơ hội chuyển sang Thua. */
export interface CareSuggestion {
  readonly enabled: boolean;
}

/** Tham chiếu gọn tới luồng, nhúng vào cơ hội. */
export interface PipelineRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** Tham chiếu gọn tới giai đoạn (có nhãn và nghĩa), nhúng vào cơ hội. */
export interface StageRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly semantic: StageSemantic;
}

/** Kết quả kiểm một điều kiện chuyển giai đoạn với một cơ hội cụ thể. */
export interface StageRequirementCheck {
  readonly kind: StageRequirementKind;
  readonly ref: string;
  readonly required: boolean;
  readonly message: string;
  /** `true` đã đạt; `null` chưa kiểm được (ví dụ DOCUMENT_TYPE khi chưa có kho tài liệu). */
  readonly met: boolean | null;
}

/** Sự kiện outbox khi cơ hội đổi giai đoạn (`aggregateType` `crm-opportunity`). */
export const CRM_OPPORTUNITY_STAGE_CHANGED = 'crm.opportunity.stage-changed';

/**
 * Payload sự kiện đổi giai đoạn. `fromStage`, `stage` là MÃ giai đoạn (như
 * trường `stage` của cơ hội); `semantic`, `pipelineId`, `stageId`... là trường
 * thêm ở GĐ B, trường cũ không đổi tên hay đổi nghĩa.
 */
export interface CrmOpportunityStageChangedPayload {
  readonly opportunityId: string;
  readonly customerId: string;
  readonly name: string;
  readonly ownerUserId: string;
  readonly fromStage: string;
  readonly stage: string;
  readonly reason: string | null;
  readonly actorUserId: string | null;
  readonly semantic: StageSemantic;
  readonly pipelineId: string;
  readonly stageId: string;
  readonly fromStageId: string;
  readonly fromSemantic: StageSemantic;
}

/** Sự kiện outbox khi người đảm nhận một giai đoạn của dự án được gán hoặc đổi (`aggregateType` `crm-opportunity`). */
export const CRM_OPPORTUNITY_STAGE_ASSIGNED = 'crm.opportunity.stage-assigned';

/**
 * Payload sự kiện gán người đảm nhận giai đoạn. `recipientUserIds` là người cũ (nếu có) và người
 * mới, trừ người thực hiện; `assigneeUserId` rỗng khi bỏ gán. `cause`: `CREATED` (kế hoạch lúc tạo
 * dự án), `OVERRIDE` (sửa tay theo dự án).
 */
export interface CrmOpportunityStageAssignedPayload {
  readonly opportunityId: string;
  readonly name: string;
  readonly stageId: string;
  readonly stageCode: string;
  readonly stageName: string;
  readonly assigneeUserId: string | null;
  readonly previousAssigneeUserId: string | null;
  readonly actorUserId: string | null;
  readonly cause: 'CREATED' | 'OVERRIDE';
  readonly recipientUserIds: readonly string[];
  readonly summary: string;
  readonly deepLink: string;
}

/**
 * LƯU Ý (GĐ B): các hằng `OPPORTUNITY_STAGES`, `OPEN_OPPORTUNITY_STAGES`,
 * `OPPORTUNITY_STAGE_LABELS`, `OPPORTUNITY_STAGE_TRANSITIONS` dưới đây chỉ là
 * dữ liệu mẫu của luồng mặc định "Bán hàng thông thường" (khớp migration
 * 0017) và để code phase 1 còn dùng tạm. Server KHÔNG dùng chúng để kiểm logic:
 * giai đoạn, nghĩa và bước chuyển đọc từ cấu hình luồng (`Pipeline`).
 */
export const OPPORTUNITY_STAGES = [
  'NEW',
  'CONTACTED',
  'DISCOVERY',
  'QUOTING',
  'NEGOTIATION',
  'WON',
  'LOST',
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

/** Giai đoạn còn mở, theo thứ tự tiến. */
export const OPEN_OPPORTUNITY_STAGES: readonly OpportunityStage[] = [
  'NEW',
  'CONTACTED',
  'DISCOVERY',
  'QUOTING',
  'NEGOTIATION',
];

export const OPPORTUNITY_STAGE_LABELS: Readonly<Record<OpportunityStage, string>> = {
  NEW: 'Mới',
  CONTACTED: 'Đã liên hệ',
  DISCOVERY: 'Khảo sát nhu cầu',
  QUOTING: 'Báo giá',
  NEGOTIATION: 'Đàm phán',
  WON: 'Thắng',
  LOST: 'Thua',
};

/**
 * Bảng chuyển giai đoạn (mục 5.1 kế hoạch): giai đoạn mở tiến hoặc lùi một
 * bước, Đàm phán sang Thắng, mọi giai đoạn mở sang Thua; Thắng, Thua là cuối.
 * Server kiểm bằng chính bảng này; giao diện dùng để biết cột nào thả được.
 */
export const OPPORTUNITY_STAGE_TRANSITIONS: Readonly<Record<OpportunityStage, readonly OpportunityStage[]>> = {
  NEW: ['CONTACTED', 'LOST'],
  CONTACTED: ['NEW', 'DISCOVERY', 'LOST'],
  DISCOVERY: ['CONTACTED', 'QUOTING', 'LOST'],
  QUOTING: ['DISCOVERY', 'NEGOTIATION', 'LOST'],
  NEGOTIATION: ['QUOTING', 'WON', 'LOST'],
  WON: [],
  LOST: [],
};

export interface OpportunitySummary {
  readonly id: string;
  readonly name: string;
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  /** Mã giai đoạn (tương thích phase 1); nhãn và nghĩa ở `stageInfo`. */
  readonly stage: string;
  readonly pipeline: PipelineRef;
  readonly stageInfo: StageRef;
  readonly probability: number;
  readonly expectedValue: number | null;
  readonly expectedCloseDate: string | null;
  readonly ownerUserId: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface OpportunityStageHistoryEntry {
  readonly id: string;
  readonly fromStage: string | null;
  readonly toStage: string;
  /** Id và tên giai đoạn lúc chuyển; `null` với lịch sử cũ không còn khớp luồng. */
  readonly fromStageId: string | null;
  readonly toStageId: string | null;
  readonly fromStageName: string | null;
  readonly toStageName: string | null;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly at: string;
  /** `CHANGE` chuyển giai đoạn; `SKIP` bỏ qua giai đoạn (`toStage` là giai đoạn bỏ qua, `fromStage` rỗng). */
  readonly kind: 'CHANGE' | 'SKIP';
}

export const STAGE_PLAN_STATUSES = ['PENDING', 'ACTIVE', 'DONE', 'SKIPPED'] as const;
export type StagePlanStatus = (typeof STAGE_PLAN_STATUSES)[number];

/** Một dòng kế hoạch giai đoạn của dự án. */
export interface OpportunityStagePlanItem {
  readonly stage: StageRef;
  readonly sortOrder: number;
  readonly status: StagePlanStatus;
  readonly skippable: boolean;
  readonly assigneeUserId: string | null;
  /** Vì sao chưa có người (quy tắc không tìm được người, Tenant Core lỗi...); rỗng khi đã gán hoặc không cần. */
  readonly assigneeWarning: string | null;
  readonly assignedBy: string | null;
  readonly assignedAt: string | null;
  readonly dueDate: string | null;
  readonly skippedReason: string | null;
  readonly skippedBy: string | null;
  readonly skippedAt: string | null;
}

export interface OpportunityStagePlan {
  readonly opportunityId: string;
  readonly items: readonly OpportunityStagePlanItem[];
}

/** Gán hoặc ghi đè người đảm nhận một giai đoạn của riêng dự án; `null` là bỏ gán. */
export interface UpdateStageAssigneeRequest {
  readonly assigneeUserId: string | null;
  readonly dueDate?: string | null;
}

/** Bỏ qua một giai đoạn (cần lý do). */
export interface SkipStageRequest {
  readonly reason: string;
}

/** Giai đoạn bỏ qua ngay lúc tạo dự án. */
export interface CreateOpportunitySkippedStage {
  /** Mã giai đoạn trong luồng được chọn. */
  readonly stage: string;
  readonly reason: string;
}

/** Một việc "Việc của tôi": giai đoạn của dự án giao cho người gọi (ACTIVE hoặc PENDING). */
export interface MyStageTask {
  readonly opportunityId: string;
  readonly opportunityName: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly stage: StageRef;
  readonly status: 'PENDING' | 'ACTIVE';
  readonly dueDate: string | null;
  readonly ownerUserId: string;
  readonly updatedAt: string;
}

/**
 * PAKD mới nhất của dự án (P2D-09): của báo giá mới nhất, phiên bản đã duyệt gần nhất, không có thì phiên bản
 * mới nhất có PAKD. Người không có quyền xem giá vốn chỉ nhận doanh thu (`goodsCost`, `totalCost`, `profit` là `null`).
 */
export interface OpportunityBusinessPlanSummary {
  readonly quoteId: string;
  readonly quoteCode: string;
  readonly versionNo: number;
  readonly status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  readonly revenue: number;
  readonly costVisible: boolean;
  readonly totalCost: number | null;
  readonly profit: number | null;
}

export interface OpportunityDetail extends OpportunitySummary {
  /** Chỉ có ở phản hồi `GET` một cơ hội; `null` là dự án chưa có PAKD. Nơi khác không có. */
  readonly latestBusinessPlan?: OpportunityBusinessPlanSummary | null;
  /** Chỉ có ở phản hồi đổi giai đoạn sang Thua (P2F-01); nơi khác không có. */
  readonly careSuggestion?: CareSuggestion;
  readonly need: string | null;
  readonly budget: number | null;
  /** Tổng giá trị dự toán (đồng); `null` là chưa nhập. Đối chiếu với PAKD ở giao diện. */
  readonly estimateTotalValue: number | null;
  /** Giá vốn dự kiến của dự toán (đồng); `null` là chưa nhập. */
  readonly estimateCostValue: number | null;
  /** Đối thủ cạnh tranh (P2F-03); `null` là chưa nhập. */
  readonly competitorName: string | null;
  /** Giá đối thủ chào (đồng, >= 0); `null` là chưa nhập. */
  readonly competitorPrice: number | null;
  readonly lostReason: string | null;
  readonly leadId: string | null;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly history: readonly OpportunityStageHistoryEntry[];
  /** Giai đoạn đích chuyển được ngay từ giai đoạn hiện tại (đã bỏ giai đoạn tắt), theo thứ tự luồng. */
  readonly nextStages: readonly StageRef[];
}

export interface OpportunityFields {
  readonly name: string;
  readonly probability?: number;
  readonly expectedValue?: number | null;
  readonly expectedCloseDate?: string | null;
  readonly need?: string | null;
  readonly budget?: number | null;
  /** Không gửi (`undefined`) thì giữ nguyên; `null` xoá giá trị. Phải >= 0. */
  readonly estimateTotalValue?: number | null;
  readonly estimateCostValue?: number | null;
  /** Không gửi thì giữ nguyên; `null` xoá. Tên tối đa 300 ký tự, giá phải >= 0. */
  readonly competitorName?: string | null;
  readonly competitorPrice?: number | null;
  readonly ownerUserId?: string | null;
}

export interface CreateOpportunityRequest extends OpportunityFields {
  readonly customerId: string;
  /** Rỗng thì dùng luồng mặc định; cơ hội vào giai đoạn đầu (đang bật, nghĩa OPEN) của luồng. */
  readonly pipelineId?: string | null;
  /** Giai đoạn bỏ qua ngay từ đầu (chỉ giai đoạn `skippable`, không phải giai đoạn đầu); mỗi mục cần lý do. */
  readonly skipStages?: readonly CreateOpportunitySkippedStage[];
}

export interface UpdateOpportunityRequest extends OpportunityFields {
  readonly version: number;
}

/** Chuyển giai đoạn. Thua bắt buộc `reason`. */
export interface ChangeOpportunityStageRequest {
  /** Mã giai đoạn đích trong luồng của cơ hội. */
  readonly stage: string;
  readonly reason?: string | null;
  /** Bản đang xem; khác bản trong DB thì 409. Không gửi thì không so. */
  readonly version?: number;
}

export interface OpportunityListQuery {
  readonly q?: string;
  /** Mã giai đoạn (kết hợp `pipelineId` khi nhiều luồng trùng mã). */
  readonly stage?: string;
  readonly pipelineId?: string;
  readonly ownerUserId?: string;
  readonly customerId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** Một cột kanban: các thẻ mới cập nhật nhất và tổng của cả cột. */
export interface OpportunityBoardColumn {
  readonly stage: string;
  readonly stageInfo: StageRef;
  readonly total: number;
  readonly totalValue: number;
  readonly items: readonly OpportunitySummary[];
}

export interface OpportunityBoard {
  readonly pipeline: PipelineRef;
  /** Cột theo thứ tự giai đoạn của luồng; giai đoạn tắt chỉ có cột khi còn cơ hội. */
  readonly columns: readonly OpportunityBoardColumn[];
  /** Số thẻ tối đa trả về mỗi cột. */
  readonly perStageLimit: number;
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

export const LEAD_STATUSES = ['NEW', 'WORKING', 'DISQUALIFIED', 'CONVERTED'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Readonly<Record<LeadStatus, string>> = {
  NEW: 'Mới',
  WORKING: 'Đang chăm sóc',
  DISQUALIFIED: 'Không tiềm năng',
  CONVERTED: 'Đã chuyển đổi',
};

export interface Lead {
  readonly id: string;
  readonly name: string;
  readonly contactName: string | null;
  readonly taxCode: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly source: string | null;
  readonly need: string | null;
  readonly note: string | null;
  readonly ownerUserId: string;
  readonly status: LeadStatus;
  readonly convertedCustomerId: string | null;
  readonly convertedOpportunityId: string | null;
  readonly convertedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LeadFields {
  readonly name: string;
  readonly contactName?: string | null;
  readonly taxCode?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly source?: string | null;
  readonly need?: string | null;
  readonly note?: string | null;
  readonly ownerUserId?: string | null;
}

export type CreateLeadRequest = LeadFields;

export interface UpdateLeadRequest extends LeadFields {
  /** Không cho đặt CONVERTED bằng sửa; chỉ qua thao tác chuyển đổi. */
  readonly status?: Exclude<LeadStatus, 'CONVERTED'>;
  readonly version: number;
}

export interface LeadListQuery {
  readonly q?: string;
  readonly status?: LeadStatus;
  readonly ownerUserId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ConvertLeadRequest {
  /** Tên cơ hội; rỗng thì lấy tên lead. */
  readonly opportunityName?: string | null;
  readonly expectedValue?: number | null;
  readonly expectedCloseDate?: string | null;
}

export interface ConvertLeadResult {
  readonly leadId: string;
  readonly customerId: string;
  readonly opportunityId: string;
  /** Lead khớp MST khách đã có nên gắn vào khách cũ, không tạo khách mới. */
  readonly attachedToExistingCustomer: boolean;
}

// ---------------------------------------------------------------------------
// Hoạt động
// ---------------------------------------------------------------------------

export const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'TASK'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABELS: Readonly<Record<ActivityType, string>> = {
  CALL: 'Gọi điện',
  EMAIL: 'Email',
  MEETING: 'Gặp mặt',
  TASK: 'Công việc',
};

export const ACTIVITY_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_STATUS_LABELS: Readonly<Record<ActivityStatus, string>> = {
  OPEN: 'Đang mở',
  DONE: 'Hoàn tất',
  CANCELLED: 'Đã huỷ',
};

export interface Activity {
  readonly id: string;
  readonly type: ActivityType;
  readonly subject: string;
  readonly description: string | null;
  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly opportunityId: string | null;
  readonly opportunityName: string | null;
  readonly assigneeUserId: string;
  readonly dueAt: string | null;
  readonly status: ActivityStatus;
  readonly result: string | null;
  readonly completedAt: string | null;
  readonly completedBy: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export interface CreateActivityRequest {
  readonly type: ActivityType;
  readonly subject: string;
  readonly description?: string | null;
  readonly customerId?: string | null;
  readonly opportunityId?: string | null;
  /** Rỗng thì là người tạo. */
  readonly assigneeUserId?: string | null;
  readonly dueAt?: string | null;
}

export interface UpdateActivityRequest {
  readonly version: number;
  readonly type?: ActivityType;
  readonly subject?: string;
  readonly description?: string | null;
  readonly assigneeUserId?: string;
  readonly dueAt?: string | null;
  readonly status?: ActivityStatus;
  readonly result?: string | null;
}

export interface ActivityListQuery {
  readonly customerId?: string;
  readonly opportunityId?: string;
  readonly assigneeUserId?: string;
  readonly status?: ActivityStatus;
  readonly cursor?: string;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Dòng thời gian khách hàng
// ---------------------------------------------------------------------------

/**
 * Loại mục trên dòng thời gian. Giai đoạn sau thêm báo giá, hợp đồng, đơn,
 * công nợ, bảo hành bằng cách thêm thành viên vào union này; giao diện hiện
 * mục lạ bằng nhãn chung nên không vỡ.
 */
export type CustomerTimelineEntry =
  | {
      readonly kind: 'opportunity-created';
      readonly id: string;
      readonly at: string;
      readonly actorId: string | null;
      readonly opportunityId: string;
      readonly opportunityName: string;
      readonly stage: string;
    }
  | {
      readonly kind: 'opportunity-stage-changed';
      readonly id: string;
      readonly at: string;
      readonly actorId: string | null;
      readonly opportunityId: string;
      readonly opportunityName: string;
      readonly fromStage: string;
      readonly toStage: string;
      readonly reason: string | null;
    }
  | {
      readonly kind: 'activity';
      readonly id: string;
      readonly at: string;
      readonly actorId: string | null;
      readonly activityId: string;
      readonly activityType: ActivityType;
      readonly subject: string;
      readonly status: ActivityStatus;
      readonly dueAt: string | null;
      readonly opportunityId: string | null;
    }
  | {
      /** Báo giá: lập, gửi duyệt, duyệt, gửi khách, khách trả lời, hết hạn, sinh phiên bản mới. */
      readonly kind: 'quote';
      readonly id: string;
      readonly at: string;
      readonly actorId: string | null;
      readonly quoteId: string;
      readonly quoteCode: string;
      readonly action: string;
      readonly fromStatus: string | null;
      readonly toStatus: string | null;
      readonly versionNo: number | null;
      readonly reason: string | null;
      readonly opportunityId: string | null;
    }
  | {
      /** Hợp đồng: lập, xác nhận, hết hạn, hoàn thành, thanh lý, huỷ. */
      readonly kind: 'contract';
      readonly id: string;
      readonly at: string;
      readonly actorId: string | null;
      readonly contractId: string;
      readonly contractCode: string;
      readonly action: string;
      readonly fromStatus: string | null;
      readonly toStatus: string | null;
      readonly reason: string | null;
    }
  | {
      /** Đơn bán: lập, xác nhận, giao hàng, huỷ, hoàn tất. */
      readonly kind: 'order';
      readonly id: string;
      readonly at: string;
      readonly actorId: string | null;
      readonly orderId: string;
      readonly orderCode: string;
      readonly action: string;
      readonly fromStatus: string | null;
      readonly toStatus: string | null;
      readonly reason: string | null;
    }
  | {
      /**
       * Công nợ: phát sinh nợ (giao hàng, đợt thanh toán), bút đảo; lần thu tiền
       * (ghi nhận, phiếu ghi sổ, bị trả lại, bị đảo); điều chỉnh (lập, duyệt, huỷ).
       */
      readonly kind: 'receivable';
      readonly id: string;
      readonly at: string;
      readonly actorId: string | null;
      /** `entry` (dòng sổ nợ), `receipt` (lần thu), `adjustment` (điều chỉnh). */
      readonly subject: 'entry' | 'receipt' | 'adjustment';
      /** Id dòng sổ, lần thu hoặc điều chỉnh. */
      readonly refId: string;
      /** Mã đơn (dòng sổ), mã lần thu, mã điều chỉnh. */
      readonly code: string | null;
      /** Dòng sổ: DEBIT, REVERSAL; lần thu, điều chỉnh: thao tác (`create`, `post`...). */
      readonly action: string;
      readonly toStatus: string | null;
      readonly amount: number | null;
      readonly reason: string | null;
    }
  | {
      /** Bảo hành, đổi trả: tiếp nhận, nhận hàng, kiểm định, xử lý, từ chối, đóng. */
      readonly kind: 'warranty';
      readonly id: string;
      readonly at: string;
      readonly actorId: string | null;
      readonly caseId: string;
      readonly caseCode: string;
      readonly action: string;
      readonly fromStatus: string | null;
      readonly toStatus: string | null;
      readonly reason: string | null;
    };

export type CustomerTimelineKind = CustomerTimelineEntry['kind'];
