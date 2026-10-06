import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import amqp, { type Channel, type ConfirmChannel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import type { Pool } from 'pg';

const EXCHANGE = 'enterprise.events';
const DEAD_LETTER_EXCHANGE = 'enterprise.events.dlx';
const RETRY_EXCHANGE = 'enterprise.events.retry';

export const RABBITMQ_RETRY_DELAYS_MS = [5_000, 30_000, 300_000] as const;

export interface RetryQueueDefinition {
  readonly queue: string;
  readonly routingKey: string;
  readonly ttlMs: number;
}

export function buildRetryQueueDefinitions(queue: string): readonly RetryQueueDefinition[] {
  return RABBITMQ_RETRY_DELAYS_MS.map((ttlMs, index) => ({
    queue: `${queue}.retry.${index + 1}`,
    routingKey: `${queue}.retry.${index + 1}`,
    ttlMs,
  }));
}

export class PermanentMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentMessageError';
  }
}

export type RetryDisposition =
  | { readonly kind: 'retry'; readonly attempt: number; readonly delayMs: number }
  | { readonly kind: 'dead-letter'; readonly attempt: number; readonly reason: string };

export function retryDisposition(error: unknown, currentAttempt: number): RetryDisposition {
  const attempt = Math.max(0, Math.trunc(currentAttempt));
  const reason = error instanceof Error ? error.message : String(error);
  if (error instanceof PermanentMessageError || attempt >= RABBITMQ_RETRY_DELAYS_MS.length) {
    return { kind: 'dead-letter', attempt, reason };
  }
  return {
    kind: 'retry',
    attempt: attempt + 1,
    delayMs: RABBITMQ_RETRY_DELAYS_MS[attempt],
  };
}

type AmqpConnect = (url: string) => Promise<ChannelModel>;

export class RabbitMqPublisher {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;

  constructor(
    private readonly url: string,
    private readonly connect: AmqpConnect = (url) => amqp.connect(url),
  ) {}

  async publish(event: IntegrationEventEnvelope): Promise<void> {
    const channel = await this.ensureChannel();
    channel.publish(EXCHANGE, event.type, Buffer.from(JSON.stringify(event)), {
      contentType: 'application/json',
      deliveryMode: 2,
      messageId: event.id,
      timestamp: Date.parse(event.occurredAt),
      type: event.type,
      headers: { eventVersion: event.version, tenantId: event.tenantId },
    });
    await channel.waitForConfirms();
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.channel = undefined;
    this.connection = undefined;
  }

  private async ensureChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    this.connection = await this.connect(this.url);
    const channel = await this.connection.createConfirmChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', { durable: true });
    await channel.assertQueue('enterprise.events.dead', { durable: true });
    await channel.bindQueue('enterprise.events.dead', DEAD_LETTER_EXCHANGE, '#');
    this.connection.on('close', () => { this.channel = undefined; this.connection = undefined; });
    this.channel = channel;
    return channel;
  }
}

interface OutboxRow {
  id: string;
  payload: IntegrationEventEnvelope;
}

export class TransactionalOutboxRelay {
  constructor(
    private readonly pool: Pool,
    private readonly publisher: RabbitMqPublisher,
    private readonly batchSize = 50,
    private readonly mayPublish?: (event: IntegrationEventEnvelope) => Promise<boolean>,
  ) {}

  async flush(): Promise<number> {
    const client = await this.pool.connect();
    let currentId: string | undefined;
    try {
      await client.query('BEGIN');
      const result = await client.query<OutboxRow>(
        `SELECT id, payload
           FROM integration_schema.outbox_events
          WHERE published_at IS NULL
          ORDER BY occurred_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [this.batchSize],
      );
      for (const row of result.rows) {
        currentId = row.id;
        if (!this.mayPublish || await this.mayPublish(row.payload)) await this.publisher.publish(row.payload);
        await client.query(
          `UPDATE integration_schema.outbox_events
              SET published_at = now(), attempts = attempts + 1, last_error = NULL
            WHERE id = $1`,
          [row.id],
        );
      }
      await client.query('COMMIT');
      return result.rowCount ?? result.rows.length;
    } catch (error) {
      await client.query('ROLLBACK');
      if (currentId) {
        await this.pool.query(
          `UPDATE integration_schema.outbox_events
              SET attempts = attempts + 1, last_error = left($2, 2000)
            WHERE id = $1 AND published_at IS NULL`,
          [currentId, error instanceof Error ? error.message : String(error)],
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export class IdempotentInbox {
  constructor(private readonly pool: Pool, private readonly consumer: string) {}

  async process(event: IntegrationEventEnvelope, handler: () => Promise<void>): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO integration_schema.inbox_messages (consumer, event_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING event_id`,
        [this.consumer, event.id],
      );
      if (inserted.rowCount === 0) { await client.query('ROLLBACK'); return false; }
      await handler();
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

export interface RabbitMqConsumerOptions {
  readonly queue: string;
  readonly bindings: readonly string[];
  readonly prefetch?: number;
  /** Số lần giữ-lại-rồi-thử-lại cho lỗi tạm thời trước khi chuyển vào DLQ. */
  readonly maxTransientRetries?: number;
  /** Độ trễ cơ sở (ms) cho lỗi tạm thời; nhân theo số lần đã thử. */
  readonly transientRetryDelayMs?: number;
}

/** Lỗi tạm thời (tenant bận, chưa migrate...): thử lại có độ trễ, không vào DLQ ngay. */
export class TransientConsumerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientConsumerError';
  }
}

export const RECONNECT_MIN_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 30_000;
export const RECONNECT_GIVE_UP_MS = 5 * 60_000;

/** Exponential backoff có jitter, nằm trong [1s, 30s]. */
export function reconnectDelayMs(attempt: number, random = Math.random): number {
  const capped = Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_MIN_DELAY_MS * 2 ** Math.max(0, attempt),
  );
  const jittered = capped * (0.5 + random() * 0.5);
  return Math.round(
    Math.min(RECONNECT_MAX_DELAY_MS, Math.max(RECONNECT_MIN_DELAY_MS, jittered)),
  );
}

export interface RabbitMqConsumerDeps {
  readonly connect?: (url: string) => Promise<ChannelModel>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly exit?: (code: number) => void;
  readonly giveUpAfterMs?: number;
}

export class RabbitMqConsumer {
  private connection?: ChannelModel;
  private channel?: Channel;
  private handler?: (event: IntegrationEventEnvelope) => Promise<void>;
  private reconnecting?: Promise<void>;
  private stopped = false;
  private readonly deps: Required<RabbitMqConsumerDeps>;

  constructor(
    private readonly url: string,
    private readonly options: RabbitMqConsumerOptions,
    deps: RabbitMqConsumerDeps = {},
  ) {
    this.deps = {
      connect: deps.connect ?? ((u) => amqp.connect(u)),
      sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      now: deps.now ?? Date.now,
      random: deps.random ?? Math.random,
      exit: deps.exit ?? ((code) => process.exit(code)),
      giveUpAfterMs: deps.giveUpAfterMs ?? RECONNECT_GIVE_UP_MS,
    };
  }

  /** Kết nối và tiêu thụ; lỗi kết nối ban đầu cũng đi qua vòng retry. */
  async start(handler: (event: IntegrationEventEnvelope) => Promise<void>): Promise<void> {
    if (this.handler) return;
    this.handler = handler;
    this.stopped = false;
    await this.connectWithRetry();
  }

  private async connectWithRetry(): Promise<void> {
    const startedAt = this.deps.now();
    for (let attempt = 0; !this.stopped; attempt += 1) {
      try {
        await this.open();
        if (attempt > 0) console.warn(`Consumer ${this.options.queue} reconnected.`);
        return;
      } catch (error) {
        await this.teardown();
        const message = error instanceof Error ? error.message : String(error);
        if (this.deps.now() - startedAt >= this.deps.giveUpAfterMs) {
          console.error(`Consumer ${this.options.queue} could not reconnect in time (${message}); exiting.`);
          this.deps.exit(1);
          return;
        }
        const delay = reconnectDelayMs(attempt, this.deps.random);
        console.warn(`Consumer ${this.options.queue} connect failed (${message}); retry in ${delay}ms.`);
        await this.deps.sleep(delay);
      }
    }
  }

  private async open(): Promise<void> {
    const connection = await this.deps.connect(this.url);
    this.connection = connection;
    connection.on('error', (error: unknown) => {
      console.error(`Consumer ${this.options.queue} connection error:`, error instanceof Error ? error.message : error);
    });
    connection.on('close', () => this.onLost(connection));
    const channel = await connection.createConfirmChannel();
    this.channel = channel;
    channel.on('error', (error: unknown) => {
      console.error(`Consumer ${this.options.queue} channel error:`, error instanceof Error ? error.message : error);
    });
    channel.on('close', () => this.onLost(connection));
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(RETRY_EXCHANGE, 'direct', { durable: true });
    await channel.assertQueue(this.options.queue, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE },
    });
    await channel.assertQueue('enterprise.events.dead', { durable: true });
    await channel.bindQueue('enterprise.events.dead', DEAD_LETTER_EXCHANGE, '#');
    for (const retry of buildRetryQueueDefinitions(this.options.queue)) {
      await channel.assertQueue(retry.queue, {
        durable: true,
        arguments: {
          'x-message-ttl': retry.ttlMs,
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': this.options.queue,
        },
      });
      await channel.bindQueue(retry.queue, RETRY_EXCHANGE, retry.routingKey);
    }
    for (const binding of this.options.bindings) {
      await channel.bindQueue(this.options.queue, EXCHANGE, binding);
    }
    await channel.prefetch(this.options.prefetch ?? 8);
    await channel.consume(this.options.queue, (message) => {
      if (!message) return;
      void this.handle(channel, message);
    });
  }

  private async handle(channel: ConfirmChannel, message: ConsumeMessage): Promise<void> {
    try {
      let event: IntegrationEventEnvelope;
      try {
        event = JSON.parse(message.content.toString('utf8')) as IntegrationEventEnvelope;
      } catch {
        throw new PermanentMessageError('Message is not valid JSON.');
      }
      await this.handler?.(event);
      this.safely(() => channel.ack(message));
    } catch (error) {
      console.error(`Consumer ${this.options.queue} failed:`, error instanceof Error ? error.message : error);
      const headers = message.properties.headers;
      if (error instanceof TransientConsumerError) {
        const retries = Number(headers?.['x-transient-retries'] ?? 0);
        if (retries < (this.options.maxTransientRetries ?? 5)) {
          // Giữ tin chưa ack trong lúc chờ; sập process thì broker giao lại.
          await this.deps.sleep((this.options.transientRetryDelayMs ?? 2_000) * (retries + 1));
          await this.relocate(channel, message, () =>
            channel.sendToQueue(this.options.queue, message.content, {
              ...message.properties,
              persistent: true,
              headers: { ...headers, 'x-transient-retries': retries + 1 },
            }),
          );
          return;
        }
        // Hết ngân sách thử lại tạm thời: vào DLQ kèm lý do thay vì nack trần.
        await this.settle(channel, message, { kind: 'dead-letter', attempt: retries, reason: error.message });
        return;
      }
      const rawAttempt = headers?.['x-retry-attempt'];
      const currentAttempt = typeof rawAttempt === 'number' && Number.isFinite(rawAttempt) ? rawAttempt : 0;
      await this.settle(channel, message, retryDisposition(error, currentAttempt));
    }
  }

  /** Đưa tin vào retry queue (TTL) hoặc DLQ theo `disposition`. */
  private async settle(channel: ConfirmChannel, message: ConsumeMessage, disposition: RetryDisposition): Promise<void> {
    const base = {
      contentType: message.properties.contentType ?? 'application/json',
      deliveryMode: 2,
      messageId: message.properties.messageId,
      timestamp: message.properties.timestamp,
      type: message.properties.type,
      correlationId: message.properties.correlationId,
    };
    const originalRoutingKey = message.fields.routingKey;
    if (disposition.kind === 'retry') {
      const retry = buildRetryQueueDefinitions(this.options.queue)[disposition.attempt - 1];
      await this.relocate(channel, message, () =>
        channel.publish(RETRY_EXCHANGE, retry.routingKey, message.content, {
          ...base,
          headers: {
            ...message.properties.headers,
            'x-retry-attempt': disposition.attempt,
            'x-retry-delay-ms': disposition.delayMs,
            'x-original-routing-key': originalRoutingKey,
          },
        }),
      );
      return;
    }
    await this.relocate(channel, message, () =>
      channel.publish(DEAD_LETTER_EXCHANGE, originalRoutingKey || this.options.queue, message.content, {
        ...base,
        headers: {
          ...message.properties.headers,
          'x-retry-attempt': disposition.attempt,
          'x-failure-reason': disposition.reason.slice(0, 1_000),
          'x-original-routing-key': originalRoutingKey,
        },
      }),
    );
  }

  /** Ghi tin sang nơi khác và chỉ ack khi broker đã xác nhận; lỗi thì trả tin về hàng đợi để không mất. */
  private async relocate(channel: ConfirmChannel, message: ConsumeMessage, send: () => void): Promise<void> {
    try {
      send();
      await channel.waitForConfirms();
    } catch (error) {
      console.error(
        `Consumer ${this.options.queue} could not persist retry/DLQ:`,
        error instanceof Error ? error.message : error,
      );
      this.safely(() => channel.nack(message, false, true));
      return;
    }
    this.safely(() => channel.ack(message));
  }

  private safely(action: () => void): void {
    try {
      action();
    } catch (error) {
      // Kênh đã đóng (đang reconnect): broker sẽ giao lại tin chưa ack.
      console.warn(`Consumer ${this.options.queue} ack skipped:`, error instanceof Error ? error.message : error);
    }
  }

  private onLost(connection: ChannelModel): void {
    if (this.stopped || this.connection !== connection || this.reconnecting) return;
    console.warn(`Consumer ${this.options.queue} lost its broker connection; reconnecting.`);
    this.channel = undefined;
    this.connection = undefined;
    this.reconnecting = this.connectWithRetry().finally(() => {
      this.reconnecting = undefined;
    });
  }

  private async teardown(): Promise<void> {
    const { channel, connection } = this;
    this.channel = undefined;
    this.connection = undefined;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }

  isReady(): boolean {
    return this.channel !== undefined;
  }

  async close(): Promise<void> {
    this.stopped = true;
    await this.teardown();
    this.handler = undefined;
  }
}
