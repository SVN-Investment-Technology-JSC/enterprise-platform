/**
 * Hợp đồng dữ liệu của phân hệ Văn thư: tiếp nhận công văn đến, trình duyệt theo
 * quy trình cấu hình được, giao phòng ban xử lý, duyệt văn bản phản hồi, phát hành
 * công văn đi và lưu trữ hồ sơ.
 *
 * Mọi danh mục (loại văn bản, độ khẩn, độ mật), quy trình duyệt và người duyệt ở
 * từng bước do tenant tự cấu hình; người duyệt và phòng ban lấy theo sơ đồ tổ chức
 * của Tenant Core. Luồng duyệt nằm trọn trong phân hệ, không đi qua Quy trình.
 * Tệp nằm trong kho tài liệu của Hệ dùng chung, thư mục "Văn thư / <năm> / Công
 * văn đến / <hồ sơ>"; phân hệ chỉ giữ id tài liệu bên đó.
 */

/** Mã phân hệ: khoá entitlement, tiền tố quyền, tên schema `correspondence_schema`. */
export const CORRESPONDENCE_MODULE_KEY = 'correspondence';
export const CORRESPONDENCE_LAUNCH_URL = '/modules/correspondence';
export const CORRESPONDENCE_API_ROOT = '/api/correspondence/v1';

/** Quyền của phân hệ; danh mục thật (nhãn hiển thị) nằm ở `TENANT_PERMISSION_ACTIONS`. */
export const CORRESPONDENCE_PERMISSIONS = [
  'correspondence.read',
  'correspondence.letter.read-all',
  'correspondence.letter.confidential',
  'correspondence.letter.register',
  'correspondence.letter.direct',
  'correspondence.letter.publish',
  'correspondence.letter.archive',
  'correspondence.config',
  'correspondence.manage',
] as const;
export type CorrespondencePermission = (typeof CORRESPONDENCE_PERMISSIONS)[number];

/* ------------------------------------------------------------ giai đoạn */

/**
 * Giai đoạn của một công văn đến.
 *
 * received → registered → (các bước duyệt của quy trình) → … `processing` sau bước
 * chỉ đạo … → publishing → closing → archived. `reviewing` là đang ở một bước
 * xem xét hay duyệt; `directing` là đang ở bước chỉ đạo, giao phòng ban.
 */
export const LETTER_STAGES = [
  'received',
  'registered',
  'reviewing',
  'directing',
  'processing',
  'publishing',
  'closing',
  'archived',
  'cancelled',
] as const;
export type LetterStage = (typeof LETTER_STAGES)[number];

export const LETTER_STAGE_LABELS: Readonly<Record<LetterStage, string>> = {
  received: 'Tiếp nhận',
  registered: 'Chờ trình',
  reviewing: 'Đang duyệt',
  directing: 'Chờ chỉ đạo',
  processing: 'Phòng ban xử lý',
  publishing: 'Chờ phát hành',
  closing: 'Chờ lưu trữ',
  archived: 'Đã lưu trữ',
  cancelled: 'Đã huỷ',
};

/** Công văn còn đang chạy trên luồng (chưa lưu trữ, chưa huỷ). */
export const OPEN_LETTER_STAGES: readonly LetterStage[] = [
  'received',
  'registered',
  'reviewing',
  'directing',
  'processing',
  'publishing',
  'closing',
];

export function isOpenStage(stage: LetterStage): boolean {
  return OPEN_LETTER_STAGES.includes(stage);
}

/* ------------------------------------------------------------- danh mục */

/**
 * Danh mục tenant tự cấu hình. Công văn giữ `code`; mục ngừng dùng vẫn hiện tên ở công
 * văn cũ nhưng không chọn được nữa. Mục đã dùng thì không xoá, chỉ ngừng dùng.
 */
export const CATALOG_KINDS = ['letter_type', 'urgency', 'confidentiality'] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export const CATALOG_KIND_LABELS: Readonly<Record<CatalogKind, string>> = {
  letter_type: 'Loại văn bản',
  urgency: 'Độ khẩn',
  confidentiality: 'Độ mật',
};

export interface CatalogItem {
  readonly id: string;
  readonly kind: CatalogKind;
  /** Mã ổn định, chữ thường, số, gạch ngang. */
  readonly code: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
  /** Loại văn bản: hạn xử lý mặc định (ngày) khi tiếp nhận; trống là theo cấu hình sổ. */
  readonly defaultDueDays?: number;
  /** Loại văn bản: quy trình duyệt mặc định khi trình. */
  readonly workflowId?: string;
  /** Độ khẩn: tô đỏ trong danh sách. */
  readonly highlight?: boolean;
  /** Độ mật: chỉ người liên quan và người có quyền xem công văn mật mới thấy. */
  readonly restricted?: boolean;
  /** Đang có công văn dùng mục này. */
  readonly inUse?: boolean;
}

export interface SaveCatalogItemRequest {
  readonly kind: CatalogKind;
  readonly code: string;
  readonly name: string;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
  readonly defaultDueDays?: number | null;
  readonly workflowId?: string | null;
  readonly highlight?: boolean;
  readonly restricted?: boolean;
}

/* --------------------------------------------------------- quy trình duyệt */

/**
 * Ai duyệt một bước, theo sơ đồ tổ chức:
 *
 * - `choose`: người trình (hoặc người duyệt bước trước) chọn một người trong nhóm:
 *   người có quyền chỉ đạo (`leaders`), người giữ các chức danh, người thuộc các phòng ban;
 * - `users`: một trong những người được chỉ định;
 * - `positions`: người đang giữ một trong các chức danh;
 * - `unit_heads`: trưởng các đơn vị (đơn vị chưa có trưởng thì lên đơn vị cha);
 * - `assigned_unit_heads`: trưởng các phòng ban được giao xử lý (chỉ dùng sau bước chỉ đạo);
 * - `director`: chính người đã chỉ đạo (chỉ dùng sau bước chỉ đạo).
 */
export type ApproverRule =
  | { readonly type: 'choose'; readonly pool: 'leaders' | 'positions' | 'units'; readonly ids?: readonly string[] }
  | { readonly type: 'users'; readonly userIds: readonly string[] }
  | { readonly type: 'positions'; readonly positionIds: readonly string[] }
  | { readonly type: 'unit_heads'; readonly unitIds: readonly string[] }
  | { readonly type: 'assigned_unit_heads' }
  | { readonly type: 'director' };

export type ApproverRuleType = ApproverRule['type'];

export const APPROVER_RULE_LABELS: Readonly<Record<ApproverRuleType, string>> = {
  choose: 'Người trình chọn trong một nhóm',
  users: 'Người được chỉ định',
  positions: 'Người giữ chức danh',
  unit_heads: 'Trưởng đơn vị',
  assigned_unit_heads: 'Trưởng các phòng ban được giao xử lý',
  director: 'Người đã chỉ đạo',
};

/**
 * Một bước của quy trình. `direct` là bước chỉ đạo, giao phòng ban (đúng một bước);
 * `approve` trước bước chỉ đạo là xem xét rồi chuyển tiếp, sau bước chỉ đạo là duyệt
 * văn bản phản hồi của phòng ban.
 */
export interface WorkflowStep {
  readonly key: string;
  readonly name: string;
  readonly kind: 'direct' | 'approve';
  readonly approver: ApproverRule;
  /** Số ngày cho bước này, để nhắc hạn; trống là theo hạn của công văn. */
  readonly dueDays?: number;
}

export interface Workflow {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly isActive: boolean;
  /** Dùng khi loại văn bản chưa gắn quy trình. */
  readonly isDefault: boolean;
  readonly steps: readonly WorkflowStep[];
  readonly updatedAt: string;
}

export interface SaveWorkflowRequest {
  readonly name: string;
  readonly description?: string;
  readonly isActive?: boolean;
  readonly isDefault?: boolean;
  readonly steps: readonly WorkflowStep[];
}

export const MAX_WORKFLOW_STEPS = 10;

/* ------------------------------------------------------------- bước thật */

export const LETTER_STEP_STATUSES = ['waiting', 'active', 'done', 'skipped'] as const;
export type LetterStepStatus = (typeof LETTER_STEP_STATUSES)[number];

/** Một bước của quy trình trên một công văn cụ thể (chép từ quy trình lúc trình). */
export interface LetterStep {
  readonly id: string;
  readonly seq: number;
  readonly name: string;
  readonly kind: 'direct' | 'approve';
  readonly approver: ApproverRule;
  readonly status: LetterStepStatus;
  /** Người được giao bước, đã giải theo sơ đồ tổ chức lúc bước bắt đầu. */
  readonly assignees: readonly { readonly userId: string; readonly name?: string }[];
  readonly actedBy?: string;
  readonly actedByName?: string;
  readonly actedAt?: string;
  readonly decision?: 'approved' | 'directed' | 'closed' | 'returned' | 'revision';
  readonly note?: string;
}

/** Ô trên thanh tiến trình. */
export interface FlowNode {
  readonly label: string;
  readonly state: 'done' | 'current' | 'todo';
}

/* ------------------------------------------------------------- tệp */

/**
 * Loại tệp của hồ sơ: bản quét công văn đến (văn thư), dự thảo phản hồi (phòng
 * ban), bản phát hành đã ký (văn thư), tài liệu tham khảo khác.
 */
export const ATTACHMENT_KINDS = ['incoming', 'draft', 'outgoing', 'reference'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABELS: Readonly<Record<AttachmentKind, string>> = {
  incoming: 'Công văn đến',
  draft: 'Dự thảo phản hồi',
  outgoing: 'Bản phát hành',
  reference: 'Tài liệu kèm theo',
};

/** Một tệp tối đa 50 MB: công văn là bản quét PDF, không phải bản vẽ hay video. */
export const CORRESPONDENCE_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

export interface LetterAttachment {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly assignmentId?: string;
  readonly fileName: string;
  readonly contentType: string;
  /** Rỗng là chưa tải lên xong. */
  readonly sizeBytes?: number;
  readonly uploadedBy: string;
  readonly uploadedByName?: string;
  readonly createdAt: string;
  readonly canDelete: boolean;
}

/* ------------------------------------------------------------- phòng ban */

export const ASSIGNMENT_STATUSES = ['pending', 'submitted'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export interface LetterAssignment {
  readonly id: string;
  /** Node đơn vị trong sơ đồ tổ chức của Tenant Core. */
  readonly unitId: string;
  readonly unitName: string;
  /** Lượt giao: tăng mỗi lần yêu cầu sửa dự thảo. */
  readonly round: number;
  readonly status: AssignmentStatus;
  readonly responseNote?: string;
  readonly submittedBy?: string;
  readonly submittedByName?: string;
  readonly submittedAt?: string;
  readonly revisionReason?: string;
  /** Trưởng đơn vị theo sơ đồ tổ chức hiện tại. */
  readonly headNames: readonly string[];
  readonly canRespond: boolean;
}

/* ------------------------------------------------------------- nhật ký */

export const LETTER_HISTORY_ACTIONS = [
  'receive',
  'update',
  'classify',
  'submit',
  'approve',
  'return',
  'direct',
  'close-for-info',
  'respond',
  'review-requested',
  'request-revision',
  'publish',
  'archive',
  'cancel',
  'attach',
  'detach',
] as const;
export type LetterHistoryAction = (typeof LETTER_HISTORY_ACTIONS)[number];

export interface LetterHistoryEntry {
  readonly id: string;
  readonly action: LetterHistoryAction;
  readonly summary: string;
  readonly note?: string;
  /** Rỗng khi hệ thống tự làm. */
  readonly actorUserId?: string;
  readonly actorName?: string;
  readonly at: string;
}

/* ------------------------------------------------------------- công văn */

export interface LetterSummary {
  readonly id: string;
  /** Số đến, ví dụ "41/CVĐ". */
  readonly incomingNo: string;
  readonly receivedOn: string;
  readonly senderOrg: string;
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject: string;
  /** Mã trong danh mục loại văn bản, độ khẩn, độ mật. */
  readonly kind: string;
  readonly kindName: string;
  readonly urgency: string;
  readonly urgencyName: string;
  readonly urgencyHighlight: boolean;
  readonly confidentiality: string;
  readonly confidentialityName: string;
  readonly restricted: boolean;
  /** Hạn xử lý, `YYYY-MM-DD`. */
  readonly dueOn?: string;
  readonly stage: LetterStage;
  /** Tên bước đang chạy của quy trình (khi đang duyệt hay chỉ đạo). */
  readonly currentStepName?: string;
  /** Người đang giữ bước hiện tại. */
  readonly currentAssigneeNames: readonly string[];
  readonly assignmentsDone: number;
  readonly assignmentsTotal: number;
  readonly outgoingNo?: string;
  readonly publishedOn?: string;
  readonly recipient?: string;
  readonly archiveCode?: string;
  readonly archivedOn?: string;
  readonly receivedBy: string;
  readonly receivedByName?: string;
  readonly updatedAt: string;
  /** Người đang xem có việc phải làm ở bước hiện tại. */
  readonly awaitingMe: boolean;
}

export interface LetterDetail extends LetterSummary {
  readonly workflowId?: string;
  readonly workflowName?: string;
  readonly instruction?: string;
  readonly cancelReason?: string;
  readonly sharedFolderId?: string;
  readonly steps: readonly LetterStep[];
  readonly flow: readonly FlowNode[];
  readonly assignments: readonly LetterAssignment[];
  readonly attachments: readonly LetterAttachment[];
  readonly history: readonly LetterHistoryEntry[];
  readonly actions: LetterActions;
}

/** Thao tác người xem làm được ở bước hiện tại; quyền thật vẫn kiểm ở API. */
export interface LetterActions {
  readonly edit: boolean;
  readonly classify: boolean;
  readonly submit: boolean;
  /** Bước xem xét hay duyệt đang chờ người xem. */
  readonly approve: boolean;
  /** Trả về văn thư (từ bước xem xét trước khi chỉ đạo, hoặc bước chỉ đạo). */
  readonly returnToClerk: boolean;
  readonly direct: boolean;
  readonly closeForInfo: boolean;
  /** Bước duyệt sau chỉ đạo: trả phòng ban sửa dự thảo. */
  readonly requestRevision: boolean;
  readonly publish: boolean;
  readonly archive: boolean;
  readonly cancel: boolean;
  readonly attachKinds: readonly AttachmentKind[];
}

/** Ứng viên cho bước kế tiếp khi bước đó để người thao tác chọn người duyệt. */
export interface StepChoice {
  readonly stepName: string;
  readonly candidates: readonly { readonly userId: string; readonly name: string; readonly detail?: string }[];
}

/* -------------------------------------------------------------- yêu cầu */

export interface CreateLetterRequest {
  readonly senderOrg: string;
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject: string;
  readonly receivedOn?: string;
  readonly dueOn?: string;
  readonly kind?: string;
  readonly urgency?: string;
  readonly confidentiality?: string;
}

export type UpdateLetterRequest = Partial<CreateLetterRequest>;

export interface ClassifyLetterRequest {
  readonly kind: string;
  readonly urgency: string;
  readonly confidentiality?: string;
}

export interface SubmitLetterRequest {
  /** Bỏ trống là quy trình mặc định của loại văn bản (hoặc của tenant). */
  readonly workflowId?: string;
  /** Bắt buộc khi bước đầu để người trình chọn người duyệt. */
  readonly assigneeUserId?: string;
  readonly note?: string;
}

export interface ApproveStepRequest {
  readonly note?: string;
  /** Bắt buộc khi bước kế tiếp để người thao tác chọn người duyệt. */
  readonly nextAssigneeUserId?: string;
}

export interface DirectLetterRequest {
  readonly unitIds: readonly string[];
  readonly instruction: string;
  readonly dueOn?: string;
  /** Bắt buộc khi bước duyệt sau xử lý để người chỉ đạo chọn người duyệt. */
  readonly nextAssigneeUserId?: string;
}

export interface NoteRequest {
  readonly note?: string;
}

export interface ReasonRequest {
  readonly reason: string;
}

export interface RespondAssignmentRequest {
  readonly note: string;
}

export interface RequestRevisionRequest {
  readonly reason: string;
  readonly assignmentIds?: readonly string[];
}

export interface PublishLetterRequest {
  readonly recipient: string;
  readonly publishedOn?: string;
}

export interface CreateAttachmentRequest {
  readonly kind: AttachmentKind;
  readonly assignmentId?: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface AttachmentUploadTicket {
  readonly attachment: LetterAttachment;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
}

export interface CompleteAttachmentRequest {
  readonly sizeBytes: number;
}

export type AttachmentDownloadMode = 'download' | 'preview';

export interface AttachmentDownloadTicket {
  readonly downloadUrl: string;
  readonly expiresInSeconds: number;
  readonly fileName: string;
  readonly contentType: string;
}

export const LETTER_BOXES = ['all', 'mine', 'outgoing', 'archive'] as const;
export type LetterBox = (typeof LETTER_BOXES)[number];

export interface LetterQuery {
  readonly box?: LetterBox;
  readonly stage?: LetterStage;
  readonly search?: string;
}

/* ------------------------------------------------------------ tổng quan */

export interface CorrespondenceOverview {
  readonly open: number;
  readonly awaitingApproval: number;
  readonly overdue: number;
  readonly archived: number;
  readonly awaitingMe: number;
  readonly byStage: Readonly<Partial<Record<LetterStage, number>>>;
  readonly urgent: readonly LetterSummary[];
}

/* -------------------------------------------------------- sơ đồ tổ chức */

export interface DirectoryMember {
  readonly userId: string;
  readonly name: string;
  readonly positionName?: string;
  readonly isHead: boolean;
}

export interface DirectoryUnit {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  /** "Công ty › Khối kinh doanh": các đơn vị cha. */
  readonly path: string;
  /** Người thuộc đơn vị (kể cả đơn vị con), trưởng đơn vị đứng đầu. */
  readonly members: readonly DirectoryMember[];
}

export interface DirectoryPosition {
  readonly id: string;
  readonly name: string;
  readonly unitName?: string;
  readonly holderNames: readonly string[];
}

export interface CorrespondenceDirectory {
  readonly units: readonly DirectoryUnit[];
  readonly positions: readonly DirectoryPosition[];
  /** Người dùng của tenant, để chỉ định người duyệt. */
  readonly people: readonly { readonly userId: string; readonly name: string }[];
  /** Người có quyền chỉ đạo (`correspondence.letter.direct`). */
  readonly leaders: readonly { readonly userId: string; readonly name: string }[];
  /** Không đọc được sơ đồ tổ chức. */
  readonly degraded: boolean;
}

/* ------------------------------------------------------------- cấu hình */

export interface CorrespondenceSettings {
  readonly incomingSuffix: string;
  readonly outgoingSuffix: string;
  readonly archivePrefix: string;
  /** Hạn xử lý mặc định khi tiếp nhận (ngày), khi loại văn bản không đặt riêng. */
  readonly defaultDueDays: number;
}

export const DEFAULT_CORRESPONDENCE_SETTINGS: CorrespondenceSettings = {
  incomingSuffix: 'CVĐ',
  outgoingSuffix: 'CV',
  archivePrefix: 'HS',
  defaultDueDays: 7,
};

/** Cấu hình động gửi cho giao diện một lần: danh mục và quy trình. */
export interface CorrespondenceConfig {
  readonly settings: CorrespondenceSettings;
  readonly catalog: readonly CatalogItem[];
  readonly workflows: readonly Workflow[];
}

/* ------------------------------------------------------------ trạng thái */

export interface CorrespondenceCapabilities {
  readonly isTenantAdmin: boolean;
  readonly canRegister: boolean;
  readonly canPublish: boolean;
  readonly canArchive: boolean;
  readonly canDirect: boolean;
  readonly canReadAll: boolean;
  readonly canReadConfidential: boolean;
  readonly canConfigure: boolean;
}

export interface CorrespondenceStatus {
  readonly tenantId: string;
  readonly userId: string;
  readonly tablesReady: boolean;
  readonly capabilities: CorrespondenceCapabilities;
}

/* --------------------------------------------------------------- sự kiện */

export const CORRESPONDENCE_EVENTS = {
  stepAssigned: 'correspondence.letter.step-assigned',
  returned: 'correspondence.letter.returned',
  assigned: 'correspondence.letter.assigned',
  revisionRequested: 'correspondence.letter.revision-requested',
  approved: 'correspondence.letter.approved',
  archiveRequested: 'correspondence.letter.archive-requested',
  published: 'correspondence.letter.published',
  archived: 'correspondence.letter.archived',
  dueSoon: 'correspondence.letter.due-soon',
  overdue: 'correspondence.letter.overdue',
} as const;
export type CorrespondenceEventType = (typeof CORRESPONDENCE_EVENTS)[keyof typeof CORRESPONDENCE_EVENTS];

export function letterDeepLink(letterId: string): string {
  return `${CORRESPONDENCE_LAUNCH_URL}#letters/${encodeURIComponent(letterId)}`;
}

export function letterTitle(letter: { readonly incomingNo: string; readonly subject: string }): string {
  return `${letter.incomingNo} · ${letter.subject}`;
}

/** Số ngày còn lại tới hạn so với `today` (`YYYY-MM-DD`); âm là đã quá hạn. */
export function daysUntil(dueOn: string, today: string): number {
  const due = Date.parse(`${dueOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return Math.round((due - now) / 86_400_000);
}

/** Mã danh mục hợp lệ: chữ thường không dấu, số, gạch ngang, gạch dưới. */
export const CATALOG_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
