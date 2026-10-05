import { randomUUID } from 'node:crypto';
import type {
  NotificationGroup,
  NotificationModule,
  NotificationPreference,
  NotificationPriority,
  NotificationRecord,
  NotificationSummary,
  NotificationSyncResult,
  RealtimeEventEnvelope,
  RealtimeServerEvent,
} from '@enterprise-platform/contracts-realtime';
import {
  MAX_SEARCH_LENGTH,
  normalizeNotificationPreference,
  SEARCH_TRANSLATE_FROM,
  SEARCH_TRANSLATE_TO,
  searchTerms,
} from '@enterprise-platform/contracts-realtime';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

const CONSUMER = 'notification-worker';
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const MAX_SYNC_EVENTS = 500;

export interface NotificationEventInput {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly title: string;
  readonly body: string;
  readonly deepLink?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface ResolvedNotificationPolicy {
  readonly module: NotificationModule;
  readonly category: string;
  readonly priority: NotificationPriority;
  readonly feedEnabled: boolean;
  readonly toastEnabled: boolean;
  readonly aggregationKey?: string;
  readonly aggregationWindowMinutes?: number;
}

export type ProcessResult =
  | { readonly status: 'duplicate' | 'suppressed' }
  | {
      readonly status: 'created' | 'updated';
      readonly notification: NotificationRecord;
      readonly sequence: number;
      readonly toastEnabled: boolean;
    };

export interface NotificationListOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly unread?: boolean;
  readonly module?: NotificationModule;
  readonly category?: string;
  /** Tìm trong tiêu đề và nội dung, không phân biệt hoa thường và dấu tiếng Việt. */
  readonly query?: string;
}

export interface NotificationListResult {
  readonly items: readonly NotificationRecord[];
  readonly nextCursor?: string;
}

interface NotificationRow extends QueryResultRow {
  id: string;
  module: NotificationModule;
  category: string;
  priority: NotificationPriority;
  title: string;
  body: string;
  deep_link: string | null;
  source_type: string;
  source_id: string;
  aggregate_count: number;
  read_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  sequence: string | number;
}

interface UserStateRow extends QueryResultRow {
  last_sequence: string | number;
  unread_count: string | number;
}

interface EventRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  user_id: string;
  sequence: string | number;
  event_name: RealtimeServerEvent;
  event_version: 1;
  payload: unknown;
  occurred_at: Date | string;
}

export class NotificationNotFoundError extends Error {
  constructor() {
    super('Notification was not found for this user.');
    this.name = 'NotificationNotFoundError';
  }
}

/** Caller-supplied input (for example a pagination cursor) that cannot be parsed. */
export class NotificationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationInputError';
  }
}

export class PostgresNotificationStore {
  constructor(private readonly pool: Pool) {}

  async process(
    event: NotificationEventInput,
    policy: ResolvedNotificationPolicy,
  ): Promise<ProcessResult> {
    validateEvent(event);
    validatePolicy(policy);
    const normalized = normalizeNotificationPreference(policy);
    const effectivePolicy: ResolvedNotificationPolicy = {
      ...policy,
      feedEnabled: normalized.feedEnabled,
      toastEnabled: normalized.toastEnabled,
    };

    return this.transaction(async (client) => {
      const claimed = await client.query(
        `INSERT INTO notification_schema.inbox_messages (consumer, event_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING event_id`,
        [CONSUMER, event.id, event.userId],
      );
      if (!claimed.rowCount) return { status: 'duplicate' };
      if (!effectivePolicy.feedEnabled) return { status: 'suppressed' };

      await this.lockState(client, event.userId);
      const aggregate = effectivePolicy.aggregationKey
        ? await this.findAggregate(client, event, effectivePolicy)
        : undefined;

      if (aggregate) {
        const unreadDelta = aggregate.read_at ? 1 : 0;
        const sequence = await this.nextSequence(client, event.userId, unreadDelta);
        const updated = await client.query<NotificationRow>(
          `UPDATE notification_schema.notifications
              SET title = $3,
                  body = $4,
                  deep_link = $5,
                  source_type = $6,
                  source_id = $7,
                  data = $8::jsonb,
                  aggregate_count = aggregate_count + 1,
                  read_at = NULL,
                  sequence = $9,
                  updated_at = now(),
                  expires_at = now() + interval '90 days'
            WHERE id = $1 AND user_id = $2
            RETURNING *`,
          [
            aggregate.id,
            event.userId,
            event.title,
            event.body,
            event.deepLink ?? null,
            event.sourceType,
            event.sourceId,
            JSON.stringify(event.data ?? {}),
            sequence,
          ],
        );
        const notification = mapNotification(updated.rows[0]);
        await this.appendEvent(
          client,
          event.tenantId,
          event.userId,
          sequence,
          'notification.updated',
          notification.id,
          { notification },
        );
        return {
          status: 'updated',
          notification,
          sequence,
          toastEnabled: effectivePolicy.toastEnabled,
        };
      }

      const sequence = await this.nextSequence(client, event.userId, 1);
      const id = randomUUID();
      const inserted = await client.query<NotificationRow>(
        `INSERT INTO notification_schema.notifications
          (id, user_id, module, category, priority, title, body, deep_link,
           source_type, source_id, aggregation_key,
           aggregation_window_started_at, data, sequence, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12::timestamptz, $13::jsonb, $14, $12::timestamptz, now())
         ON CONFLICT (user_id, source_type, source_id, category) DO NOTHING
         RETURNING *`,
        [
          id,
          event.userId,
          effectivePolicy.module,
          effectivePolicy.category,
          effectivePolicy.priority,
          event.title,
          event.body,
          event.deepLink ?? null,
          event.sourceType,
          event.sourceId,
          effectivePolicy.aggregationKey ?? null,
          event.occurredAt,
          JSON.stringify(event.data ?? {}),
          sequence,
        ],
      );
      if (!inserted.rows[0]) {
        throw new Error('Notification source already exists under a different event id.');
      }
      const notification = mapNotification(inserted.rows[0]);
      await this.appendEvent(
        client,
        event.tenantId,
        event.userId,
        sequence,
        'notification.created',
        notification.id,
        { notification },
      );
      return {
        status: 'created',
        notification,
        sequence,
        toastEnabled: effectivePolicy.toastEnabled,
      };
    });
  }

  async setRead(
    tenantId: string,
    userId: string,
    notificationId: string,
    read: boolean,
  ): Promise<NotificationRecord> {
    return this.transaction(async (client) => {
      await this.lockState(client, userId);
      const existing = await client.query<NotificationRow>(
        `SELECT * FROM notification_schema.notifications
          WHERE id = $1 AND user_id = $2 AND expires_at > now()
          FOR UPDATE`,
        [notificationId, userId],
      );
      const row = existing.rows[0];
      if (!row) throw new NotificationNotFoundError();
      const alreadyRead = row.read_at !== null;
      if (alreadyRead === read) return mapNotification(row);

      const sequence = await this.nextSequence(client, userId, read ? -1 : 1);
      const changed = await client.query<NotificationRow>(
        `UPDATE notification_schema.notifications
            SET read_at = CASE WHEN $3 THEN now() ELSE NULL END,
                sequence = $4,
                updated_at = now()
          WHERE id = $1 AND user_id = $2
          RETURNING *`,
        [notificationId, userId, read, sequence],
      );
      const notification = mapNotification(changed.rows[0]);
      await this.appendEvent(
        client,
        tenantId,
        userId,
        sequence,
        'notification.read',
        notificationId,
        { notificationId, read, readAt: notification.readAt ?? null },
      );
      return notification;
    });
  }

  async readAll(tenantId: string, userId: string): Promise<NotificationSummary> {
    return this.transaction(async (client) => {
      const state = await this.lockState(client, userId);
      const changed = await client.query(
        `UPDATE notification_schema.notifications
            SET read_at = now(), updated_at = now()
          WHERE user_id = $1 AND read_at IS NULL AND expires_at > now()
          RETURNING id`,
        [userId],
      );
      if (!changed.rowCount) return mapSummary(state);

      const sequence = await this.nextSequence(client, userId, -Number(state.unread_count));
      const summary = { unreadCount: 0, lastSequence: sequence };
      await this.appendEvent(
        client,
        tenantId,
        userId,
        sequence,
        'notification.summary-updated',
        null,
        { summary },
      );
      return summary;
    });
  }

  async list(
    userId: string,
    options: NotificationListOptions = {},
  ): Promise<NotificationListResult> {
    const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
    const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
    const values: unknown[] = [userId];
    const clauses = ['user_id = $1', 'expires_at > now()'];
    if (options.unread) clauses.push('read_at IS NULL');
    if (options.module) {
      values.push(options.module);
      clauses.push(`module = $${values.length}`);
    }
    if (options.category) {
      values.push(options.category);
      clauses.push(`category = $${values.length}`);
    }
    // Chuỗi từ khoá đã được chuẩn hoá (không dấu, chữ thường); cột được chuyển cùng bảng ký tự
    // bằng translate() nên không cần extension `unaccent` (cần quyền superuser để cài).
    for (const term of searchTerms(options.query?.slice(0, MAX_SEARCH_LENGTH))) {
      values.push(`%${escapeLike(term)}%`);
      clauses.push(
        `lower(translate(title || ' ' || body, '${SEARCH_TRANSLATE_FROM}', '${SEARCH_TRANSLATE_TO}')) LIKE $${values.length} ESCAPE '\\'`,
      );
    }
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      clauses.push(`(created_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(limit + 1);
    const result = await this.pool.query<NotificationRow>(
      `SELECT * FROM notification_schema.notifications
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT $${values.length}`,
      values,
    );
    const hasMore = result.rows.length > limit;
    const visible = result.rows.slice(0, limit);
    const last = visible.at(-1);
    return {
      items: visible.map(mapNotification),
      nextCursor:
        hasMore && last
          ? encodeCursor(toIso(last.created_at), last.id)
          : undefined,
    };
  }

  /** Các nhóm (module + loại) người dùng đang có thông báo, để dựng bộ lọc theo nhóm. */
  async groups(userId: string): Promise<readonly NotificationGroup[]> {
    const result = await this.pool.query<{ module: NotificationModule; category: string }>(
      `SELECT DISTINCT module, category
         FROM notification_schema.notifications
        WHERE user_id = $1 AND expires_at > now()
        ORDER BY module, category`,
      [userId],
    );
    return result.rows.map((row) => ({ module: row.module, category: row.category }));
  }

  async summary(userId: string): Promise<NotificationSummary> {
    const result = await this.pool.query<UserStateRow>(
      `SELECT last_sequence, unread_count
         FROM notification_schema.user_state
        WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0]
      ? mapSummary(result.rows[0])
      : { unreadCount: 0, lastSequence: 0 };
  }

  async sync(userId: string, afterSequence: number): Promise<NotificationSyncResult> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      return {
        resetRequired: true,
        events: [],
        summary: await this.summary(userId),
      };
    }
    const summary = await this.summary(userId);
    if (afterSequence > summary.lastSequence) {
      return { resetRequired: true, events: [], summary };
    }
    if (afterSequence === summary.lastSequence) {
      return { resetRequired: false, events: [], summary };
    }
    const bounds = await this.pool.query<{ first_sequence: string | number | null }>(
      `SELECT min(sequence) AS first_sequence
         FROM notification_schema.notification_events
        WHERE user_id = $1 AND expires_at > now()`,
      [userId],
    );
    const first = bounds.rows[0]?.first_sequence;
    if (first === null || first === undefined || afterSequence < Number(first) - 1) {
      return { resetRequired: true, events: [], summary };
    }
    const result = await this.pool.query<EventRow>(
      `SELECT id, tenant_id, user_id, sequence, event_name, event_version,
              payload, occurred_at
         FROM notification_schema.notification_events
        WHERE user_id = $1 AND sequence > $2 AND expires_at > now()
        ORDER BY sequence
        LIMIT $3`,
      [userId, afterSequence, MAX_SYNC_EVENTS],
    );
    return {
      resetRequired: false,
      events: result.rows.map(mapEvent),
      summary,
    };
  }

  async preferences(userId: string): Promise<readonly NotificationPreference[]> {
    const result = await this.pool.query<
      QueryResultRow & {
        module: NotificationModule;
        category: string;
        priority: NotificationPriority;
        feed_enabled: boolean;
        toast_enabled: boolean;
      }
    >(
      `SELECT module, category, priority, feed_enabled, toast_enabled
         FROM notification_schema.preferences
        WHERE user_id = $1
        ORDER BY module, category`,
      [userId],
    );
    return result.rows.map((row) => ({
      module: row.module,
      category: row.category,
      priority: row.priority,
      feedEnabled: row.feed_enabled,
      toastEnabled: row.toast_enabled,
    }));
  }

  async setPreferences(
    userId: string,
    preferences: readonly NotificationPreference[],
  ): Promise<readonly NotificationPreference[]> {
    await this.transaction(async (client) => {
      for (const candidate of preferences) {
        const preference = normalizeNotificationPreference(candidate);
        await client.query(
          `INSERT INTO notification_schema.preferences
            (user_id, module, category, priority, feed_enabled, toast_enabled)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, module, category) DO UPDATE
             SET priority = EXCLUDED.priority,
                 feed_enabled = EXCLUDED.feed_enabled,
                 toast_enabled = EXCLUDED.toast_enabled,
                 updated_at = now()`,
          [
            userId,
            preference.module,
            preference.category,
            preference.priority,
            preference.feedEnabled,
            preference.toastEnabled,
          ],
        );
      }
    });
    return this.preferences(userId);
  }

  async removeExpired(
    tenantId: string,
  ): Promise<{ notifications: number; events: number }> {
    return this.transaction(async (client) => {
      const events = await client.query(
        `DELETE FROM notification_schema.notification_events
          WHERE expires_at <= now()`,
      );
      const notifications = await client.query<{ user_id: string; read_at: Date | null }>(
        `DELETE FROM notification_schema.notifications
          WHERE expires_at <= now()
          RETURNING user_id, read_at`,
      );
      const expiredUnreadByUser = new Map<string, number>();
      for (const row of notifications.rows) {
        if (row.read_at) continue;
        expiredUnreadByUser.set(
          row.user_id,
          (expiredUnreadByUser.get(row.user_id) ?? 0) + 1,
        );
      }
      for (const [userId, count] of expiredUnreadByUser) {
        await this.lockState(client, userId);
        const sequence = await this.nextSequence(client, userId, -count);
        const state = await client.query<UserStateRow>(
          `SELECT last_sequence, unread_count
             FROM notification_schema.user_state
            WHERE user_id = $1`,
          [userId],
        );
        await this.appendEvent(
          client,
          tenantId,
          userId,
          sequence,
          'notification.summary-updated',
          null,
          { summary: mapSummary(state.rows[0]) },
        );
      }
      await client.query(
        `DELETE FROM notification_schema.inbox_messages
          WHERE received_at <= now() - interval '90 days'`,
      );
      await client.query(
        `DELETE FROM notification_schema.schedule_emissions
          WHERE emitted_at <= now() - interval '90 days'`,
      );
      return {
        notifications: notifications.rowCount ?? 0,
        events: events.rowCount ?? 0,
      };
    });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockState(client: PoolClient, userId: string): Promise<UserStateRow> {
    await client.query(
      `INSERT INTO notification_schema.user_state (user_id)
       VALUES ($1)
       ON CONFLICT DO NOTHING`,
      [userId],
    );
    const state = await client.query<UserStateRow>(
      `SELECT last_sequence, unread_count
         FROM notification_schema.user_state
        WHERE user_id = $1
        FOR UPDATE`,
      [userId],
    );
    if (!state.rows[0]) throw new Error('Notification user state could not be locked.');
    return state.rows[0];
  }

  private async nextSequence(
    client: PoolClient,
    userId: string,
    unreadDelta: number,
  ): Promise<number> {
    const result = await client.query<UserStateRow>(
      `UPDATE notification_schema.user_state
          SET last_sequence = last_sequence + 1,
              unread_count = greatest(0, unread_count + $2),
              updated_at = now()
        WHERE user_id = $1
        RETURNING last_sequence, unread_count`,
      [userId, unreadDelta],
    );
    return Number(result.rows[0]?.last_sequence);
  }

  private async findAggregate(
    client: PoolClient,
    event: NotificationEventInput,
    policy: ResolvedNotificationPolicy,
  ): Promise<NotificationRow | undefined> {
    const windowMinutes = policy.aggregationWindowMinutes ?? 15;
    const result = await client.query<NotificationRow>(
      `SELECT * FROM notification_schema.notifications
        WHERE user_id = $1
          AND aggregation_key = $2
          AND $3::timestamptz >= aggregation_window_started_at
          AND $3::timestamptz < aggregation_window_started_at
              + ($4 * interval '1 minute')
          AND expires_at > now()
        ORDER BY aggregation_window_started_at DESC
        LIMIT 1
        FOR UPDATE`,
      [event.userId, policy.aggregationKey, event.occurredAt, windowMinutes],
    );
    return result.rows[0];
  }

  private async appendEvent(
    client: PoolClient,
    tenantId: string,
    userId: string,
    sequence: number,
    eventName: RealtimeServerEvent,
    notificationId: string | null,
    payload: unknown,
  ): Promise<void> {
    await client.query(
      `INSERT INTO notification_schema.notification_events
        (id, tenant_id, user_id, sequence, event_name, notification_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        randomUUID(),
        tenantId,
        userId,
        sequence,
        eventName,
        notificationId,
        JSON.stringify(payload),
      ],
    );
  }
}

function validateEvent(event: NotificationEventInput): void {
  for (const [field, value] of Object.entries({
    id: event.id,
    tenantId: event.tenantId,
    userId: event.userId,
    type: event.type,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    title: event.title,
    body: event.body,
  })) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }
  if (event.version < 1 || !Number.isSafeInteger(event.version)) {
    throw new TypeError('version must be a positive integer');
  }
  if (Number.isNaN(Date.parse(event.occurredAt))) {
    throw new TypeError('occurredAt must be an ISO date');
  }
  if (event.deepLink && (!event.deepLink.startsWith('/') || event.deepLink.startsWith('//'))) {
    throw new TypeError('deepLink must be a same-origin path');
  }
}

function validatePolicy(policy: ResolvedNotificationPolicy): void {
  if (!['required', 'actionable', 'informational'].includes(policy.priority)) {
    throw new TypeError('priority is not supported');
  }
  if (!policy.category.trim()) throw new TypeError('category is required');
  if (
    policy.aggregationWindowMinutes !== undefined &&
    (!Number.isFinite(policy.aggregationWindowMinutes) ||
      policy.aggregationWindowMinutes <= 0)
  ) {
    throw new TypeError('aggregationWindowMinutes must be positive');
  }
}

function mapNotification(row: NotificationRow | undefined): NotificationRecord {
  if (!row) throw new Error('Notification mutation returned no row.');
  return {
    id: row.id,
    module: row.module,
    category: row.category,
    priority: row.priority,
    title: row.title,
    body: row.body,
    ...(row.deep_link ? { deepLink: row.deep_link } : {}),
    sourceType: row.source_type,
    sourceId: row.source_id,
    aggregateCount: Number(row.aggregate_count),
    ...(row.read_at ? { readAt: toIso(row.read_at) } : {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    sequence: Number(row.sequence),
  };
}

function mapSummary(row: UserStateRow): NotificationSummary {
  return {
    unreadCount: Number(row.unread_count),
    lastSequence: Number(row.last_sequence),
  };
}

function mapEvent(row: EventRow): RealtimeEventEnvelope {
  return {
    id: row.id,
    event: row.event_name,
    version: row.event_version,
    tenantId: row.tenant_id,
    userId: row.user_id,
    sequence: Number(row.sequence),
    occurredAt: toIso(row.occurred_at),
    data: row.payload,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

function decodeCursor(value: string): { createdAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== 'string' ||
      !UUID_PATTERN.test(parsed.id)
    ) {
      throw new Error();
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new NotificationInputError('cursor is invalid');
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
