import {
  MAX_WORKDAY_UNITS,
  WORKDAY_RULE_KINDS,
  type UpdateWorkdayRulesRequest,
  type WorkdayRule,
  type WorkdayRuleKind,
  type WorkdayRuleSet,
} from '@enterprise-platform/contracts-workspace';
import { ProjectForbiddenError, WorkspaceValidationError } from '../domain/workspace.error.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

/**
 * Thứ tự ưu tiên tính công cho báo cáo công tác và chia thưởng.
 *
 * Ai cũng xem được; chỉ quản trị (canManage hoặc quản trị tenant) được đổi
 * thứ tự và số công. Dùng chung toàn tenant để mọi dự án cùng một cách tính.
 */
export class WorkdayRuleService {
  constructor(private readonly store: WorkspaceStore) {}

  async get(actor: WorkspaceActor): Promise<WorkdayRuleSet> {
    const rows = await this.store.workdayRules.list(actor.tenantId);
    const rules: WorkdayRule[] = rows
      .filter((row) => row.rank != null && isKind(row.kind))
      .map((row) => ({
        kind: row.kind as WorkdayRuleKind,
        label: row.label,
        rank: row.rank as number,
        units: row.units,
      }));
    const normal = rows.find((row) => row.kind === 'normal');
    const updatedAt = rows.map((row) => row.updatedAt).sort().at(-1);
    return {
      rules,
      normalUnits: normal?.units ?? 1,
      updatedAt,
      canEdit: canEdit(actor),
    };
  }

  async update(actor: WorkspaceActor, input: UpdateWorkdayRulesRequest): Promise<WorkdayRuleSet> {
    if (!canEdit(actor)) throw new ProjectForbiddenError();
    const order = Array.isArray(input?.order) ? input.order : [];
    if (
      order.length !== WORKDAY_RULE_KINDS.length ||
      new Set(order).size !== order.length ||
      !order.every(isKind)
    ) {
      throw new WorkspaceValidationError('Thứ tự ưu tiên phải gồm đủ và không trùng các loại đơn.');
    }
    const units = {} as Record<WorkdayRuleKind, number>;
    for (const kind of WORKDAY_RULE_KINDS) units[kind] = requireUnits(input.units?.[kind]);
    await this.store.workdayRules.replace(actor.tenantId, actor.userId, {
      order,
      units,
      normalUnits: requireUnits(input.normalUnits),
    });
    return this.get(actor);
  }
}

function canEdit(actor: WorkspaceActor): boolean {
  return actor.canManage || actor.isTenantAdmin;
}

function isKind(value: unknown): value is WorkdayRuleKind {
  return WORKDAY_RULE_KINDS.some((kind) => kind === value);
}

function requireUnits(value: unknown): number {
  const units = Number(value);
  if (!Number.isFinite(units) || units < 0 || units > MAX_WORKDAY_UNITS) {
    throw new WorkspaceValidationError(`Số công mỗi ngày phải từ 0 đến ${MAX_WORKDAY_UNITS}.`);
  }
  return Math.round(units * 100) / 100;
}
