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
      on: jest.fn(),
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

describe('RabbitMqPublisher connection loss', () => {
  it('handles a connection error and opens a fresh connection on the next publish', async () => {
    const handlers: Record<string, (error?: unknown) => void> = {};
    const makeChannel = () => ({
      assertExchange: jest.fn(async () => undefined),
      assertQueue: jest.fn(async () => undefined),
      bindQueue: jest.fn(async () => undefined),
      publish: jest.fn(() => true),
      waitForConfirms: jest.fn(async () => undefined),
      on: jest.fn(),
    });
    const connect = jest.fn(async () => ({
      createConfirmChannel: jest.fn(async () => makeChannel()),
      on: jest.fn((event: string, callback: (error?: unknown) => void) => {
        handlers[event] = callback;
      }),
    }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const publisher = new RabbitMqPublisher('amqp://localhost', connect as never);
    const event = {
      id: 'event-1',
      type: 'workspace.work-item.assigned',
      version: 1,
      occurredAt: '2026-10-01T08:00:00.000Z',
      tenantId: 'tenant-1',
      source: 'workspace',
      correlationId: 'work-item-1',
      payload: {},
    };

    await publisher.publish(event);
    // Có listener `error` thì heartbeat timeout không làm sập tiến trình.
    expect(handlers['error']).toBeDefined();
    expect(() => handlers['error']?.(new Error('Heartbeat timeout'))).not.toThrow();

    await publisher.publish(event);
    expect(connect).toHaveBeenCalledTimes(2);
    warn.mockRestore();
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
      on: jest.fn(),
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
      { connect: jest.fn(async () => connection) as never, sleep: async () => undefined },
    );

    expect(consumer.isReady()).toBe(false);
    await consumer.start(jest.fn());
    expect(consumer.isReady()).toBe(true);
    onClose?.();
    expect(consumer.isReady()).toBe(false);
    await consumer.close();
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

import {
  TransientConsumerError,
  reconnectDelayMs,
} from './adapter-events.js';

function fakeBroker() {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const chHandlers: Record<string, (...a: unknown[]) => void> = {};
  let consumeCb: ((m: unknown) => void) | undefined;
  const channel = {
    on: jest.fn((e: string, cb: (...a: unknown[]) => void) => { chHandlers[e] = cb; }),
    assertExchange: jest.fn(async () => undefined),
    assertQueue: jest.fn(async () => undefined),
    bindQueue: jest.fn(async () => undefined),
    prefetch: jest.fn(async () => undefined),
    consume: jest.fn(async (_q: string, cb: (m: unknown) => void) => { consumeCb = cb; }),
    ack: jest.fn(),
    nack: jest.fn(),
    sendToQueue: jest.fn(),
    publish: jest.fn(),
    waitForConfirms: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  const connection = {
    on: jest.fn((e: string, cb: (...a: unknown[]) => void) => { handlers[e] = cb; }),
    createConfirmChannel: jest.fn(async () => channel),
    close: jest.fn(async () => undefined),
  };
  return { channel, connection, handlers, deliver: (m: unknown) => consumeCb?.(m) };
}
const msg = (headers: Record<string, unknown> = {}, redelivered = false) => ({
  content: Buffer.from(JSON.stringify({ id: 'e1', type: 't' })),
  fields: { redelivered, routingKey: 'a.b' },
  properties: { headers },
});
const flush = () => new Promise((r) => setImmediate(r));

describe('reconnectDelayMs', () => {
  it('stays within 1s-30s and grows', () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(1000);
    expect(reconnectDelayMs(3, () => 1)).toBe(8000);
    expect(reconnectDelayMs(20, () => 1)).toBe(30000);
    expect(reconnectDelayMs(20, () => 0)).toBe(15000);
  });
});

describe('RabbitMqConsumer reconnect', () => {
  const opts = { queue: 'q', bindings: ['a.b'] };

  it('retries the initial connection with backoff until it succeeds', async () => {
    const broker = fakeBroker();
    const connect = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(broker.connection);
    const sleep = jest.fn(async (_ms: number) => undefined);
    const consumer = new RabbitMqConsumer('amqp://x', opts, { connect: connect as never, sleep, random: () => 1 });
    await consumer.start(async () => undefined);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
    expect(broker.channel.consume).toHaveBeenCalledTimes(1);
  });

  it('re-declares topology and consumes again after the connection closes', async () => {
    const first = fakeBroker();
    const second = fakeBroker();
    const connect = jest.fn().mockResolvedValueOnce(first.connection).mockResolvedValue(second.connection);
    const consumer = new RabbitMqConsumer('amqp://x', opts, { connect: connect as never, sleep: async () => undefined });
    await consumer.start(async () => undefined);
    first.handlers.close();
    await flush();
    await flush();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(second.channel.assertQueue).toHaveBeenCalled();
    expect(second.channel.bindQueue).toHaveBeenCalledWith('q', 'enterprise.events', 'a.b');
    expect(second.channel.consume).toHaveBeenCalledTimes(1);
  });

  it('exits the process when it cannot reconnect within the deadline', async () => {
    let clock = 0;
    const exit = jest.fn();
    const connect = jest.fn().mockRejectedValue(new Error('down'));
    const consumer = new RabbitMqConsumer('amqp://x', opts, {
      connect: connect as never,
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      exit,
      random: () => 1,
      giveUpAfterMs: 60_000,
    });
    await consumer.start(async () => undefined);
    expect(exit).toHaveBeenCalledWith(1);
    expect(clock).toBeGreaterThanOrEqual(60_000 - 30_000);
  });
});

describe('RabbitMqConsumer failure handling', () => {
  const setup = async (handler: () => Promise<void>, extra = {}) => {
    const broker = fakeBroker();
    const sleep = jest.fn(async (_ms: number) => undefined);
    const consumer = new RabbitMqConsumer('amqp://x', { queue: 'q', bindings: [], ...extra }, {
      connect: (async () => broker.connection) as never,
      sleep,
    });
    await consumer.start(handler);
    return { broker, sleep };
  };

  it('acks on success', async () => {
    const { broker } = await setup(async () => undefined);
    const m = msg();
    broker.deliver(m);
    await flush();
    expect(broker.channel.ack).toHaveBeenCalledWith(m);
  });

  it('requeues a transient failure with delay instead of dead-lettering', async () => {
    const { broker, sleep } = await setup(async () => { throw new TransientConsumerError('busy'); });
    const m = msg({ 'x-transient-retries': 1 });
    broker.deliver(m);
    await flush();
    expect(sleep).toHaveBeenCalledWith(4000);
    expect(broker.channel.sendToQueue).toHaveBeenCalledWith('q', m.content, expect.objectContaining({
      headers: { 'x-transient-retries': 2 },
    }));
    expect(broker.channel.ack).toHaveBeenCalledWith(m);
    expect(broker.channel.nack).not.toHaveBeenCalled();
  });

  it('dead-letters a transient failure with its reason after the retry budget', async () => {
    const { broker } = await setup(async () => { throw new TransientConsumerError('busy'); }, { maxTransientRetries: 2 });
    const m = msg({ 'x-transient-retries': 2 });
    broker.deliver(m);
    await flush();
    expect(broker.channel.publish).toHaveBeenCalledWith('enterprise.events.dlx', 'a.b', m.content, expect.objectContaining({
      headers: expect.objectContaining({ 'x-failure-reason': 'busy' }),
    }));
    expect(broker.channel.ack).toHaveBeenCalledWith(m);
    expect(broker.channel.nack).not.toHaveBeenCalled();
  });

  it('sends other failures to the first TTL retry queue, then acks once the broker confirmed', async () => {
    const { broker } = await setup(async () => { throw new Error('bad'); });
    const m = msg();
    broker.deliver(m);
    await flush();
    expect(broker.channel.publish).toHaveBeenCalledWith('enterprise.events.retry', 'q.retry.1', m.content, expect.objectContaining({
      headers: expect.objectContaining({ 'x-retry-attempt': 1, 'x-retry-delay-ms': 5000 }),
    }));
    expect(broker.channel.waitForConfirms).toHaveBeenCalled();
    expect(broker.channel.ack).toHaveBeenCalledWith(m);
    expect(broker.channel.nack).not.toHaveBeenCalled();
  });

  it('dead-letters other failures once the retry queues are exhausted', async () => {
    const { broker } = await setup(async () => { throw new Error('still bad'); });
    const m = msg({ 'x-retry-attempt': 3 });
    broker.deliver(m);
    await flush();
    expect(broker.channel.publish).toHaveBeenCalledWith('enterprise.events.dlx', 'a.b', m.content, expect.objectContaining({
      headers: expect.objectContaining({ 'x-retry-attempt': 3, 'x-failure-reason': 'still bad' }),
    }));
    expect(broker.channel.ack).toHaveBeenCalledWith(m);
  });

  it('sends permanent errors straight to the DLQ without retrying', async () => {
    const { broker } = await setup(async () => { throw new PermanentMessageError('invalid event schema'); });
    const m = msg();
    broker.deliver(m);
    await flush();
    expect(broker.channel.publish).toHaveBeenCalledTimes(1);
    expect(broker.channel.publish).toHaveBeenCalledWith('enterprise.events.dlx', 'a.b', m.content, expect.objectContaining({
      headers: expect.objectContaining({ 'x-failure-reason': 'invalid event schema' }),
    }));
    expect(broker.channel.ack).toHaveBeenCalledWith(m);
  });

  it('treats an unparseable message as permanent', async () => {
    const handler = jest.fn(async () => undefined);
    const { broker } = await setup(handler);
    const m = { ...msg(), content: Buffer.from('not json') };
    broker.deliver(m);
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(broker.channel.publish).toHaveBeenCalledWith('enterprise.events.dlx', 'a.b', m.content, expect.objectContaining({
      headers: expect.objectContaining({ 'x-failure-reason': 'Message is not valid JSON.' }),
    }));
  });

  it('returns the message to the queue when the broker does not confirm the retry publish', async () => {
    const { broker } = await setup(async () => { throw new Error('bad'); });
    broker.channel.waitForConfirms.mockRejectedValueOnce(new Error('nack from broker'));
    const m = msg();
    broker.deliver(m);
    await flush();
    expect(broker.channel.nack).toHaveBeenCalledWith(m, false, true);
    expect(broker.channel.ack).not.toHaveBeenCalled();
  });
});
