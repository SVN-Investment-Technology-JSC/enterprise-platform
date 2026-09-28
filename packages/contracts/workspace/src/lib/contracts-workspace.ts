/* =========================================================================
   WORKSPACE — HỢP ĐỒNG CÔNG KHAI

   Một tệp phẳng, chia mục bằng banner, đúng quy ước của
   packages/contracts/inventory/src/lib/contracts-inventory.ts.

   Chỉ chứa kiểu và hằng số. KHÔNG chứa implementation.
   ========================================================================= */

/* =========================================================================
   MODULE
   ========================================================================= */

/** Khoá module, trùng với `module_registry_schema.modules.key`. */
export const WORKSPACE_MODULE_KEY = 'workspace';

/** Bốn quyền nền tảng của module. */
export const WORKSPACE_PERMISSIONS = [
  'workspace.read',
  'workspace.task.write',
  'workspace.document.write',
  'workspace.manage',
] as const;
export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

/* =========================================================================
   VAI TRÒ TRONG DỰ ÁN

   Đây là nguồn phân quyền chi tiết của cả module. Quyền nền tảng ở trên chỉ
   quyết định ĐƯỢC LÀM LOẠI THAO TÁC GÌ; vai trò dự án quyết định ĐƯỢC LÀM
   TRÊN DỮ LIỆU NÀO.
   ========================================================================= */

export const PROJECT_ROLES = ['owner', 'manager', 'member', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/* =========================================================================
   TRẠNG THÁI VÀ PHÂN LOẠI
   ========================================================================= */

export const PROJECT_STATUSES = [
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const WORK_ITEM_STATUSES = [
  'todo',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled',
] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

/** Hai trạng thái đóng. Việc đã đóng không tính vào tải công việc và không bị coi là quá hạn. */
export const CLOSED_WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ['done', 'cancelled'];

export const WORK_ITEM_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

/**
 * `phase` chỉ chứa việc con, không gán người và không có giờ ước lượng.
 * `milestone` là mốc thời điểm, không hiện trên bảng Kanban.
 */
export const WORK_ITEM_TYPES = ['phase', 'task', 'milestone'] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

/**
 * Cách thực hiện một công việc.
 *
 * `procedure` nghĩa là công việc được mở thành một hồ sơ bên module Quy trình.
 * Việc tạo hồ sơ đó do TRÌNH DUYỆT gọi, bằng chính phiên của người dùng —
 * server của Workspace không bao giờ ghi sang module khác.
 */
export const WORK_ITEM_EXECUTION_TYPES = ['manual', 'procedure'] as const;
export type WorkItemExecutionType = (typeof WORK_ITEM_EXECUTION_TYPES)[number];

/** Loại phụ thuộc. Chỉ `FS` chặn cứng việc hoàn thành; các loại còn lại chỉ cảnh báo lịch. */
export const DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

/* =========================================================================
   GIỚI HẠN CẤU TRÚC

   Khai báo một chỗ để tầng application, tầng giao diện và ràng buộc CHECK
   trong migration không bị lệch nhau.
   ========================================================================= */

/** Cây công việc tối đa 10 cấp. Cột `depth` trong CSDL chạy từ 0 tới 9. */
export const MAX_WORK_ITEM_DEPTH = 10;

/** Độ sâu tối đa của cây thư mục tài liệu. */
export const MAX_FOLDER_DEPTH = 5;

/** Khoảng tra cứu lịch và báo cáo tối đa, tính bằng ngày. */
export const MAX_QUERY_RANGE_DAYS = 366;

/* =========================================================================
   PHÂN TRANG DÙNG CHUNG
   ========================================================================= */

export const PAGE_SIZES = [15, 30, 45, 60] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export interface Paged<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/* =========================================================================
   DỰ ÁN
   ========================================================================= */

export interface Project {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly status: ProjectStatus;
  readonly ownerUserId: string;
  readonly orgUnitId?: string;
  readonly customerRef?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  /** Giá trị dẫn xuất từ các công việc lá; không nhận giá trị nhập tay. */
  readonly progressPercent: number;
  readonly metadata: Record<string, unknown>;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Dòng trong bảng danh sách: thêm vài số liệu tổng hợp để khỏi gọi thêm API. */
export interface ProjectSummary extends Project {
  readonly totalItems: number;
  readonly closedItems: number;
  readonly overdueItems: number;
  /** Vai trò của người đang đăng nhập trong dự án này. */
  readonly myRole?: ProjectRole;
  /**
   * Chỉ có mặt khi người gọi được xem tài chính.
   *
   * Với `member` và `viewer`, trường này **vắng hẳn** khỏi payload — không
   * phải `null`, không phải bị che ở giao diện. Ẩn ở giao diện mà vẫn gửi số
   * xuống là để lộ nó cho bất kỳ ai mở tab Network.
   */
  readonly finance?: ProjectFinance;
}

export interface ProjectMember {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly role: ProjectRole;
  readonly joinedAt: string;
}

export interface CreateProjectRequest {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly orgUnitId?: string;
  readonly customerRef?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}

/** Mã dự án không có mặt: đã tạo thì không đổi được. */
export interface UpdateProjectRequest {
  readonly name?: string;
  readonly description?: string;
  readonly status?: ProjectStatus;
  readonly ownerUserId?: string;
  readonly orgUnitId?: string;
  readonly customerRef?: string;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
}

export interface SetProjectMembersRequest {
  readonly members: readonly { readonly userId: string; readonly role: ProjectRole }[];
}

/* =========================================================================
   CÔNG VIỆC
   ========================================================================= */

export interface WorkItem {
  readonly id: string;
  readonly projectId: string;
  readonly parentId?: string;
  readonly code: string;
  readonly title: string;
  readonly description?: string;
  readonly itemType: WorkItemType;
  readonly executionType: WorkItemExecutionType;
  readonly status: WorkItemStatus;
  readonly priority: WorkItemPriority;
  readonly assigneeUserId?: string;
  readonly plannedStart?: string;
  readonly plannedEnd?: string;
  readonly actualStart?: string;
  readonly actualEnd?: string;
  readonly estimateHours?: number;
  readonly progressPercent: number;
  readonly sortOrder: number;
  readonly depth: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Cây được trả về dạng PHẲNG kèm `parentId` và `depth`.
 *
 * Client tự dựng cây từ danh sách phẳng. Trả về JSON lồng nhau sẽ phình rất
 * nhanh ở cây 10 cấp và khó cập nhật một node lẻ.
 */
export interface WorkItemTree {
  readonly items: readonly WorkItem[];
}

export interface CreateWorkItemRequest {
  readonly projectId: string;
  readonly parentId?: string;
  readonly title: string;
  readonly description?: string;
  readonly itemType?: WorkItemType;
  readonly executionType?: WorkItemExecutionType;
  readonly priority?: WorkItemPriority;
  readonly assigneeUserId?: string;
  readonly plannedStart?: string;
  readonly plannedEnd?: string;
  readonly estimateHours?: number;
}

export interface UpdateWorkItemRequest {
  readonly title?: string;
  readonly description?: string;
  readonly priority?: WorkItemPriority;
  readonly assigneeUserId?: string | null;
  readonly plannedStart?: string | null;
  readonly plannedEnd?: string | null;
  readonly estimateHours?: number | null;
  readonly progressPercent?: number;
}

export interface ChangeWorkItemStatusRequest {
  readonly status: WorkItemStatus;
  readonly note?: string;
}

/** Đổi cha và vị trí trong cây cùng lúc. */
export interface MoveWorkItemRequest {
  readonly parentId?: string | null;
  readonly sortOrder?: number;
}

/* =========================================================================
   PHỤ THUỘC VÀ NHẬT KÝ
   ========================================================================= */

export interface WorkItemDependency {
  readonly id: string;
  readonly projectId: string;
  readonly predecessorId: string;
  readonly successorId: string;
  readonly dependencyType: DependencyType;
  readonly lagDays: number;
  readonly createdAt: string;
}

export interface AddDependencyRequest {
  readonly predecessorId: string;
  readonly dependencyType?: DependencyType;
  readonly lagDays?: number;
}

export interface WorkItemStatusHistoryEntry {
  readonly id: string;
  readonly workItemId: string;
  readonly fromStatus?: WorkItemStatus;
  readonly toStatus: WorkItemStatus;
  readonly note?: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

/* =========================================================================
   DTO CÒN LẠI

   Bổ sung theo giai đoạn: Báo cáo (P7) · Tài chính (P9).
   ========================================================================= */

/* =========================================================================
   LỊCH BIỂU (P2)
   ========================================================================= */

/** Họp · Sinh hoạt · Khác. Hạn công việc tự hiện trên lịch, không cần sự kiện riêng. */
export const EVENT_TYPES = ['meeting', 'activity', 'other'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = ['scheduled', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const PARTICIPANT_RESPONSES = [
  'needs_action',
  'accepted',
  'declined',
  'tentative',
] as const;
export type ParticipantResponse = (typeof PARTICIPANT_RESPONSES)[number];

/** Tần suất lặp được hỗ trợ ở phiên bản này. Cột lưu chuỗi RRULE đúng chuẩn. */
export const RECURRENCE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** Phạm vi khi sửa hoặc huỷ một buổi thuộc chuỗi lặp. */
export const RECURRENCE_SCOPES = ['single', 'following', 'all'] as const;
export type RecurrenceScope = (typeof RECURRENCE_SCOPES)[number];

/** Tối đa 100 người một sự kiện; danh sách dài hơn là dấu hiệu dùng sai công cụ. */
export const MAX_EVENT_PARTICIPANTS = 100;

export interface CalendarEvent {
  readonly id: string;
  readonly seriesId?: string;
  readonly projectId?: string;
  readonly workItemId?: string;
  readonly title: string;
  readonly description?: string;
  readonly location?: string;
  readonly eventType: EventType;
  readonly startAt: string;
  readonly endAt: string;
  readonly allDay: boolean;
  readonly timezone: string;
  readonly recurrenceRule?: string;
  readonly recurrenceUntil?: string;
  readonly recurrenceCount?: number;
  readonly orgUnitId?: string;
  readonly status: EventStatus;
  readonly organizerUserId: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Một lần xuất hiện đã khai triển trên lưới lịch.
 *
 * KHÔNG phải một dòng trong cơ sở dữ liệu: một chuỗi hằng tuần hai năm là một
 * dòng `calendar_events` nhưng hàng trăm `CalendarOccurrence`. Vì vậy khoá để
 * thao tác là cặp `eventId` + `occurrenceDate`, không phải một id riêng.
 */
export interface CalendarOccurrence {
  readonly eventId: string;
  readonly seriesId?: string;
  /** Ngày theo giờ địa phương của sự kiện, dạng `YYYY-MM-DD`. */
  readonly occurrenceDate: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly title: string;
  readonly eventType: EventType;
  readonly allDay: boolean;
  readonly timezone: string;
  readonly location?: string;
  readonly projectId?: string;
  readonly workItemId?: string;
  readonly organizerUserId: string;
  /** Lần xuất hiện này là bản thay thế của một ngoại lệ `moved`. */
  readonly isException: boolean;
  /** Sự kiện gốc có lặp hay không; quyết định hộp thoại có hỏi phạm vi sửa. */
  readonly isRecurring: boolean;
}

export interface EventParticipant {
  readonly id: string;
  readonly eventId: string;
  readonly userId: string;
  readonly responseStatus: ParticipantResponse;
  readonly isOrganizer: boolean;
  readonly respondedAt?: string;
}

export interface CreateEventRequest {
  readonly projectId?: string;
  readonly workItemId?: string;
  readonly title: string;
  readonly description?: string;
  readonly location?: string;
  readonly eventType?: EventType;
  readonly startAt: string;
  readonly endAt: string;
  readonly allDay?: boolean;
  readonly timezone?: string;
  readonly recurrenceRule?: string;
  readonly recurrenceUntil?: string;
  readonly recurrenceCount?: number;
  readonly participantUserIds?: readonly string[];
}

export interface UpdateEventRequest {
  readonly title?: string;
  readonly description?: string;
  readonly location?: string;
  readonly eventType?: EventType;
  readonly startAt?: string;
  readonly endAt?: string;
  readonly allDay?: boolean;
  readonly participantUserIds?: readonly string[];
  /**
   * Buổi nào của chuỗi bị tác động.
   *
   * `single` tách riêng buổi đó thành sự kiện mới và ghi một dòng ngoại lệ;
   * `following` cắt chuỗi cũ trước buổi đó rồi sinh chuỗi mới từ buổi đó;
   * `all` sửa thẳng dòng gốc.
   */
  readonly scope?: RecurrenceScope;
  /** Bắt buộc khi `scope` là `single` hoặc `following`: buổi nào đang được sửa. */
  readonly occurrenceDate?: string;
}

export interface RespondToEventRequest {
  readonly responseStatus: ParticipantResponse;
}

/**
 * Kết quả đọc lịch trong một khoảng.
 *
 * Cảnh báo trùng lịch người không nằm ở đây — nó trả về khi ghi, trong
 * `EventMutationResponse.warnings`.
 */
export interface CalendarRangeResponse {
  readonly occurrences: readonly CalendarOccurrence[];
  readonly from: string;
  readonly to: string;
}

export interface SchedulingWarning {
  readonly code: 'PARTICIPANT_BUSY';
  readonly userId: string;
  readonly conflictingEventId: string;
  readonly message: string;
}

export interface EventMutationResponse {
  readonly event: CalendarEvent;
  readonly participants: readonly EventParticipant[];
  readonly warnings: readonly SchedulingWarning[];
}

/* =========================================================================
   CHAT THEO NODE (P4)
   ========================================================================= */

export const CHAT_ENTITY_TYPES = ['project', 'work_item'] as const;
export type ChatEntityType = (typeof CHAT_ENTITY_TYPES)[number];

/** Văn bản thuần, khớp ràng buộc CHECK của cột `body`. */
export const MAX_CHAT_BODY_LENGTH = 5000;

/**
 * Trả lời tối đa hai cấp.
 *
 * Luồng sâu hơn hai cấp rất khó đọc trên một Drawer hẹp, và không có cách
 * hiển thị nào gọn cho nhánh cấp ba.
 */
export const MAX_CHAT_REPLY_DEPTH = 2;

/**
 * Cửa sổ sửa tin nhắn, tính bằng phút.
 *
 * Sửa được mãi mãi nghĩa là người khác đã đọc và phản hồi dựa trên một nội
 * dung có thể bị viết lại sau lưng họ.
 */
export const CHAT_EDIT_WINDOW_MINUTES = 15;

/** Nhịp hỏi lại số tin chưa đọc. Không có WebSocket trong repo. */
export const CHAT_UNREAD_POLL_MS = 30_000;

export interface ChatMessage {
  readonly id: string;
  readonly channelId: string;
  readonly parentId?: string;
  /** Rỗng khi tin đã bị xoá mềm; giao diện hiện "Tin nhắn đã thu hồi". */
  readonly body: string;
  readonly mentions: readonly string[];
  readonly attachmentDocumentId?: string;
  readonly isEdited: boolean;
  readonly isDeleted: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChatChannel {
  readonly id: string;
  readonly entityType: ChatEntityType;
  readonly entityId: string;
  readonly projectId: string;
  readonly lastMessageAt?: string;
}

/**
 * Luồng tin của một node.
 *
 * `channel` rỗng nghĩa là node chưa từng có ai nhắn: Drawer vẫn mở được, chỉ
 * là trống. Kênh được tạo lười khi gửi tin đầu tiên.
 */
export interface ChatThread {
  readonly channel?: ChatChannel;
  readonly messages: readonly ChatMessage[];
}

export interface SendChatMessageRequest {
  readonly entityType: ChatEntityType;
  readonly entityId: string;
  readonly body: string;
  readonly parentId?: string;
  readonly mentions?: readonly string[];
  readonly attachmentDocumentId?: string;
}

export interface UpdateChatMessageRequest {
  readonly body: string;
  readonly mentions?: readonly string[];
}

/**
 * Kết quả gửi tin.
 *
 * `droppedMentions` là những id được nhắc nhưng không phải thành viên dự án.
 * Tin vẫn gửi đi — chặn cả tin chỉ vì gõ nhầm một cái tên là quá tay — nhưng
 * giao diện nói rõ ai đã bị bỏ, để người gửi không tưởng họ sẽ nhận thông báo.
 */
export interface SendChatMessageResponse {
  readonly message: ChatMessage;
  readonly droppedMentions: readonly string[];
}

/**
 * Số tin chưa đọc của cả cây, lấy trong MỘT lời gọi.
 *
 * `byNode` là số tin chưa đọc của riêng node đó; `rolledUp` đã cộng cả nhánh
 * con bên dưới. Cây tô chấm đỏ bằng `rolledUp` để một tin nhắn ở node sâu vẫn
 * nhìn thấy được khi nhánh đang thu gọn.
 */
export interface UnreadSummary {
  readonly byNode: Readonly<Record<string, number>>;
  readonly rolledUp: Readonly<Record<string, number>>;
  readonly total: number;
}

/* =========================================================================
   TÀI LIỆU (P5)
   ========================================================================= */

export const DOCUMENT_STATUSES = ['active', 'archived'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_LINK_ENTITY_TYPES = ['project', 'work_item', 'calendar_event'] as const;
export type DocumentLinkEntityType = (typeof DOCUMENT_LINK_ENTITY_TYPES)[number];

export const DOCUMENT_ACCESS_ACTIONS = [
  'view',
  'download',
  'upload',
  'lock',
  'unlock',
] as const;
export type DocumentAccessAction = (typeof DOCUMENT_ACCESS_ACTIONS)[number];

/** Trần dung lượng một tệp. Cùng con số với Inventory để người dùng khỏi đoán. */
export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * URL ký trước sống 300 giây.
 *
 * Đủ dài cho một lượt tải lên bình thường, đủ ngắn để một đường dẫn lọt ra
 * ngoài không còn dùng được bao lâu.
 */
export const PRESIGNED_URL_TTL_SECONDS = 300;

/** Kiểu tệp được chấp nhận. Danh sách trắng, không phải danh sách đen. */
export const ALLOWED_DOCUMENT_CONTENT_TYPES: readonly string[] = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
];

export interface DocumentFolder {
  readonly id: string;
  /** Rỗng nghĩa là thư mục cấp đơn vị, không thuộc dự án nào. */
  readonly projectId?: string;
  readonly parentId?: string;
  readonly name: string;
  readonly depth: number;
  readonly isActive: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface DocumentVersion {
  readonly id: string;
  readonly documentId: string;
  readonly versionNo: number;
  readonly fileName: string;
  readonly contentType: string;
  /**
   * Rỗng nghĩa là **chưa tải lên xong**.
   *
   * Server không bao giờ được kho lưu trữ báo là upload đã hoàn tất, nên đây
   * là tín hiệu nhận biết duy nhất. Giao diện hiện nhãn "Chưa tải lên xong"
   * và tắt nút tải xuống.
   */
  readonly sizeBytes?: number;
  readonly checksum?: string;
  readonly changeNote?: string;
  readonly uploadedBy: string;
  readonly createdAt: string;
}

/** `storage_key` KHÔNG bao giờ lộ ra client — chỉ URL đã ký. */
export interface WorkspaceDocument {
  readonly id: string;
  readonly folderId: string;
  readonly projectId?: string;
  readonly name: string;
  readonly description?: string;
  readonly currentVersionId?: string;
  readonly status: DocumentStatus;
  readonly lockedByUserId?: string;
  readonly lockedAt?: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Dòng trong bảng danh sách: kèm sẵn phiên bản hiện hành để khỏi gọi thêm. */
export interface DocumentSummary extends WorkspaceDocument {
  readonly currentVersion?: DocumentVersion;
  readonly versionCount: number;
}

export interface DocumentDetail extends WorkspaceDocument {
  readonly versions: readonly DocumentVersion[];
  readonly links: readonly DocumentLink[];
}

export interface DocumentLink {
  readonly id: string;
  readonly documentId: string;
  readonly entityType: DocumentLinkEntityType;
  readonly entityId: string;
  readonly createdAt: string;
}

export interface DocumentAccessLogEntry {
  readonly id: string;
  readonly documentId: string;
  readonly versionId?: string;
  readonly action: DocumentAccessAction;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface CreateFolderRequest {
  readonly projectId?: string;
  readonly parentId?: string;
  readonly name: string;
}

/**
 * Yêu cầu dọn sẵn đường dẫn `<thư mục gốc>/<dự án>/<công việc>`.
 *
 * Người dùng chỉ chọn thư mục gốc; server tạo nốt các cấp còn thiếu và trả về
 * thư mục lá để tài liệu rơi vào đúng chỗ. Gọi lại nhiều lần cho cùng một công
 * việc thì vẫn ra đúng thư mục cũ.
 */
export interface EnsureFolderPathRequest {
  readonly rootFolderId: string;
  readonly projectId: string;
  /** Bỏ trống thì dừng ở cấp dự án. */
  readonly workItemId?: string;
}

export interface CreateDocumentRequest {
  readonly folderId: string;
  readonly name: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly description?: string;
  readonly note?: string;
  /** Gắn ngay vào một công việc hoặc sự kiện khi tạo. */
  readonly linkTo?: {
    readonly entityType: DocumentLinkEntityType;
    readonly entityId: string;
  };
}

export interface CreateVersionRequest {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  /** Bắt buộc từ phiên bản 2 trở đi. */
  readonly changeNote: string;
}

/**
 * Chặng 3: trình duyệt báo đã `PUT` xong lên kho.
 *
 * Tới lúc này `size_bytes` của phiên bản mới được ghi; trước đó nó rỗng, và
 * rỗng nghĩa là "chưa tải lên xong" — tải xuống bị chặn.
 */
export interface CompleteUploadRequest {
  readonly sizeBytes: number;
}

export interface LinkDocumentRequest {
  readonly entityType: DocumentLinkEntityType;
  readonly entityId: string;
}

/**
 * Chặng 1 của luồng tải lên ba chặng.
 *
 * Chặng 2 là trình duyệt `PUT` thẳng tệp lên `uploadUrl`. **Không có chặng
 * 3** — server không được thông báo khi upload xong.
 */
export interface UploadTicket {
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
  readonly version: DocumentVersion;
}

export interface CreateDocumentResponse extends UploadTicket {
  readonly document: WorkspaceDocument;
}

export interface DownloadTicket {
  readonly downloadUrl: string;
  readonly expiresInSeconds: number;
  readonly fileName: string;
}

/* =========================================================================
   CÔNG VIỆC CỦA TÔI (P6)

   Không có bảng dữ liệu riêng: đây là lớp truy vấn tổng hợp trên dữ liệu đã
   có. Mọi truy vấn lọc theo danh tính do guard gắn vào request — **không
   endpoint nào nhận `userId` từ client**, kể cả với `tenant-admin`.
   ========================================================================= */

/** Bốn con số ở đầu trang. */
export interface MyWorkCounters {
  readonly openItems: number;
  readonly overdueItems: number;
  readonly dueToday: number;
  readonly completedThisWeek: number;
}

/**
 * Nhóm theo hạn, không theo dự án.
 *
 * Người dùng mở màn này để biết "hôm nay làm gì", nên trục thời gian mới là
 * thứ đáng chia nhóm; dự án chỉ là nhãn trên từng dòng.
 */
export const MY_WORK_BUCKETS = ['overdue', 'today', 'this_week', 'later', 'no_due'] as const;
export type MyWorkBucket = (typeof MY_WORK_BUCKETS)[number];

export interface MyWorkItem {
  readonly item: WorkItem;
  readonly bucket: MyWorkBucket;
  readonly projectCode: string;
  readonly projectName: string;
}

/** Sự kiện hôm nay mà tôi có mặt và chưa từ chối. */
export interface MyWorkEvent {
  readonly eventId: string;
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly allDay: boolean;
  readonly location?: string;
  readonly responseStatus: ParticipantResponse;
  readonly projectId?: string;
}

/** Một lượt có người nhắc tên tôi trong chat. */
export interface MyWorkMention {
  readonly messageId: string;
  readonly channelId: string;
  readonly entityType: ChatEntityType;
  readonly entityId: string;
  readonly projectId: string;
  readonly excerpt: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

/**
 * Con trỏ sang module khác, gắn trên công việc của tôi.
 *
 * Chỉ nhãn cache để hiển thị nhanh; **nguồn sự thật luôn là module gốc**.
 * `cachedStatus` không bao giờ được dùng làm căn cứ cho quyết định nghiệp vụ.
 */
export interface MyWorkExternalCard {
  readonly id: string;
  readonly workItemId: string;
  readonly workItemTitle: string;
  readonly moduleKey: string;
  readonly externalCode?: string;
  readonly launchUrl: string;
  readonly cachedLabel?: string;
  readonly cachedStatus?: string;
  readonly syncedAt?: string;
}

export interface MyWorkSummary {
  readonly counters: MyWorkCounters;
  readonly items: readonly MyWorkItem[];
  readonly todayEvents: readonly MyWorkEvent[];
  readonly pendingInvitations: readonly MyWorkEvent[];
  readonly mentions: readonly MyWorkMention[];
  readonly externalCards: readonly MyWorkExternalCard[];
  /** Múi giờ dùng để cắt "hôm nay" và "tuần này". */
  readonly timezone: string;
  readonly today: string;
}

/* =========================================================================
   BÁO CÁO (P7)

   Phạm vi áp **trong câu SQL**, không lọc sau khi lấy dữ liệu:
   · `member` và `viewer` — số liệu của chính mình, cộng tổng quan các dự án
     mình tham gia
   · `owner` và `manager` — toàn bộ dự án mình phụ trách, gồm mọi thành viên
   · `tenant-admin` — toàn bộ dự án trong tenant
   ========================================================================= */

/** Khoảng tra cứu tối đa của báo cáo, bằng đúng trần của lịch. */
export const MAX_REPORT_RANGE_DAYS = MAX_QUERY_RANGE_DAYS;

/**
 * Trần số dòng khi xuất Excel.
 *
 * Tệp sinh ở trình duyệt; vượt ngưỡng này thì tab treo trước khi tệp xong,
 * nên chặn sớm và yêu cầu thu hẹp bộ lọc vẫn hơn.
 */
export const MAX_EXPORT_ROWS = 50_000;

/** Khối "Của tôi" đứng đầu trang, bất kể vai trò. */
export interface MyReportBlock {
  readonly openItems: number;
  readonly overdueItems: number;
  readonly completedInPeriod: number;
}

/** Một dòng của báo cáo tiến độ dự án. */
export interface ProjectProgressRow {
  readonly projectId: string;
  readonly projectCode: string;
  readonly projectName: string;
  readonly status: ProjectStatus;
  readonly progressPercent: number;
  readonly totalItems: number;
  readonly closedItems: number;
  readonly overdueItems: number;
  readonly startDate?: string;
  readonly endDate?: string;
}

/** Một dòng của báo cáo tải công việc, theo người phụ trách. */
export interface WorkloadRow {
  readonly userId: string;
  readonly openItems: number;
  readonly overdueItems: number;
  readonly dueThisWeek: number;
  /** Tổng giờ ước lượng của việc đang mở; việc chưa ước lượng không cộng. */
  readonly estimatedHours: number;
}

/** Một dòng của báo cáo công việc quá hạn. */
export interface OverdueRow {
  readonly workItemId: string;
  readonly code: string;
  readonly title: string;
  readonly projectCode: string;
  readonly projectName: string;
  readonly assigneeUserId?: string;
  readonly plannedEnd: string;
  /** Số ngày đã trôi qua kể từ hạn, tính theo múi giờ tenant. */
  readonly daysLate: number;
  readonly status: WorkItemStatus;
}

export interface ReportScope {
  /** Vai trò cao nhất người gọi có trong phạm vi đang xem. */
  readonly level: 'self' | 'managed' | 'tenant';
  /** Số dự án nằm trong phạm vi. */
  readonly projectCount: number;
  /** Người gọi có được xem số tiền không; khối tài chính thuộc P9. */
  readonly canSeeFinance: boolean;
}

export interface ReportBundle {
  readonly scope: ReportScope;
  readonly mine: MyReportBlock;
  readonly projectProgress: readonly ProjectProgressRow[];
  readonly workload: readonly WorkloadRow[];
  readonly overdue: readonly OverdueRow[];
  /** Chỉ có mặt khi `scope.canSeeFinance`; vắng hẳn với mức `self`. */
  readonly finance?: FinanceSummaryBlock;
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
  /** Thời điểm sinh số liệu; ghi kèm khi xuất Excel. */
  readonly generatedAt: string;
}

/* =========================================================================
   LIÊN MODULE (P8)

   "Workspace hiển thị, module gốc sở hữu." Workspace chỉ giữ con trỏ và một
   nhãn cache để hiển thị nhanh; nguồn sự thật luôn là module gốc.
   ========================================================================= */

export const EXTERNAL_MODULE_KEYS = [
  'procedure-engine',
  'maintenance',
  'inventory',
  'crm',
] as const;
export type ExternalModuleKey = (typeof EXTERNAL_MODULE_KEYS)[number];

/** Nhãn cache được coi là còn tươi trong ngần này giây. */
export const EXTERNAL_CACHE_TTL_SECONDS = 60;

/** Quá thời gian này thì bỏ cuộc gọi sang module khác và dùng nhãn cache. */
export const EXTERNAL_TIMEOUT_SECONDS = 3;

export interface ExternalReference {
  readonly id: string;
  readonly entityType: 'project' | 'work_item';
  readonly entityId: string;
  readonly projectId: string;
  readonly moduleKey: ExternalModuleKey;
  readonly externalId: string;
  readonly externalCode?: string;
  /** Đường dẫn mở hồ sơ ở module gốc; lấy từ chính module đó, không tự ghép. */
  readonly launchUrl: string;
  /** Bản sao để hiển thị, có thể cũ. KHÔNG dùng làm căn cứ nghiệp vụ. */
  readonly cachedLabel?: string;
  readonly cachedStatus?: string;
  readonly syncedAt?: string;
  readonly createdAt: string;
}

export interface CreateExternalReferenceRequest {
  readonly moduleKey: ExternalModuleKey;
  readonly externalId: string;
  readonly externalCode?: string;
  readonly launchUrl: string;
  readonly cachedLabel?: string;
  readonly cachedStatus?: string;
}

/**
 * Danh sách con trỏ kèm cờ độ tươi.
 *
 * `degraded` bật khi không đọc được module gốc trong thời hạn: nhãn trả về là
 * bản cache cũ, và giao diện phải nói rõ điều đó thay vì im lặng hiện số liệu
 * có thể đã sai.
 */
export interface ExternalReferenceList {
  readonly items: readonly ExternalReference[];
  readonly degraded: boolean;
}

/* =========================================================================
   TÀI CHÍNH (P9)

   Đơn vị VND. Chưa hỗ trợ đa tiền tệ. Chỉ `owner`, `manager` và quản trị viên
   tenant được thấy và sửa — `member` và `viewer` không nhận được bất kỳ con
   số tiền nào, kể cả trong payload của các endpoint khác.
   ========================================================================= */

/** Số liệu tài chính của một dự án, đã tính sẵn các giá trị dẫn xuất. */
export interface ProjectFinance {
  readonly projectId: string;
  readonly contractValue: number | null;
  readonly budget: number | null;
  readonly committedCost: number;
  readonly forecastCostOverride: number | null;
  readonly actualCost: number;
  /** Tổng dự toán của các công việc CHƯA đóng. */
  readonly remainingEstimate: number;
  readonly forecastCost: number;
  readonly forecastOverridden: boolean;
  readonly profit: number | null;
  /** Phần trăm, một chữ số thập phân. Rỗng khi chưa có giá trị hợp đồng. */
  readonly profitMargin: number | null;
  /** Ngân sách trừ dự kiến; âm nghĩa là sẽ vượt ngân sách. */
  readonly budgetVariance: number | null;
  /** Chi phí từng công việc, để bảng chi tiết và form công việc dùng lại. */
  readonly items: readonly WorkItemCost[];
}

export interface WorkItemCost {
  readonly workItemId: string;
  readonly code: string;
  readonly title: string;
  readonly status: WorkItemStatus;
  readonly estimatedCost: number | null;
  readonly actualCost: number;
}

/** `null` xoá giá trị đã nhập; bỏ trống trường nghĩa là không đụng tới. */
export interface UpdateProjectFinanceRequest {
  readonly contractValue?: number | null;
  readonly budget?: number | null;
  readonly committedCost?: number;
  readonly forecastCostOverride?: number | null;
}

/**
 * Chỉ còn chi phí DỰ TOÁN. Chi phí thực tế không sửa thẳng được nữa — mỗi
 * lượt phát sinh ghi thành một dòng sổ qua `POST /work-items/:id/cost-entries`.
 */
export interface UpdateWorkItemCostRequest {
  readonly estimatedCost?: number | null;
}

/** Một dòng sổ ghi chi phí thực tế. Chỉ ghi thêm, không sửa, không xoá. */
export interface CostEntry {
  readonly id: string;
  readonly workItemId: string;
  readonly projectId: string;
  /** Âm nghĩa là dòng điều chỉnh. */
  readonly amount: number;
  readonly note: string;
  readonly createdBy: string;
  readonly createdAt: string;
  /** Kèm sẵn để hiện lịch sử theo dự án mà không phải tra thêm. */
  readonly workItemCode: string;
  readonly workItemTitle: string;
}

export interface CreateCostEntryRequest {
  readonly amount: number;
  readonly note: string;
}

export interface CostEntryList {
  readonly items: readonly CostEntry[];
}

/** Số dòng sổ tối đa mỗi lần đọc. */
export const COST_ENTRY_PAGE_SIZE = 200;
/** Lý do ghi chi phí tối đa 500 ký tự — khớp `VARCHAR(500)` ở `0007`. */
export const MAX_COST_NOTE_LENGTH = 500;

/** Khối tổng hợp tài chính ở trang Báo cáo. */
export interface FinanceSummaryBlock {
  readonly projectCount: number;
  readonly contractValue: number;
  readonly budget: number;
  readonly actualCost: number;
  readonly forecastCost: number;
  readonly profit: number;
  /** Có trọng số theo giá trị hợp đồng, không phải trung bình cộng các tỉ lệ. */
  readonly profitMargin: number | null;
}

/* =========================================================================
   DANH BẠ TỔ CHỨC (P11)

   Người trong tổ chức của tenant, đọc từ organization context của Tenant
   Core. Dùng để thêm thành viên dự án, mời người tham dự sự kiện và hiện tên
   thật thay cho userId. Chỉ là danh bạ: KHÔNG mang quyền hay vai trò.
   ========================================================================= */

export interface DirectoryPerson {
  readonly userId: string;
  readonly displayName: string;
  readonly email?: string;
  /** Tên các đơn vị người này thuộc về, nối sẵn để hiện trên một dòng. */
  readonly unitNames: readonly string[];
  readonly positionName?: string;
  /**
   * Id các node cơ cấu người này được bổ nhiệm vào — thường là **chức danh**,
   * và id đơn vị cha của chúng.
   *
   * Dùng để đối chiếu với phân vai của module Quy trình: ở đó một vai được gán
   * cho user, cho chức danh hoặc cho đơn vị, và `subjectId` chính là id node
   * trong cùng cây cơ cấu này. Có id thì Workspace mới biết trước quy trình nào
   * người dùng được phép khởi tạo, thay vì để họ bấm rồi nhận 403.
   */
  readonly orgNodeIds?: readonly string[];
}

export interface DirectoryResponse {
  readonly people: readonly DirectoryPerson[];
  /** Không đọc được Tenant Core; danh sách có thể rỗng hoặc cũ. */
  readonly degraded: boolean;
}

/** Danh bạ đổi rất chậm; đọc lại sau mỗi phút là đủ. */
export const DIRECTORY_CACHE_TTL_SECONDS = 60;
export const DIRECTORY_TIMEOUT_SECONDS = 3;

/* =========================================================================
   ĐỌC NỘI BỘ (P11)

   Cho module khác (Quy trình, Bảo trì…) hiện nhãn của công việc / dự án mà
   hồ sơ của họ đang trỏ tới. Gọi service-to-service bằng `x-service-token`
   cộng `x-tenant-id`; **không bao giờ** kèm số liệu tài chính, mô tả hay danh
   sách thành viên — bên gọi không mang danh tính người dùng nên không có cách
   kiểm vai trò dự án.
   ========================================================================= */

export interface InternalWorkItemSummary {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly itemType: WorkItemType;
  readonly executionType: WorkItemExecutionType;
  readonly status: WorkItemStatus;
  readonly priority: WorkItemPriority;
  readonly assigneeUserId?: string;
  readonly plannedStart?: string;
  readonly plannedEnd?: string;
  readonly progressPercent: number;
  readonly project: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly status: ProjectStatus;
  };
  /** Đường dẫn mở module Workspace; bên gọi dùng làm link "Mở trong Workspace". */
  readonly launchUrl: string;
}

export interface InternalProjectSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly ownerUserId: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly progressPercent: number;
  readonly totalItems: number;
  readonly closedItems: number;
  readonly overdueItems: number;
  readonly launchUrl: string;
}

/** Trùng `launch_url` của module trong danh mục Platform (xem `apps/migrator`). */
export const WORKSPACE_LAUNCH_URL = '/modules/workspace';
