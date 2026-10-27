import type {
  Activity,
  ActivityStatus,
  ActivityType,
  CrmPage,
  CrmPerson,
  CustomerDetail,
  CustomerGroup,
  CustomerKind,
  CustomerSummary,
  CustomerTimelineEntry,
  Lead,
  LeadStatus,
  OpportunityBoard,
  OpportunityDetail,
  OpportunityStage,
  OpportunitySummary,
  TaxCodeMatch,
} from '@enterprise-platform/contracts-crm';
import type { CustomerCodeRule } from '../domain/customer-code.js';
import type { KeysetCursor } from '../domain/pagination.js';
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
  readonly stage?: OpportunityStage;
  readonly ownerUserId?: string;
  readonly customerId?: string;
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

export interface OpportunityRecord {
  readonly name: string;
  readonly probability: number;
  readonly expectedValue: number | null;
  readonly expectedCloseDate: string | null;
  readonly need: string | null;
  readonly budget: number | null;
  readonly ownerUserId: string;
}

export interface StageChange {
  readonly from: OpportunityStage;
  readonly to: OpportunityStage;
  readonly reason: string | null;
  /** Không có thì không so phiên bản (chỉ so giai đoạn hiện tại). */
  readonly expectedVersion?: number;
}

export interface OpportunityStore {
  listOpportunities(
    tenantId: string,
    scope: CrmDataScope,
    filter: OpportunityFilter,
  ): Promise<CrmPage<OpportunitySummary>>;
  board(
    tenantId: string,
    scope: CrmDataScope,
    filter: { readonly ownerUserId?: string; readonly q?: string },
    perStageLimit: number,
  ): Promise<OpportunityBoard>;
  getOpportunity(tenantId: string, scope: CrmDataScope, id: string): Promise<OpportunityDetail | undefined>;
  /** Tạo ở giai đoạn Mới, ghi dòng lịch sử đầu tiên và nhật ký. Trả id. */
  createOpportunity(
    tenantId: string,
    customerId: string,
    record: OpportunityRecord,
    actorId: string,
  ): Promise<string>;
  updateOpportunity(
    tenantId: string,
    id: string,
    record: OpportunityRecord,
    expectedVersion: number,
    actorId: string,
  ): Promise<void>;
  /**
   * Đổi giai đoạn chỉ khi giai đoạn hiện tại vẫn là `change.from` (và phiên
   * bản khớp nếu có); ghi lịch sử và `audit_log` cùng transaction. Ai đó vừa
   * đổi trước: 409.
   */
  changeStage(tenantId: string, id: string, change: StageChange, actorId: string): Promise<void>;
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
