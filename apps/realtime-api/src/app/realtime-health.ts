import { Counter, Gauge, Registry } from '@prometheus-io/client';
import { ServiceUnavailableException } from '@nestjs/common';

export interface RealtimePlatformHealth {
  query(text: string): Promise<unknown>;
}

export interface RealtimeValkeyHealth {
  ping(): Promise<string>;
}

export class RealtimeHealthService {
  constructor(
    private readonly platform: RealtimePlatformHealth,
    private readonly valkey: RealtimeValkeyHealth,
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

  socketConnected(): void {
    this.activeSockets.inc();
  }

  socketDisconnected(): void {
    this.activeSockets.dec();
  }

  authFailed(reason: string): void {
    this.authFailures.inc({ reason });
  }

  deliveryPublished(event: string): void {
    this.deliveries.inc({ event });
  }

  sessionRevoked(): void {
    this.sessionRevocations.inc();
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
