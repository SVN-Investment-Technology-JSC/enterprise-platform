import { ServiceUnavailableException } from '@nestjs/common';
import { RealtimeHealthService, RealtimeMetrics } from './realtime-health';

describe('RealtimeHealthService', () => {
  it('keeps liveness independent from external dependencies', () => {
    const health = new RealtimeHealthService(
      { query: jest.fn().mockRejectedValue(new Error('db down')) },
      { ping: jest.fn().mockRejectedValue(new Error('valkey down')) },
    );

    expect(health.live()).toEqual({ status: 'ok' });
  });

  it('reports ready only after both platform PostgreSQL and Valkey respond', async () => {
    const platform = { query: jest.fn().mockResolvedValue({ rows: [{ ready: 1 }] }) };
    const valkey = { ping: jest.fn().mockResolvedValue('PONG') };
    const health = new RealtimeHealthService(platform, valkey);

    await expect(health.ready()).resolves.toEqual({ status: 'ready' });
    expect(platform.query).toHaveBeenCalledWith('SELECT 1 AS ready');
    expect(valkey.ping).toHaveBeenCalledTimes(1);
  });

  it('returns service unavailable when a readiness dependency fails', async () => {
    const health = new RealtimeHealthService(
      { query: jest.fn().mockResolvedValue({ rows: [{ ready: 1 }] }) },
      { ping: jest.fn().mockRejectedValue(new Error('valkey down')) },
    );

    await expect(health.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('RealtimeMetrics', () => {
  it('exports Prometheus counters and gauges for realtime delivery', async () => {
    const metrics = new RealtimeMetrics();
    metrics.socketConnected();
    metrics.authFailed('origin');
    metrics.deliveryPublished('notification.created');
    metrics.socketDisconnected();

    const text = await metrics.render();
    expect(text).toContain('realtime_active_sockets 0');
    expect(text).toContain('realtime_auth_failures_total{reason="origin"} 1');
    expect(text).toContain(
      'realtime_delivery_published_total{event="notification.created"} 1',
    );
  });
});
