import { PermanentMessageError } from '@enterprise-platform/adapter-events';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type { NotificationPreference } from '@enterprise-platform/contracts-realtime';
import {
  effectiveDelivery,
  type NotificationPolicyRegistry,
  type PostgresNotificationStore,
  type RecipientDirectory,
  type ResolvedNotificationPolicy,
} from '@enterprise-platform/module-notifications';

export interface NotificationStorePort {
  preferences(userId: string): Promise<readonly NotificationPreference[]>;
  process: PostgresNotificationStore['process'];
}

export interface NotificationTenantRuntime {
  readonly directory: RecipientDirectory;
  readonly store: NotificationStorePort;
  readonly relay: { flush(): Promise<number> };
}

export interface NotificationTenantRuntimeRegistry {
  resolve(tenantId: string): Promise<NotificationTenantRuntime | undefined>;
}

export interface NotificationProcessingOutcome {
  readonly status: 'processed' | 'ignored' | 'tenant-inactive';
  readonly recipients: number;
  readonly mutations: number;
}

export class NotificationProcessor {
  constructor(
    private readonly tenants: NotificationTenantRuntimeRegistry,
    private readonly policies: NotificationPolicyRegistry,
  ) {}

  async handle(event: IntegrationEventEnvelope): Promise<NotificationProcessingOutcome> {
    validateEnvelope(event);
    const policy = this.policies.find(event.type, event.version);
    if (!policy) return { status: 'ignored', recipients: 0, mutations: 0 };

    const tenant = await this.tenants.resolve(event.tenantId);
    if (!tenant) {
      return { status: 'tenant-inactive', recipients: 0, mutations: 0 };
    }

    let resolved;
    try {
      resolved = await this.policies.resolve(event, tenant.directory);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new PermanentMessageError(error.message);
      }
      throw error;
    }
    if (!resolved) return { status: 'ignored', recipients: 0, mutations: 0 };

    let mutations = 0;
    for (const userId of resolved.recipients) {
      const preferences = await tenant.store.preferences(userId);
      const selected = preferences.find(
        (candidate) =>
          candidate.module === policy.module &&
          candidate.category === policy.category,
      );
      const delivery = effectiveDelivery(
        policy.priority,
        selected
          ? {
              feedEnabled: selected.feedEnabled,
              toastEnabled: selected.toastEnabled,
            }
          : undefined,
      );
      const processPolicy: ResolvedNotificationPolicy = {
        module: policy.module,
        category: policy.category,
        priority: policy.priority,
        ...delivery,
        ...(resolved.aggregationKey
          ? { aggregationKey: resolved.aggregationKey }
          : {}),
        ...(resolved.aggregationWindowMinutes
          ? { aggregationWindowMinutes: resolved.aggregationWindowMinutes }
          : {}),
      };
      const result = await tenant.store.process(
        {
          id: event.id,
          tenantId: event.tenantId,
          userId,
          type: event.type,
          version: event.version,
          occurredAt: event.occurredAt,
          sourceType: resolved.template.sourceType,
          sourceId: resolved.template.sourceId,
          title: resolved.template.title,
          body: resolved.template.body,
          ...(resolved.template.deepLink
            ? { deepLink: resolved.template.deepLink }
            : {}),
          data: {
            eventType: event.type,
            correlationId: event.correlationId,
            ...(resolved.template.data ?? {}),
          },
        },
        processPolicy,
      );
      if (result.status === 'created' || result.status === 'updated') mutations += 1;
    }

    // A previous attempt may have committed the notification but failed while
    // publishing its delivery event. Flush even when every recipient is a
    // duplicate so redelivery can drain that durable outbox row.
    if (resolved.recipients.length > 0) await tenant.relay.flush();
    return {
      status: 'processed',
      recipients: resolved.recipients.length,
      mutations,
    };
  }
}

function validateEnvelope(event: IntegrationEventEnvelope): void {
  const fields = {
    id: event?.id,
    type: event?.type,
    tenantId: event?.tenantId,
    source: event?.source,
    correlationId: event?.correlationId,
  };
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new PermanentMessageError(`${name} must be a non-empty string.`);
    }
  }
  if (!Number.isSafeInteger(event.version) || event.version < 1) {
    throw new PermanentMessageError('version must be a positive integer.');
  }
  if (typeof event.occurredAt !== 'string' || Number.isNaN(Date.parse(event.occurredAt))) {
    throw new PermanentMessageError('occurredAt must be an ISO date.');
  }
  if (typeof event.payload !== 'object' || event.payload === null || Array.isArray(event.payload)) {
    throw new PermanentMessageError('payload must be an object.');
  }
}
