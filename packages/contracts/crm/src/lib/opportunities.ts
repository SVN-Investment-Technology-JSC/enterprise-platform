/**
 * Lead, cơ hội, hoạt động và dòng thời gian khách hàng (GĐ2).
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
  readonly stage: OpportunityStage;
  readonly probability: number;
  readonly expectedValue: number | null;
  readonly expectedCloseDate: string | null;
  readonly ownerUserId: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface OpportunityStageHistoryEntry {
  readonly id: string;
  readonly fromStage: OpportunityStage | null;
  readonly toStage: OpportunityStage;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly at: string;
}

export interface OpportunityDetail extends OpportunitySummary {
  readonly need: string | null;
  readonly budget: number | null;
  readonly lostReason: string | null;
  readonly leadId: string | null;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly history: readonly OpportunityStageHistoryEntry[];
}

export interface OpportunityFields {
  readonly name: string;
  readonly probability?: number;
  readonly expectedValue?: number | null;
  readonly expectedCloseDate?: string | null;
  readonly need?: string | null;
  readonly budget?: number | null;
  readonly ownerUserId?: string | null;
}

export interface CreateOpportunityRequest extends OpportunityFields {
  readonly customerId: string;
}

export interface UpdateOpportunityRequest extends OpportunityFields {
  readonly version: number;
}

/** Chuyển giai đoạn. Thua bắt buộc `reason`. */
export interface ChangeOpportunityStageRequest {
  readonly stage: OpportunityStage;
  readonly reason?: string | null;
  /** Bản đang xem; khác bản trong DB thì 409. Không gửi thì không so. */
  readonly version?: number;
}

export interface OpportunityListQuery {
  readonly q?: string;
  readonly stage?: OpportunityStage;
  readonly ownerUserId?: string;
  readonly customerId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** Một cột kanban: các thẻ mới cập nhật nhất và tổng của cả cột. */
export interface OpportunityBoardColumn {
  readonly stage: OpportunityStage;
  readonly total: number;
  readonly totalValue: number;
  readonly items: readonly OpportunitySummary[];
}

export interface OpportunityBoard {
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
      readonly stage: OpportunityStage;
    }
  | {
      readonly kind: 'opportunity-stage-changed';
      readonly id: string;
      readonly at: string;
      readonly actorId: string | null;
      readonly opportunityId: string;
      readonly opportunityName: string;
      readonly fromStage: OpportunityStage;
      readonly toStage: OpportunityStage;
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
