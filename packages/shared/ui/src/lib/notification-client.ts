import { io } from 'socket.io-client';
import {
  normalizeNotificationPreference,
  parseRealtimeEventEnvelope,
} from '@enterprise-platform/contracts-realtime';
import type {
  NotificationModule,
  NotificationPreference,
  NotificationPriority,
  NotificationRecord,
  NotificationSummary,
  NotificationSyncResult,
  RealtimeEventEnvelope,
} from '@enterprise-platform/contracts-realtime';
import { authFetch } from './auth-fetch';

export { normalizeNotificationPreference };
export type {
  NotificationModule,
  NotificationPreference,
  NotificationPriority,
  NotificationRecord,
  NotificationSummary,
  NotificationSyncResult,
  RealtimeEventEnvelope,
};

export interface NotificationListOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly unread?: boolean;
  readonly module?: NotificationModule;
}

export interface NotificationListResult {
  readonly items: readonly NotificationRecord[];
  readonly nextCursor?: string;
}

export interface NotificationSocketHandlers {
  readonly onConnected: () => void | Promise<void>;
  readonly onDisconnected?: () => void;
  readonly onEvent: (event: RealtimeEventEnvelope) => void;
  readonly onSessionRevoked?: (reason?: string) => void;
}

export interface NotificationSocketConnection {
  disconnect(): void;
}

export interface NotificationClient {
  list(options?: NotificationListOptions): Promise<NotificationListResult>;
  summary(): Promise<NotificationSummary>;
  sync(afterSequence: number): Promise<NotificationSyncResult>;
  setRead(notificationId: string, read: boolean): Promise<NotificationRecord>;
  readAll(): Promise<NotificationSummary>;
  preferences(): Promise<readonly NotificationPreference[]>;
  setPreferences(
    preferences: readonly NotificationPreference[],
  ): Promise<readonly NotificationPreference[]>;
  connect(handlers: NotificationSocketHandlers): NotificationSocketConnection;
}

const NOTIFICATION_EVENTS = [
  'notification.created',
  'notification.updated',
  'notification.read',
  'notification.summary-updated',
] as const;

export class BrowserNotificationClient implements NotificationClient {
  constructor(private readonly baseUrl = '/api/realtime/v1') {}

  list(options: NotificationListOptions = {}): Promise<NotificationListResult> {
    const query = new URLSearchParams();
    if (options.cursor) query.set('cursor', options.cursor);
    if (options.limit) query.set('limit', String(options.limit));
    if (options.unread !== undefined) query.set('unread', String(options.unread));
    if (options.module) query.set('module', options.module);
    return this.get(`/notifications${query.size ? `?${query.toString()}` : ''}`);
  }

  summary(): Promise<NotificationSummary> {
    return this.get('/summary');
  }

  sync(afterSequence: number): Promise<NotificationSyncResult> {
    return this.get(`/sync?afterSequence=${encodeURIComponent(String(afterSequence))}`);
  }

  setRead(notificationId: string, read: boolean): Promise<NotificationRecord> {
    return this.request(`/notifications/${encodeURIComponent(notificationId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ read }),
    });
  }

  readAll(): Promise<NotificationSummary> {
    return this.request('/notifications/read-all', { method: 'POST' });
  }

  preferences(): Promise<readonly NotificationPreference[]> {
    return this.get('/preferences');
  }

  setPreferences(
    preferences: readonly NotificationPreference[],
  ): Promise<readonly NotificationPreference[]> {
    return this.request('/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferences }),
    });
  }

  connect(handlers: NotificationSocketHandlers): NotificationSocketConnection {
    const socket = io({
      path: '/realtime/socket.io',
      transports: ['websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 1,
    });

    socket.on('connect', () => {
      void handlers.onConnected();
    });
    socket.on('disconnect', () => handlers.onDisconnected?.());
    socket.on('session.revoked', (payload: unknown) => {
      const reason = isRecord(payload) && typeof payload.reason === 'string' ? payload.reason : undefined;
      handlers.onSessionRevoked?.(reason);
    });
    for (const eventName of NOTIFICATION_EVENTS) {
      socket.on(eventName, (value: unknown) => {
        try {
          handlers.onEvent(parseRealtimeEventEnvelope(value));
        } catch {
          // Ignore malformed server frames; REST sync remains the recovery path.
        }
      });
    }

    return { disconnect: () => socket.disconnect() };
  }

  private get<T>(path: string): Promise<T> {
    return this.request(path, { method: 'GET', cache: 'no-store' });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await authFetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(`Máy chủ trả về lỗi (HTTP ${response.status}). Vui lòng thử lại sau.`);
    }
    return (await response.json()) as T;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
