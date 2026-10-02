import {
  PermanentMessageError,
  RabbitMqConsumer,
} from '@enterprise-platform/adapter-events';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import { parseRealtimeEventEnvelope } from '@enterprise-platform/contracts-realtime';
import { RealtimeGateway } from './realtime.gateway';

export class RealtimeDeliveryHandler {
  constructor(
    private readonly gateway: Pick<RealtimeGateway, 'emitUserEvent' | 'disconnectSession'>,
    private readonly withActiveTenant: (tenantId: string, operation: () => Promise<void>) => Promise<void>,
  ) {}

  async handle(event: IntegrationEventEnvelope): Promise<void> {
    if (event.version !== 1) {
      throw new PermanentMessageError(`Unsupported event version for ${event.type}.`);
    }
    if (event.type === 'notification.delivery.v1') {
      let realtime;
      try {
        realtime = parseRealtimeEventEnvelope(event.payload);
      } catch (error) {
        throw new PermanentMessageError(
          error instanceof Error ? `Invalid realtime delivery: ${error.message}` : 'Invalid realtime delivery.',
        );
      }
      if (realtime.tenantId !== event.tenantId) {
        throw new PermanentMessageError('Realtime delivery tenant does not match envelope tenant.');
      }
      await this.withActiveTenant(event.tenantId, () => this.gateway.emitUserEvent(realtime));
      return;
    }
    if (event.type === 'identity.session.revoked') {
      const payload = sessionRevocation(event.payload);
      await this.gateway.disconnectSession(payload.sessionId, {
        tenantId: event.tenantId,
        userId: payload.userId,
        reason: payload.reason,
      });
      return;
    }
    throw new PermanentMessageError(`Unsupported realtime event type ${event.type}.`);
  }
}

export class RealtimeDeliveryConsumer {
  private readonly consumer: RabbitMqConsumer;
  private started = false;

  constructor(
    rabbitUrl: string,
    private readonly handler: RealtimeDeliveryHandler,
    consumer?: RabbitMqConsumer,
    private readonly enabled = true,
  ) {
    this.consumer =
      consumer ??
      new RabbitMqConsumer(rabbitUrl, {
        queue: 'realtime-api.delivery.v1',
        bindings: ['notification.delivery.v1', 'identity.session.revoked'],
        prefetch: 64,
      });
  }

  async start(): Promise<void> {
    if (!this.enabled) return;
    await this.consumer.start((event) => this.handler.handle(event));
    this.started = true;
  }

  ready(): boolean {
    if (!this.enabled) return true;
    const readiness = (this.consumer as RabbitMqConsumer & {
      isReady?: () => boolean;
    }).isReady;
    return this.started && (readiness ? readiness.call(this.consumer) : true);
  }

  async close(): Promise<void> {
    if (this.enabled) await this.consumer.close();
    this.started = false;
  }
}

function sessionRevocation(value: unknown): {
  readonly userId: string;
  readonly sessionId: string;
  readonly reason: string;
} {
  if (!isRecord(value)) throw new PermanentMessageError('Session revocation payload must be an object.');
  const userId = text(value.userId);
  const sessionId = text(value.sessionId);
  const reason = text(value.reason);
  if (!userId || !sessionId || !reason) {
    throw new PermanentMessageError('Session revocation payload is incomplete.');
  }
  return { userId, sessionId, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
