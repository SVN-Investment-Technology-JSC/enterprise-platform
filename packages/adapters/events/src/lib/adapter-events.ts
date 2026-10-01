import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import amqp, { type Channel, type ConfirmChannel, type ChannelModel } from 'amqplib';
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
}

export class RabbitMqConsumer {
  private connection?: ChannelModel;
  private channel?: Channel;

  constructor(
    private readonly url: string,
    private readonly options: RabbitMqConsumerOptions,
    private readonly connect: AmqpConnect = (url) => amqp.connect(url),
  ) {}

  async start(handler: (event: IntegrationEventEnvelope) => Promise<void>): Promise<void> {
    if (this.channel) return;
    this.connection = await this.connect(this.url);
    const channel = await this.connection.createConfirmChannel();
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
      void (async () => {
        try {
          let event: IntegrationEventEnvelope;
          try {
            event = JSON.parse(message.content.toString('utf8')) as IntegrationEventEnvelope;
          } catch {
            throw new PermanentMessageError('Message is not valid JSON.');
          }
          await handler(event);
          channel.ack(message);
        } catch (error) {
          console.error(`Consumer ${this.options.queue} failed:`, error instanceof Error ? error.message : error);
          const rawAttempt = message.properties.headers?.['x-retry-attempt'];
          const currentAttempt =
            typeof rawAttempt === 'number' && Number.isFinite(rawAttempt)
              ? rawAttempt
              : 0;
          const disposition = retryDisposition(error, currentAttempt);
          try {
            if (disposition.kind === 'retry') {
              const retry = buildRetryQueueDefinitions(this.options.queue)[
                disposition.attempt - 1
              ];
              channel.publish(RETRY_EXCHANGE, retry.routingKey, message.content, {
                contentType: message.properties.contentType ?? 'application/json',
                deliveryMode: 2,
                messageId: message.properties.messageId,
                timestamp: message.properties.timestamp,
                type: message.properties.type,
                correlationId: message.properties.correlationId,
                headers: {
                  ...message.properties.headers,
                  'x-retry-attempt': disposition.attempt,
                  'x-retry-delay-ms': disposition.delayMs,
                  'x-original-routing-key': message.fields.routingKey,
                },
              });
            } else {
              channel.publish(
                DEAD_LETTER_EXCHANGE,
                message.fields.routingKey || this.options.queue,
                message.content,
                {
                  contentType: message.properties.contentType ?? 'application/json',
                  deliveryMode: 2,
                  messageId: message.properties.messageId,
                  timestamp: message.properties.timestamp,
                  type: message.properties.type,
                  correlationId: message.properties.correlationId,
                  headers: {
                    ...message.properties.headers,
                    'x-retry-attempt': disposition.attempt,
                    'x-failure-reason': disposition.reason.slice(0, 1_000),
                    'x-original-routing-key': message.fields.routingKey,
                  },
                },
              );
            }
            await channel.waitForConfirms();
            channel.ack(message);
          } catch (publishError) {
            console.error(
              `Consumer ${this.options.queue} could not persist retry/DLQ:`,
              publishError instanceof Error ? publishError.message : publishError,
            );
            channel.nack(message, false, true);
          }
        }
      })();
    });
    this.connection.on('close', () => { this.channel = undefined; this.connection = undefined; });
    this.channel = channel;
  }

  isReady(): boolean {
    return this.channel !== undefined;
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.channel = undefined;
    this.connection = undefined;
  }
}
