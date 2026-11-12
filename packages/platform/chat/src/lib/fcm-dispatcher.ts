import { chatNotificationLink } from '@enterprise-platform/contracts-chat';
import {
  parseRealtimeEventEnvelope,
  type NotificationRecord,
} from '@enterprise-platform/contracts-realtime';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { ChatDb } from './chat.store.js';
import { logFcmBootStatus } from './fcm-config.js';
import {
  fcmTableReady,
  fcmTokensOf,
  markFcmFailed,
  markFcmSent,
  removeFcmTokens,
  revokeFcmDeviceTokens,
  type FcmDeviceTokenRecord,
} from './fcm.store.js';
import { parseMessagePayload, pushMessageFor, type DispatchOutcome } from './push-dispatcher.js';

const FCM_APP_NAME = 'enterprise-platform-fcm';
/** Giới hạn tối đa mỗi lần gọi `sendEachForMulticast` của Firebase Admin SDK. */
const FCM_MULTICAST_LIMIT = 500;

/** Các mã lỗi Firebase cho biết token đã gỡ cài đặt ứng dụng hoặc không còn tồn tại: xoá ngay khỏi DB. */
const UNREGISTERED_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export interface FcmMessagePayload {
  readonly notification: {
    readonly title: string;
    readonly body: string;
  };
  readonly data: Readonly<Record<string, string>>;
}

export interface FcmSendItemResult {
  readonly success: boolean;
  readonly errorCode?: string;
}

export interface FcmMulticastSender {
  sendEachForMulticast(
    tokens: readonly string[],
    message: FcmMessagePayload,
  ): Promise<readonly FcmSendItemResult[]>;
}

function getOrCreateFirebaseApp(env: NodeJS.ProcessEnv): App | null {
  const config = logFcmBootStatus(env);
  if (!config) return null;
  const existing = getApps().find((candidate) => candidate.name === FCM_APP_NAME);
  if (existing) return existing;
  return initializeApp(
    {
      credential: cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey,
      }),
    },
    FCM_APP_NAME,
  );
}

/**
 * Tạo bộ gửi FCM dùng Firebase Admin SDK từ biến môi trường `FIREBASE_SERVICE_ACCOUNT`.
 * Chưa cấu hình thì trả `null` để worker chạy bình thường mà không gửi push di động.
 */
export function firebaseAdminSender(env: NodeJS.ProcessEnv = process.env): FcmMulticastSender | null {
  const app = getOrCreateFirebaseApp(env);
  if (!app) return null;
  const messaging = getMessaging(app);
  return {
    async sendEachForMulticast(tokens, message) {
      const results: FcmSendItemResult[] = [];
      for (let offset = 0; offset < tokens.length; offset += FCM_MULTICAST_LIMIT) {
        const chunk = tokens.slice(offset, offset + FCM_MULTICAST_LIMIT);
        const batch = await messaging.sendEachForMulticast({
          tokens: [...chunk],
          notification: {
            title: message.notification.title,
            body: message.notification.body,
          },
          data: { ...message.data },
          android: {
            priority: 'high',
            notification: { sound: 'default' },
          },
          apns: {
            headers: { 'apns-priority': '10' },
            payload: { aps: { sound: 'default' } },
          },
        });
        for (const item of batch.responses) {
          results.push(
            item.success
              ? { success: true }
              : { success: false, ...(item.error?.code ? { errorCode: item.error.code } : {}) },
          );
        }
      }
      return results;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNotificationRecord(value: unknown): {
  readonly notification: NotificationRecord;
  readonly toastEnabled: boolean;
} | null {
  if (!isRecord(value) || !isRecord(value.notification)) return null;
  const n = value.notification;
  if (
    typeof n.id !== 'string' ||
    typeof n.module !== 'string' ||
    typeof n.category !== 'string' ||
    typeof n.title !== 'string' ||
    typeof n.body !== 'string' ||
    typeof n.sourceType !== 'string' ||
    typeof n.sourceId !== 'string'
  ) {
    return null;
  }
  const toastEnabled = typeof value.toastEnabled === 'boolean' ? value.toastEnabled : true;
  return {
    notification: n as unknown as NotificationRecord,
    toastEnabled,
  };
}

/**
 * Điều phối gửi thông báo đẩy FCM cho thiết bị di động:
 * 1. Tin nhắn chat nội bộ (`core.chat.message`);
 * 2. Thông báo nghiệp vụ của các phân hệ (`notification.delivery.v1`);
 * 3. Dọn token khi phiên đăng nhập bị thu hồi (`identity.session.revoked`).
 */
export class FcmPushDispatcher {
  constructor(private readonly sender: FcmMulticastSender | null) {}

  async handleChatMessage(db: ChatDb, raw: unknown): Promise<DispatchOutcome> {
    const none: DispatchOutcome = { sent: 0, removed: 0, failed: 0 };
    const payload = parseMessagePayload(raw);
    if (!this.sender || !payload || payload.recipientUserIds.length === 0) return none;
    if (!(await fcmTableReady(db))) return none;

    const recipients = payload.recipientUserIds.filter((id) => id !== payload.actorUserId.toLowerCase());
    const devices = await fcmTokensOf(db, recipients);
    if (devices.length === 0) return none;

    // Gom theo nội dung thông báo: người được @nhắc tên có tiêu đề riêng, còn lại dùng chung một lượt multicast.
    const groups = new Map<string, { readonly message: FcmMessagePayload; readonly records: FcmDeviceTokenRecord[] }>();
    const deepLink = chatNotificationLink(payload.conversationId);
    for (const device of devices) {
      const chatNotice = pushMessageFor(payload, device.userId);
      const groupKey = `${chatNotice.title}\n${chatNotice.body}`;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.records.push(device);
      } else {
        groups.set(groupKey, {
          message: {
            notification: { title: chatNotice.title, body: chatNotice.body },
            data: {
              type: 'chat.message',
              module: 'chat',
              targetId: payload.conversationId,
              conversationId: payload.conversationId,
              messageId: payload.messageId,
              deepLink,
            },
          },
          records: [device],
        });
      }
    }

    const sent: string[] = [];
    const removed: string[] = [];
    const failed: string[] = [];
    for (const group of groups.values()) {
      await this.dispatchBatch(group.records, group.message, sent, removed, failed);
    }
    await markFcmSent(db, sent);
    await removeFcmTokens(db, removed);
    await markFcmFailed(db, failed);
    return { sent: sent.length, removed: removed.length, failed: failed.length };
  }

  async handleNotificationDelivery(db: ChatDb, raw: unknown): Promise<DispatchOutcome> {
    const none: DispatchOutcome = { sent: 0, removed: 0, failed: 0 };
    if (!this.sender) return none;
    let envelope;
    try {
      envelope = parseRealtimeEventEnvelope(raw);
    } catch {
      return none;
    }
    if (envelope.event !== 'notification.created' && envelope.event !== 'notification.updated') {
      return none;
    }
    const parsed = parseNotificationRecord(envelope.data);
    if (!parsed || !parsed.toastEnabled) return none;
    // Tin nhắc tên trong chat nội bộ (`core.chat.mention`, module `chat`) đã được `core.chat.message` đẩy kèm nhãn
    // "nhắc đến bạn", bỏ qua ở đây để người nhận không bị rung điện thoại hai lần cho cùng một tin nhắn.
    if (parsed.notification.module === 'chat') return none;
    if (!(await fcmTableReady(db))) return none;

    const devices = await fcmTokensOf(db, [envelope.userId]);
    if (devices.length === 0) return none;

    const { notification } = parsed;
    const message: FcmMessagePayload = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        type: envelope.event,
        notificationId: notification.id,
        module: notification.module,
        category: notification.category,
        sourceType: notification.sourceType,
        targetId: notification.sourceId,
        deepLink: notification.deepLink ?? '',
      },
    };

    const sent: string[] = [];
    const removed: string[] = [];
    const failed: string[] = [];
    await this.dispatchBatch(devices, message, sent, removed, failed);
    await markFcmSent(db, sent);
    await removeFcmTokens(db, removed);
    await markFcmFailed(db, failed);
    return { sent: sent.length, removed: removed.length, failed: failed.length };
  }

  async handleSessionRevoked(db: ChatDb, raw: unknown): Promise<number> {
    if (!isRecord(raw)) return 0;
    const userId = typeof raw.userId === 'string' ? raw.userId.trim() : '';
    const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId.trim() : '';
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    if (!userId || !sessionId || !reason) return 0;
    if (!(await fcmTableReady(db))) return 0;
    return revokeFcmDeviceTokens(db, { userId, sessionId, reason });
  }

  private async dispatchBatch(
    records: readonly FcmDeviceTokenRecord[],
    message: FcmMessagePayload,
    sent: string[],
    removed: string[],
    failed: string[],
  ): Promise<void> {
    if (!this.sender || records.length === 0) return;
    try {
      const results = await this.sender.sendEachForMulticast(
        records.map((item) => item.token),
        message,
      );
      records.forEach((record, index) => {
        const outcome = results[index];
        if (outcome?.success) {
          sent.push(record.id);
        } else if (outcome?.errorCode && UNREGISTERED_ERROR_CODES.has(outcome.errorCode)) {
          removed.push(record.id);
        } else {
          failed.push(record.id);
        }
      });
    } catch {
      for (const record of records) failed.push(record.id);
    }
  }
}
