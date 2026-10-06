import {
  NotificationConsumerRuntime,
  NotificationWorkerOperational,
  createNotificationOperationalServer,
  featureFlag,
} from './notification-operational';

describe('notification worker rollout controls', () => {
  it('requires explicit boolean feature flag values', () => {
    expect(featureFlag(undefined, false)).toBe(false);
    expect(featureFlag('true', false)).toBe(true);
    expect(featureFlag('false', true)).toBe(false);
    expect(() => featureFlag('enabled', false)).toThrow('true or false');
  });

  it('keeps the worker ready in dark mode without connecting a consumer', async () => {
    const rabbit = { start: jest.fn(), close: jest.fn() };
    const runtime = new NotificationConsumerRuntime(rabbit as never, false);

    await runtime.start(jest.fn());

    expect(rabbit.start).not.toHaveBeenCalled();
    expect(runtime.ready()).toBe(true);
  });
});

describe('NotificationWorkerOperational', () => {
  it('checks PostgreSQL and enabled consumer state for readiness', async () => {
    const platform = { query: jest.fn().mockResolvedValue({ rows: [{ ready: 1 }] }) };
    const consumer = { ready: jest.fn().mockReturnValue(false) };
    const operational = new NotificationWorkerOperational(platform, consumer);

    await expect(operational.ready()).resolves.toEqual({
      status: 'not-ready',
      reason: 'RabbitMQ notification consumer is not ready.',
    });
    consumer.ready.mockReturnValue(true);
    await expect(operational.ready()).resolves.toEqual({ status: 'ready' });
    expect(platform.query).toHaveBeenCalledWith('SELECT 1 AS ready');
  });

  it('exports processing, failure and queue-lag metrics', async () => {
    const operational = new NotificationWorkerOperational(
      { query: jest.fn() },
      { ready: () => true },
    );
    operational.processed('created', '2026-10-01T00:00:00.000Z');
    operational.failed('temporary');

    const metrics = await operational.metrics();
    expect(metrics).toContain(
      'notification_worker_events_processed_total{outcome="created"} 1',
    );
    expect(metrics).toContain(
      'notification_worker_failures_total{kind="temporary"} 1',
    );
    expect(metrics).toContain('notification_worker_queue_lag_seconds');
  });

  it('serves liveness and dependency-aware readiness over the internal HTTP port', async () => {
    const operational = new NotificationWorkerOperational(
      { query: jest.fn().mockResolvedValue({ rows: [{ ready: 1 }] }) },
      { ready: () => false },
    );
    const server = createNotificationOperationalServer(operational);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no TCP port.');

    try {
      const live = await fetch(`http://127.0.0.1:${address.port}/health/live`);
      expect(live.status).toBe(200);
      await expect(live.json()).resolves.toEqual({ status: 'ok' });

      const ready = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
      expect(ready.status).toBe(503);
      await expect(ready.json()).resolves.toMatchObject({ status: 'not-ready' });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
