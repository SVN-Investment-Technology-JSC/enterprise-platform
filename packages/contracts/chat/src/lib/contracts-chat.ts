/**
 * Chat nội bộ của core: kiểu dữ liệu dùng chung giữa core API (`apps/api`, gói `platform-chat`) và giao diện
 * (`feature-chat`). Chat thuộc core nên chạy cho mọi tenant, không phụ thuộc phân hệ nào được bật.
 */

export const CHAT_API_ROOT = '/api/platform/v1/chat';
export const PROFILE_API_ROOT = '/api/platform/v1/profile';
export const PEOPLE_API_ROOT = '/api/platform/v1/people';

/** URL ảnh đại diện; `version` đổi mỗi lần thay ảnh nên trình duyệt cache lâu mà vẫn thấy ảnh mới. */
export function userAvatarUrl(userId: string, version: number): string {
  return `/api/platform/v1/users/${encodeURIComponent(userId)}/avatar?v=${version}`;
}

export const CHAT_CONVERSATION_KINDS = ['company', 'direct', 'group'] as const;
export type ChatConversationKind = (typeof CHAT_CONVERSATION_KINDS)[number];

/** Tên cố định của cuộc trò chuyện chung toàn công ty. */
export const CHAT_COMPANY_TITLE = 'Tất cả nội bộ';

export const CHAT_MAX_BODY_LENGTH = 5000;
export const CHAT_MAX_TITLE_LENGTH = 120;
/** Sửa tin trong 15 phút sau khi gửi; thu hồi thì lúc nào cũng được. */
export const CHAT_EDIT_WINDOW_MINUTES = 15;
export const CHAT_PAGE_SIZE = 30;
export const CHAT_MAX_PAGE_SIZE = 100;
export const CHAT_MAX_GROUP_MEMBERS = 200;
export const CHAT_MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const CHAT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Tin "đã nhận", "đã xem" chỉ phát tín hiệu cho nhóm nhỏ; cuộc chung toàn công ty xem lại khi mở. */
export const CHAT_RECEIPT_SIGNAL_MAX_MEMBERS = 50;

export const CHAT_IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const CHAT_ALLOWED_CONTENT_TYPES = [
  ...CHAT_IMAGE_CONTENT_TYPES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'text/plain',
  'text/csv',
] as const;

export function isChatImageType(contentType: string): boolean {
  return (CHAT_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType.toLowerCase());
}

export function isChatAllowedType(contentType: string): boolean {
  return (CHAT_ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType.toLowerCase());
}

/** Cảm xúc thả vào tin; giao diện vẽ bằng icon SVG, không dùng emoji. */
export const CHAT_REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'] as const;
export type ChatReaction = (typeof CHAT_REACTIONS)[number];

export const CHAT_REACTION_LABELS: Readonly<Record<ChatReaction, string>> = {
  like: 'Thích',
  love: 'Yêu thích',
  haha: 'Haha',
  wow: 'Wow',
  sad: 'Buồn',
  angry: 'Phẫn nộ',
};

export function isChatReaction(value: unknown): value is ChatReaction {
  return typeof value === 'string' && (CHAT_REACTIONS as readonly string[]).includes(value);
}

/* ------------------------------- Người dùng ------------------------------- */

/** Một người trong danh bạ của công ty (người dùng core đang hoạt động). */
export interface ChatPerson {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  /** Null khi chưa có ảnh đại diện (giao diện hiện chữ viết tắt). */
  readonly avatarVersion: number | null;
}

export interface PeopleDirectory {
  readonly people: readonly ChatPerson[];
}

export interface MyProfile {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly avatarVersion: number | null;
}

/** Ảnh đại diện nhận vào (sau khi trình duyệt đã cắt vuông và thu nhỏ). */
export const AVATAR_MAX_UPLOAD_BYTES = 1024 * 1024;
/** Ảnh gốc người dùng chọn, trước khi trình duyệt thu nhỏ. */
export const AVATAR_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const AVATAR_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Cạnh ảnh đại diện sau khi thu nhỏ. */
export const AVATAR_SIZE_PX = 512;

/* -------------------------------- Tin nhắn -------------------------------- */

export interface ChatAttachmentView {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly isImage: boolean;
}

export type ChatSystemEvent =
  | { readonly type: 'group.created'; readonly title: string }
  | { readonly type: 'members.added'; readonly userIds: readonly string[] }
  | { readonly type: 'member.removed'; readonly userId: string }
  | { readonly type: 'member.left' }
  | { readonly type: 'title.changed'; readonly title: string };

export interface ChatReactionSummary {
  readonly reaction: ChatReaction;
  readonly userIds: readonly string[];
}

export interface ChatReplyPreview {
  readonly id: string;
  readonly senderId: string;
  readonly excerpt: string;
  readonly isDeleted: boolean;
  readonly hasAttachments: boolean;
}

export interface ChatMessageView {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly kind: 'text' | 'system';
  /** Rỗng khi tin đã thu hồi. */
  readonly body: string;
  readonly mentions: readonly string[];
  readonly replyTo: ChatReplyPreview | null;
  readonly attachments: readonly ChatAttachmentView[];
  readonly reactions: readonly ChatReactionSummary[];
  readonly systemEvent: ChatSystemEvent | null;
  readonly clientId: string | null;
  readonly isEdited: boolean;
  readonly isDeleted: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChatMessagePreview {
  readonly id: string;
  readonly senderId: string;
  readonly kind: 'text' | 'system';
  readonly excerpt: string;
  readonly attachmentCount: number;
  readonly hasImage: boolean;
  readonly isDeleted: boolean;
  readonly systemEvent: ChatSystemEvent | null;
  readonly createdAt: string;
}

/** Mốc đã đọc / đã nhận của một thành viên. */
export interface ChatMemberView {
  readonly userId: string;
  readonly role: 'owner' | 'member';
  readonly lastReadAt: string | null;
  readonly lastDeliveredAt: string | null;
}

export interface ChatConversationView {
  readonly id: string;
  readonly kind: ChatConversationKind;
  /** Nhóm: tên nhóm; chung toàn công ty: `CHAT_COMPANY_TITLE`; 1-1: null (giao diện dùng tên người kia). */
  readonly title: string | null;
  /** 1-1: người còn lại. */
  readonly peerUserId: string | null;
  /** Thành viên đang trong cuộc trò chuyện; cuộc chung toàn công ty không liệt kê (là mọi người). */
  readonly memberIds: readonly string[];
  readonly memberCount: number;
  readonly myRole: 'owner' | 'member' | null;
  readonly muted: boolean;
  readonly unreadCount: number;
  /** Số tin chưa đọc có nhắc tên mình. */
  readonly unreadMentionCount: number;
  readonly lastMessage: ChatMessagePreview | null;
  readonly lastMessageAt: string | null;
  readonly createdAt: string;
}

export interface ChatConversationList {
  readonly items: readonly ChatConversationView[];
  readonly unreadTotal: number;
}

export interface ChatMessagePage {
  readonly conversation: ChatConversationView;
  /** Cũ đến mới. */
  readonly messages: readonly ChatMessageView[];
  readonly hasMore: boolean;
  /** Mốc đã đọc/đã nhận của các thành viên khác (cuộc chung: những ai đã từng đọc). */
  readonly members: readonly ChatMemberView[];
}

export interface ChatUnreadSummary {
  readonly unreadTotal: number;
}

/* -------------------------------- Yêu cầu --------------------------------- */

export interface SendChatMessageRequest {
  readonly body: string;
  readonly mentions?: readonly string[];
  readonly replyToId?: string | null;
  readonly attachmentIds?: readonly string[];
  readonly clientId?: string;
}

export interface SendChatMessageResponse {
  readonly message: ChatMessageView;
  /** Người được nhắc nhưng không ở trong cuộc trò chuyện (không gửi thông báo). */
  readonly droppedMentions: readonly string[];
}

export interface UpdateChatMessageRequest {
  readonly body: string;
  readonly mentions?: readonly string[];
}

export interface CreateDirectChatRequest {
  readonly userId: string;
}

export interface CreateGroupChatRequest {
  readonly title: string;
  readonly memberIds: readonly string[];
}

export interface UpdateChatConversationRequest {
  readonly title?: string;
  readonly muted?: boolean;
}

export interface AddChatMembersRequest {
  readonly userIds: readonly string[];
}

export interface MarkChatReadRequest {
  readonly messageId: string;
}

export interface ReactChatMessageRequest {
  /** Null để bỏ cảm xúc đã thả. */
  readonly reaction: ChatReaction | null;
}

export interface InitiateChatAttachmentRequest {
  readonly conversationId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface InitiateChatAttachmentResponse {
  readonly attachment: ChatAttachmentView;
  readonly uploadUrl: string;
  readonly uploadHeaders: Readonly<Record<string, string>>;
}

export interface ChatAttachmentUrl {
  readonly url: string;
  readonly expiresAt: string;
}

/** Ai nhận tín hiệu "đang nhập" (realtime-api hỏi bằng cookie của người gõ). */
export type ChatTypingRecipients =
  | { readonly audience: 'members'; readonly userIds: readonly string[] }
  | { readonly audience: 'company' };

/* ------------------------------ Sự kiện outbox ------------------------------ */

/** Loại sự kiện outbox core ghi khi chat đổi; realtime-api đổi thành tín hiệu `core.chat.changed`. */
export const CORE_CHAT_CHANGED_EVENT = 'core.chat.changed';
/** Được nhắc tên trong chat; notification-worker tạo thông báo cho người được nhắc. */
export const CORE_CHAT_MENTION_EVENT = 'core.chat.mention';
/** Đổi hoặc gỡ ảnh đại diện (Mạng nội bộ đã nghe sự kiện này để đăng hoạt động). */
export const CORE_USER_AVATAR_UPDATED_EVENT = 'core.user.avatar-updated';

export const CORE_CHAT_CHANGES = [
  'message.created',
  'message.edited',
  'message.deleted',
  'reaction.changed',
  'read',
  'delivered',
  'conversation.updated',
  'members.changed',
] as const;
export type CoreChatChange = (typeof CORE_CHAT_CHANGES)[number];

export function isCoreChatChange(value: unknown): value is CoreChatChange {
  return typeof value === 'string' && (CORE_CHAT_CHANGES as readonly string[]).includes(value);
}

/**
 * Payload của sự kiện outbox `core.chat.changed`. Chỉ mang định danh, không mang nội dung tin: người nhận gọi lại
 * API (có kiểm quyền) để lấy dữ liệu. `audience: 'company'` gửi cho mọi phiên của công ty, khi đó không có danh sách.
 */
export interface CoreChatChangedPayload {
  readonly conversationId: string;
  readonly messageId: string | null;
  readonly change: CoreChatChange;
  readonly actorUserId: string;
  readonly audience: 'members' | 'company';
  readonly recipientUserIds: readonly string[];
}

/** Đường dẫn trong thông báo khi được nhắc tên; trung tâm thông báo đổi thành `#chat/<id>` trên trang hiện tại. */
export function chatNotificationLink(conversationId: string): string {
  return `/chat/${encodeURIComponent(conversationId)}`;
}

/* -------------------------------- Hàm dùng chung -------------------------------- */

/** Chữ viết tắt của họ tên: "Nguyễn Văn An" thành "NA". */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Khoá của chat 1-1: hai id theo thứ tự tăng dần, để mỗi cặp chỉ có một cuộc trò chuyện. */
export function directChatKey(a: string, b: string): string {
  const [first, second] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${first}:${second}`;
}
