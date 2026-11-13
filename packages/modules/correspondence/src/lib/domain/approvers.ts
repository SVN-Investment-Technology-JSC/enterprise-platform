import {
  MAX_WORKFLOW_STEPS,
  type ApproverRule,
  type WorkflowStep,
} from '@enterprise-platform/contracts-correspondence';
import { CorrespondenceValidationError } from './correspondence.error.js';
import {
  positionHolders,
  unitHeads,
  unitMembers,
  type OrganizationSnapshot,
} from './organization.js';

/** Những gì cần để giải luật người duyệt của một bước thành người cụ thể. */
export interface ApproverContext {
  readonly organization: OrganizationSnapshot;
  /** Người có quyền chỉ đạo (`correspondence.letter.direct`). */
  readonly leaders: readonly { readonly userId: string; readonly name: string }[];
  readonly directorUserId?: string;
  readonly assignedUnitIds: readonly string[];
  /** Người đã được chọn cho bước có luật `choose`. */
  readonly chosenUserId?: string;
}

export interface Candidate {
  readonly userId: string;
  readonly name: string;
  readonly detail?: string;
}

/** Người được chọn trong nhóm của luật `choose`. */
export function chooseCandidates(rule: ApproverRule, context: ApproverContext): Candidate[] {
  if (rule.type !== 'choose') return [];
  const organization = context.organization;
  if (rule.pool === 'leaders') {
    return context.leaders.map((leader) => ({
      userId: leader.userId,
      name: leader.name,
      detail: organization.members.find((member) => member.userId === leader.userId)?.positionName,
    }));
  }
  const ids = rule.ids ?? [];
  const members =
    rule.pool === 'positions'
      ? organization.members.filter((member) => ids.includes(member.nodeId))
      : ids.flatMap((unitId) => unitMembers(organization, unitId));
  const byUser = new Map<string, Candidate>();
  for (const member of members) {
    if (!byUser.has(member.userId)) {
      byUser.set(member.userId, { userId: member.userId, name: member.name, detail: member.positionName });
    }
  }
  return [...byUser.values()].sort((left, right) => left.name.localeCompare(right.name, 'vi'));
}

/**
 * Người được giao một bước. Luật `choose` cần người đã chọn (và người đó phải thuộc
 * nhóm); trả mảng rỗng khi sơ đồ tổ chức không có ai khớp, để nơi gọi báo rõ.
 */
export function resolveAssignees(rule: ApproverRule, context: ApproverContext): string[] {
  const organization = context.organization;
  switch (rule.type) {
    case 'choose': {
      const chosen = context.chosenUserId;
      if (!chosen) return [];
      return chooseCandidates(rule, context).some((candidate) => candidate.userId === chosen) ? [chosen] : [];
    }
    case 'users':
      return [...new Set(rule.userIds)];
    case 'positions':
      return positionHolders(organization, rule.positionIds);
    case 'unit_heads':
      return [...new Set(rule.unitIds.flatMap((unitId) => unitHeads(organization, unitId)))];
    case 'assigned_unit_heads':
      return [...new Set(context.assignedUnitIds.flatMap((unitId) => unitHeads(organization, unitId)))];
    case 'director':
      return context.directorUserId ? [context.directorUserId] : [];
    default:
      return [];
  }
}

/** Mô tả luật bằng tiếng Việt, để hiện trong cấu hình và trên bước của công văn. */
export function describeRule(rule: ApproverRule, organization: OrganizationSnapshot): string {
  const names = (ids: readonly string[]) =>
    ids.map((id) => organization.nodes.find((node) => node.id === id)?.name ?? 'không còn trong sơ đồ').join(', ');
  switch (rule.type) {
    case 'choose':
      return rule.pool === 'leaders'
        ? 'Người trình chọn một lãnh đạo có quyền chỉ đạo'
        : `Người trình chọn trong ${rule.pool === 'positions' ? 'chức danh' : 'phòng ban'}: ${names(rule.ids ?? [])}`;
    case 'users':
      return `Người được chỉ định (${rule.userIds.length})`;
    case 'positions':
      return `Người giữ chức danh: ${names(rule.positionIds)}`;
    case 'unit_heads':
      return `Trưởng đơn vị: ${names(rule.unitIds)}`;
    case 'assigned_unit_heads':
      return 'Trưởng các phòng ban được giao xử lý';
    case 'director':
      return 'Người đã chỉ đạo';
    default:
      return '';
  }
}

/* ------------------------------------------------------------- kiểm cấu hình */

const RULE_TYPES = ['choose', 'users', 'positions', 'unit_heads', 'assigned_unit_heads', 'director'] as const;

/**
 * Kiểm và chuẩn hoá các bước của một quy trình: 1–10 bước, đúng một bước chỉ đạo, luật
 * người duyệt hợp lệ; luật dựa vào kết quả chỉ đạo chỉ đặt sau bước chỉ đạo.
 */
export function normalizeSteps(input: unknown): WorkflowStep[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new CorrespondenceValidationError('Quy trình cần ít nhất một bước.');
  }
  if (input.length > MAX_WORKFLOW_STEPS) {
    throw new CorrespondenceValidationError(`Quy trình tối đa ${MAX_WORKFLOW_STEPS} bước.`);
  }
  const steps = input.map((raw, index) => normalizeStep(raw, index));
  const directIndex = steps.findIndex((step) => step.kind === 'direct');
  if (directIndex < 0 || steps.filter((step) => step.kind === 'direct').length !== 1) {
    throw new CorrespondenceValidationError('Quy trình phải có đúng một bước chỉ đạo (giao phòng ban xử lý).');
  }
  steps.forEach((step, index) => {
    if (index <= directIndex && (step.approver.type === 'assigned_unit_heads' || step.approver.type === 'director')) {
      throw new CorrespondenceValidationError(
        `Bước "${step.name}" dùng người được giao hay người đã chỉ đạo nên phải đặt sau bước chỉ đạo.`,
      );
    }
  });
  const keys = new Set(steps.map((step) => step.key));
  if (keys.size !== steps.length) throw new CorrespondenceValidationError('Mã các bước không được trùng nhau.');
  return steps;
}

function normalizeStep(raw: unknown, index: number): WorkflowStep {
  const value = (raw ?? {}) as Record<string, unknown>;
  const name = String(value['name'] ?? '').trim();
  if (!name) throw new CorrespondenceValidationError(`Bước ${index + 1} chưa có tên.`);
  if (name.length > 160) throw new CorrespondenceValidationError(`Tên bước ${index + 1} dài quá 160 ký tự.`);
  const kind = value['kind'] === 'direct' ? 'direct' : value['kind'] === 'approve' ? 'approve' : undefined;
  if (!kind) throw new CorrespondenceValidationError(`Bước "${name}" chưa chọn loại bước.`);
  const key = String(value['key'] ?? '').trim() || `step-${index + 1}`;
  const dueDays = value['dueDays'] === undefined || value['dueDays'] === null || value['dueDays'] === '' ? undefined : Number(value['dueDays']);
  if (dueDays !== undefined && (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365)) {
    throw new CorrespondenceValidationError(`Số ngày của bước "${name}" phải từ 0 đến 365.`);
  }
  return { key: key.slice(0, 60), name, kind, approver: normalizeRule(value['approver'], name), ...(dueDays !== undefined ? { dueDays } : {}) };
}

function ids(value: unknown, label: string, stepName: string): string[] {
  const list = Array.isArray(value) ? [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))] : [];
  if (list.length === 0) throw new CorrespondenceValidationError(`Bước "${stepName}": chọn ít nhất một ${label}.`);
  if (list.length > 50) throw new CorrespondenceValidationError(`Bước "${stepName}": tối đa 50 ${label}.`);
  return list;
}

export function normalizeRule(raw: unknown, stepName: string): ApproverRule {
  const value = (raw ?? {}) as Record<string, unknown>;
  const type = String(value['type'] ?? '') as (typeof RULE_TYPES)[number];
  switch (type) {
    case 'choose': {
      const pool = value['pool'];
      if (pool === 'leaders') return { type, pool };
      if (pool === 'positions') return { type, pool, ids: ids(value['ids'], 'chức danh', stepName) };
      if (pool === 'units') return { type, pool, ids: ids(value['ids'], 'phòng ban', stepName) };
      throw new CorrespondenceValidationError(`Bước "${stepName}": chọn nhóm người để người trình chọn.`);
    }
    case 'users':
      return { type, userIds: ids(value['userIds'], 'người', stepName) };
    case 'positions':
      return { type, positionIds: ids(value['positionIds'], 'chức danh', stepName) };
    case 'unit_heads':
      return { type, unitIds: ids(value['unitIds'], 'đơn vị', stepName) };
    case 'assigned_unit_heads':
    case 'director':
      return { type };
    default:
      throw new CorrespondenceValidationError(`Bước "${stepName}" chưa chọn cách xác định người duyệt.`);
  }
}
