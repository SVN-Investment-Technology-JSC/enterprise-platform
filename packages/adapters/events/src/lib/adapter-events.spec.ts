import { RabbitMqPublisher } from './adapter-events.js';

describe('RabbitMqPublisher', () => {
  it('is configured without opening a connection eagerly', () => {
    expect(new RabbitMqPublisher('amqp://localhost')).toBeInstanceOf(RabbitMqPublisher);
  });
});

import {
  RabbitMqConsumer,
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
    close: jest.fn(async () => undefined),
  };
  const connection = {
    on: jest.fn((e: string, cb: (...a: unknown[]) => void) => { handlers[e] = cb; }),
    createChannel: jest.fn(async () => channel),
    close: jest.fn(async () => undefined),
  };
  return { channel, connection, handlers, deliver: (m: unknown) => consumeCb?.(m) };
}
const msg = (headers: Record<string, unknown> = {}, redelivered = false) => ({
  content: Buffer.from(JSON.stringify({ id: 'e1', type: 't' })),
  fields: { redelivered },
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

  it('dead-letters a transient failure after the retry budget', async () => {
    const { broker } = await setup(async () => { throw new TransientConsumerError('busy'); }, { maxTransientRetries: 2 });
    const m = msg({ 'x-transient-retries': 2 });
    broker.deliver(m);
    await flush();
    expect(broker.channel.nack).toHaveBeenCalledWith(m, false, false);
  });

  it('keeps the old behaviour for permanent errors: requeue once then DLQ', async () => {
    const { broker } = await setup(async () => { throw new Error('bad'); });
    const first = msg({}, false);
    const second = msg({}, true);
    broker.deliver(first);
    broker.deliver(second);
    await flush();
    expect(broker.channel.nack).toHaveBeenCalledWith(first, false, true);
    expect(broker.channel.nack).toHaveBeenCalledWith(second, false, false);
  });
});
