/**
 * Hợp đồng dữ liệu của phân hệ Văn thư: tiếp nhận công văn đến, trình lãnh đạo
 * chỉ đạo, giao phòng ban xử lý, duyệt văn bản phản hồi, phát hành công văn đi
 * và lưu trữ hồ sơ.
 *
 * Luồng duyệt nằm trọn trong phân hệ, không đi qua Quy trình. Tệp (bản quét
 * công văn đến, dự thảo phản hồi, bản phát hành đã ký) không lưu ở đây mà nằm
 * trong kho tài liệu của Hệ dùng chung, thư mục "Văn thư / <năm> / Công văn đến /
 * <hồ sơ>"; phân hệ chỉ giữ id tài liệu bên đó.
 */

/** Mã phân hệ: khoá entitlement, tiền tố quyền, tên schema `correspondence_schema`. */
export const CORRESPONDENCE_MODULE_KEY = 'correspondence';
export const CORRESPONDENCE_LAUNCH_URL = '/modules/correspondence';
export const CORRESPONDENCE_API_ROOT = '/api/correspondence/v1';

/** Quyền của phân hệ; danh mục thật nằm ở `TENANT_PERMISSION_ACTIONS`. */
export const CORRESPONDENCE_PERMISSIONS = [
  'correspondence.read',
  'correspondence.letter.register',
  'correspondence.letter.direct',
  'correspondence.manage',
] as const;
export type CorrespondencePermission = (typeof CORRESPONDENCE_PERMISSIONS)[number];

/* ------------------------------------------------------------ giai đoạn */

/**
 * Giai đoạn của một công văn đến.
 *
 * received → registered → directing → processing → reviewing → publishing →
 * closing → archived. Lãnh đạo có thể cho "lưu để biết" ngay ở bước chỉ đạo
 * (directing → closing), trả lại văn thư (directing → registered) hoặc yêu
 * cầu sửa dự thảo (reviewing → processing). Văn thư huỷ được công văn chưa trình.
 */
export const LETTER_STAGES = [
  'received',
  'registered',
  'directing',
  'processing',
  'reviewing',
  'publishing',
  'closing',
  'archived',
  'cancelled',
] as const;
export type LetterStage = (typeof LETTER_STAGES)[number];

export const LETTER_STAGE_LABELS: Readonly<Record<LetterStage, string>> = {
  received: 'Tiếp nhận',
  registered: 'Đã phân loại',
  directing: 'Lãnh đạo chỉ đạo',
  processing: 'Phòng ban xử lý',
  reviewing: 'Trình lại lãnh đạo',
  publishing: 'Phát hành',
  closing: 'Chờ lưu trữ',
  archived: 'Đã lưu trữ',
  cancelled: 'Đã huỷ',
};

/** Bảy bước hiện trên thanh tiến trình; `archived` là đã qua hết, `cancelled` không nằm trên thanh. */
export const LETTER_FLOW_STAGES: readonly LetterStage[] = [
  'received',
  'registered',
  'directing',
  'processing',
  'reviewing',
  'publishing',
  'closing',
];

export const LETTER_FLOW_LABELS: readonly string[] = [
  'Tiếp nhận',
  'Phân loại',
  'Lãnh đạo chỉ đạo',
  'Phòng ban xử lý',
  'Trình lại lãnh đạo',
  'Phát hành',
  'Lưu trữ',
];

/** Công văn còn đang chạy trên luồng (chưa lưu trữ, chưa huỷ). */
export const OPEN_LETTER_STAGES: readonly LetterStage[] = LETTER_FLOW_STAGES;

export function isOpenStage(stage: LetterStage): boolean {
  return OPEN_LETTER_STAGES.includes(stage);
}

/** Vị trí của giai đoạn trên thanh tiến trình; lưu trữ xong là qua hết, huỷ là -1. */
export function stageIndex(stage: LetterStage): number {
  if (stage === 'archived') return LETTER_FLOW_STAGES.length;
  return LETTER_FLOW_STAGES.indexOf(stage);
}

/* ------------------------------------------------------------- phân loại */

export const LETTER_KINDS = ['directive', 'commercial', 'finance', 'technical', 'legal', 'other'] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

export const LETTER_KIND_LABELS: Readonly<Record<LetterKind, string>> = {
  directive: 'Chỉ đạo – điều hành',
  commercial: 'Hợp đồng – thương mại',
  finance: 'Tài chính – thuế',
  technical: 'Kỹ thuật – dự án',
  legal: 'Pháp lý',
  other: 'Khác',
};

export const LETTER_URGENCIES = ['normal', 'urgent', 'flash'] as const;
export type LetterUrgency = (typeof LETTER_URGENCIES)[number];

export const LETTER_URGENCY_LABELS: Readonly<Record<LetterUrgency, string>> = {
  normal: 'Thường',
  urgent: 'Khẩn',
  flash: 'Hỏa tốc',
};

/** Độ mật: "Mật" chỉ người liên quan và văn thư thấy, và đi theo sang Hệ dùng chung. */
export const LETTER_CONFIDENTIALITIES = ['normal', 'confidential'] as const;
export type LetterConfidentiality = (typeof LETTER_CONFIDENTIALITIES)[number];

export const LETTER_CONFIDENTIALITY_LABELS: Readonly<Record<LetterConfidentiality, string>> = {
  normal: 'Thường',
  confidential: 'Mật',
};

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
  /** Người xem được xoá tệp này không (người tải lên, khi bước còn mở). */
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
  /** Lượt giao: tăng mỗi lần lãnh đạo yêu cầu sửa dự thảo. */
  readonly round: number;
  readonly status: AssignmentStatus;
  readonly responseNote?: string;
  readonly submittedBy?: string;
  readonly submittedByName?: string;
  readonly submittedAt?: string;
  /** Lý do lãnh đạo trả lại ở lượt trước, nếu có. */
  readonly revisionReason?: string;
  /** Người xem thuộc phòng ban này (hoặc là văn thư) nên gửi phản hồi được. */
  readonly canRespond: boolean;
}

/* ------------------------------------------------------------- nhật ký */

export const LETTER_HISTORY_ACTIONS = [
  'receive',
  'update',
  'classify',
  'submit',
  'return',
  'direct',
  'close-for-info',
  'respond',
  'review-requested',
  'approve',
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
  /** Rỗng khi hệ thống tự làm (ví dụ tự trình lại khi đủ phản hồi). */
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
  /** Số, ký hiệu văn bản của nơi gửi. */
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject: string;
  readonly kind: LetterKind;
  readonly urgency: LetterUrgency;
  readonly confidentiality: LetterConfidentiality;
  /** Hạn xử lý, `YYYY-MM-DD`. */
  readonly dueOn?: string;
  readonly stage: LetterStage;
  readonly leaderUserId?: string;
  readonly leaderName?: string;
  /** Phòng ban đã gửi phản hồi / tổng số phòng ban của lượt hiện tại. */
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
  readonly instruction?: string;
  readonly approvalNote?: string;
  readonly cancelReason?: string;
  /** Thư mục hồ sơ bên Hệ dùng chung, có sau lần tải tệp đầu tiên. */
  readonly sharedFolderId?: string;
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
  readonly direct: boolean;
  readonly returnToClerk: boolean;
  readonly closeForInfo: boolean;
  readonly approve: boolean;
  readonly requestRevision: boolean;
  readonly publish: boolean;
  readonly archive: boolean;
  readonly cancel: boolean;
  /** Loại tệp người xem tải lên được lúc này. */
  readonly attachKinds: readonly AttachmentKind[];
}

/* -------------------------------------------------------------- yêu cầu */

export interface CreateLetterRequest {
  readonly senderOrg: string;
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject: string;
  readonly receivedOn?: string;
  readonly dueOn?: string;
  readonly kind?: LetterKind;
  readonly urgency?: LetterUrgency;
  readonly confidentiality?: LetterConfidentiality;
}

export type UpdateLetterRequest = Partial<CreateLetterRequest>;

export interface ClassifyLetterRequest {
  readonly kind: LetterKind;
  readonly urgency: LetterUrgency;
  readonly confidentiality?: LetterConfidentiality;
}

export interface SubmitLetterRequest {
  readonly leaderUserId: string;
  readonly note?: string;
}

export interface DirectLetterRequest {
  readonly unitIds: readonly string[];
  readonly instruction: string;
  /** Đổi hạn xử lý khi giao; bỏ trống là giữ hạn cũ. */
  readonly dueOn?: string;
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
  /** Phòng ban phải sửa; bỏ trống là mọi phòng ban của lượt hiện tại. */
  readonly assignmentIds?: readonly string[];
}

export interface PublishLetterRequest {
  readonly recipient: string;
  readonly publishedOn?: string;
}

export interface CreateAttachmentRequest {
  readonly kind: AttachmentKind;
  /** Bắt buộc với dự thảo: phòng ban nộp. */
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

/** Hộp thư nào: tất cả (văn thư), việc của tôi, đã phát hành, đã lưu trữ. */
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
  readonly awaitingLeader: number;
  readonly overdue: number;
  readonly archived: number;
  readonly awaitingMe: number;
  /** Số công văn ở từng bước của thanh tiến trình. */
  readonly byStage: Readonly<Partial<Record<LetterStage, number>>>;
  /** Công văn còn mở, hạn gần nhất trước. */
  readonly urgent: readonly LetterSummary[];
}

/* ------------------------------------------------------------- danh bạ */

export interface CorrespondenceLeader {
  readonly userId: string;
  readonly name: string;
}

export interface CorrespondenceUnit {
  readonly id: string;
  readonly name: string;
  /** "Công ty › Khối kinh doanh": các đơn vị cha. */
  readonly path: string;
}

export interface CorrespondenceDirectory {
  /** Người giữ quyền `correspondence.letter.direct`. */
  readonly leaders: readonly CorrespondenceLeader[];
  readonly units: readonly CorrespondenceUnit[];
  /** Không đọc được sơ đồ tổ chức. */
  readonly degraded: boolean;
}

/* ------------------------------------------------------------- cấu hình */

export interface CorrespondenceSettings {
  /** Hậu tố số đến: "41/CVĐ". */
  readonly incomingSuffix: string;
  /** Hậu tố số đi: "198/CV-ĐDX". */
  readonly outgoingSuffix: string;
  /** Tiền tố số hồ sơ lưu trữ: "HS-2026-0391". */
  readonly archivePrefix: string;
  /** Hạn xử lý mặc định khi tiếp nhận, số ngày. */
  readonly defaultDueDays: number;
}

export const DEFAULT_CORRESPONDENCE_SETTINGS: CorrespondenceSettings = {
  incomingSuffix: 'CVĐ',
  outgoingSuffix: 'CV',
  archivePrefix: 'HS',
  defaultDueDays: 7,
};

/* ------------------------------------------------------------ trạng thái */

export interface CorrespondenceCapabilities {
  readonly isTenantAdmin: boolean;
  /** Văn thư: tiếp nhận, phân loại, trình, phát hành, lưu trữ; thấy mọi công văn. */
  readonly canRegister: boolean;
  /** Lãnh đạo: được chọn để chỉ đạo, duyệt. */
  readonly canDirect: boolean;
  readonly canManage: boolean;
}

export interface CorrespondenceStatus {
  readonly tenantId: string;
  readonly userId: string;
  readonly tablesReady: boolean;
  readonly capabilities: CorrespondenceCapabilities;
  readonly settings: CorrespondenceSettings;
}

/* --------------------------------------------------------------- sự kiện */

/**
 * Loại sự kiện của phân hệ (qua outbox). Sự kiện dẫn tới thông báo có
 * `recipientUserIds`, `summary`, `deepLink`; giao phòng ban có thêm
 * `assignments` để notification-worker giải ra người phụ trách đơn vị.
 */
export const CORRESPONDENCE_EVENTS = {
  submitted: 'correspondence.letter.submitted',
  returned: 'correspondence.letter.returned',
  assigned: 'correspondence.letter.assigned',
  reviewRequested: 'correspondence.letter.review-requested',
  revisionRequested: 'correspondence.letter.revision-requested',
  approved: 'correspondence.letter.approved',
  archiveRequested: 'correspondence.letter.archive-requested',
  published: 'correspondence.letter.published',
  archived: 'correspondence.letter.archived',
  dueSoon: 'correspondence.letter.due-soon',
  overdue: 'correspondence.letter.overdue',
} as const;
export type CorrespondenceEventType = (typeof CORRESPONDENCE_EVENTS)[keyof typeof CORRESPONDENCE_EVENTS];

/** Liên kết mở thẳng ngăn chi tiết của một công văn. */
export function letterDeepLink(letterId: string): string {
  return `${CORRESPONDENCE_LAUNCH_URL}#letters/${encodeURIComponent(letterId)}`;
}

/** Nhãn "41/CVĐ · Trích yếu" dùng trong thông báo. */
export function letterTitle(letter: { readonly incomingNo: string; readonly subject: string }): string {
  return `${letter.incomingNo} · ${letter.subject}`;
}

/** Số ngày còn lại tới hạn so với `today` (`YYYY-MM-DD`); âm là đã quá hạn. */
export function daysUntil(dueOn: string, today: string): number {
  const due = Date.parse(`${dueOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return Math.round((due - now) / 86_400_000);
}
