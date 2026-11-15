import {
  ASSIGNMENT_ROLES,
  conditionSet,
  MAX_WORKFLOW_STEPS,
  RETURN_TARGETS,
  STEP_TYPES,
  STEP_TYPE_LABELS,
  type ApproverRule,
  type AssignmentRole,
  type LetterCondition,
  type StepMode,
  type StepType,
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
    throw new CorrespondenceValidationError(`Quy trình tối đa ${MAX_WORKFLOW_STEPS} bước.`);
  }
  const steps = input.map((raw, index) => normalizeStep(raw, index));
  if (new Set(steps.map((step) => step.key)).size !== steps.length) {
    throw new CorrespondenceValidationError('Mã các bước không được trùng nhau.');
  }
  // Phòng ban của bước "phòng ban xử lý" do người làm bước liền trước chọn; hai bước liền nhau thì không ai chọn.
  const doubled = steps.findIndex((step, index) => index > 0 && step.type === 'process' && steps[index - 1].type === 'process');
  if (doubled > 0) {
    throw new CorrespondenceValidationError(
      `Bước "${steps[doubled - 1].name}" và "${steps[doubled].name}" đều là phòng ban xử lý, đứng liền nhau. Gộp thành một bước hoặc đặt một bước khác ở giữa.`,
    );
  }
  // Bước có điều kiện nằm giữa hai bước phòng ban: bị bỏ qua thì hai bước phòng ban liền nhau, không ai chọn phòng.
  const squeezed = steps.findIndex(
    (step, index) => conditionSet(step.condition) && steps[index - 1]?.type === 'process' && steps[index + 1]?.type === 'process',
  );
  if (squeezed >= 0) {
    throw new CorrespondenceValidationError(
      `Bước "${steps[squeezed].name}" có điều kiện mà nằm giữa hai bước phòng ban xử lý: khi bị bỏ qua thì không ai chọn phòng cho bước sau. Bỏ điều kiện hoặc đổi thứ tự.`,
    );
  }
  // Bút phê chọn phòng ban cho bước "phòng ban xử lý" phía sau; không có bước đó thì phòng được giao không phải làm gì.
  const idle = steps.findIndex((step, index) => step.directs && !steps.slice(index + 1).some((later) => later.type === 'process'));
  if (idle >= 0) {
    throw new CorrespondenceValidationError(
      `Bước "${steps[idle].name}" có bút phê nhưng phía sau không có bước Phòng ban xử lý, phòng ban được giao sẽ không phải xử lý gì. Thêm bước "Phòng ban xử lý" sau bước này, hoặc bỏ bút phê.`,
    );
  }
  return steps;
}

function normalizeStep(raw: unknown, index: number): WorkflowStep {
  const value = (raw ?? {}) as Record<string, unknown>;
  const typed = (STEP_TYPES as readonly unknown[]).includes(value['type']) ? (value['type'] as StepType) : 'approve';
  const name = String(value['name'] ?? '').trim() || (typed === 'approve' ? '' : STEP_TYPE_LABELS[typed]);
  if (!name) throw new CorrespondenceValidationError(`Bước ${index + 1} chưa có tên.`);
  if (name.length > 160) throw new CorrespondenceValidationError(`Tên bước ${index + 1} dài quá 160 ký tự.`);
  const key = (String(value['key'] ?? '').trim() || `step-${index + 1}`).slice(0, 60);
  const rawDue = value['dueDays'];
  const dueDays = rawDue === undefined || rawDue === null || rawDue === '' ? undefined : Number(rawDue);
  if (dueDays !== undefined && (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365)) {
    throw new CorrespondenceValidationError(`Số ngày của bước "${name}" phải từ 0 đến 365.`);
  }
  const rawType = value['type'] ?? 'approve';
  if (!(STEP_TYPES as readonly unknown[]).includes(rawType)) throw new CorrespondenceValidationError(`Bước "${name}": loại bước không hợp lệ.`);
  const type = rawType as StepType;
  const rejectTo = value['rejectTo'];
  if (rejectTo !== undefined && rejectTo !== null && rejectTo !== '' && !(RETURN_TARGETS as readonly unknown[]).includes(rejectTo)) {
    throw new CorrespondenceValidationError(`Bước "${name}": nơi trả về khi không đạt không hợp lệ.`);
  }
  const condition = normalizeCondition(value['condition']);
  const skip = ((value['condition'] ?? {}) as Record<string, unknown>)['skip'] === true;
  const mode = value['mode'];
  const modes: readonly unknown[] = type === 'approve' ? ['any', 'all'] : type === 'process' ? ['all', 'lead'] : [];
  if (mode !== undefined && mode !== null && mode !== '' && !modes.includes(mode)) {
    throw new CorrespondenceValidationError(`Bước "${name}": cách xong bước không hợp lệ.`);
  }
  return {
    key,
    name,
    type,
    // Bước duyệt có luật người duyệt; phòng ban do người làm bước trước chọn.
    ...(type === 'approve' ? { approver: normalizeRule(value['approver'], name) } : {}),
    // Bước văn thư kiểm tra giao người riêng (thư ký, phòng hành chính…); trống là người làm văn thư.
    ...(type === 'check' && value['approver'] ? { approver: normalizeRule(value['approver'], name) } : {}),
    // Cách xong khác mặc định: tất cả cùng duyệt; phòng chủ trì gửi là xong.
    ...((type === 'approve' && mode === 'all') || (type === 'process' && mode === 'lead') ? { mode: mode as StepMode } : {}),
    // Phòng ban cố định của bước phòng ban xử lý (khoá thì không ai chọn lại).
    ...(type === 'process' ? fixedUnits(value['units'], value['lockUnits'], name) : {}),
    // Bước chỉ chạy khi / bỏ qua khi công văn khớp điều kiện.
    ...(conditionSet(condition) ? { condition: { ...condition, ...(skip ? { skip: true } : {}) } } : {}),
    // Bước chỉ đạo (bút phê): người duyệt chọn đơn vị chủ trì, phối hợp, thời hạn.
    ...(type === 'approve' && value['directs'] === true ? { directs: true } : {}),
    ...(rejectTo && type !== 'process' ? { rejectTo: rejectTo as ReturnTarget } : {}),
    ...(dueDays !== undefined ? { dueDays } : {}),
  };
}

/** Điều kiện theo phân loại công văn: danh sách mã (không trùng, tối đa 50 mỗi mục), mục trống bỏ đi. */
export function normalizeCondition(raw: unknown): LetterCondition {
  const value = (raw ?? {}) as Record<string, unknown>;
  const codes = (field: string) => {
    const list = Array.isArray(value[field]) ? [...new Set((value[field] as unknown[]).map((item) => String(item ?? '').trim()).filter(Boolean))] : [];
    if (list.length > 50) throw new CorrespondenceValidationError('Điều kiện tối đa 50 giá trị mỗi mục.');
    return list;
  };
  const kinds = codes('kinds');
  const urgency = codes('urgency');
  const confidentiality = codes('confidentiality');
  return {
    ...(kinds.length > 0 ? { kinds } : {}),
    ...(urgency.length > 0 ? { urgency } : {}),
    ...(confidentiality.length > 0 ? { confidentiality } : {}),
  };
}

function fixedUnits(raw: unknown, lock: unknown, stepName: string): Pick<WorkflowStep, 'units' | 'lockUnits'> {
  const seen = new Set<string>();
  const units = (Array.isArray(raw) ? raw : [])
    .map((entry) => (entry ?? {}) as Record<string, unknown>)
    .map((entry) => ({
      unitId: String(entry['unitId'] ?? '').trim(),
      role: (ASSIGNMENT_ROLES as readonly unknown[]).includes(entry['role']) ? (entry['role'] as AssignmentRole) : ('lead' as const),
    }))
    .filter((entry) => entry.unitId && !seen.has(entry.unitId) && seen.add(entry.unitId));
  if (units.length > 50) throw new CorrespondenceValidationError(`Bước "${stepName}": tối đa 50 phòng ban cố định.`);
  if (units.length > 0 && !units.some((unit) => unit.role !== 'info')) {
    throw new CorrespondenceValidationError(`Bước "${stepName}": phòng ban cố định cần ít nhất một phòng chủ trì hoặc phối hợp.`);
  }
  if (lock === true && units.length === 0) throw new CorrespondenceValidationError(`Bước "${stepName}": khoá phòng ban thì phải chọn phòng ban cố định.`);
  return units.length > 0 ? { units, ...(lock === true ? { lockUnits: true } : {}) } : {};
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
