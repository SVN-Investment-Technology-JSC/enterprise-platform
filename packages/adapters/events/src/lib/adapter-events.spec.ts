import {
  PermanentMessageError,
  RABBITMQ_RETRY_DELAYS_MS,
  RabbitMqPublisher,
  RabbitMqConsumer,
  buildRetryQueueDefinitions,
  retryDisposition,
} from './adapter-events.js';

describe('RabbitMqPublisher', () => {
  it('is configured without opening a connection eagerly', () => {
    expect(new RabbitMqPublisher('amqp://localhost')).toBeInstanceOf(RabbitMqPublisher);
  });

  it('waits for broker confirmation before publish completes', async () => {
    const waitForConfirms = jest.fn(async () => undefined);
    const publish = jest.fn(() => true);
    const channel = {
      assertExchange: jest.fn(async () => undefined),
      assertQueue: jest.fn(async () => undefined),
      bindQueue: jest.fn(async () => undefined),
      publish,
      waitForConfirms,
    };
    const connection = {
      createConfirmChannel: jest.fn(async () => channel),
      on: jest.fn(),
    };
    const publisher = new RabbitMqPublisher(
      'amqp://localhost',
      jest.fn(async () => connection) as never,
    );

    await publisher.publish({
      id: 'event-1',
      type: 'workspace.work-item.assigned',
      version: 1,
      occurredAt: '2026-10-01T08:00:00.000Z',
      tenantId: 'tenant-1',
      source: 'workspace',
      correlationId: 'work-item-1',
      payload: {},
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(waitForConfirms).toHaveBeenCalledTimes(1);
    expect(publish.mock.invocationCallOrder[0]).toBeLessThan(
      waitForConfirms.mock.invocationCallOrder[0],
    );
  });
});

describe('RabbitMqConsumer readiness', () => {
  it('tracks broker channel availability across start and connection close', async () => {
    let onClose: (() => void) | undefined;
    const channel = {
      assertExchange: jest.fn(async () => undefined),
      assertQueue: jest.fn(async () => undefined),
      bindQueue: jest.fn(async () => undefined),
      prefetch: jest.fn(async () => undefined),
      consume: jest.fn(async () => ({ consumerTag: 'consumer-a' })),
      close: jest.fn(async () => undefined),
    };
    const connection = {
      createConfirmChannel: jest.fn(async () => channel),
      on: jest.fn((event: string, callback: () => void) => {
        if (event === 'close') onClose = callback;
      }),
      close: jest.fn(async () => undefined),
    };
    const consumer = new RabbitMqConsumer(
      'amqp://localhost',
      { queue: 'test.events.v1', bindings: ['test.event'] },
      jest.fn(async () => connection) as never,
    );

    expect(consumer.isReady()).toBe(false);
    await consumer.start(jest.fn());
    expect(consumer.isReady()).toBe(true);
    onClose?.();
    expect(consumer.isReady()).toBe(false);
  });
});

describe('RabbitMQ retry topology', () => {
  it('declares 5 second, 30 second and 5 minute retry queues', () => {
    expect(RABBITMQ_RETRY_DELAYS_MS).toEqual([5_000, 30_000, 300_000]);
    expect(buildRetryQueueDefinitions('notifications.domain.v1')).toEqual([
      expect.objectContaining({ ttlMs: 5_000 }),
      expect.objectContaining({ ttlMs: 30_000 }),
      expect.objectContaining({ ttlMs: 300_000 }),
    ]);
  });

  it('retries transient failures three times then sends a reason to DLQ', () => {
    expect(retryDisposition(new Error('temporary'), 0)).toMatchObject({
      kind: 'retry',
      delayMs: 5_000,
      attempt: 1,
    });
    expect(retryDisposition(new Error('temporary'), 2)).toMatchObject({
      kind: 'retry',
      delayMs: 300_000,
      attempt: 3,
    });
    expect(retryDisposition(new Error('temporary'), 3)).toEqual({
      kind: 'dead-letter',
      attempt: 3,
      reason: 'temporary',
    });
  });

  it('sends permanent schema failures directly to DLQ with their reason', () => {
    expect(
      retryDisposition(new PermanentMessageError('invalid event schema'), 0),
    ).toEqual({
      kind: 'dead-letter',
      attempt: 0,
      reason: 'invalid event schema',
    });
  });
});
