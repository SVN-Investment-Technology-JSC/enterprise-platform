import { Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';
import { ServiceUnavailableException } from '@nestjs/common';

export interface RealtimePlatformHealth {
  query(text: string): Promise<unknown>;
}

export interface RealtimeValkeyHealth {
  ping(): Promise<string>;
}

export interface RealtimeDeliveryHealth {
  ready(): boolean;
}

export class RealtimeHealthService {
  constructor(
    private readonly platform: RealtimePlatformHealth,
    private readonly valkey: RealtimeValkeyHealth,
    private readonly delivery?: RealtimeDeliveryHealth,
  ) {}

  live(): { readonly status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<{ readonly status: 'ready' }> {
    try {
      const [, pong] = await Promise.all([
        this.platform.query('SELECT 1 AS ready'),
        this.valkey.ping(),
      ]);
      if (pong !== 'PONG') throw new Error('Valkey ping did not return PONG.');
      if (this.delivery && !this.delivery.ready()) {
        throw new Error('RabbitMQ delivery consumer is not ready.');
      }
      return { status: 'ready' };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'not-ready',
        reason: error instanceof Error ? error.message : 'Dependency check failed.',
      });
    }
  }
}

export class RealtimeMetrics {
  private readonly registry = new Registry();
  private readonly activeSockets = new Gauge({
    name: 'realtime_active_sockets',
    help: 'Current number of authenticated realtime sockets.',
    registers: [this.registry],
  });
  private readonly authFailures = new Counter<'reason'>({
    name: 'realtime_auth_failures_total',
    help: 'Rejected realtime socket handshakes.',
    labelNames: ['reason'],
    registers: [this.registry],
  });
  private readonly deliveries = new Counter<'event'>({
    name: 'realtime_delivery_published_total',
    help: 'Realtime events persisted to Valkey Streams for Socket.IO delivery.',
    labelNames: ['event'],
    registers: [this.registry],
  });
  private readonly sessionRevocations = new Counter({
    name: 'realtime_session_revocations_total',
    help: 'Session revocations propagated through the realtime gateway.',
    registers: [this.registry],
  });
  private readonly reconnects = new Counter({
    name: 'realtime_reconnects_total',
    help: 'Authenticated sockets recovered after a connection interruption.',
    registers: [this.registry],
  });
  private readonly sequenceGaps = new Counter({
    name: 'realtime_sequence_gaps_total',
    help: 'Sequence gaps detected by REST synchronization.',
    registers: [this.registry],
  });
  private readonly syncResets = new Counter({
    name: 'realtime_sync_resets_total',
    help: 'REST synchronization requests that required a full reset.',
    registers: [this.registry],
  });
  private readonly deliveryLatency = new Histogram({
    name: 'realtime_delivery_latency_seconds',
    help: 'Seconds from event occurrence until publication to Valkey Streams.',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  });

  socketConnected(): void {
    this.activeSockets.inc();
  }

  socketDisconnected(): void {
    this.activeSockets.dec();
  }

  authFailed(reason: string): void {
    this.authFailures.inc({ reason });
  }

  deliveryPublished(event: string, occurredAt?: string): void {
    this.deliveries.inc({ event });
    if (occurredAt) {
      const occurredAtMs = Date.parse(occurredAt);
      if (Number.isFinite(occurredAtMs)) {
        this.deliveryLatency.observe(Math.max(0, Date.now() - occurredAtMs) / 1_000);
      }
    }
  }

  sessionRevoked(): void {
    this.sessionRevocations.inc();
  }

  reconnected(): void {
    this.reconnects.inc();
  }

  sequenceGap(): void {
    this.sequenceGaps.inc();
  }

  syncReset(): void {
    this.syncResets.inc();
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
