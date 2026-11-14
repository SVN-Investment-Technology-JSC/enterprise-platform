/**
 * Hợp đồng dữ liệu của phân hệ Văn thư, hai luồng:
 *
 * - Công văn đến: văn thư tiếp nhận, phân loại, chọn phòng ban xử lý → phòng ban phân công
 *   người xử lý, chuẩn bị nội dung → lãnh đạo xem xét theo quy trình cấu hình (nhiều cấp)
 *   → văn thư hoàn tất → lưu trữ, tra cứu.
 * - Công văn đi: phòng ban soạn thảo → văn thư kiểm tra thể thức → trình duyệt theo quy
 *   trình cấu hình → văn thư đánh số, ban hành, gửi đi → lưu trữ, theo dõi tình trạng gửi.
 *
 * Ở mọi bước, người đang giữ bước trả lại được bước trước kèm lý do; trao đổi theo từng bước
 * ghi ngay trên công văn. Danh mục, quy trình, người duyệt do tenant cấu hình và lấy theo sơ
 * đồ tổ chức. Tệp nằm trong kho tài liệu của Hệ dùng chung.
 */

export const CORRESPONDENCE_MODULE_KEY = 'correspondence';
export const CORRESPONDENCE_LAUNCH_URL = '/modules/correspondence';
export const CORRESPONDENCE_API_ROOT = '/api/correspondence/v1';

/** Quyền của phân hệ; nhãn hiển thị nằm ở `TENANT_PERMISSION_ACTIONS`. */
export const CORRESPONDENCE_PERMISSIONS = [
  'correspondence.read',
  'correspondence.letter.read-all',
  'correspondence.letter.confidential',
  'correspondence.letter.register',
  'correspondence.outgoing.create',
  'correspondence.letter.direct',
  'correspondence.letter.publish',
  'correspondence.letter.archive',
  'correspondence.report.read',
  'correspondence.config',
  'correspondence.manage',
] as const;
export type CorrespondencePermission = (typeof CORRESPONDENCE_PERMISSIONS)[number];

/* ------------------------------------------------------------- luồng */

export const LETTER_DIRECTIONS = ['incoming', 'outgoing'] as const;
export type LetterDirection = (typeof LETTER_DIRECTIONS)[number];

export const LETTER_DIRECTION_LABELS: Readonly<Record<LetterDirection, string>> = {
  incoming: 'Công văn đến',
  outgoing: 'Công văn đi',
};

/**
 * Giai đoạn. Công văn đến: received → processing → reviewing → closing → archived.
 * Công văn đi: drafting → checking → reviewing → publishing → archived. `reviewing` là đang ở
 * một bước duyệt của quy trình (không có bước nào thì bỏ qua).
 */
export const LETTER_STAGES = [
  'received',
  'processing',
  'drafting',
  'checking',
  'reviewing',
  'closing',
  'publishing',
  'archived',
  'revoking',
  'cancelled',
] as const;
export type LetterStage = (typeof LETTER_STAGES)[number];

export const LETTER_STAGE_LABELS: Readonly<Record<LetterStage, string>> = {
  received: 'Văn thư tiếp nhận',
  processing: 'Phòng ban xử lý',
  drafting: 'Đang soạn thảo',
  checking: 'Văn thư kiểm tra',
  reviewing: 'Đang trình duyệt',
  closing: 'Chờ hoàn tất',
  publishing: 'Chờ ban hành',
  archived: 'Đã lưu trữ',
  revoking: 'Chờ duyệt huỷ',
  cancelled: 'Đã huỷ',
};

/**
 * Huỷ công văn đã ban hành (đi) hay đã hoàn tất (đến): văn thư đề nghị thu hồi, hoặc sửa đổi,
 * thay thế bằng văn bản khác; người có thẩm quyền ở bước duyệt cuối xác nhận.
 */
export const REVOKE_KINDS = ['recall', 'amend'] as const;
export type RevokeKind = (typeof REVOKE_KINDS)[number];

export const REVOKE_KIND_LABELS: Readonly<Record<RevokeKind, string>> = {
  recall: 'Thu hồi',
  amend: 'Sửa đổi, thay thế',
};

export const OPEN_LETTER_STAGES: readonly LetterStage[] = [
  'received',
  'processing',
  'drafting',
  'checking',
  'reviewing',
  'closing',
  'publishing',
];

/** Các giai đoạn còn mở theo luồng, đúng thứ tự trên luồng. */
export const DIRECTION_STAGES: Readonly<Record<LetterDirection, readonly LetterStage[]>> = {
  incoming: ['received', 'processing', 'reviewing', 'closing'],
  outgoing: ['drafting', 'checking', 'reviewing', 'publishing'],
};

export function isOpenStage(stage: LetterStage): boolean {
  return OPEN_LETTER_STAGES.includes(stage);
}

/* ------------------------------------------------------------- danh mục */

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
  readonly code: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
  /** Loại văn bản: hạn xử lý mặc định (ngày); trống là theo cấu hình sổ. */
  readonly defaultDueDays?: number;
  /** Loại văn bản: quy trình duyệt mặc định của công văn đến. */
  readonly workflowId?: string;
  /** Loại văn bản: quy trình duyệt mặc định của công văn đi. */
  readonly outgoingWorkflowId?: string;
  /** Loại văn bản: phòng ban gợi ý khi văn thư giao xử lý công văn đến. */
  readonly defaultUnitIds?: readonly string[];
  /** Độ khẩn: tô đỏ trong danh sách. */
  readonly highlight?: boolean;
  /** Độ mật: chỉ người liên quan và người có quyền xem công văn mật thấy. */
  readonly restricted?: boolean;
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
  readonly outgoingWorkflowId?: string | null;
  readonly defaultUnitIds?: readonly string[];
  readonly highlight?: boolean;
  readonly restricted?: boolean;
}

/** Thêm nhanh một mục danh mục ngay lúc nhập công văn: chỉ cần tên, mã tự sinh. */
export interface QuickCatalogItemRequest {
  readonly kind: CatalogKind;
  readonly name: string;
}

/* --------------------------------------------------------- quy trình duyệt */

/**
 * Ai duyệt một bước, theo sơ đồ tổ chức:
 *
 * - `choose`: người trình (văn thư, hay người duyệt bước trước) chọn một người trong nhóm:
 *   người có quyền lãnh đạo (`leaders`), người giữ các chức danh, người thuộc các phòng ban;
 * - `users`: một trong những người được chỉ định;
 * - `positions`: người đang giữ một trong các chức danh;
 * - `unit_heads`: trưởng các đơn vị chỉ định (chưa có trưởng thì lên đơn vị cha);
 * - `handling_unit_heads`: trưởng phòng ban xử lý (công văn đến) hay phòng ban soạn thảo (công văn đi).
 */
export type ApproverRule =
  | { readonly type: 'choose'; readonly pool: 'leaders' | 'positions' | 'units'; readonly ids?: readonly string[] }
  | { readonly type: 'users'; readonly userIds: readonly string[] }
  | { readonly type: 'positions'; readonly positionIds: readonly string[] }
  | { readonly type: 'unit_heads'; readonly unitIds: readonly string[] }
  | { readonly type: 'handling_unit_heads' };

export type ApproverRuleType = ApproverRule['type'];

export const APPROVER_RULE_LABELS: Readonly<Record<ApproverRuleType, string>> = {
  choose: 'Người trình chọn trong một nhóm',
  users: 'Người được chỉ định',
  positions: 'Người giữ chức danh',
  unit_heads: 'Trưởng đơn vị',
  handling_unit_heads: 'Trưởng phòng ban xử lý / soạn thảo',
};

/**
 * Khi người duyệt chọn "Không đạt", công văn về đâu (mặc định của bước; người duyệt vẫn
 * chọn được nơi khác trong số nơi hợp lệ):
 * - `previous-step`: bước duyệt trước; bước duyệt đầu tiên thì về người xử lý;
 * - `handlers`: phòng ban xử lý (công văn đến) hay người soạn thảo (công văn đi);
 * - `clerk`: văn thư.
 */
export const RETURN_TARGETS = ['previous-step', 'handlers', 'clerk'] as const;
export type ReturnTarget = (typeof RETURN_TARGETS)[number];

export function returnTargetLabel(target: ReturnTarget, direction: LetterDirection): string {
  if (target === 'previous-step') return 'Bước duyệt trước';
  if (target === 'clerk') return 'Văn thư';
  return direction === 'incoming' ? 'Phòng ban xử lý' : 'Người soạn thảo';
}

/** Một bước duyệt của quy trình. */
export interface WorkflowStep {
  readonly key: string;
  readonly name: string;
  readonly approver: ApproverRule;
  /** Không đạt thì trả về đâu; trống là bước trước. */
  readonly rejectTo?: ReturnTarget;
  /** Số ngày cho bước, để nhắc hạn; trống là theo hạn của công văn. */
  readonly dueDays?: number;
}

export interface Workflow {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly direction: LetterDirection;
  readonly isActive: boolean;
  /** Dùng khi loại văn bản chưa gắn quy trình của luồng này. */
  readonly isDefault: boolean;
  /** Các bước duyệt theo thứ tự; rỗng là không cần duyệt. */
  readonly steps: readonly WorkflowStep[];
  readonly updatedAt: string;
}

export interface SaveWorkflowRequest {
  readonly name: string;
  readonly description?: string;
  readonly direction: LetterDirection;
  readonly isActive?: boolean;
  readonly isDefault?: boolean;
  readonly steps: readonly WorkflowStep[];
}

export const MAX_WORKFLOW_STEPS = 10;

/* ------------------------------------------------------------- bước thật */

export const LETTER_STEP_STATUSES = ['waiting', 'active', 'done', 'skipped'] as const;
export type LetterStepStatus = (typeof LETTER_STEP_STATUSES)[number];

export type LetterStepDecision = 'approved' | 'returned';

/** Một bước duyệt trên một công văn cụ thể (chép từ quy trình lúc trình). */
export interface LetterStep {
  readonly id: string;
  readonly seq: number;
  readonly name: string;
  readonly approver: ApproverRule;
  readonly status: LetterStepStatus;
  readonly assignees: readonly { readonly userId: string; readonly name?: string }[];
  readonly actedBy?: string;
  readonly actedByName?: string;
  readonly actedAt?: string;
  readonly decision?: LetterStepDecision;
  readonly note?: string;
}

/**
 * Ô trên thanh tiến trình, dựng theo quy trình cấu hình của công văn: các bước cố định của
 * luồng (tiếp nhận, phòng ban xử lý, ban hành…) xen các bước duyệt. Khi công văn chưa trình,
 * các bước duyệt là của quy trình sẽ áp dụng (theo loại văn bản hay quy trình mặc định).
 */
export interface FlowNode {
  readonly key: string;
  readonly label: string;
  readonly state: 'done' | 'current' | 'todo';
  /** Bước duyệt của quy trình (không phải bước cố định của luồng). */
  readonly approval: boolean;
  /** Người đã làm, đang được giao hay sẽ làm bước này. */
  readonly people?: string;
  /** Lúc xong bước (ISO). */
  readonly at?: string;
}

/* ------------------------------------------------------------- tệp */

/**
 * Loại tệp: bản quét công văn đến (văn thư), dự thảo / kết quả (phòng ban, người soạn),
 * bản ban hành đã ký (văn thư), tài liệu kèm theo.
 */
export const ATTACHMENT_KINDS = ['incoming', 'draft', 'outgoing', 'reference'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABELS: Readonly<Record<AttachmentKind, string>> = {
  incoming: 'Công văn đến',
  draft: 'Dự thảo, kết quả xử lý',
  outgoing: 'Bản ban hành',
  reference: 'Tài liệu kèm theo',
};

export const CORRESPONDENCE_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

export interface LetterAttachment {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly assignmentId?: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  /** Phiên bản hiện hành (tải phiên bản mới thì tăng). */
  readonly versionNo: number;
  readonly uploadedBy: string;
  readonly uploadedByName?: string;
  readonly createdAt: string;
  /** Người xem gỡ được tệp ở bước hiện tại. */
  readonly canDelete: boolean;
  /** Người xem tải được phiên bản mới của tệp ở bước hiện tại. */
  readonly canVersion: boolean;
}

/* ------------------------------------------------------------- phòng ban */

export const ASSIGNMENT_STATUSES = ['pending', 'submitted'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export interface LetterAssignment {
  readonly id: string;
  readonly unitId: string;
  readonly unitName: string;
  readonly round: number;
  readonly status: AssignmentStatus;
  /** Người xử lý do phòng ban phân công. */
  readonly handlerUserId?: string;
  readonly handlerName?: string;
  readonly responseNote?: string;
  readonly submittedBy?: string;
  readonly submittedByName?: string;
  readonly submittedAt?: string;
  readonly revisionReason?: string;
  readonly headNames: readonly string[];
  /** Người xem phân công được người xử lý cho phòng. */
  readonly canAssignHandler: boolean;
  /** Người xem gửi được kết quả của phòng. */
  readonly canRespond: boolean;
}

/* ------------------------------------------------------------- nhật ký, trao đổi */

export const LETTER_HISTORY_ACTIONS = [
  'receive',
  'create',
  'update',
  'dispatch',
  'assign-handler',
  'respond',
  'send-to-clerk',
  'submit',
  'approve',
  'return',
  'complete',
  'publish',
  'delivery',
  'archive',
  'cancel',
  'attach',
  'detach',
  'version',
  'revoke-request',
  'revoke-approve',
  'revoke-reject',
  'revoke-withdraw',
  'delete',
  // Giá trị của luồng cũ, còn trong nhật ký công văn trước đây.
  'classify',
  'direct',
  'close-for-info',
  'review-requested',
  'request-revision',
] as const;
export type LetterHistoryAction = (typeof LETTER_HISTORY_ACTIONS)[number];

export interface LetterHistoryEntry {
  readonly id: string;
  readonly action: LetterHistoryAction;
  readonly summary: string;
  readonly note?: string;
  readonly actorUserId?: string;
  readonly actorName?: string;
  readonly at: string;
}

export interface LetterComment {
  readonly id: string;
  /** Bước của công văn lúc viết: tên giai đoạn hay tên bước duyệt. */
  readonly stepLabel: string;
  readonly body: string;
  /** Người được nhắc tên (@) trong trao đổi; họ thấy được công văn và nhận thông báo. */
  readonly mentions: readonly { readonly userId: string; readonly name?: string }[];
  readonly authorId: string;
  readonly authorName?: string;
  readonly at: string;
}

/* ------------------------------------------------------------- công văn */

export const DELIVERY_STATUSES = ['pending', 'sent', 'received', 'returned'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Readonly<Record<DeliveryStatus, string>> = {
  pending: 'Chưa gửi',
  sent: 'Đã gửi',
  received: 'Nơi nhận đã nhận',
  returned: 'Bị trả lại',
};

export interface LetterSummary {
  readonly id: string;
  readonly direction: LetterDirection;
  /** Số hiển thị: số đến; công văn đi là số ban hành, chưa có thì số dự thảo. */
  readonly displayNo: string;
  /** Số đến (công văn đến) hay số dự thảo (công văn đi). */
  readonly incomingNo: string;
  readonly receivedOn: string;
  /** Công văn đến: cơ quan gửi. Công văn đi: đơn vị soạn thảo. */
  readonly senderOrg: string;
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject: string;
  readonly kind: string;
  readonly kindName: string;
  readonly urgency: string;
  readonly urgencyName: string;
  readonly urgencyHighlight: boolean;
  readonly confidentiality: string;
  readonly confidentialityName: string;
  readonly restricted: boolean;
  readonly dueOn?: string;
  readonly stage: LetterStage;
  readonly stageLabel: string;
  readonly currentStepName?: string;
  readonly currentAssigneeNames: readonly string[];
  readonly assignmentsDone: number;
  readonly assignmentsTotal: number;
  readonly authorUserId?: string;
  readonly authorName?: string;
  readonly authorUnitName?: string;
  readonly outgoingNo?: string;
  readonly publishedOn?: string;
  readonly recipient?: string;
  readonly deliveryStatus?: DeliveryStatus;
  readonly archiveCode?: string;
  readonly archivedOn?: string;
  readonly receivedBy: string;
  readonly receivedByName?: string;
  readonly updatedAt: string;
  readonly awaitingMe: boolean;
}

export interface LetterDetail extends LetterSummary {
  /** Ghi chú của văn thư khi giao phòng ban (công văn đến). */
  readonly instruction?: string;
  readonly workflowId?: string;
  readonly workflowName?: string;
  readonly relatedLetterId?: string;
  readonly relatedLetterNo?: string;
  readonly cancelReason?: string;
  /** Đề nghị huỷ công văn đã ban hành / hoàn tất: đang chờ xác nhận (giai đoạn `revoking`) hay đã được đồng ý. */
  readonly revoke?: LetterRevoke;
  readonly completionNote?: string;
  readonly deliveryMethod?: string;
  readonly deliveryNote?: string;
  readonly deliveredOn?: string;
  readonly sharedFolderId?: string;
  readonly steps: readonly LetterStep[];
  readonly flow: readonly FlowNode[];
  readonly assignments: readonly LetterAssignment[];
  readonly attachments: readonly LetterAttachment[];
  readonly comments: readonly LetterComment[];
  readonly history: readonly LetterHistoryEntry[];
  readonly actions: LetterActions;
}

export interface LetterRevoke {
  readonly kind: RevokeKind;
  readonly kindLabel: string;
  readonly reason: string;
  readonly requestedBy?: string;
  readonly requestedByName?: string;
  readonly requestedAt?: string;
  /** Người có thẩm quyền xác nhận (bước duyệt cuối của quy trình). */
  readonly approverNames: readonly string[];
}

/** Thao tác người xem làm được ở bước hiện tại; quyền thật vẫn kiểm ở API. */
export interface LetterActions {
  readonly edit: boolean;
  /** Công văn đến: văn thư phân loại, chọn phòng ban, giao xử lý. */
  readonly dispatch: boolean;
  /** Công văn đi: người soạn gửi văn thư. */
  readonly sendToClerk: boolean;
  /** Công văn đi: văn thư xác nhận hợp lệ và trình duyệt. */
  readonly submit: boolean;
  /** Bước duyệt đang chờ người xem. */
  readonly approve: boolean;
  /** Công văn đến: văn thư xác nhận hoàn tất và lưu trữ. */
  readonly complete: boolean;
  /** Công văn đi: văn thư đánh số, ban hành, lưu trữ. */
  readonly publish: boolean;
  /** Công văn đi đã ban hành: cập nhật tình trạng gửi. */
  readonly updateDelivery: boolean;
  readonly cancel: boolean;
  /** Văn thư đề nghị huỷ (thu hồi, sửa đổi) công văn đã ban hành / hoàn tất. */
  readonly requestRevoke: boolean;
  /** Người có thẩm quyền xác nhận huỷ hay không. */
  readonly decideRevoke: boolean;
  /** Văn thư rút đề nghị huỷ khi chưa được xác nhận. */
  readonly withdrawRevoke: boolean;
  /** Xoá công văn đã huỷ khỏi Văn thư. */
  readonly remove: boolean;
  /** Người xem trả lại được về đâu ở bước hiện tại ("Không đạt"). */
  readonly returnTargets: readonly ReturnTarget[];
  /** Nơi trả về mặc định của bước hiện tại (cấu hình của bước duyệt). */
  readonly defaultReturnTarget?: ReturnTarget;
  readonly comment: boolean;
  /** Tạo công văn đi trả lời công văn đến này. */
  readonly reply: boolean;
  readonly attachKinds: readonly AttachmentKind[];
}

/** Ứng viên cho bước duyệt sắp bắt đầu khi bước đó để người thao tác chọn người duyệt. */
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

/** Soạn công văn đi. Đơn vị soạn thảo mặc định là phòng ban của người soạn, chọn lại được phòng khác trong sơ đồ tổ chức. */
export interface CreateOutgoingRequest {
  readonly subject: string;
  readonly recipient: string;
  readonly dueOn?: string;
  readonly kind?: string;
  readonly urgency?: string;
  readonly confidentiality?: string;
  /** Phòng ban soạn thảo khi người soạn thuộc nhiều phòng. */
  readonly authorUnitId?: string;
  /** Công văn đến mà công văn đi này trả lời. */
  readonly relatedLetterId?: string;
}

export interface UpdateLetterRequest {
  readonly senderOrg?: string;
  readonly senderRef?: string;
  readonly senderDate?: string;
  readonly subject?: string;
  readonly receivedOn?: string;
  readonly dueOn?: string;
  readonly kind?: string;
  readonly urgency?: string;
  readonly confidentiality?: string;
  readonly recipient?: string;
}

/**
 * Một phòng ban được giao. Không chọn người xử lý thì mọi nhân sự của phòng cùng nhận (và
 * phòng phân công sau được); chọn thì người đó nhận và xử lý.
 */
export interface DispatchUnit {
  readonly unitId: string;
  readonly handlerUserId?: string;
}

/** Văn thư phân loại, chọn phòng ban xử lý và giao (công văn đến). */
export interface DispatchLetterRequest {
  readonly kind: string;
  readonly urgency: string;
  readonly confidentiality?: string;
  readonly units: readonly DispatchUnit[];
  readonly dueOn?: string;
  readonly note?: string;
  /** Quy trình lãnh đạo xem xét sau khi phòng ban xử lý xong; trống là mặc định. */
  readonly workflowId?: string;
  /** Người duyệt bước đầu khi bước đó để người trình chọn. */
  readonly assigneeUserId?: string;
}

export interface AssignHandlerRequest {
  readonly handlerUserId: string;
  readonly note?: string;
}

export interface SubmitLetterRequest {
  readonly workflowId?: string;
  readonly assigneeUserId?: string;
  readonly note?: string;
}

export interface ApproveStepRequest {
  readonly note?: string;
  readonly nextAssigneeUserId?: string;
}

export interface ReturnLetterRequest {
  readonly target: ReturnTarget;
  readonly reason: string;
  /** Khi trả phòng ban: phòng ban phải làm lại; trống là mọi phòng. */
  readonly assignmentIds?: readonly string[];
}

export interface NoteRequest {
  readonly note?: string;
}

export interface ReasonRequest {
  readonly reason: string;
}

export interface RequestRevokeRequest {
  readonly kind: RevokeKind;
  readonly reason: string;
}

export interface DecideRevokeRequest {
  /** true: đồng ý huỷ; false: giữ công văn. */
  readonly approve: boolean;
  readonly note?: string;
}

export interface RespondAssignmentRequest {
  readonly note: string;
}

export interface PublishLetterRequest {
  readonly recipient: string;
  readonly publishedOn?: string;
  readonly deliveryMethod?: string;
  readonly note?: string;
}

export interface UpdateDeliveryRequest {
  readonly status: DeliveryStatus;
  readonly deliveredOn?: string;
  readonly note?: string;
}

export interface CommentRequest {
  readonly body: string;
  /** Người được nhắc tên (@) trong nội dung. */
  readonly mentionedUserIds?: readonly string[];
}

export interface CreateAttachmentRequest {
  readonly kind: AttachmentKind;
  readonly assignmentId?: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface CreateAttachmentVersionRequest {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly note?: string;
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

export const LETTER_BOXES = ['incoming', 'outgoing', 'mine', 'archive'] as const;
export type LetterBox = (typeof LETTER_BOXES)[number];

export interface LetterQuery {
  readonly box?: LetterBox;
  readonly stage?: LetterStage;
  readonly search?: string;
}

/* ------------------------------------------------------------ tổng quan, báo cáo */

export interface CorrespondenceOverview {
  readonly incomingOpen: number;
  readonly outgoingOpen: number;
  readonly awaitingApproval: number;
  readonly overdue: number;
  readonly archived: number;
  readonly awaitingMe: number;
  readonly byStage: Readonly<Record<LetterDirection, Readonly<Partial<Record<LetterStage, number>>>>>;
  readonly urgent: readonly LetterSummary[];
}

export interface CorrespondenceReportRow {
  readonly label: string;
  readonly incoming: number;
  readonly outgoing: number;
  readonly completed: number;
  /** Đã xong mà quá hạn, hoặc còn mở đã quá hạn. */
  readonly late: number;
}

export interface CorrespondenceReport {
  readonly year: number;
  readonly totals: { readonly incoming: number; readonly outgoing: number; readonly completed: number; readonly open: number; readonly late: number };
  readonly byMonth: readonly CorrespondenceReportRow[];
  readonly byType: readonly CorrespondenceReportRow[];
  /** Phòng ban được giao xử lý công văn đến và phòng ban soạn công văn đi. */
  readonly byUnit: readonly CorrespondenceReportRow[];
}

/* ------------------------------------------------------------ kho lưu trữ */

/** Một tệp trong cây lưu trữ (nằm ở kho tài liệu của Hệ dùng chung). */
export interface ArchiveFile {
  readonly id: string;
  readonly fileName: string;
  readonly kind: AttachmentKind;
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly versionNo: number;
  readonly createdAt: string;
  /** Phòng ban gửi tệp kết quả (công văn đến). */
  readonly unitName?: string;
}

/** Thư mục hồ sơ của một công văn, cùng tên với thư mục bên Hệ dùng chung. */
export interface ArchiveDossier {
  readonly letterId: string;
  readonly direction: LetterDirection;
  readonly folderName: string;
  readonly displayNo: string;
  readonly subject: string;
  readonly stage: LetterStage;
  readonly stageLabel: string;
  /** Cơ quan gửi (công văn đến) hay nơi nhận (công văn đi). */
  readonly partner?: string;
  readonly archiveCode?: string;
  readonly archivedOn?: string;
  readonly receivedOn: string;
  readonly files: readonly ArchiveFile[];
}

/**
 * Cây lưu trữ như thư mục "Văn thư" bên Hệ dùng chung: năm › công văn đến / đi › hồ sơ › tệp.
 * Chỉ gồm công văn người xem được thấy.
 */
export interface ArchiveTree {
  readonly rootName: string;
  readonly years: readonly {
    readonly year: number;
    readonly groups: readonly { readonly direction: LetterDirection; readonly label: string; readonly dossiers: readonly ArchiveDossier[] }[];
  }[];
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
  readonly path: string;
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
  readonly people: readonly { readonly userId: string; readonly name: string }[];
  /** Người có quyền lãnh đạo (`correspondence.letter.direct`). */
  readonly leaders: readonly { readonly userId: string; readonly name: string }[];
  /** Phòng ban của người đang xem (để soạn công văn đi). */
  readonly myUnitIds: readonly string[];
  readonly degraded: boolean;
}

/* ------------------------------------------------------------- cấu hình */

/**
 * Cách giao phòng ban mặc định: `all` cả phòng cùng nhận (chọn người xử lý là tuỳ chọn),
 * `handler` văn thư phải chọn một người xử lý cho mỗi phòng.
 */
export const DISPATCH_MODES = ['all', 'handler'] as const;
export type DispatchMode = (typeof DISPATCH_MODES)[number];

export const DISPATCH_MODE_LABELS: Readonly<Record<DispatchMode, string>> = {
  all: 'Cả phòng ban cùng nhận (chọn người xử lý nếu cần)',
  handler: 'Phải chọn một người xử lý cho mỗi phòng ban',
};

export interface CorrespondenceSettings {
  readonly incomingSuffix: string;
  readonly outgoingSuffix: string;
  readonly archivePrefix: string;
  readonly defaultDueDays: number;
  readonly dispatchMode: DispatchMode;
  /**
   * Người làm văn thư (1–10 người): làm được việc của văn thư trong phân hệ (tiếp nhận, kiểm tra,
   * ban hành, lưu trữ), nhận thông báo việc của văn thư và hiện tên ở các bước của văn thư. Trống
   * là mọi người có quyền văn thư trong Phân quyền.
   */
  readonly clerkUserIds: readonly string[];
}

export const MAX_CLERKS = 10;

export const DEFAULT_CORRESPONDENCE_SETTINGS: CorrespondenceSettings = {
  incomingSuffix: 'CVĐ',
  outgoingSuffix: 'CV',
  archivePrefix: 'HS',
  defaultDueDays: 7,
  dispatchMode: 'all',
  clerkUserIds: [],
};

export interface CorrespondenceConfig {
  readonly settings: CorrespondenceSettings;
  readonly catalog: readonly CatalogItem[];
  readonly workflows: readonly Workflow[];
}

/* ------------------------------------------------------------ trạng thái */

export interface CorrespondenceCapabilities {
  readonly isTenantAdmin: boolean;
  readonly canRegister: boolean;
  readonly canCreateOutgoing: boolean;
  readonly canPublish: boolean;
  readonly canArchive: boolean;
  readonly canDirect: boolean;
  readonly canReadAll: boolean;
  readonly canReadConfidential: boolean;
  readonly canReadReports: boolean;
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
  /** Phòng ban được giao xử lý công văn đến (giải ra trưởng đơn vị). */
  assigned: 'correspondence.letter.assigned',
  /** Người được phòng ban phân công xử lý. */
  handlerAssigned: 'correspondence.letter.handler-assigned',
  /** Công văn đi gửi văn thư kiểm tra. */
  sentToClerk: 'correspondence.letter.sent-to-clerk',
  /** Bước duyệt bắt đầu, chờ người duyệt. */
  stepAssigned: 'correspondence.letter.step-assigned',
  returned: 'correspondence.letter.returned',
  /** Duyệt xong: chờ văn thư hoàn tất (đến) hay ban hành (đi). */
  approved: 'correspondence.letter.approved',
  completed: 'correspondence.letter.completed',
  published: 'correspondence.letter.published',
  cancelled: 'correspondence.letter.cancelled',
  /** Văn thư đề nghị huỷ công văn đã ban hành / hoàn tất, chờ người có thẩm quyền xác nhận. */
  revokeRequested: 'correspondence.letter.revoke-requested',
  /** Người có thẩm quyền không đồng ý huỷ. */
  revokeRejected: 'correspondence.letter.revoke-rejected',
  /** Văn thư rút đề nghị huỷ. */
  revokeWithdrawn: 'correspondence.letter.revoke-withdrawn',
  commented: 'correspondence.letter.commented',
  mentioned: 'correspondence.letter.mentioned',
  dueSoon: 'correspondence.letter.due-soon',
  overdue: 'correspondence.letter.overdue',
} as const;
export type CorrespondenceEventType = (typeof CORRESPONDENCE_EVENTS)[keyof typeof CORRESPONDENCE_EVENTS];

export function letterDeepLink(letterId: string): string {
  return `${CORRESPONDENCE_LAUNCH_URL}#letters/${encodeURIComponent(letterId)}`;
}

export function letterTitle(letter: { readonly displayNo?: string; readonly incomingNo: string; readonly subject: string }): string {
  return `${letter.displayNo ?? letter.incomingNo} · ${letter.subject}`;
}

export function daysUntil(dueOn: string, today: string): number {
  const due = Date.parse(`${dueOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return Math.round((due - now) / 86_400_000);
}

export const CATALOG_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
