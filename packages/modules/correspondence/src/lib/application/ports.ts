import type {
  ApproverRule,
  AssignmentStatus,
  AttachmentDownloadMode,
  AttachmentDownloadTicket,
  AttachmentKind,
  CatalogItem,
  CatalogKind,
  CorrespondenceSettings,
  LetterHistoryAction,
  LetterStage,
  LetterStep,
  LetterStepStatus,
  Workflow,
  WorkflowStep,
} from '@enterprise-platform/contracts-correspondence';
import type {
  SharedFilingDocumentRequest,
  SharedFilingDocumentResponse,
  SharedFilingFolderUpdateRequest,
} from '@enterprise-platform/contracts-shared';
import type { OrganizationSnapshot } from '../domain/organization.js';

/** Người gọi API, guard dựng từ quyết định truy cập của Platform. */
export interface CorrespondenceActor {
  readonly tenantId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly isTenantAdmin: boolean;
  readonly canRegister: boolean;
  readonly canPublish: boolean;
  readonly canArchive: boolean;
  /** Có quyền chỉ đạo: nằm trong nhóm "lãnh đạo" để người trình chọn. */
  readonly canDirect: boolean;
  readonly canReadAll: boolean;
  readonly canReadConfidential: boolean;
  readonly canConfigure: boolean;
}

/* ---------------------------------------------------------------- bản ghi */

export interface LetterRecord {
  readonly id: string;
  readonly year: number;
  readonly seq: number;
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
  readonly directorUserId?: string;
  readonly instruction?: string;
  readonly outgoingNo?: string;
  readonly publishedOn?: string;
  readonly recipient?: string;
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
  readonly kind: 'direct' | 'approve';
  readonly approver: ApproverRule;
  readonly dueDays?: number;
  readonly status: LetterStepStatus;
  readonly chosenUserId?: string;
  readonly assigneeUserIds: readonly string[];
  readonly activatedAt?: string;
  readonly actedBy?: string;
  readonly actedAt?: string;
  readonly decision?: LetterStep['decision'];
  readonly note?: string;
}

export interface AssignmentRecord {
  readonly id: string;
  readonly letterId: string;
  readonly unitId: string;
  readonly unitName: string;
  readonly round: number;
  readonly status: AssignmentStatus;
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

/** Một dòng danh sách: công văn kèm bước và phòng ban (để tính quyền xem và "việc của tôi"). */
export interface LetterListRow extends LetterRecord {
  readonly steps: readonly Pick<StepRecord, 'seq' | 'name' | 'kind' | 'status' | 'assigneeUserIds' | 'actedBy'>[];
  readonly assignments: readonly Pick<AssignmentRecord, 'unitId' | 'status' | 'submittedBy'>[];
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
  readonly stages?: readonly LetterStage[];
  readonly onlyPublished?: boolean;
  readonly search?: string;
  readonly limit: number;
}

/* ---------------------------------------------------------------- ghi */

export type LetterPatch = Partial<
  Omit<LetterRecord, 'id' | 'year' | 'seq' | 'incomingNo' | 'receivedBy' | 'createdAt' | 'updatedAt'>
>;

export interface LetterInsert {
  readonly receivedOn: string;
  readonly senderOrg: string;
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject: string;
  readonly kind: string;
  readonly urgency: string;
  readonly confidentiality: string;
  readonly dueOn?: string;
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
  /** Ghi `activated_at = now()`. */
  readonly activate?: boolean;
  readonly actedBy?: string | null;
  readonly decision?: LetterStep['decision'] | null;
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
  update(patch: LetterPatch): Promise<LetterRecord>;
  nextNumber(kind: 'outgoing' | 'archive', year: number): Promise<number>;
  /** Thay toàn bộ bước của công văn bằng các bước chép từ quy trình (lúc trình). */
  replaceSteps(steps: readonly WorkflowStep[]): Promise<void>;
  /** Ghi một bước; `actedBy` kèm `acted_at = now()`. */
  updateStep(stepId: string, update: StepUpdate): Promise<void>;
  assign(units: readonly { readonly unitId: string; readonly unitName: string }[]): Promise<void>;
  submitAssignment(assignmentId: string, input: { readonly note: string; readonly userId: string }): Promise<void>;
  reopenAssignments(assignmentIds: readonly string[], reason: string): Promise<void>;
  addAttachment(input: Omit<AttachmentRecord, 'id' | 'letterId' | 'createdAt' | 'sizeBytes'>): Promise<AttachmentRecord>;
  removeAttachment(attachmentId: string): Promise<void>;
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
  readonly highlight: boolean;
  readonly restricted: boolean;
}

export interface WorkflowUpsert {
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly isDefault: boolean;
  readonly steps: readonly WorkflowStep[];
}

export interface CorrespondenceStore {
  tablesReady(tenantId: string): Promise<boolean>;

  settings(tenantId: string): Promise<CorrespondenceSettings>;
  saveSettings(tenantId: string, userId: string, settings: CorrespondenceSettings): Promise<void>;

  catalog(tenantId: string): Promise<CatalogItem[]>;
  /** Thêm mới (`id` rỗng) hoặc sửa; trùng mã trong cùng loại thì ném lỗi kiểm tra. */
  saveCatalogItem(tenantId: string, userId: string, id: string | undefined, input: CatalogUpsert): Promise<CatalogItem>;
  /** Xoá mục chưa từng dùng; đã dùng thì `false`. */
  deleteCatalogItem(tenantId: string, id: string): Promise<boolean>;

  workflows(tenantId: string): Promise<Workflow[]>;
  /** Đặt `isDefault` thì bỏ cờ mặc định ở quy trình khác, cùng transaction. */
  saveWorkflow(tenantId: string, userId: string, id: string | undefined, input: WorkflowUpsert): Promise<Workflow>;
  /** Xoá quy trình chưa gắn công văn hay loại văn bản nào; đang dùng thì `false`. */
  deleteWorkflow(tenantId: string, id: string): Promise<boolean>;

  createLetter(
    tenantId: string,
    input: LetterInsert,
    incomingSuffix: string,
    after: (tx: LetterTransaction) => Promise<void>,
  ): Promise<LetterRecord>;

  /** Khoá công văn và chạy `work` trong một transaction; không có thì ném `LetterNotFoundError`. */
  withLetter<T>(tenantId: string, letterId: string, work: (tx: LetterTransaction) => Promise<T>): Promise<T>;

  findLetter(tenantId: string, letterId: string): Promise<LetterRecord | undefined>;
  listLetters(tenantId: string, filter: LetterListFilter): Promise<LetterListRow[]>;
  countArchived(tenantId: string, visibleTo?: LetterListFilter['visibleTo']): Promise<number>;
  steps(tenantId: string, letterId: string): Promise<StepRecord[]>;
  assignments(tenantId: string, letterId: string): Promise<AssignmentRecord[]>;
  attachments(tenantId: string, letterId: string): Promise<AttachmentRecord[]>;
  findAttachment(tenantId: string, attachmentId: string): Promise<AttachmentRecord | undefined>;
  completeAttachment(tenantId: string, attachmentId: string, sizeBytes: number): Promise<void>;
  history(tenantId: string, letterId: string): Promise<HistoryRecord[]>;

  /** Tên hiển thị của người dùng (bảng người dùng của tenant). */
  userNames(tenantId: string, userIds: readonly string[]): Promise<Map<string, string>>;
  /** Người dùng đang hoạt động của tenant, để chỉ định người duyệt. */
  people(tenantId: string): Promise<{ userId: string; name: string }[]>;
  /** Người được cấp đích danh quyền chỉ đạo (`correspondence.letter.direct`). */
  leaders(tenantId: string): Promise<{ userId: string; name: string }[]>;
}

export const CORRESPONDENCE_STORE = Symbol('CORRESPONDENCE_STORE');

/* --------------------------------------------------------------- kho tệp */

export interface FileStore {
  create(tenantId: string, input: Omit<SharedFilingDocumentRequest, 'module'>): Promise<SharedFilingDocumentResponse>;
  complete(tenantId: string, documentId: string, versionId: string, sizeBytes: number): Promise<void>;
  download(
    tenantId: string,
    documentId: string,
    userId: string,
    mode: AttachmentDownloadMode,
  ): Promise<AttachmentDownloadTicket>;
  trash(tenantId: string, documentId: string, userId: string): Promise<void>;
  updateFolder(tenantId: string, folderId: string, input: Omit<SharedFilingFolderUpdateRequest, 'module'>): Promise<void>;
}

export const FILE_STORE = Symbol('CORRESPONDENCE_FILE_STORE');

/** Kho tệp trả 404: thư mục hay tài liệu đã bị xoá bên Hệ dùng chung. */
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
