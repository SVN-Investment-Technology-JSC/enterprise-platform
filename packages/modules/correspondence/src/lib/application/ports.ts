import type {
  ApproverRule,
  AssignmentStatus,
  AttachmentDownloadMode,
  AttachmentDownloadTicket,
  AttachmentKind,
  CatalogItem,
  CatalogKind,
  CorrespondenceSettings,
  DeliveryStatus,
  LetterDirection,
  LetterHistoryAction,
  LetterStage,
  LetterStepDecision,
  LetterStepStatus,
  ReturnTarget,
  Workflow,
  WorkflowStep,
} from '@enterprise-platform/contracts-correspondence';
import type {
  SharedFilingDocumentRequest,
  SharedFilingDocumentResponse,
  SharedFilingFolderUpdateRequest,
  SharedFilingVersionRequest,
  SharedFilingVersionResponse,
} from '@enterprise-platform/contracts-shared';
import type { OrganizationSnapshot } from '../domain/organization.js';

/** Người gọi API, guard dựng từ quyết định truy cập của Platform. */
export interface CorrespondenceActor {
  readonly tenantId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly isTenantAdmin: boolean;
  readonly canRegister: boolean;
  readonly canCreateOutgoing: boolean;
  readonly canPublish: boolean;
  readonly canArchive: boolean;
  /** Có quyền lãnh đạo: nằm trong nhóm "lãnh đạo" để người trình chọn. */
  readonly canDirect: boolean;
  readonly canReadAll: boolean;
  readonly canReadConfidential: boolean;
  readonly canReadReports: boolean;
  readonly canConfigure: boolean;
}

/* ---------------------------------------------------------------- bản ghi */

export interface LetterRecord {
  readonly id: string;
  readonly direction: LetterDirection;
  readonly year: number;
  readonly seq: number;
  /** Số đến (công văn đến) hay số dự thảo (công văn đi). */
  readonly incomingNo: string;
  readonly receivedOn: string;
  readonly senderOrg: string;
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject: string;
  readonly kind: string;
  readonly urgency: string;
  readonly confidentiality: string;
  readonly dueOn?: string;
  readonly stage: LetterStage;
  readonly workflowId?: string;
  readonly workflowName?: string;
  /** Ghi chú khi văn thư giao phòng ban (công văn đến). */
  readonly instruction?: string;
  readonly authorUserId?: string;
  readonly authorUnitId?: string;
  readonly authorUnitName?: string;
  readonly relatedLetterId?: string;
  readonly completionNote?: string;
  readonly outgoingNo?: string;
  readonly publishedOn?: string;
  readonly recipient?: string;
  readonly deliveryMethod?: string;
  readonly deliveryStatus?: DeliveryStatus;
  readonly deliveryNote?: string;
  readonly deliveredOn?: string;
  readonly archiveCode?: string;
  readonly archivedOn?: string;
  readonly cancelReason?: string;
  readonly sharedFolderId?: string;
  readonly receivedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StepRecord {
  readonly id: string;
  readonly seq: number;
  readonly name: string;
  readonly approver: ApproverRule;
  readonly rejectTo?: ReturnTarget;
  readonly dueDays?: number;
  readonly status: LetterStepStatus;
  readonly chosenUserId?: string;
  readonly assigneeUserIds: readonly string[];
  readonly activatedAt?: string;
  readonly actedBy?: string;
  readonly actedAt?: string;
  readonly decision?: LetterStepDecision;
  readonly note?: string;
}

export interface AssignmentRecord {
  readonly id: string;
  readonly letterId: string;
  readonly unitId: string;
  readonly unitName: string;
  readonly round: number;
  readonly status: AssignmentStatus;
  readonly handlerUserId?: string;
  readonly responseNote?: string;
  readonly submittedBy?: string;
  readonly submittedAt?: string;
  readonly revisionReason?: string;
}

export interface AttachmentRecord {
  readonly id: string;
  readonly letterId: string;
  readonly kind: AttachmentKind;
  readonly assignmentId?: string;
  readonly sharedDocumentId: string;
  readonly sharedVersionId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly versionNo: number;
  readonly uploadedBy: string;
  readonly createdAt: string;
}

export interface HistoryRecord {
  readonly id: string;
  readonly action: LetterHistoryAction;
  readonly summary: string;
  readonly note?: string;
  readonly actorUserId?: string;
  readonly at: string;
}

export interface CommentRecord {
  readonly id: string;
  readonly stage: LetterStage;
  readonly stepName?: string;
  readonly body: string;
  readonly mentionedUserIds: readonly string[];
  readonly authorId: string;
  readonly at: string;
}

/** Một dòng danh sách: công văn kèm bước, phòng ban và người được nhắc tên (để tính quyền xem). */
export interface LetterListRow extends LetterRecord {
  readonly steps: readonly Pick<StepRecord, 'seq' | 'name' | 'status' | 'assigneeUserIds' | 'actedBy' | 'rejectTo'>[];
  readonly assignments: readonly Pick<AssignmentRecord, 'unitId' | 'unitName' | 'status' | 'submittedBy' | 'handlerUserId' | 'submittedAt'>[];
  readonly mentionedUserIds: readonly string[];
}

export interface LetterListFilter {
  /**
   * Bỏ trống là mọi công văn. Có thì chỉ công văn người này liên quan, cộng công văn
   * không mật (`readAll`) và công văn mật (`readConfidential`) nếu được phép.
   */
  readonly visibleTo?: {
    readonly userId: string;
    readonly unitIds: readonly string[];
    readonly readAll: boolean;
    readonly readConfidential: boolean;
  };
  readonly direction?: LetterDirection;
  readonly stages?: readonly LetterStage[];
  readonly year?: number;
  readonly search?: string;
  readonly limit: number;
}

/* ---------------------------------------------------------------- ghi */

export type LetterPatch = Partial<
  Omit<LetterRecord, 'id' | 'direction' | 'year' | 'seq' | 'incomingNo' | 'receivedBy' | 'createdAt' | 'updatedAt'>
>;

export interface LetterInsert {
  readonly direction: LetterDirection;
  readonly receivedOn: string;
  readonly senderOrg: string;
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject: string;
  readonly kind: string;
  readonly urgency: string;
  readonly confidentiality: string;
  readonly dueOn?: string;
  readonly stage: LetterStage;
  readonly authorUserId?: string;
  readonly authorUnitId?: string;
  readonly authorUnitName?: string;
  readonly relatedLetterId?: string;
  readonly recipient?: string;
  readonly receivedBy: string;
}

export interface OutboxEvent {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface HistoryInsert {
  readonly action: LetterHistoryAction;
  readonly summary: string;
  readonly note?: string;
  readonly actorUserId?: string;
}

export interface StepUpdate {
  readonly status?: LetterStepStatus;
  readonly chosenUserId?: string | null;
  readonly assigneeUserIds?: readonly string[];
  readonly activate?: boolean;
  readonly actedBy?: string | null;
  readonly decision?: LetterStepDecision | null;
  readonly note?: string | null;
}

/**
 * Một lượt ghi trên một công văn, trong một transaction và đã khoá dòng công văn
 * (`SELECT … FOR UPDATE`), nên hai người bấm cùng lúc không cùng chuyển bước.
 */
export interface LetterTransaction {
  readonly letter: LetterRecord;
  readonly steps: readonly StepRecord[];
  readonly assignments: readonly AssignmentRecord[];
  readonly mentionedUserIds: readonly string[];
  update(patch: LetterPatch): Promise<LetterRecord>;
  nextNumber(kind: 'outgoing' | 'archive', year: number): Promise<number>;
  /** Thay toàn bộ bước của công văn bằng các bước chép từ quy trình. */
  replaceSteps(steps: readonly WorkflowStep[]): Promise<void>;
  updateStep(stepId: string, update: StepUpdate): Promise<void>;
  /** Thêm phòng ban mới hay đưa phòng ban đã có về chờ ở lượt mới; ghi người xử lý nếu có. */
  assign(units: readonly { readonly unitId: string; readonly unitName: string; readonly handlerUserId?: string }[]): Promise<void>;
  /** Bỏ phòng ban khỏi công văn (văn thư giao lại không còn chọn phòng đó). */
  removeAssignments(assignmentIds: readonly string[]): Promise<void>;
  setHandler(assignmentId: string, handlerUserId: string | null): Promise<void>;
  submitAssignment(assignmentId: string, input: { readonly note: string; readonly userId: string }): Promise<void>;
  reopenAssignments(assignmentIds: readonly string[], reason: string): Promise<void>;
  addAttachment(
    input: Omit<AttachmentRecord, 'id' | 'letterId' | 'createdAt' | 'sizeBytes' | 'versionNo'>,
  ): Promise<AttachmentRecord>;
  /** Tệp chuyển sang phiên bản mới, chưa tải lên xong (dung lượng về trống), người tải là người tải phiên bản này. */
  setAttachmentVersion(
    attachmentId: string,
    input: {
      readonly sharedVersionId: string;
      readonly versionNo: number;
      readonly fileName: string;
      readonly contentType: string;
      readonly uploadedBy: string;
    },
  ): Promise<void>;
  removeAttachment(attachmentId: string): Promise<void>;
  addComment(input: Omit<CommentRecord, 'id' | 'at'>): Promise<CommentRecord>;
  history(entry: HistoryInsert): Promise<void>;
  outbox(event: OutboxEvent): Promise<void>;
}

export interface CatalogUpsert {
  readonly kind: CatalogKind;
  readonly code: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly defaultDueDays: number | null;
  readonly workflowId: string | null;
  readonly outgoingWorkflowId: string | null;
  readonly defaultUnitIds: readonly string[];
  readonly highlight: boolean;
  readonly restricted: boolean;
}

export interface WorkflowUpsert {
  readonly name: string;
  readonly description: string | null;
  readonly direction: LetterDirection;
  readonly isActive: boolean;
  readonly isDefault: boolean;
  readonly steps: readonly WorkflowStep[];
}

export interface CorrespondenceStore {
  tablesReady(tenantId: string): Promise<boolean>;

  settings(tenantId: string): Promise<CorrespondenceSettings>;
  saveSettings(tenantId: string, userId: string, settings: CorrespondenceSettings): Promise<void>;

  catalog(tenantId: string): Promise<CatalogItem[]>;
  saveCatalogItem(tenantId: string, userId: string, id: string | undefined, input: CatalogUpsert): Promise<CatalogItem>;
  deleteCatalogItem(tenantId: string, id: string): Promise<boolean>;

  workflows(tenantId: string): Promise<Workflow[]>;
  /** Đặt `isDefault` thì bỏ cờ mặc định ở quy trình khác cùng luồng, cùng transaction. */
  saveWorkflow(tenantId: string, userId: string, id: string | undefined, input: WorkflowUpsert): Promise<Workflow>;
  deleteWorkflow(tenantId: string, id: string): Promise<boolean>;

  /**
   * Vào sổ một công văn: cấp số theo bộ đếm của luồng (`incoming`: số đến, `draft`: số dự
   * thảo công văn đi) rồi ghi dòng, một transaction.
   */
  createLetter(
    tenantId: string,
    input: LetterInsert,
    numbering: { readonly counter: 'incoming' | 'draft'; readonly suffix: string },
    after: (tx: LetterTransaction) => Promise<void>,
  ): Promise<LetterRecord>;

  withLetter<T>(tenantId: string, letterId: string, work: (tx: LetterTransaction) => Promise<T>): Promise<T>;

  findLetter(tenantId: string, letterId: string): Promise<LetterRecord | undefined>;
  listLetters(tenantId: string, filter: LetterListFilter): Promise<LetterListRow[]>;
  countArchived(tenantId: string, visibleTo?: LetterListFilter['visibleTo']): Promise<number>;
  steps(tenantId: string, letterId: string): Promise<StepRecord[]>;
  assignments(tenantId: string, letterId: string): Promise<AssignmentRecord[]>;
  attachments(tenantId: string, letterId: string): Promise<AttachmentRecord[]>;
  findAttachment(tenantId: string, attachmentId: string): Promise<AttachmentRecord | undefined>;
  /** Tệp của nhiều công văn một lượt (cây lưu trữ), kèm tên phòng ban gửi tệp kết quả. */
  attachmentsOf(tenantId: string, letterIds: readonly string[]): Promise<(AttachmentRecord & { readonly unitName?: string })[]>;
  completeAttachment(tenantId: string, attachmentId: string, sizeBytes: number): Promise<void>;
  comments(tenantId: string, letterId: string): Promise<CommentRecord[]>;
  history(tenantId: string, letterId: string): Promise<HistoryRecord[]>;

  userNames(tenantId: string, userIds: readonly string[]): Promise<Map<string, string>>;
  people(tenantId: string): Promise<{ userId: string; name: string }[]>;
  leaders(tenantId: string): Promise<{ userId: string; name: string }[]>;
}

export const CORRESPONDENCE_STORE = Symbol('CORRESPONDENCE_STORE');

/* --------------------------------------------------------------- kho tệp */

export interface FileStore {
  create(tenantId: string, input: Omit<SharedFilingDocumentRequest, 'module'>): Promise<SharedFilingDocumentResponse>;
  addVersion(
    tenantId: string,
    documentId: string,
    input: Omit<SharedFilingVersionRequest, 'module'>,
  ): Promise<SharedFilingVersionResponse>;
  complete(tenantId: string, documentId: string, versionId: string, sizeBytes: number): Promise<void>;
  download(tenantId: string, documentId: string, userId: string, mode: AttachmentDownloadMode): Promise<AttachmentDownloadTicket>;
  trash(tenantId: string, documentId: string, userId: string): Promise<void>;
  updateFolder(tenantId: string, folderId: string, input: Omit<SharedFilingFolderUpdateRequest, 'module'>): Promise<void>;
}

export const FILE_STORE = Symbol('CORRESPONDENCE_FILE_STORE');

export class FileStoreMissingError extends Error {
  constructor() {
    super('Shared filing resource not found.');
    Object.setPrototypeOf(this, FileStoreMissingError.prototype);
  }
}

/* --------------------------------------------------------------- tổ chức */

export interface OrganizationReader {
  snapshot(tenantId: string): Promise<OrganizationSnapshot>;
}

export const ORGANIZATION_READER = Symbol('CORRESPONDENCE_ORGANIZATION_READER');
