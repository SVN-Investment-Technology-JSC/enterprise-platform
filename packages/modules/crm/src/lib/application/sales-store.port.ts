import type {
  Activity,
  ActivityStatus,
  ActivityType,
  CrmPage,
  CrmPerson,
  CustomerDetail,
  CustomerGroup,
  CustomerKind,
  CustomerKindOption,
  CustomerSummary,
  CustomerTimelineEntry,
  Lead,
  LeadStatus,
  MyStageTask,
  OpportunityBoard,
  OpportunityByCustomerPage,
  OpportunityDetail,
  OpportunityStagePlanItem,
  OpportunitySummary,
  Pipeline,
  StageSemantic,
  TaxCodeMatch,
} from '@enterprise-platform/contracts-crm';
import type { CrmCustomerReference } from '@enterprise-platform/contracts-integration';
import type { CustomerCodeRule } from '../domain/customer-code.js';
import type { KeysetCursor } from '../domain/pagination.js';
import type { PlannedStage } from '../domain/stage-plan.js';
import type { CrmDataScope } from './data-scope.js';

/**
 * Port lưu trữ của khách hàng, lead, cơ hội, hoạt động (GĐ2).
 *
 * Mọi hàm đọc nhận `scope` và tự lọc theo người phụ trách: bản ghi ngoài phạm
 * vi đọc ra `undefined` như không có. Hàm ghi được gọi sau khi service đã đọc
 * bản ghi trong phạm vi; hàm ghi nhiều bảng chạy trong một transaction.
 */

export const CRM_CUSTOMER_STORE = Symbol('CRM_CUSTOMER_STORE');
export const CRM_CUSTOMER_GROUP_STORE = Symbol('CRM_CUSTOMER_GROUP_STORE');
export const CRM_CUSTOMER_KIND_STORE = Symbol('CRM_CUSTOMER_KIND_STORE');
export const CRM_SETTINGS_STORE = Symbol('CRM_SETTINGS_STORE');
export const CRM_LEAD_STORE = Symbol('CRM_LEAD_STORE');
export const CRM_OPPORTUNITY_STORE = Symbol('CRM_OPPORTUNITY_STORE');
export const CRM_ACTIVITY_STORE = Symbol('CRM_ACTIVITY_STORE');
export const CRM_TIMELINE_STORE = Symbol('CRM_TIMELINE_STORE');
export const CRM_PEOPLE_DIRECTORY = Symbol('CRM_PEOPLE_DIRECTORY');

// ---------------------------------------------------------------------------
// Khách hàng
// ---------------------------------------------------------------------------

export interface CustomerFilter {
  readonly q?: string;
  readonly groupId?: string;
  readonly kind?: CustomerKind;
  readonly ownerUserId?: string;
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

/** Khách hàng đã kiểm và chuẩn hoá, sẵn sàng ghi. */
export interface CustomerRecord {
  readonly name: string;
  readonly taxCode: string | null;
  readonly address: string | null;
  readonly province: string | null;
  readonly region: string | null;
  readonly industry: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly groupId: string | null;
  readonly kind: CustomerKind;
  readonly creditLimit: number | null;
  readonly paymentTermDays: number | null;
  readonly note: string | null;
  readonly ownerUserId: string;
}

export interface ContactRecord {
  readonly fullName: string;
  readonly title: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly note: string | null;
  readonly isPrimary: boolean;
}

export interface CustomerStore {
  listCustomers(tenantId: string, scope: CrmDataScope, filter: CustomerFilter): Promise<CrmPage<CustomerSummary>>;
  getCustomer(tenantId: string, scope: CrmDataScope, id: string): Promise<CustomerDetail | undefined>;
  /** Khách khác đang dùng MST này (không lọc phạm vi: cảnh báo trùng áp cho cả tenant). */
  findByTaxCode(tenantId: string, taxCode: string, excludeId?: string): Promise<TaxCodeMatch[]>;
  /** `code` rỗng thì sinh theo quy tắc trong `settings`. Trả id. Trùng mã: 409. */
  createCustomer(tenantId: string, code: string | null, record: CustomerRecord, actorId: string): Promise<string>;
  /** Sai `expectedVersion`: 409. Trùng mã: 409. */
  updateCustomer(
    tenantId: string,
    id: string,
    code: string,
    record: CustomerRecord,
    expectedVersion: number,
    actorId: string,
  ): Promise<void>;
  /**
   * Lưu chân dung khách hàng (P2F-03), tăng `version`; sai `expectedVersion`: 409. Ghi `audit_log` trong cùng
   * transaction. `false` khi khách không còn.
   */
  saveProfileNote(
    tenantId: string,
    id: string,
    profileNote: string | null,
    expectedVersion: number,
    actorId: string,
  ): Promise<boolean>;
  /** Người liên hệ đầu tiên luôn là người chính. Trả id. */
  addContact(tenantId: string, customerId: string, record: ContactRecord, actorId: string): Promise<string>;
  /** `false` khi người liên hệ không thuộc khách này. */
  updateContact(
    tenantId: string,
    customerId: string,
    contactId: string,
    record: ContactRecord,
    actorId: string,
  ): Promise<boolean>;
  /** Xoá người chính thì người liên hệ cũ nhất còn lại thành người chính. */
  deleteContact(tenantId: string, customerId: string, contactId: string): Promise<boolean>;
  /**
   * Tra khách cho phân hệ khác (`GET /v1/internal/customers`): theo danh sách id
   * hoặc theo chuỗi tìm (đầu mã, đầu MST, đầu từ trong tên). Không lọc phạm vi
   * người phụ trách: bên gọi là dịch vụ, chỉ nhận mã, tên, MST, phiên bản.
   */
  lookupCustomers(tenantId: string, query: CustomerLookupQuery): Promise<CrmCustomerReference[]>;
}

export interface CustomerLookupQuery {
  readonly q?: string;
  readonly ids?: readonly string[];
  readonly limit: number;
}

// ---------------------------------------------------------------------------
// Nhóm khách, cấu hình, danh bạ
// ---------------------------------------------------------------------------

export interface CustomerGroupRecord {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
}

export interface CustomerGroupStore {
  listGroups(tenantId: string): Promise<CustomerGroup[]>;
  /** Trùng mã: 409. */
  createGroup(tenantId: string, record: CustomerGroupRecord, actorId: string): Promise<CustomerGroup>;
  /** `undefined` khi không có. Trùng mã: 409. */
  updateGroup(
    tenantId: string,
    id: string,
    record: CustomerGroupRecord,
    actorId: string,
  ): Promise<CustomerGroup | undefined>;
  /** `false` khi không có. Nhóm đang có khách: 409. */
  deleteGroup(tenantId: string, id: string): Promise<boolean>;
}

export interface CustomerKindRecord {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly sortOrder: number;
}

export interface CustomerKindStore {
  listKinds(tenantId: string): Promise<CustomerKindOption[]>;
  /** Trùng mã: 409. */
  createKind(tenantId: string, record: CustomerKindRecord, actorId: string): Promise<CustomerKindOption>;
  /**
   * Sửa theo mã hiện tại; đổi mã thì khách thuộc phân loại đổi theo. `undefined` khi không có. Trùng mã: 409.
   * Phân loại hệ thống không đổi mã được: 409.
   */
  updateKind(
    tenantId: string,
    code: string,
    record: CustomerKindRecord,
    actorId: string,
  ): Promise<CustomerKindOption | undefined>;
  /** `false` khi không có. Phân loại hệ thống hoặc đang có khách: 409. */
  deleteKind(tenantId: string, code: string): Promise<boolean>;
}

export interface SettingsStore {
  customerCodeRule(tenantId: string): Promise<CustomerCodeRule>;
  saveCustomerCodeRule(tenantId: string, rule: CustomerCodeRule, actorId: string): Promise<void>;
  activityReminderMinutes(tenantId: string): Promise<number>;
  saveActivityReminderMinutes(tenantId: string, minutes: number, actorId: string): Promise<void>;
}

export interface PeopleDirectory {
  people(tenantId: string): Promise<CrmPerson[]>;
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

export interface LeadFilter {
  readonly q?: string;
  readonly status?: LeadStatus;
  readonly ownerUserId?: string;
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

export interface LeadRecord {
  readonly name: string;
  readonly contactName: string | null;
  readonly taxCode: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly source: string | null;
  readonly need: string | null;
  readonly note: string | null;
  readonly ownerUserId: string;
}

/** Kế hoạch chuyển đổi đã kiểm ở service; store thực hiện trong một transaction. */
export interface LeadConversionPlan {
  readonly leadId: string;
  /** Phiên bản lead lúc service đọc; khác thì 409, không chuyển gì. */
  readonly expectedVersion: number;
  /** Khách mới tạo nếu không khớp MST với khách có sẵn. */
  readonly customer: CustomerRecord;
  /** Người liên hệ chính của khách mới (tên người liên hệ trên lead). */
  readonly contact: ContactRecord | null;
  readonly opportunity: OpportunityRecord;
}

export interface LeadConversionOutcome {
  readonly customerId: string;
  readonly opportunityId: string;
  readonly attachedToExistingCustomer: boolean;
}

export interface LeadStore {
  listLeads(tenantId: string, scope: CrmDataScope, filter: LeadFilter): Promise<CrmPage<Lead>>;
  getLead(tenantId: string, scope: CrmDataScope, id: string): Promise<Lead | undefined>;
  createLead(tenantId: string, record: LeadRecord, actorId: string): Promise<string>;
  /** Lead đã chuyển đổi hoặc sai `expectedVersion`: 409. */
  updateLead(
    tenantId: string,
    id: string,
    record: LeadRecord,
    status: Exclude<LeadStatus, 'CONVERTED'>,
    expectedVersion: number,
    actorId: string,
  ): Promise<void>;
  /**
   * Chuyển lead thành khách và cơ hội trong MỘT transaction: khoá lead, khớp
   * MST với khách có sẵn (có thì gắn vào khách đó), tạo khách nếu cần, tạo cơ
   * hội Mới kèm lịch sử và nhật ký, đánh dấu lead Đã chuyển đổi. Lỗi ở bất kỳ
   * bước nào thì không còn gì.
   */
  convertLead(tenantId: string, plan: LeadConversionPlan, actorId: string): Promise<LeadConversionOutcome>;
}

// ---------------------------------------------------------------------------
// Cơ hội
// ---------------------------------------------------------------------------

export interface OpportunityFilter {
  readonly q?: string;
  /** Mã giai đoạn. */
  readonly stage?: string;
  readonly pipelineId?: string;
  readonly ownerUserId?: string;
  readonly customerId?: string;
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

/** Bộ lọc của danh sách theo khách: như danh sách dự án, phân trang theo số trang. */
export interface OpportunityByCustomerFilter extends Omit<OpportunityFilter, 'cursor' | 'limit' | 'customerId'> {
  readonly page: number;
  readonly pageSize: number;
}

export interface OpportunityRecord {
  readonly name: string;
  readonly probability: number;
  readonly expectedValue: number | null;
  readonly expectedCloseDate: string | null;
  readonly need: string | null;
  readonly budget: number | null;
  /** Dự toán (P2D-09); bỏ trống (lead chuyển đổi) là chưa nhập. */
  readonly estimateTotalValue?: number | null;
  readonly estimateCostValue?: number | null;
  /** Đối thủ và giá đối thủ (P2F-03); bỏ trống là chưa nhập. */
  readonly competitorName?: string | null;
  readonly competitorPrice?: number | null;
  readonly ownerUserId: string;
}

/** Luồng và giai đoạn đầu cho cơ hội mới (service đã chọn từ cấu hình). */
export interface OpportunityPlacement {
  readonly pipelineId: string;
  readonly stageId: string;
  readonly stageCode: string;
  /**
   * Kế hoạch giai đoạn đã dựng ở service (người đảm nhận theo quy tắc, giai đoạn bỏ qua). Không có thì
   * store lập kế hoạch cho mọi giai đoạn đang bật của luồng, chưa gán người (chuyển đổi lead).
   */
  readonly plan?: readonly PlannedStage[];
  /** Tên giai đoạn theo id, để ghi nhật ký và sự kiện gán người. */
  readonly stageNames?: Readonly<Record<string, { code: string; name: string }>>;
}

/** Thay đổi người đảm nhận một giai đoạn của riêng dự án. */
export interface StageAssigneeChange {
  readonly stageId: string;
  readonly assigneeUserId: string | null;
  /** `undefined` giữ hạn cũ; `null` xoá hạn. */
  readonly dueDate?: string | null;
}

export interface StageSkip {
  readonly stageId: string;
  readonly reason: string;
}

/** Kết nối của transaction đang mở (cổng hẹp, tầng application không import hạ tầng). */
export interface StageChangeTransaction {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface StageChange {
  readonly pipelineId: string;
  /** Giai đoạn hiện tại (id và mã); chỉ đổi khi cơ hội vẫn đang ở đó. */
  readonly fromStageId: string;
  readonly from: string;
  readonly fromSemantic: StageSemantic;
  readonly toStageId: string;
  readonly to: string;
  readonly toSemantic: StageSemantic;
  /** Thứ tự giai đoạn trong luồng, để cập nhật kế hoạch (tiến hoặc lùi). */
  readonly fromSortOrder: number;
  readonly toSortOrder: number;
  readonly reason: string | null;
  /** Không có thì không so phiên bản (chỉ so giai đoạn hiện tại). */
  readonly expectedVersion?: number;
  /**
   * Sang Báo giá: tạo nháp báo giá (hạn hiệu lực ngày này) trong cùng
   * transaction nếu cơ hội chưa có báo giá còn hiệu lực (OPP-05).
   */
  readonly draftQuoteValidUntil?: string;
  /**
   * Giai đoạn đích có điều kiện QUOTE_APPROVED bắt buộc: kiểm lại trong
   * transaction (chống đua); thiếu thì 409 `ACCEPTED_QUOTE_REQUIRED` kèm thông báo này.
   */
  readonly requireAcceptedQuote?: { readonly message: string };
  /** Sang nghĩa LOST: báo giá chưa kết thúc sang Khách từ chối trong cùng transaction (T3-21). */
  readonly declineOpenQuotes?: boolean;
  /** Sang Đã nộp (GĐ E): ghi ngày nộp vào hồ sơ thầu của cơ hội (nếu có), chưa ghi thì mới ghi. */
  readonly markTenderSubmitted?: boolean;
  /** Sang Trúng hoặc Trượt (GĐ E): ghi kết quả vào hồ sơ thầu của cơ hội (nếu có và chưa có kết quả). */
  readonly syncTenderResult?: boolean;
  /** Việc thêm cần làm trong CÙNG transaction, chạy sau khi đã đổi giai đoạn; ném lỗi thì cả lần chuyển rollback. */
  readonly inTransaction?: (client: StageChangeTransaction) => Promise<void>;
}

export interface OpportunityStore {
  listOpportunities(
    tenantId: string,
    scope: CrmDataScope,
    filter: OpportunityFilter,
  ): Promise<CrmPage<OpportunitySummary>>;
  /** Sắp theo khách, phân trang theo số trang; kèm tổng của các khách có trên trang. */
  listByCustomer(
    tenantId: string,
    scope: CrmDataScope,
    filter: OpportunityByCustomerFilter,
  ): Promise<OpportunityByCustomerPage>;
  board(
    tenantId: string,
    scope: CrmDataScope,
    filter: { readonly ownerUserId?: string; readonly q?: string },
    perStageLimit: number,
    pipeline: Pipeline,
  ): Promise<OpportunityBoard>;
  getOpportunity(tenantId: string, scope: CrmDataScope, id: string): Promise<OpportunityDetail | undefined>;
  /** Tạo ở giai đoạn đầu của luồng đã chọn, ghi dòng lịch sử đầu tiên và nhật ký. Trả id. */
  createOpportunity(
    tenantId: string,
    customerId: string,
    record: OpportunityRecord,
    actorId: string,
    placement: OpportunityPlacement,
  ): Promise<string>;
  /** Cơ hội có báo giá Khách chấp nhận không (đọc trước để nêu đủ điều kiện thiếu). */
  hasAcceptedQuote(tenantId: string, opportunityId: string): Promise<boolean>;
  updateOpportunity(
    tenantId: string,
    id: string,
    record: OpportunityRecord,
    expectedVersion: number,
    actorId: string,
  ): Promise<void>;
  /**
   * Đổi giai đoạn chỉ khi giai đoạn hiện tại vẫn là `change.from` (và phiên
   * bản khớp nếu có); ghi `stage` và `stage_id`, lịch sử, `audit_log` và sự kiện
   * outbox `crm.opportunity.stage-changed` cùng transaction. Ai đó vừa đổi trước: 409.
   */
  changeStage(tenantId: string, id: string, change: StageChange, actorId: string): Promise<void>;
  /**
   * Kế hoạch giai đoạn của cơ hội theo thứ tự luồng. Không kiểm phạm vi: bên gọi đã đọc được cơ hội
   * (`getOpportunity` đã lọc phạm vi).
   */
  getStagePlan(tenantId: string, opportunityId: string): Promise<OpportunityStagePlanItem[]>;
  /**
   * PAKD mới nhất của cơ hội (P2D-09), một truy vấn: báo giá mới nhất của cơ hội, phiên bản đã duyệt gần nhất,
   * không có thì phiên bản mới nhất có PAKD. Trả đủ số liệu; service lọc theo quyền xem giá vốn. Không kiểm phạm vi.
   */
  latestBusinessPlan(
    tenantId: string,
    opportunityId: string,
  ): Promise<
    | {
        readonly quoteId: string;
        readonly quoteCode: string;
        readonly versionNo: number;
        readonly status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
        readonly revenue: number;
        readonly totalCost: number;
        readonly profit: number;
      }
    | undefined
  >;
  /**
   * Gán hoặc ghi đè người đảm nhận một giai đoạn chưa xong (PENDING hoặc ACTIVE) của riêng cơ hội: ghi
   * `audit_log` và sự kiện `crm.opportunity.stage-assigned` cùng transaction. Giai đoạn DONE hoặc SKIPPED
   * thì 409; giai đoạn không có trong kế hoạch thì 404. Không đổi người thì không ghi gì.
   */
  setStageAssignee(
    tenantId: string,
    opportunityId: string,
    change: StageAssigneeChange,
    actorId: string,
  ): Promise<void>;
  /**
   * Bỏ qua một giai đoạn PENDING của cơ hội đang mở; khoá dòng cơ hội để không đua với chuyển giai đoạn.
   * Ghi `audit_log` (`skip_stage`). Giai đoạn không còn PENDING: 409.
   */
  skipStage(tenantId: string, opportunityId: string, skip: StageSkip, actorId: string): Promise<void>;
  /** Bật hoặc tắt gợi ý chăm sóc lại của luồng (kèm `audit_log`); `false` khi không có luồng. */
  setPipelineCareSuggestion(tenantId: string, pipelineId: string, enabled: boolean, actorId: string): Promise<boolean>;
  /** "Việc của tôi": giai đoạn ACTIVE hoặc PENDING giao cho `userId` ở cơ hội còn mở, ACTIVE trước. */
  listMyStageTasks(tenantId: string, userId: string, limit: number): Promise<MyStageTask[]>;
}

// ---------------------------------------------------------------------------
// Hoạt động
// ---------------------------------------------------------------------------

export interface ActivityFilter {
  readonly customerId?: string;
  readonly opportunityId?: string;
  readonly assigneeUserId?: string;
  readonly status?: ActivityStatus;
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

export interface ActivityRecord {
  readonly type: ActivityType;
  readonly subject: string;
  readonly description: string | null;
  readonly assigneeUserId: string;
  readonly dueAt: string | null;
  readonly status: ActivityStatus;
  readonly result: string | null;
}

export interface ActivityStore {
  /**
   * Phạm vi của hoạt động: người được giao, hoặc người phụ trách khách hàng,
   * cơ hội mà hoạt động gắn vào, nằm trong phạm vi.
   */
  listActivities(tenantId: string, scope: CrmDataScope, filter: ActivityFilter): Promise<CrmPage<Activity>>;
  getActivity(tenantId: string, scope: CrmDataScope, id: string): Promise<Activity | undefined>;
  createActivity(
    tenantId: string,
    target: { readonly customerId: string | null; readonly opportunityId: string | null },
    record: ActivityRecord,
    actorId: string,
  ): Promise<string>;
  /** Sang DONE ghi thời điểm và người hoàn tất; mở lại thì xoá hai trường đó. */
  updateActivity(
    tenantId: string,
    id: string,
    record: ActivityRecord,
    expectedVersion: number,
    actorId: string,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Dòng thời gian
// ---------------------------------------------------------------------------

export interface TimelineStore {
  /** Mục của một khách, mới nhất trước, đã lọc theo phạm vi từng loại. */
  customerTimeline(
    tenantId: string,
    scope: CrmDataScope,
    customerId: string,
    cursor: KeysetCursor | undefined,
    limit: number,
  ): Promise<CrmPage<CustomerTimelineEntry>>;
}
