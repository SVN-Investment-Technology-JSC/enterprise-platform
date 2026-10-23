import { randomUUID } from 'node:crypto';
import {
  CORE_CHAT_CHANGED_EVENT,
  CORE_CHAT_MENTION_EVENT,
  chatNotificationLink,
  type CoreChatChange,
  type CoreChatChangedPayload,
} from '@enterprise-platform/contracts-chat';
import { createIntegrationEvent } from '@enterprise-platform/contracts-integration';
import type { ChatDb } from './chat.store.js';

const SOURCE = 'platform-chat';

/** Payload của `core.chat.mention`; notification-worker tạo thông báo "được nhắc tên" từ đây. */
export interface CoreChatMentionPayload {
  readonly mentionId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly mentionedUserIds: readonly string[];
  readonly actorUserId: string;
  readonly actorName: string;
  readonly conversationTitle: string | null;
  readonly excerpt: string;
  readonly deepLink: string;
}

async function insertOutbox(
  db: ChatDb,
  tenantId: string,
  type: string,
  aggregateId: string,
  payload: unknown,
  newId: () => string,
): Promise<void> {
  const event = createIntegrationEvent({
    id: newId(),
    type,
    tenantId,
    source: SOURCE,
    correlationId: newId(),
    payload,
  });
  await db.query(
    `INSERT INTO integration_schema.outbox_events
       (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
     VALUES ($1, 'core-chat-conversation', $2, $3, 1, $4::jsonb, $5)`,
    [event.id, aggregateId, event.type, JSON.stringify(event), event.occurredAt],
  );
}

/**
 * Tín hiệu "cuộc trò chuyện có thay đổi", ghi vào outbox cùng giao dịch với thay đổi. Chỉ mang định danh: người nhận
 * gọi lại API để lấy dữ liệu. Không có ai nhận (nhóm chỉ còn người làm) thì không ghi gì.
 */
export async function writeChatSignal(
  db: ChatDb,
  input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly messageId: string | null;
    readonly change: CoreChatChange;
    readonly actorUserId: string;
    readonly audience: 'members' | 'company';
    readonly recipientUserIds: readonly string[];
  },
  newId: () => string = randomUUID,
): Promise<void> {
  const recipients = [...new Set(input.recipientUserIds.map((id) => id.toLowerCase()))].filter(
    (id) => id !== input.actorUserId.toLowerCase(),
  );
  if (input.audience === 'members' && recipients.length === 0) return;
  const payload: CoreChatChangedPayload = {
    conversationId: input.conversationId,
    messageId: input.messageId,
    change: input.change,
    actorUserId: input.actorUserId,
    audience: input.audience,
    recipientUserIds: input.audience === 'company' ? [] : recipients,
  };
  await insertOutbox(db, input.tenantId, CORE_CHAT_CHANGED_EVENT, input.conversationId, payload, newId);
}

export async function writeMentionEvent(
  db: ChatDb,
  input: Omit<CoreChatMentionPayload, 'mentionId' | 'deepLink'> & { readonly tenantId: string },
  newId: () => string = randomUUID,
): Promise<void> {
  const mentioned = [...new Set(input.mentionedUserIds.map((id) => id.toLowerCase()))].filter(
    (id) => id !== input.actorUserId.toLowerCase(),
  );
  if (mentioned.length === 0) return;
  const payload: CoreChatMentionPayload = {
    mentionId: newId(),
    conversationId: input.conversationId,
    messageId: input.messageId,
    mentionedUserIds: mentioned,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    conversationTitle: input.conversationTitle,
    excerpt: input.excerpt,
    deepLink: chatNotificationLink(input.conversationId),
  };
  await insertOutbox(db, input.tenantId, CORE_CHAT_MENTION_EVENT, input.conversationId, payload, newId);
}
