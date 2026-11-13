import type {
  AssignmentStatus,
  AttachmentDownloadMode,
  AttachmentDownloadTicket,
  AttachmentKind,
  CorrespondenceLeader,
  CorrespondenceSettings,
  LetterConfidentiality,
  LetterHistoryAction,
  LetterKind,
  LetterStage,
  LetterUrgency,
} from '@enterprise-platform/contracts-correspondence';
import type {
  SharedFilingDocumentRequest,
  SharedFilingDocumentResponse,
  SharedFilingFolderUpdateRequest,
} from '@enterprise-platform/contracts-shared';

/** Người gọi API, guard dựng từ quyết định truy cập của Platform. */
export interface CorrespondenceActor {
  readonly tenantId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly isTenantAdmin: boolean;
  /** `correspondence.letter.register`: việc của văn thư. */
  readonly canRegister: boolean;
  /** `correspondence.letter.direct`: lãnh đạo chỉ đạo, duyệt. */
  readonly canDirect: boolean;
  readonly canManage: boolean;
}

/** Văn thư, quản trị văn thư hay quản trị tenant: làm việc của văn thư và thấy mọi công văn. */
export function isClerk(actor: CorrespondenceActor): boolean {
  return actor.canRegister || actor.canManage || actor.isTenantAdmin;
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
  readonly kind: LetterKind;
  readonly urgency: LetterUrgency;
  readonly confidentiality: LetterConfidentiality;
  readonly dueOn?: string;
  readonly stage: LetterStage;
  readonly leaderUserId?: string;
  readonly instruction?: string;
  readonly approvalNote?: string;
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

/** Một dòng danh sách: công văn kèm phòng ban của nó (để tính quyền xem và "việc của tôi"). */
export interface LetterListRow extends LetterRecord {
  readonly assignments: readonly Pick<AssignmentRecord, 'unitId' | 'status' | 'submittedBy'>[];
}

export interface LetterListFilter {
  /** Bỏ trống là mọi công văn (văn thư); có thì chỉ công văn người này liên quan. */
  readonly visibleTo?: { readonly userId: string; readonly unitIds: readonly string[] };
  readonly stages?: readonly LetterStage[];
  readonly onlyPublished?: boolean;
  readonly search?: string;
  readonly limit: number;
}

/* ---------------------------------------------------------------- ghi */

export type LetterPatch = Partial<Omit<LetterRecord, 'id' | 'year' | 'seq' | 'incomingNo' | 'receivedBy' | 'createdAt' | 'updatedAt'>>;

export interface LetterInsert {
  readonly receivedOn: string;
  readonly senderOrg: string;
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject: string;
  readonly kind: LetterKind;
  readonly urgency: LetterUrgency;
  readonly confidentiality: LetterConfidentiality;
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
  /** Rỗng: hệ thống tự làm. */
  readonly actorUserId?: string;
}

/**
 * Một lượt ghi trên một công văn, trong một transaction và đã khoá dòng công văn
 * (`SELECT … FOR UPDATE`), nên hai người bấm cùng lúc không cùng chuyển bước.
 */
export interface LetterTransaction {
  readonly letter: LetterRecord;
  readonly assignments: readonly AssignmentRecord[];
  update(patch: LetterPatch): Promise<LetterRecord>;
  /** Số kế tiếp của bộ đếm theo năm. */
  nextNumber(kind: 'outgoing' | 'archive', year: number): Promise<number>;
  /** Thêm phòng ban mới, hoặc đưa phòng ban đã có về chờ phản hồi ở lượt mới. */
  assign(units: readonly { readonly unitId: string; readonly unitName: string }[]): Promise<void>;
  submitAssignment(assignmentId: string, input: { readonly note: string; readonly userId: string }): Promise<void>;
  reopenAssignments(assignmentIds: readonly string[], reason: string): Promise<void>;
  addAttachment(input: Omit<AttachmentRecord, 'id' | 'letterId' | 'createdAt' | 'sizeBytes'>): Promise<AttachmentRecord>;
  removeAttachment(attachmentId: string): Promise<void>;
  history(entry: HistoryInsert): Promise<void>;
  outbox(event: OutboxEvent): Promise<void>;
}

export interface CorrespondenceStore {
  tablesReady(tenantId: string): Promise<boolean>;

  settings(tenantId: string): Promise<CorrespondenceSettings>;
  saveSettings(tenantId: string, userId: string, settings: CorrespondenceSettings): Promise<void>;

  /** Vào sổ một công văn đến: cấp số đến theo năm rồi ghi dòng, một transaction. */
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
  assignments(tenantId: string, letterId: string): Promise<AssignmentRecord[]>;
  attachments(tenantId: string, letterId: string): Promise<AttachmentRecord[]>;
  findAttachment(tenantId: string, attachmentId: string): Promise<AttachmentRecord | undefined>;
  completeAttachment(tenantId: string, attachmentId: string, sizeBytes: number): Promise<void>;
  history(tenantId: string, letterId: string): Promise<HistoryRecord[]>;

  /** Tên hiển thị của người dùng (bảng người dùng của tenant). */
  userNames(tenantId: string, userIds: readonly string[]): Promise<Map<string, string>>;
  /** Người được cấp đích danh quyền chỉ đạo (`correspondence.letter.direct`), qua vai trò hay quyền bổ sung. */
  leaders(tenantId: string): Promise<CorrespondenceLeader[]>;
}

export const CORRESPONDENCE_STORE = Symbol('CORRESPONDENCE_STORE');

/* --------------------------------------------------------------- kho tệp */

/** Tệp của hồ sơ nằm ở kho tài liệu của Hệ dùng chung, qua route nội bộ `/v1/internal/filings/*`. */
export interface FileStore {
  create(tenantId: string, input: Omit<SharedFilingDocumentRequest, 'module'>): Promise<SharedFilingDocumentResponse>;
  complete(tenantId: string, documentId: string, versionId: string, sizeBytes: number): Promise<void>;
  download(
    tenantId: string,
    documentId: string,
    userId: string,
    mode: AttachmentDownloadMode,
  ): Promise<AttachmentDownloadTicket>;
  /** Vào Thùng rác của kho; tài liệu đã không còn thì bỏ qua. */
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

export interface OrganizationUnit {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  readonly kind: 'unit' | 'position';
}

export interface OrganizationSnapshot {
  readonly nodes: readonly OrganizationUnit[];
  readonly assignments: readonly { readonly userId: string; readonly nodeId: string }[];
  readonly degraded: boolean;
}

export interface OrganizationReader {
  snapshot(tenantId: string): Promise<OrganizationSnapshot>;
}

export const ORGANIZATION_READER = Symbol('CORRESPONDENCE_ORGANIZATION_READER');

/** Mọi node người dùng thuộc về: node được bổ nhiệm và mọi node cha của nó. */
export function membershipNodes(snapshot: OrganizationSnapshot, userId: string): Set<string> {
  const parentOf = new Map(snapshot.nodes.map((node) => [node.id, node.parentId]));
  const nodeIds = new Set<string>();
  for (const assignment of snapshot.assignments) {
    if (assignment.userId !== userId) continue;
    let current: string | undefined = assignment.nodeId;
    while (current && !nodeIds.has(current)) {
      nodeIds.add(current);
      current = parentOf.get(current);
    }
  }
  return nodeIds;
}
