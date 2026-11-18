import type {
  BusinessPlanCostKind,
  BusinessPlanCostLine,
  BusinessPlanDeviationSettings,
  BusinessPlanFigures,
  BusinessPlanRound,
  BusinessPlanStatus,
} from '@enterprise-platform/contracts-crm';

/**
 * Port của phương án kinh doanh (PAKD, GĐ D). Hàm ghi khoá dòng PAKD (và báo giá, phiên bản) rồi so lại `version`
 * mà service đã đọc: lệch thì 409 `STALE_VERSION`, không ghi đè. Phạm vi dữ liệu kiểm ở service qua báo giá.
 */
export const CRM_BUSINESS_PLAN_STORE = Symbol('CRM_BUSINESS_PLAN_STORE');

export interface BusinessPlanRecord {
  readonly id: string;
  readonly quoteId: string;
  readonly quoteVersionId: string;
  readonly quoteVersionNo: number;
  readonly status: BusinessPlanStatus;
  readonly version: number;
  readonly note: string | null;
  /** Bản chụp số liệu lần lưu hoặc trình gần nhất. */
  readonly figures: BusinessPlanFigures;
  readonly snapshotAt: string | null;
  readonly lines: readonly BusinessPlanCostLine[];
  readonly currentRoundNo: number | null;
  readonly submittedAt: string | null;
  readonly submittedBy: string | null;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly decisionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Vòng đang mở đi cùng lần gửi duyệt báo giá hay trình riêng; rỗng khi chưa có vòng. */
  readonly currentRoundVia: 'STANDALONE' | 'QUOTE' | null;
}

export interface PlanLineRecord {
  readonly kind: BusinessPlanCostKind;
  readonly description: string | null;
  readonly amount: number;
}

export interface NewBusinessPlanRecord {
  readonly quoteId: string;
  readonly quoteVersionId: string;
  readonly note: string | null;
  readonly lines: readonly PlanLineRecord[];
  readonly figures: BusinessPlanFigures;
}

export interface BusinessPlanChange {
  readonly note: string | null;
  readonly lines: readonly PlanLineRecord[];
  readonly figures: BusinessPlanFigures;
}

/** Đính PAKD vào lần gửi duyệt báo giá: khoá và mở vòng duyệt cùng transaction với báo giá. */
export interface PlanAttachment {
  readonly planId: string;
  readonly expectedVersion: number;
  readonly figures: BusinessPlanFigures;
}

/** Quy trình duyệt PAKD trình riêng: định nghĩa đã gắn và tiêu đề hồ sơ. */
export interface PlanProcedureStart {
  readonly definitionId: string;
  readonly title: string;
}

/** Liên kết Quy trình của vòng duyệt PAKD. */
export interface PlanRoundLink {
  readonly id: string;
  readonly status: string;
  readonly instanceId: string | null;
  readonly instanceCode: string | null;
}

export interface BusinessPlanStore {
  /** PAKD của một phiên bản báo giá (kèm dòng chi phí). */
  findByVersion(tenantId: string, quoteId: string, versionNo: number): Promise<BusinessPlanRecord | undefined>;
  /** PAKD đã duyệt gần nhất của các phiên bản có số nhỏ hơn `beforeVersionNo`. */
  latestApproved(tenantId: string, quoteId: string, beforeVersionNo: number): Promise<BusinessPlanRecord | undefined>;
  listRounds(tenantId: string, quoteId: string): Promise<BusinessPlanRound[]>;
  /** Tạo PAKD đang soạn cho phiên bản Nháp; đã có thì 409 `PLAN_EXISTS`. */
  create(tenantId: string, record: NewBusinessPlanRecord, actorId: string): Promise<string>;
  /** Sửa (đang soạn hoặc bị từ chối, bị từ chối thì về đang soạn); phiên bản báo giá phải còn Nháp. */
  update(tenantId: string, planId: string, expectedVersion: number, change: BusinessPlanChange, actorId: string): Promise<void>;
  /**
   * Trình riêng: đang soạn -> chờ duyệt, mở vòng mới. Có `procedure` (loại duyệt `BUSINESS_PLAN` qua Quy trình) thì
   * cùng transaction tạo liên kết `crm_business_plan` cho vòng đó; trả id liên kết để tạo phiên sau commit.
   */
  submit(
    tenantId: string,
    planId: string,
    expectedVersion: number,
    figures: BusinessPlanFigures,
    actorId: string,
    procedure?: PlanProcedureStart | null,
  ): Promise<string | null>;
  /** Liên kết Quy trình của vòng đang mở (PAKD trình riêng qua Quy trình); rỗng khi duyệt trực tiếp. */
  currentRoundLink(tenantId: string, planId: string): Promise<PlanRoundLink | undefined>;
  /** Duyệt hay từ chối PAKD đang chờ duyệt do trình riêng; người trình không tự duyệt. */
  decide(
    tenantId: string,
    planId: string,
    expectedVersion: number,
    decision: 'APPROVED' | 'REJECTED',
    reason: string | null,
    actorId: string,
  ): Promise<void>;
  deviationSettings(tenantId: string): Promise<BusinessPlanDeviationSettings>;
  saveDeviationSettings(tenantId: string, settings: BusinessPlanDeviationSettings, actorId: string): Promise<void>;
}
