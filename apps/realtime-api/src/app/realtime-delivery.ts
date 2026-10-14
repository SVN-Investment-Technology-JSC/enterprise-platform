import {
  PermanentMessageError,
  RabbitMqConsumer,
} from '@enterprise-platform/adapter-events';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import {
  parseRealtimeEventEnvelope,
  type WorkspaceChatSignal,
} from '@enterprise-platform/contracts-realtime';
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
    if (event.type === 'workspace.chat.changed') {
      const { recipients, signal } = chatSignal(event.payload);
      // Mỗi người nhận một bao thư riêng vào phòng cá nhân của họ: dùng lại đúng
      // đường xác thực và thu hồi phiên của thông báo, không thêm phòng mới.
      await this.withActiveTenant(event.tenantId, async () => {
        for (const userId of recipients) {
          await this.gateway.emitUserEvent({
            id: `${event.id}:${userId}`,
            event: 'workspace.chat.changed',
            version: 1,
            tenantId: event.tenantId,
            userId,
            // Tín hiệu chỉ để làm mới, không nằm trong chuỗi thông báo có thứ tự;
            // khôi phục sau khi mất kết nối đã có tải lại qua API.
            sequence: 1,
            occurredAt: event.occurredAt,
            data: signal,
          });
        }
      });
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
        bindings: ['notification.delivery.v1', 'identity.session.revoked', 'workspace.chat.changed'],
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

const MAX_CHAT_RECIPIENTS = 1_000;
/** Phải khớp `WorkspaceChatSignal['change']`: thiếu một giá trị là sự kiện đó bị đẩy vào DLQ. */
const CHAT_CHANGES: ReadonlySet<string> = new Set(['created', 'edited', 'deleted', 'read']);

function isChatChange(value: unknown): value is WorkspaceChatSignal['change'] {
  return typeof value === 'string' && CHAT_CHANGES.has(value);
}

function chatSignal(value: unknown): {
  readonly recipients: readonly string[];
  readonly signal: WorkspaceChatSignal;
} {
  if (!isRecord(value)) throw new PermanentMessageError('Chat signal payload must be an object.');
  const channelId = text(value.channelId);
  const entityId = text(value.entityId);
  const projectId = text(value.projectId);
  const messageId = text(value.messageId);
  const actorUserId = text(value.actorUserId);
  const entityType = value.entityType;
  const change = value.change;
  if (
    !channelId || !entityId || !projectId || !messageId || !actorUserId ||
    (entityType !== 'project' && entityType !== 'work_item') ||
    !isChatChange(change) ||
    !Array.isArray(value.recipientUserIds)
  ) {
    throw new PermanentMessageError('Chat signal payload is incomplete.');
  }
  const recipients = [...new Set(value.recipientUserIds.map(text).filter((id): id is string => Boolean(id)))]
    .filter((id) => id !== actorUserId)
    .slice(0, MAX_CHAT_RECIPIENTS);
  return {
    recipients,
    signal: { channelId, entityType, entityId, projectId, messageId, change, actorUserId },
  };
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
