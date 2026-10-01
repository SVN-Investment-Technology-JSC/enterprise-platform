import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type {
  NotificationModule,
  NotificationPriority,
} from '@enterprise-platform/contracts-realtime';

export interface NotificationTemplateResult {
  readonly title: string;
  readonly body: string;
  readonly deepLink?: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface NotificationTemplateContext {
  readonly event: IntegrationEventEnvelope<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type NotificationRecipientRule =
  | {
      readonly kind: 'payload';
      readonly fields: readonly string[];
    }
  | {
      readonly kind: 'permission';
      readonly permission: string;
    };

export interface NotificationPolicy {
  readonly eventType: string;
  readonly version: number;
  readonly module: NotificationModule;
  readonly category: string;
  readonly priority: NotificationPriority;
  readonly recipients: NotificationRecipientRule;
  readonly actorField?: string;
  readonly template: (
    context: NotificationTemplateContext,
  ) => NotificationTemplateResult;
  readonly aggregation?: {
    readonly windowMinutes: number;
    readonly key: (context: NotificationTemplateContext) => string;
  };
}

export interface RecipientDirectory {
  usersWithPermission(permission: string): Promise<readonly string[]>;
  activeUsers(userIds: readonly string[]): Promise<readonly string[]>;
}

export interface ResolvedPolicyNotification {
  readonly policy: NotificationPolicy;
  readonly recipients: readonly string[];
  readonly template: NotificationTemplateResult;
  readonly aggregationKey?: string;
  readonly aggregationWindowMinutes?: number;
}

export function effectiveDelivery(
  priority: NotificationPriority,
  preference?: { readonly feedEnabled: boolean; readonly toastEnabled: boolean },
): { readonly feedEnabled: boolean; readonly toastEnabled: boolean } {
  const selected = preference ?? { feedEnabled: true, toastEnabled: true };
  if (priority === 'required') {
    return { feedEnabled: true, toastEnabled: true };
  }
  if (priority === 'actionable') {
    return { feedEnabled: true, toastEnabled: selected.toastEnabled };
  }
  return selected;
}

export class NotificationPolicyRegistry {
  private readonly policies = new Map<string, NotificationPolicy>();

  constructor(policies: readonly NotificationPolicy[]) {
    for (const policy of policies) {
      const key = policyKey(policy.eventType, policy.version);
      if (this.policies.has(key)) {
        throw new Error(`Duplicate notification policy ${key}.`);
      }
      this.policies.set(key, policy);
    }
  }

  find(eventType: string, version: number): NotificationPolicy | undefined {
    return this.policies.get(policyKey(eventType, version));
  }

  async resolve(
    event: IntegrationEventEnvelope,
    directory: RecipientDirectory,
  ): Promise<ResolvedPolicyNotification | undefined> {
    const policy = this.find(event.type, event.version);
    if (!policy) return undefined;
    const payload = requirePayload(event.payload);
    const context = { event: event as IntegrationEventEnvelope<Record<string, unknown>>, payload };
    const candidates =
      policy.recipients.kind === 'permission'
        ? await directory.usersWithPermission(policy.recipients.permission)
        : policy.recipients.fields.flatMap((field) => recipientValues(payload[field]));
    const actor = policy.actorField ? optionalString(payload[policy.actorField]) : undefined;
    const unique = [...new Set(candidates)].filter((userId) => userId !== actor);
    const recipients = await directory.activeUsers(unique);
    const template = policy.template(context);
    validateTemplate(template);
    const aggregationKey = policy.aggregation?.key(context);
    if (policy.aggregation && !aggregationKey?.trim()) {
      throw new TypeError('Notification aggregation key is required.');
    }
    return {
      policy,
      recipients: [...new Set(recipients)].filter((userId) => userId !== actor),
      template,
      ...(aggregationKey ? { aggregationKey } : {}),
      ...(policy.aggregation
        ? { aggregationWindowMinutes: policy.aggregation.windowMinutes }
        : {}),
    };
  }
}

function policyKey(eventType: string, version: number): string {
  return `${eventType}@${version}`;
}

function requirePayload(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Integration event payload must be an object.');
  }
  return value as Readonly<Record<string, unknown>>;
}

function recipientValues(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value];
  if (Array.isArray(value)) {
    return value.filter(
      (candidate): candidate is string =>
        typeof candidate === 'string' && candidate.trim().length > 0,
    );
  }
  return [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function validateTemplate(template: NotificationTemplateResult): void {
  if (!template.title.trim() || !template.body.trim()) {
    throw new TypeError('Notification template title and body are required.');
  }
  if (!template.sourceType.trim() || !template.sourceId.trim()) {
    throw new TypeError('Notification template source is required.');
  }
  if (
    template.deepLink &&
    (!template.deepLink.startsWith('/') || template.deepLink.startsWith('//'))
  ) {
    throw new TypeError('Notification deep link must be a same-origin path.');
  }
}
