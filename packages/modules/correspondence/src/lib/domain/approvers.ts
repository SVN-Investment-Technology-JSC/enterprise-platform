import {
  MAX_WORKFLOW_STEPS,
  RETURN_TARGETS,
  type ApproverRule,
  type ReturnTarget,
  type WorkflowStep,
} from '@enterprise-platform/contracts-correspondence';
import { CorrespondenceValidationError } from './correspondence.error.js';
import { positionHolders, unitHeads, unitMembers, type OrganizationSnapshot } from './organization.js';

/** Những gì cần để giải luật người duyệt của một bước thành người cụ thể. */
export interface ApproverContext {
  readonly organization: OrganizationSnapshot;
  /** Người có quyền lãnh đạo (`correspondence.letter.direct`). */
  readonly leaders: readonly { readonly userId: string; readonly name: string }[];
  /** Phòng ban xử lý (công văn đến) hay phòng ban soạn thảo (công văn đi). */
  readonly handlingUnitIds: readonly string[];
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
    if (!byUser.has(member.userId)) byUser.set(member.userId, { userId: member.userId, name: member.name, detail: member.positionName });
  }
  return [...byUser.values()].sort((left, right) => left.name.localeCompare(right.name, 'vi'));
}

/**
 * Người được giao một bước. Luật `choose` cần người đã chọn (và người đó phải thuộc nhóm);
 * trả mảng rỗng khi sơ đồ tổ chức không có ai khớp, để nơi gọi báo rõ.
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
    case 'handling_unit_heads':
      return [...new Set(context.handlingUnitIds.flatMap((unitId) => unitHeads(organization, unitId)))];
    default:
      return [];
  }
}

/* ------------------------------------------------------------- kiểm cấu hình */

/** Kiểm và chuẩn hoá các bước duyệt của một quy trình: 0–10 bước, luật người duyệt hợp lệ. */
export function normalizeSteps(input: unknown): WorkflowStep[] {
  if (!Array.isArray(input)) throw new CorrespondenceValidationError('Danh sách bước duyệt không hợp lệ.');
  if (input.length > MAX_WORKFLOW_STEPS) {
    throw new CorrespondenceValidationError(`Quy trình tối đa ${MAX_WORKFLOW_STEPS} bước duyệt.`);
  }
  const steps = input.map((raw, index) => normalizeStep(raw, index));
  if (new Set(steps.map((step) => step.key)).size !== steps.length) {
    throw new CorrespondenceValidationError('Mã các bước không được trùng nhau.');
  }
  return steps;
}

function normalizeStep(raw: unknown, index: number): WorkflowStep {
  const value = (raw ?? {}) as Record<string, unknown>;
  const name = String(value['name'] ?? '').trim();
  if (!name) throw new CorrespondenceValidationError(`Bước ${index + 1} chưa có tên.`);
  if (name.length > 160) throw new CorrespondenceValidationError(`Tên bước ${index + 1} dài quá 160 ký tự.`);
  const key = (String(value['key'] ?? '').trim() || `step-${index + 1}`).slice(0, 60);
  const rawDue = value['dueDays'];
  const dueDays = rawDue === undefined || rawDue === null || rawDue === '' ? undefined : Number(rawDue);
  if (dueDays !== undefined && (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365)) {
    throw new CorrespondenceValidationError(`Số ngày của bước "${name}" phải từ 0 đến 365.`);
  }
  const rejectTo = value['rejectTo'];
  if (rejectTo !== undefined && rejectTo !== null && rejectTo !== '' && !(RETURN_TARGETS as readonly unknown[]).includes(rejectTo)) {
    throw new CorrespondenceValidationError(`Bước "${name}": nơi trả về khi không đạt không hợp lệ.`);
  }
  return {
    key,
    name,
    approver: normalizeRule(value['approver'], name),
    ...(rejectTo ? { rejectTo: rejectTo as ReturnTarget } : {}),
    ...(dueDays !== undefined ? { dueDays } : {}),
  };
}

function ids(value: unknown, label: string, stepName: string): string[] {
  const list = Array.isArray(value) ? [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))] : [];
  if (list.length === 0) throw new CorrespondenceValidationError(`Bước "${stepName}": chọn ít nhất một ${label}.`);
  if (list.length > 50) throw new CorrespondenceValidationError(`Bước "${stepName}": tối đa 50 ${label}.`);
  return list;
}

export function normalizeRule(raw: unknown, stepName: string): ApproverRule {
  const value = (raw ?? {}) as Record<string, unknown>;
  const type = String(value['type'] ?? '');
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
    // Tên cũ của luật trước khi tách hai luồng.
    case 'assigned_unit_heads':
    case 'handling_unit_heads':
      return { type: 'handling_unit_heads' };
    default:
      throw new CorrespondenceValidationError(`Bước "${stepName}" chưa chọn cách xác định người duyệt.`);
  }
}
