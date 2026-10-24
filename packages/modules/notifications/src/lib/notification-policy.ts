import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import { notificationDeepLink } from '@enterprise-platform/contracts-realtime';
import type { ProcedureAssignmentRef } from './procedure-assignee-resolver.js';
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
      /** Người ghi ở các trường này bị loại khỏi danh sách (vd. đã nhận thông báo nhắc tên cho cùng nội dung). */
      readonly excludeFields?: readonly string[];
    }
  | {
      /** Mọi người dùng đang hoạt động của tenant; `when` sai thì không báo cho ai. */
      readonly kind: 'all-active-users';
      readonly when?: (payload: Readonly<Record<string, unknown>>) => boolean;
      readonly excludeFields?: readonly string[];
    }
  | {
      /**
       * Chọn cách tính người nhận theo payload (vd. bài nhóm báo thành viên, bài Tường công ty báo mọi người).
       * `select` trả về luật con, hoặc `undefined` nếu không báo cho ai. `excludeFields` áp cho kết quả cuối.
       */
      readonly kind: 'conditional';
      readonly select: (payload: Readonly<Record<string, unknown>>) => NotificationRecipientRule | undefined;
      readonly excludeFields?: readonly string[];
    }
  | {
      /** Hợp người nhận của nhiều luật con (vd. admin nhóm trong payload cộng mọi moderator). */
      readonly kind: 'union';
      readonly rules: readonly NotificationRecipientRule[];
    }
  | {
      readonly kind: 'permission';
      readonly permission: string;
    }
  | {
      /** Người giữ BẤT KỲ quyền nào trong danh sách khoá quyền ghi ở payload (quyền phụ thuộc loại đối tượng). */
      readonly kind: 'permissions-in-payload';
      readonly field: string;
      /** Người dùng ghi thẳng trong payload, nhận thêm dù không giữ quyền nào (vd. người dự phòng). */
      readonly userFields?: readonly string[];
      /**
       * Người trong danh sách ứng viên ở payload (`scopedUserField`) chỉ nhận khi giữ BẤT KỲ quyền nào trong
       * `scopedPermissionsField`: quyền duyệt thường chỉ có hiệu lực trong phạm vi cấp dưới, nên ứng viên là cấp trên của chủ đơn.
       */
      readonly scopedPermissionsField?: string;
      readonly scopedUserField?: string;
    }
  | {
      /** Người dùng ghi thẳng trong payload cộng người được giải ra từ các vai (đơn vị, chức danh) của bước. */
      readonly kind: 'procedure-assignments';
      readonly userFields: readonly string[];
      readonly assignmentsField: string;
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
  /** Mọi người dùng đang hoạt động của tenant (thông báo toàn công ty). */
  allActiveUsers?(): Promise<readonly string[]>;
  /** Giải các vai gán cho đơn vị/chức danh thành người dùng cụ thể (cần sơ đồ tổ chức). */
  usersForProcedureAssignments?(
    assignments: readonly ProcedureAssignmentRef[],
  ): Promise<readonly string[]>;
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
    const candidates = await resolveCandidates(policy.recipients, payload, directory);
    const actor = policy.actorField ? optionalString(payload[policy.actorField]) : undefined;
    const excluded = new Set(
      'excludeFields' in policy.recipients
        ? (policy.recipients.excludeFields ?? []).flatMap((field) => recipientValues(payload[field]))
        : [],
    );
    const unique = [...new Set(candidates)].filter((userId) => userId !== actor && !excluded.has(userId));
    const recipients = await directory.activeUsers(unique);
    const rendered = policy.template(context);
    const deepLink = notificationDeepLink(rendered.deepLink);
    if (rendered.deepLink && !deepLink) throw new TypeError('Notification deep link is outside the route allow-list.');
    const template = { ...rendered, ...(deepLink ? { deepLink } : {}) };
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

async function resolveCandidates(
  rule: NotificationRecipientRule,
  payload: Readonly<Record<string, unknown>>,
  directory: RecipientDirectory,
): Promise<readonly string[]> {
  if (rule.kind === 'conditional') {
    const selected = rule.select(payload);
    return selected ? resolveCandidates(selected, payload, directory) : [];
  }
  if (rule.kind === 'union') {
    return (await Promise.all(rule.rules.map((sub) => resolveCandidates(sub, payload, directory)))).flat();
  }
  if (rule.kind === 'all-active-users') {
    if (rule.when && !rule.when(payload)) return [];
    if (!directory.allActiveUsers) throw new TypeError('Recipient directory cannot list all active users.');
    return directory.allActiveUsers();
  }
  if (rule.kind === 'permission') return directory.usersWithPermission(rule.permission);
  if (rule.kind === 'permissions-in-payload') {
    const permissions = recipientValues(payload[rule.field]);
    const direct = (rule.userFields ?? []).flatMap((field) => recipientValues(payload[field]));
    const scoped = await scopedHolders(rule, payload, directory);
    return [
      ...direct,
      ...scoped,
      ...(await Promise.all(permissions.map((permission) => directory.usersWithPermission(permission)))).flat(),
    ];
  }
  if (rule.kind === 'payload') return rule.fields.flatMap((field) => recipientValues(payload[field]));
  const direct = rule.userFields.flatMap((field) => recipientValues(payload[field]));
  const assignments = assignmentValues(payload[rule.assignmentsField]);
  if (assignments.length === 0 || !directory.usersForProcedureAssignments) return direct;
  return [...direct, ...(await directory.usersForProcedureAssignments(assignments))];
}

async function scopedHolders(
  rule: Extract<NotificationRecipientRule, { kind: 'permissions-in-payload' }>,
  payload: Readonly<Record<string, unknown>>,
  directory: RecipientDirectory,
): Promise<readonly string[]> {
  if (!rule.scopedPermissionsField || !rule.scopedUserField) return [];
  const candidates = new Set(recipientValues(payload[rule.scopedUserField]));
  if (candidates.size === 0) return [];
  const holders = (
    await Promise.all(
      recipientValues(payload[rule.scopedPermissionsField]).map((permission) => directory.usersWithPermission(permission)),
    )
  ).flat();
  return holders.filter((userId) => candidates.has(userId));
}

function assignmentValues(value: unknown): ProcedureAssignmentRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const { subjectType, subjectId, role } = item as Record<string, unknown>;
    return typeof subjectType === 'string' && typeof subjectId === 'string' && subjectId.trim()
      ? [{ subjectType, subjectId, role: typeof role === 'string' ? role : '' }]
      : [];
  });
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
