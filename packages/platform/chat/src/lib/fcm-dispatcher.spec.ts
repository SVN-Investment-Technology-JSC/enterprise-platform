import type { CoreChatMessagePayload } from '@enterprise-platform/contracts-chat';
import type { RealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import { fcmConfigFromEnv, logFcmBootStatus } from './fcm-config.js';
import { FcmPushDispatcher, type FcmMulticastSender } from './fcm-dispatcher.js';

const RECIPIENT_1 = '11111111-1111-4111-8111-111111111111';
const RECIPIENT_2 = '33333333-3333-4333-8333-333333333333';
const ACTOR = '22222222-2222-4222-8222-222222222222';

describe('cấu hình Firebase Service Account', () => {
  it('bỏ trống biến môi trường thì trả null; có chuỗi JSON hợp lệ thì chuẩn hoá khoá bí mật', () => {
    expect(fcmConfigFromEnv({})).toBeNull();
    const raw = JSON.stringify({
      project_id: 'svn-erp',
      client_email: 'firebase-adminsdk@svn-erp.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
    });
    expect(fcmConfigFromEnv({ FIREBASE_SERVICE_ACCOUNT: raw })).toEqual({
      projectId: 'svn-erp',
      clientEmail: 'firebase-adminsdk@svn-erp.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    });
  });

  it('báo lỗi rõ ràng khi JSON sai hoặc thiếu trường bắt buộc', () => {
    expect(() => fcmConfigFromEnv({ FIREBASE_SERVICE_ACCOUNT: '{bad' })).toThrow('JSON');
    expect(() => fcmConfigFromEnv({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'svn-erp' }) })).toThrow(
      'client_email',
    );
  });

  it('in log xác nhận khi khởi động với cấu hình hợp lệ và không làm sập tiến trình khi cấu hình lỗi', () => {
    const info = jest.fn();
    const warn = jest.fn();
    expect(logFcmBootStatus({ FIREBASE_SERVICE_ACCOUNT: '{bad' }, { info, warn })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);

    const valid = JSON.stringify({
      project_id: 'svn-erp',
      client_email: 'firebase-adminsdk@svn-erp.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    });
    expect(logFcmBootStatus({ FIREBASE_SERVICE_ACCOUNT: valid }, { info, warn })).toMatchObject({ projectId: 'svn-erp' });
    expect(info).toHaveBeenCalledWith('[push] FCM push bật ✓');
  });
});

describe('FcmPushDispatcher', () => {
  const notificationEnvelope = (
    overrides: Partial<{ module: string; toastEnabled: boolean; event: 'notification.created' | 'notification.read' }> = {},
  ): RealtimeEventEnvelope => ({
    id: '10000000-0000-4000-8000-000000000001',
    event: overrides.event ?? 'notification.created',
    version: 1,
    tenantId: '10000000-0000-4000-8000-000000000002',
    userId: RECIPIENT_1,
    sequence: 5,
    occurredAt: '2026-11-12T09:00:00.000Z',
    data: {
      toastEnabled: overrides.toastEnabled ?? true,
      notification: {
        id: '10000000-0000-4000-8000-000000000099',
        module: (overrides.module ?? 'hrm') as 'hrm',
        category: 'approval',
        priority: 'actionable',
        title: 'Đơn nghỉ phép đã được duyệt',
        body: 'Đơn nghỉ phép ngày 15/11 đã được quản lý phê duyệt.',
        deepLink: '/modules/hrm#requests/req-123',
        sourceType: 'hrm_request',
        sourceId: 'req-123',
        aggregateCount: 1,
        createdAt: '2026-11-12T09:00:00.000Z',
        updatedAt: '2026-11-12T09:00:00.000Z',
        sequence: 5,
      },
    },
  });

  it('gửi multicast thông báo nghiệp vụ và tự xoá token hết hiệu lực (registration-token-not-registered)', async () => {
    const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const db = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql: sql.trim(), params });
        if (sql.includes('to_regclass')) return { rows: [{ relation: 'core_schema.fcm_device_tokens' }] };
        if (sql.includes('FROM core_schema.fcm_device_tokens t')) {
          return {
            rows: [
              { id: 'tok-ok', user_id: RECIPIENT_1, token: 'valid_token_android_001', platform: 'android' },
              { id: 'tok-dead', user_id: RECIPIENT_1, token: 'dead_token_ios_000002', platform: 'ios' },
              { id: 'tok-err', user_id: RECIPIENT_1, token: 'temp_err_token_000003', platform: 'android' },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const sender: FcmMulticastSender = {
      sendEachForMulticast: jest.fn(async () => [
        { success: true },
        { success: false, errorCode: 'messaging/registration-token-not-registered' },
        { success: false, errorCode: 'messaging/internal-error' },
      ]),
    };

    const outcome = await new FcmPushDispatcher(sender).handleNotificationDelivery(db as never, notificationEnvelope());
    expect(outcome).toEqual({ sent: 1, removed: 1, failed: 1 });
    expect(sender.sendEachForMulticast).toHaveBeenCalledWith(
      ['valid_token_android_001', 'dead_token_ios_000002', 'temp_err_token_000003'],
      {
        notification: {
          title: 'Đơn nghỉ phép đã được duyệt',
          body: 'Đơn nghỉ phép ngày 15/11 đã được quản lý phê duyệt.',
        },
        data: {
          type: 'notification.created',
          notificationId: '10000000-0000-4000-8000-000000000099',
          module: 'hrm',
          category: 'approval',
          sourceType: 'hrm_request',
          targetId: 'req-123',
          deepLink: '/modules/hrm#requests/req-123',
        },
      },
    );
    expect(queries).toContainEqual({
      sql: 'DELETE FROM core_schema.fcm_device_tokens WHERE id = ANY($1::uuid[])',
      params: [['tok-dead']],
    });
  });

  it('bỏ qua khi người dùng tắt thông báo nổi (toastEnabled=false) hoặc thông báo module chat (đã gửi qua core.chat.message)', async () => {
    const db = { query: jest.fn() };
    const sender: FcmMulticastSender = { sendEachForMulticast: jest.fn() };
    const dispatcher = new FcmPushDispatcher(sender);

    await expect(dispatcher.handleNotificationDelivery(db as never, notificationEnvelope({ toastEnabled: false }))).resolves.toEqual({
      sent: 0,
      removed: 0,
      failed: 0,
    });
    await expect(dispatcher.handleNotificationDelivery(db as never, notificationEnvelope({ module: 'chat' }))).resolves.toEqual({
      sent: 0,
      removed: 0,
      failed: 0,
    });
    expect(sender.sendEachForMulticast).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('gom tin chat theo nội dung để người được nhắc tên nhận tiêu đề riêng, không gửi cho chính người gửi', async () => {
    const db = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('to_regclass')) return { rows: [{ relation: 'core_schema.fcm_device_tokens' }] };
        if (sql.includes('FROM core_schema.fcm_device_tokens t')) {
          return {
            rows: [
              { id: 'd1', user_id: RECIPIENT_1, token: 'token_recipient_1_aaaa', platform: 'android' },
              { id: 'd2', user_id: RECIPIENT_2, token: 'token_recipient_2_bbbb', platform: 'ios' },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const sender: FcmMulticastSender = {
      sendEachForMulticast: jest.fn(async (tokens) => tokens.map(() => ({ success: true }))),
    };
    const chatPayload: CoreChatMessagePayload = {
      conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      conversationKind: 'group',
      conversationTitle: 'Ban dự án',
      messageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      actorUserId: ACTOR,
      actorName: 'Trần Bình',
      excerpt: 'Xem giúp mình tiến độ nhé',
      attachmentCount: 0,
      hasImage: false,
      mentionedUserIds: [RECIPIENT_2],
      recipientUserIds: [ACTOR, RECIPIENT_1, RECIPIENT_2],
    };

    const outcome = await new FcmPushDispatcher(sender).handleChatMessage(db as never, chatPayload);
    expect(outcome).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(sender.sendEachForMulticast).toHaveBeenCalledTimes(2);
    expect(sender.sendEachForMulticast).toHaveBeenCalledWith(
      ['token_recipient_2_bbbb'],
      expect.objectContaining({
        notification: { title: 'Trần Bình · Ban dự án nhắc đến bạn', body: 'Xem giúp mình tiến độ nhé' },
        data: expect.objectContaining({ module: 'chat', targetId: chatPayload.conversationId }),
      }),
    );
  });

  it('xoá đúng token của phiên khi logout và xoá toàn bộ token của người dùng khi khoá tài khoản', async () => {
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const db = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql: sql.trim(), params });
        if (sql.includes('to_regclass')) return { rows: [{ relation: 'core_schema.fcm_device_tokens' }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    const dispatcher = new FcmPushDispatcher(null);

    await dispatcher.handleSessionRevoked(db as never, {
      userId: RECIPIENT_1,
      sessionId: 'sess-1',
      reason: 'logout',
    });
    expect(calls.at(-1)).toEqual({
      sql: 'DELETE FROM core_schema.fcm_device_tokens WHERE user_id = $1 AND session_id = $2',
      params: [RECIPIENT_1, 'sess-1'],
    });

    await dispatcher.handleSessionRevoked(db as never, {
      userId: RECIPIENT_1,
      sessionId: 'sess-2',
      reason: 'user-disabled',
    });
    expect(calls.at(-1)).toEqual({
      sql: 'DELETE FROM core_schema.fcm_device_tokens WHERE user_id = $1',
      params: [RECIPIENT_1],
    });
  });
});
