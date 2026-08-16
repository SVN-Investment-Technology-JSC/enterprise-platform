import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import amqp, { type Channel, type ConfirmChannel, type ChannelModel } from 'amqplib';
import type { Pool } from 'pg';

const EXCHANGE = 'enterprise.events';
const DEAD_LETTER_EXCHANGE = 'enterprise.events.dlx';

export class RabbitMqPublisher {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;

  constructor(private readonly url: string) {}

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
    this.connection = await amqp.connect(this.url);
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
        await this.publisher.publish(row.payload);
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
  ) {}

  async start(handler: (event: IntegrationEventEnvelope) => Promise<void>): Promise<void> {
    if (this.channel) return;
    this.connection = await amqp.connect(this.url);
    const channel = await this.connection.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', { durable: true });
    await channel.assertQueue(this.options.queue, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE },
    });
    for (const binding of this.options.bindings) {
      await channel.bindQueue(this.options.queue, EXCHANGE, binding);
    }
    await channel.prefetch(this.options.prefetch ?? 8);
    await channel.consume(this.options.queue, (message) => {
      if (!message) return;
      void (async () => {
        try {
          const event = JSON.parse(message.content.toString('utf8')) as IntegrationEventEnvelope;
          await handler(event);
          channel.ack(message);
        } catch (error) {
          const redelivered = message.fields.redelivered;
          console.error(`Consumer ${this.options.queue} failed:`, error instanceof Error ? error.message : error);
          channel.nack(message, false, !redelivered);
        }
      })();
    });
    this.connection.on('close', () => { this.channel = undefined; this.connection = undefined; });
    this.channel = channel;
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
    this.channel = undefined;
    this.connection = undefined;
  }
}
