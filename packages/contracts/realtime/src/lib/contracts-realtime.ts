export const REALTIME_SERVER_EVENTS = [
  'session.ready',
  'session.expiring',
  'session.revoked',
  'notification.created',
  'notification.updated',
  'notification.read',
  'notification.summary-updated',
  'workspace.chat.changed',
  'workspace.chat.typing',
] as const;

export type RealtimeServerEvent = (typeof REALTIME_SERVER_EVENTS)[number];

/**
 * Tín hiệu "luồng chat có thay đổi" gửi tới từng thành viên dự án.
 *
 * Chỉ mang định danh, không mang nội dung tin: người nhận gọi lại API chat (có
 * kiểm quyền) để lấy dữ liệu, nên nội dung không đi qua broker và Redis, và
 * tin bị sửa/thu hồi không bao giờ lệch với bản trong CSDL.
 */
export interface WorkspaceChatSignal {
  readonly channelId: string;
  readonly entityType: 'project' | 'work_item';
  readonly entityId: string;
  readonly projectId: string;
  /**
   * Tin bị đổi. Với `read` là tin MỚI NHẤT mà `actorUserId` vừa đọc tới, để người
   * khác cập nhật "đã xem" ngay mà không phải tải lại cả luồng.
   */
  readonly messageId: string;
  readonly change: 'created' | 'edited' | 'deleted' | 'read';
  readonly actorUserId: string;
}

/**
 * "Đang nhập": tín hiệu tạm, không lưu ở đâu cả. Người nhận tự hết hiệu lực sau
 * vài giây nếu không có tín hiệu mới.
 */
export interface WorkspaceChatTyping {
  readonly entityType: 'project' | 'work_item';
  readonly entityId: string;
  /** Người đang gõ, do máy chủ gắn từ phiên đăng nhập, không lấy từ client. */
  readonly userId: string;
  /** `false` khi người đó xoá hết nội dung hoặc đã gửi. */
  readonly typing: boolean;
}

/** Nội dung client gửi lên qua socket để báo mình đang gõ (tên sự kiện `chat.typing`). */
export interface ChatTypingMessage {
  readonly entityType: 'project' | 'work_item';
  readonly entityId: string;
  readonly typing: boolean;
}

export interface RealtimeEventEnvelope<TData = unknown> {
  readonly id: string;
  readonly event: RealtimeServerEvent;
  readonly version: 1;
  readonly tenantId: string;
  readonly userId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly data: TData;
}

export type NotificationPriority =
  | 'required'
  | 'actionable'
  | 'informational';

export type NotificationModule =
  | 'identity'
  | 'procedure'
  | 'workspace'
  | 'hrm'
  | 'finance'
  | 'inventory'
  | 'maintenance';

export interface NotificationRecord {
  readonly id: string;
  readonly module: NotificationModule;
  readonly category: string;
  readonly priority: NotificationPriority;
  readonly title: string;
  readonly body: string;
  readonly deepLink?: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly aggregateCount: number;
  readonly readAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sequence: number;
}

/** Một nhóm thông báo (module + loại) mà người dùng hiện có ít nhất một thông báo. */
export interface NotificationGroup {
  readonly module: NotificationModule;
  readonly category: string;
}

export interface NotificationPreference {
  readonly module: NotificationModule;
  readonly category: string;
  readonly priority: NotificationPriority;
  readonly feedEnabled: boolean;
  readonly toastEnabled: boolean;
}

export interface NotificationSummary {
  readonly unreadCount: number;
  readonly lastSequence: number;
}

export interface NotificationSyncResult {
  readonly resetRequired: boolean;
  readonly events: readonly RealtimeEventEnvelope[];
  readonly summary: NotificationSummary;
}

const eventNames = new Set<string>(REALTIME_SERVER_EVENTS);

export function parseRealtimeEventEnvelope<TData = unknown>(
  value: unknown,
): RealtimeEventEnvelope<TData> {
  if (!isRecord(value)) throw new TypeError('envelope must be an object');
  requireText(value.id, 'id');
  requireText(value.tenantId, 'tenantId');
  requireText(value.userId, 'userId');
  if (!eventNames.has(String(value.event))) {
    throw new TypeError('event is not supported');
  }
  if (value.version !== 1) throw new TypeError('version must be 1');
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1) {
    throw new TypeError('sequence must be a positive safe integer');
  }
  requireText(value.occurredAt, 'occurredAt');
  if (Number.isNaN(Date.parse(String(value.occurredAt)))) {
    throw new TypeError('occurredAt must be an ISO date');
  }
  if (!('data' in value)) throw new TypeError('data is required');
  return value as unknown as RealtimeEventEnvelope<TData>;
}

export function normalizeNotificationPreference(
  preference: NotificationPreference,
): NotificationPreference {
  if (preference.priority === 'required') {
    return { ...preference, feedEnabled: true, toastEnabled: true };
  }
  if (preference.priority === 'actionable') {
    return { ...preference, feedEnabled: true };
  }
  return { ...preference };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}
