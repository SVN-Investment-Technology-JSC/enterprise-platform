import type { CoreChatChange } from '@enterprise-platform/contracts-chat';

/**
 * Tín hiệu "cuộc trò chuyện của chat core có thay đổi" (sự kiện `core.chat.changed`). Chỉ mang định danh: người nhận
 * gọi lại API chat (có kiểm quyền) để lấy dữ liệu, nên nội dung tin không đi qua broker và Redis.
 */
export interface CoreChatSignal {
  readonly conversationId: string;
  readonly messageId: string | null;
  readonly change: CoreChatChange;
  readonly actorUserId: string;
}

/** "Đang nhập" ở một cuộc trò chuyện (sự kiện `core.chat.typing`); tín hiệu tạm, không lưu ở đâu. */
export interface CoreChatTyping {
  readonly conversationId: string;
  /** Người đang gõ, do máy chủ gắn từ phiên đăng nhập, không lấy từ client. */
  readonly userId: string;
  readonly typing: boolean;
}

/** Client báo đang gõ (tên sự kiện gửi lên socket: `core-chat.typing`). */
export interface CoreChatTypingMessage {
  readonly conversationId: string;
  readonly typing: boolean;
}

export const CORE_CHAT_TYPING_CLIENT_EVENT = 'core-chat.typing';

/** Một người vừa trực tuyến hoặc vừa rời mạng (sự kiện `core.presence.changed`, gửi cho mọi phiên của công ty). */
export interface PresenceSignal {
  readonly userId: string;
  readonly online: boolean;
  /** Lần cuối còn kết nối; null khi đang trực tuyến hoặc chưa từng có. */
  readonly lastSeenAt: string | null;
}

/** Ảnh chụp trạng thái trực tuyến của cả công ty (`GET /api/realtime/v1/presence`). */
export interface PresenceSnapshot {
  readonly online: readonly string[];
  /** Id người dùng sang thời điểm cuối còn kết nối, cho người đang ngoại tuyến. */
  readonly lastSeen: Readonly<Record<string, string>>;
}
