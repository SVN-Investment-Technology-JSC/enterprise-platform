import {
  CHAT_COMPANY_TITLE,
  chatNoticeTag,
  isAllowedPushEndpoint,
  type ChatPushMessage,
  type CoreChatMessagePayload,
} from '@enterprise-platform/contracts-chat';
import * as webPush from 'web-push';
import type { ChatDb } from './chat.store.js';
import type { VapidConfig } from './push-config.js';
import { markFailed, markSent, removeSubscriptions, subscriptionsOf, type PushSubscriptionRecord } from './push.store.js';

export { vapidFromEnv, type VapidConfig } from './push-config.js';

/** Một lần gửi tới dịch vụ push; ném lỗi kèm `statusCode` khi dịch vụ từ chối. */
export interface PushSender {
  send(
    subscription: { readonly endpoint: string; readonly keys: { readonly p256dh: string; readonly auth: string } },
    payload: string,
    options: { readonly ttlSeconds: number; readonly topic: string },
  ): Promise<void>;
}

export function webPushSender(vapid: VapidConfig, timeoutMs = 10_000): PushSender {
  return {
    async send(subscription, payload, options) {
      await webPush.sendNotification(subscription, payload, {
        vapidDetails: vapid,
        TTL: options.ttlSeconds,
        topic: options.topic,
        urgency: 'high',
        timeout: timeoutMs,
        contentEncoding: 'aes128gcm',
      });
    },
  };
}

/** Giữ tin chờ trên dịch vụ push tối đa một ngày (máy tắt lâu hơn thì thôi, mở ERP sẽ thấy số tin chưa đọc). */
const TTL_SECONDS = 24 * 60 * 60;
const CONCURRENCY = 16;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0).map((id) => id.toLowerCase()))] : [];
}

export function parseMessagePayload(value: unknown): CoreChatMessagePayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const kind = record.conversationKind;
  if (!text(record.conversationId) || !text(record.messageId) || !text(record.actorUserId)) return null;
  if (kind !== 'company' && kind !== 'direct' && kind !== 'group') return null;
  return {
    conversationId: text(record.conversationId),
    conversationKind: kind,
    conversationTitle: text(record.conversationTitle) || null,
    messageId: text(record.messageId),
    actorUserId: text(record.actorUserId),
    actorName: text(record.actorName) || 'Đồng nghiệp',
    excerpt: text(record.excerpt),
    attachmentCount: Number(record.attachmentCount) || 0,
    hasImage: record.hasImage === true,
    mentionedUserIds: ids(record.mentionedUserIds),
    recipientUserIds: ids(record.recipientUserIds),
  };
}

/** Nội dung thông báo cho một người nhận (người được nhắc tên thấy "nhắc đến bạn"). */
export function pushMessageFor(payload: CoreChatMessagePayload, recipientId: string): ChatPushMessage {
  const where =
    payload.conversationKind === 'direct'
      ? ''
      : ` · ${payload.conversationKind === 'company' ? CHAT_COMPANY_TITLE : (payload.conversationTitle ?? 'Nhóm')}`;
  const mentioned = payload.mentionedUserIds.includes(recipientId.toLowerCase());
  const content =
    payload.excerpt ||
    (payload.hasImage
      ? payload.attachmentCount > 1
        ? `Đã gửi ${payload.attachmentCount} ảnh`
        : 'Đã gửi một ảnh'
      : `Đã gửi ${payload.attachmentCount} tệp đính kèm`);
  return {
    type: 'chat.message',
    tag: chatNoticeTag(payload.messageId),
    title: `${payload.actorName}${where}${mentioned ? ' nhắc đến bạn' : ''}`,
    body: content,
    conversationId: payload.conversationId,
    url: `/dashboard#chat/${payload.conversationId}`,
    icon: '/brand-logo.jpg',
  };
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

export interface DispatchOutcome {
  readonly sent: number;
  readonly removed: number;
  readonly failed: number;
}

/**
 * Gửi thông báo đẩy cho người nhận một tin chat (worker gọi khi nhận `core.chat.message`). Cố gắng tốt nhất: lỗi từng
 * trình duyệt không làm hỏng các trình duyệt khác và không ném ra (để không gửi lại cho người đã nhận). Đăng ký hết hạn
 * (404/410) hoặc địa chỉ không còn hợp lệ thì xoá.
 */
export class ChatPushDispatcher {
  constructor(private readonly sender: PushSender | null) {}

  get enabled(): boolean {
    return this.sender !== null;
  }

  async handle(db: ChatDb, raw: unknown): Promise<DispatchOutcome> {
    const payload = parseMessagePayload(raw);
    if (!this.sender || !payload || payload.recipientUserIds.length === 0) return { sent: 0, removed: 0, failed: 0 };
    const recipients = payload.recipientUserIds.filter((id) => id !== payload.actorUserId.toLowerCase());
    const subscriptions = await subscriptionsOf(db, recipients);
    const sent: string[] = [];
    const removed: string[] = [];
    const failed: string[] = [];
    const topic = payload.conversationId.replace(/-/g, '').slice(0, 32);

    const sendOne = async (subscription: PushSubscriptionRecord) => {
      if (!isAllowedPushEndpoint(subscription.endpoint)) {
        removed.push(subscription.id);
        return;
      }
      const message = pushMessageFor(payload, subscription.userId);
      try {
        await (this.sender as PushSender).send(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(message),
          { ttlSeconds: TTL_SECONDS, topic },
        );
        sent.push(subscription.id);
      } catch (error) {
        const status = statusOf(error);
        if (status === 404 || status === 410) removed.push(subscription.id);
        else failed.push(subscription.id);
      }
    };

    for (let index = 0; index < subscriptions.length; index += CONCURRENCY) {
      await Promise.all(subscriptions.slice(index, index + CONCURRENCY).map(sendOne));
    }
    await markSent(db, sent);
    await removeSubscriptions(db, removed);
    await markFailed(db, failed);
    return { sent: sent.length, removed: removed.length, failed: failed.length };
  }
}
