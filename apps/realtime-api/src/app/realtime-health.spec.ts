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

  it('requires the RabbitMQ delivery consumer only when delivery is enabled', async () => {
    const platform = { query: jest.fn().mockResolvedValue({ rows: [{ ready: 1 }] }) };
    const valkey = { ping: jest.fn().mockResolvedValue('PONG') };

    await expect(
      new RealtimeHealthService(platform, valkey, { ready: () => false }).ready(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      new RealtimeHealthService(platform, valkey, { ready: () => true }).ready(),
    ).resolves.toEqual({ status: 'ready' });
  });
});

describe('RealtimeMetrics', () => {
  it('exports Prometheus counters and gauges for realtime delivery', async () => {
    const metrics = new RealtimeMetrics();
    metrics.socketConnected();
    metrics.authFailed('origin');
    metrics.reconnected();
    metrics.deliveryPublished('notification.created');
    metrics.sequenceGap();
    metrics.syncReset();
    metrics.socketDisconnected();

    const text = await metrics.render();
    expect(text).toContain('realtime_active_sockets 0');
    expect(text).toContain('realtime_auth_failures_total{reason="origin"} 1');
    expect(text).toContain(
      'realtime_delivery_published_total{event="notification.created"} 1',
    );
    expect(text).toContain('realtime_reconnects_total 1');
    expect(text).toContain('realtime_sequence_gaps_total 1');
    expect(text).toContain('realtime_sync_resets_total 1');
    expect(text).toMatch(/realtime_process_resident_memory_bytes [1-9][0-9]*/);
    expect(text).toMatch(/realtime_process_heap_used_bytes [1-9][0-9]*/);
  });
});
