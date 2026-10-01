export const REALTIME_SERVER_EVENTS = [
  'session.ready',
  'session.expiring',
  'session.revoked',
  'notification.created',
  'notification.updated',
  'notification.read',
  'notification.summary-updated',
] as const;

export type RealtimeServerEvent = (typeof REALTIME_SERVER_EVENTS)[number];

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
