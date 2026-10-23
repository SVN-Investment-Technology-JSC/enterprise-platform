import {
  CHAT_API_ROOT,
  PEOPLE_API_ROOT,
  PROFILE_API_ROOT,
  type ChatAttachmentUrl,
  type ChatAttachmentView,
  type ChatConversationList,
  type ChatConversationView,
  type ChatMessagePage,
  type ChatMessageView,
  type ChatReaction,
  type ChatUnreadSummary,
  type InitiateChatAttachmentResponse,
  type MyProfile,
  type PeopleDirectory,
  type SendChatMessageRequest,
  type SendChatMessageResponse,
  type UpdateChatConversationRequest,
  type UpdateChatMessageRequest,
} from '@enterprise-platform/contracts-chat';
import type { PresenceSnapshot } from '@enterprise-platform/contracts-realtime';
import { authFetch } from '@enterprise-platform/shared-ui';

export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await authFetch(path, { cache: 'no-store', ...init });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    const message = Array.isArray(payload.message) ? payload.message[0] : payload.message;
    if (response.status === 401) throw new ChatApiError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 401);
    throw new ChatApiError(message || `Máy chủ trả về lỗi (HTTP ${response.status}).`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

const conversation = (id: string) => `${CHAT_API_ROOT}/conversations/${encodeURIComponent(id)}`;
const message = (id: string) => `${CHAT_API_ROOT}/messages/${encodeURIComponent(id)}`;

/** Gọi API chat nội bộ, danh bạ và hồ sơ của core (luôn có, không phụ thuộc phân hệ nào). */
export const chatApi = {
  conversations: () => request<ChatConversationList>(`${CHAT_API_ROOT}/conversations`),
  unread: () => request<ChatUnreadSummary>(`${CHAT_API_ROOT}/unread`),
  conversation: (id: string) => request<ChatConversationView>(conversation(id)),
  company: () => request<ChatConversationView>(`${CHAT_API_ROOT}/conversations/company`),
  direct: (userId: string) => request<ChatConversationView>(`${CHAT_API_ROOT}/conversations/direct`, json('POST', { userId })),
  group: (title: string, memberIds: readonly string[]) =>
    request<ChatConversationView>(`${CHAT_API_ROOT}/conversations/group`, json('POST', { title, memberIds })),
  update: (id: string, patch: UpdateChatConversationRequest) => request<ChatConversationView>(conversation(id), json('PATCH', patch)),
  addMembers: (id: string, userIds: readonly string[]) =>
    request<ChatConversationView>(`${conversation(id)}/members`, json('POST', { userIds })),
  removeMember: (id: string, userId: string) =>
    request<ChatConversationView>(`${conversation(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  leave: (id: string) => request<void>(`${conversation(id)}/leave`, { method: 'POST' }),
  messages: (id: string, before?: string) =>
    request<ChatMessagePage>(`${conversation(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  send: (id: string, body: SendChatMessageRequest) => request<SendChatMessageResponse>(`${conversation(id)}/messages`, json('POST', body)),
  markRead: (id: string, messageId: string) => request<ChatConversationView>(`${conversation(id)}/read`, json('POST', { messageId })),
  edit: (id: string, body: UpdateChatMessageRequest) => request<ChatMessageView>(message(id), json('PATCH', body)),
  recall: (id: string) => request<ChatMessageView>(message(id), { method: 'DELETE' }),
  react: (id: string, reaction: ChatReaction | null) => request<ChatMessageView>(`${message(id)}/reaction`, json('PUT', { reaction })),
  attachmentUrl: (id: string) => request<ChatAttachmentUrl>(`${CHAT_API_ROOT}/attachments/${encodeURIComponent(id)}/url`),

  /** Tải một tệp lên: xin URL ký sẵn, gửi thẳng tới kho đối tượng, rồi xác nhận để máy chủ đối chiếu dung lượng. */
  async upload(conversationId: string, file: File, signal?: AbortSignal): Promise<ChatAttachmentView> {
    const started = await request<InitiateChatAttachmentResponse>(
      `${CHAT_API_ROOT}/attachments/uploads`,
      json('POST', { conversationId, fileName: file.name || 'tep-dinh-kem', contentType: file.type || 'application/octet-stream', sizeBytes: file.size }),
    );
    const put = await fetch(started.uploadUrl, { method: 'PUT', headers: { ...started.uploadHeaders }, body: file, signal });
    if (!put.ok) throw new ChatApiError('Không tải tệp lên được. Vui lòng thử lại.', put.status);
    await request<{ id: string }>(`${CHAT_API_ROOT}/attachments/${encodeURIComponent(started.attachment.id)}/complete`, { method: 'POST' });
    return started.attachment;
  },

  people: () => request<PeopleDirectory>(PEOPLE_API_ROOT),
  profile: () => request<MyProfile>(PROFILE_API_ROOT),
  async setAvatar(image: Blob): Promise<MyProfile> {
    const form = new FormData();
    form.append('file', image, image.type === 'image/png' ? 'avatar.png' : image.type === 'image/webp' ? 'avatar.webp' : 'avatar.jpg');
    return request<MyProfile>(`${PROFILE_API_ROOT}/avatar`, { method: 'PUT', body: form });
  },
  removeAvatar: () => request<MyProfile>(`${PROFILE_API_ROOT}/avatar`, { method: 'DELETE' }),
  presence: () => request<PresenceSnapshot>('/api/realtime/v1/presence'),
};
