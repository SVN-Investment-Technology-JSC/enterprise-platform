import {
  PROCEDURE_CONDITION_OPERATORS,
  PROCEDURE_OPERATORS_BY_TYPE,
  buildFlowIndex,
  isCodeList,
  describeConditionRule,
  dominatorStepIds,
  findBranchOverlaps,
  hasFlowCycle,
  operatorNeedsUpperBound,
  operatorNeedsValue,
  reachable,
  type ProcedureAttributeDefinition,
  type ProcedureAttributeRef,
  type ProcedureConditionRule,
  type ProcedureDefinition,
  type ProcedureGatewayDefinition,
  type ProcedureValidationIssue,
  type ProcedureValidationReport,
} from '@enterprise-platform/contracts-procedure-engine';
import { ProcedureEngineError } from './procedure-engine.error.js';

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MAX_GATEWAYS = 50;
const MAX_BRANCHES = 20;
const MAX_RULES = 20;

/**
 * Kiểm hình dạng gateway lúc lưu nháp.
 *
 * Cố ý KHÔNG kiểm tham chiếu (bước tồn tại, thuộc tính đứng trước...): bản nháp
 * được lưu lại nguyên cả khối mỗi lần sửa một ô, nên một gateway đang dựng dở sẽ
 * khoá mọi thao tác khác nếu bị kiểm chặt ở đây. Các luật đó nằm ở lúc công bố.
 */
export function validateGatewaysDraft(gateways: readonly ProcedureGatewayDefinition[] | undefined): void {
  if (!gateways?.length) return;
  if (gateways.length > MAX_GATEWAYS) {
    throw new ProcedureEngineError('validation', `Quy trình có quá nhiều điểm rẽ nhánh (tối đa ${MAX_GATEWAYS}).`);
  }
  const keys = new Set<string>();
  for (const gateway of gateways) {
    if (!KEY_PATTERN.test(gateway.key?.trim() ?? '')) {
      throw new ProcedureEngineError('validation', `Mã điểm rẽ nhánh “${gateway.key}” không hợp lệ.`);
    }
    const key = gateway.key.trim().toUpperCase();
    if (keys.has(key)) {
      throw new ProcedureEngineError('validation', `Mã điểm rẽ nhánh “${key}” bị trùng.`);
    }
    keys.add(key);
    if (!gateway.name?.trim() || gateway.name.trim().length > 180) {
      throw new ProcedureEngineError('validation', `Tên điểm rẽ nhánh “${key}” là bắt buộc và không vượt quá 180 ký tự.`);
    }
    if (gateway.type !== 'exclusive') {
      throw new ProcedureEngineError('validation', `Điểm rẽ nhánh “${gateway.name}” chỉ hỗ trợ kiểu độc quyền.`);
    }
    if (!gateway.afterStepId?.trim()) {
      throw new ProcedureEngineError('validation', `Điểm rẽ nhánh “${gateway.name}” chưa gắn sau bước nào.`);
    }
    if (!Array.isArray(gateway.branches) || gateway.branches.length > MAX_BRANCHES) {
      throw new ProcedureEngineError('validation', `Điểm rẽ nhánh “${gateway.name}” có tối đa ${MAX_BRANCHES} nhánh.`);
    }
    const branchKeys = new Set<string>();
    for (const branch of gateway.branches) {
      if (!KEY_PATTERN.test(branch.key?.trim() ?? '')) {
        throw new ProcedureEngineError('validation', `Mã nhánh “${branch.key}” không hợp lệ.`);
      }
      const branchKey = branch.key.trim().toUpperCase();
      if (branchKeys.has(branchKey)) {
        throw new ProcedureEngineError('validation', `Mã nhánh “${branchKey}” bị trùng trong “${gateway.name}”.`);
      }
      branchKeys.add(branchKey);
      if (!branch.label?.trim() || branch.label.trim().length > 180) {
        throw new ProcedureEngineError('validation', `Nhãn nhánh “${branchKey}” là bắt buộc và không vượt quá 180 ký tự.`);
      }
      if (!Array.isArray(branch.stepIds)) {
        throw new ProcedureEngineError('validation', `Nhánh “${branch.label}” thiếu danh sách bước.`);
      }
      const rules = branch.condition?.rules ?? [];
      if (rules.length > MAX_RULES) {
        throw new ProcedureEngineError('validation', `Nhánh “${branch.label}” có tối đa ${MAX_RULES} điều kiện.`);
      }
      if (branch.condition && branch.condition.combinator !== 'and' && branch.condition.combinator !== 'or') {
        throw new ProcedureEngineError('validation', `Nhánh “${branch.label}” phải nối điều kiện bằng VÀ hoặc HOẶC.`);
      }
      for (const rule of rules) {
        if (!PROCEDURE_CONDITION_OPERATORS.includes(rule.operator)) {
          throw new ProcedureEngineError('validation', `Phép so sánh trong nhánh “${branch.label}” không hợp lệ.`);
        }
        if (!rule.attribute?.code?.trim()) {
          throw new ProcedureEngineError('validation', `Điều kiện trong nhánh “${branch.label}” chưa chọn thuộc tính.`);
        }
      }
    }
  }
}

/**
 * Đổi tham chiếu bước trong gateway từ `key` sang `id`.
 *
 * Lúc tạo mới, client chưa có id bước nên gửi `key`; lúc sửa, id đã có. Giá trị
 * không khớp cả id lẫn key được giữ nguyên để luật công bố báo lỗi rõ ràng thay
 * vì bị nuốt im lặng ở đây.
 */
export function resolveGatewayStepReferences(
  gateways: readonly ProcedureGatewayDefinition[] | undefined,
  steps: readonly { id: string; key: string }[],
  nextId: () => string,
): ProcedureGatewayDefinition[] | undefined {
  if (!gateways) return undefined;
  const ids = new Set(steps.map((step) => step.id));
  const idByKey = new Map(steps.map((step) => [step.key.trim().toUpperCase(), step.id]));
  const resolve = (reference: string): string => {
    const trimmed = reference?.trim() ?? '';
    if (ids.has(trimmed)) return trimmed;
    return idByKey.get(trimmed.toUpperCase()) ?? trimmed;
  };
  const resolveRef = (ref: ProcedureAttributeRef): ProcedureAttributeRef =>
    ref.scope === 'step'
      ? { scope: 'step', stepId: resolve(ref.stepId), code: ref.code.trim() }
      : { scope: 'process', code: ref.code.trim() };

  return gateways.map((gateway) => ({
    id: gateway.id?.trim() || nextId(),
    key: gateway.key.trim().toUpperCase(),
    name: gateway.name.trim(),
    type: 'exclusive' as const,
    afterStepId: resolve(gateway.afterStepId),
    branches: gateway.branches.map((branch) => ({
      id: branch.id?.trim() || nextId(),
      key: branch.key.trim().toUpperCase(),
      label: branch.label.trim(),
      isDefault: branch.isDefault === true,
      condition:
        branch.isDefault || !branch.condition
          ? undefined
          : {
              combinator: branch.condition.combinator,
              rules: branch.condition.rules.map((rule) => ({
                ...rule,
                id: rule.id?.trim() || nextId(),
                attribute: resolveRef(rule.attribute),
              })),
            },
      stepIds: branch.stepIds.map(resolve),
    })),
  }));
}

function attributeLookup(definition: ProcedureDefinition) {
  const process = new Map((definition.attributes ?? []).map((item) => [item.code, item]));
  const byStep = new Map(
    definition.steps.map((step) => [
      step.id,
      new Map((step.attributes ?? []).map((item) => [item.code, item])),
    ]),
  );
  return (ref: ProcedureAttributeRef): ProcedureAttributeDefinition | undefined =>
    ref.scope === 'process' ? process.get(ref.code) : byStep.get(ref.stepId)?.get(ref.code);
}

function ruleValueIssue(
  rule: ProcedureConditionRule,
  attribute: ProcedureAttributeDefinition,
): string | undefined {
  if (!operatorNeedsValue(rule.operator)) return undefined;
  const isNumber = (input: unknown) => typeof input === 'number' && Number.isFinite(input);
  const isDate = (input: unknown) =>
    typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input) && !Number.isNaN(Date.parse(input));
  switch (attribute.type) {
    case 'number':
    case 'money':
    case 'percent':
      if (!isNumber(rule.value)) return 'cần một số';
      if (operatorNeedsUpperBound(rule.operator)) {
        if (!isNumber(rule.valueTo)) return 'cần cận trên';
        if ((rule.value as number) >= (rule.valueTo as number)) return 'cận dưới phải nhỏ hơn cận trên';
      }
      return undefined;
    case 'date':
      if (!isDate(rule.value)) return 'cần một ngày YYYY-MM-DD';
      if (operatorNeedsUpperBound(rule.operator)) {
        if (!isDate(rule.valueTo)) return 'cần ngày kết thúc';
        if ((rule.value as string) > (rule.valueTo as string)) return 'ngày bắt đầu phải trước ngày kết thúc';
      }
      return undefined;
    case 'select': {
      const codes = new Set((attribute.options ?? []).map((option) => option.code));
      if (rule.operator === 'in') {
        return isCodeList(rule.value) && rule.value.length > 0 && rule.value.every((code) => codes.has(code))
          ? undefined
          : 'cần ít nhất một lựa chọn có trong danh sách';
      }
      return typeof rule.value === 'string' && codes.has(rule.value)
        ? undefined
        : 'lựa chọn không có trong danh sách';
    }
    case 'boolean':
      return typeof rule.value === 'boolean' ? undefined : 'cần Có hoặc Không';
    default:
      return undefined;
  }
}

/**
 * Toàn bộ luật cấu trúc rẽ nhánh lúc công bố, trả về lỗi và cảnh báo thay vì
 * ném ngay — để màn "kiểm tra trước khi công bố" liệt kê được hết một lần.
 */
export function collectFlowIssues(definition: ProcedureDefinition): ProcedureValidationReport {
  const errors: ProcedureValidationIssue[] = [];
  const warnings: ProcedureValidationIssue[] = [];
  const gateways = definition.gateways ?? [];
  const stepById = new Map(definition.steps.map((step) => [step.id, step]));
  const index = buildFlowIndex(definition.steps, gateways);
  const findAttribute = attributeLookup(definition);

  // Một bước chỉ được thuộc một nhánh, và không được vừa là bước đặt gateway.
  const owner = new Map<string, string>();
  const afterIds = new Set<string>();
  for (const gateway of gateways) {
    const at = { gatewayId: gateway.id };
    const after = stepById.get(gateway.afterStepId);
    if (!after) {
      errors.push({ level: 'error', message: `Điểm rẽ nhánh “${gateway.name}” gắn sau một bước không tồn tại.`, ...at });
      continue;
    }
    if (afterIds.has(gateway.afterStepId)) {
      errors.push({ level: 'error', message: `Bước “${after.name}” có hơn một điểm rẽ nhánh đứng sau.`, stepId: after.id, ...at });
    }
    afterIds.add(gateway.afterStepId);

    const defaults = gateway.branches.filter((branch) => branch.isDefault);
    if (defaults.length !== 1) {
      errors.push({ level: 'error', message: `Điểm rẽ nhánh “${gateway.name}” phải có đúng một nhánh mặc định (“ngược lại”).`, ...at });
    }
    if (gateway.branches.length < 2) {
      errors.push({ level: 'error', message: `Điểm rẽ nhánh “${gateway.name}” cần ít nhất một nhánh có điều kiện và một nhánh mặc định.`, ...at });
    }

    for (const branch of gateway.branches) {
      const where = { ...at, branchId: branch.id };
      for (const stepId of branch.stepIds) {
        const step = stepById.get(stepId);
        if (!step) {
          errors.push({ level: 'error', message: `Nhánh “${branch.label}” chứa một bước không tồn tại.`, ...where });
          continue;
        }
        const previous = owner.get(stepId);
        if (previous) {
          errors.push({ level: 'error', message: `Bước “${step.name}” thuộc nhiều hơn một nhánh.`, stepId, ...where });
        }
        owner.set(stepId, branch.id);
      }
      if (!branch.isDefault && !(branch.condition?.rules.length ?? 0)) {
        errors.push({ level: 'error', message: `Nhánh “${branch.label}” chưa có điều kiện.`, ...where });
      }
    }
  }

  for (const gateway of gateways) {
    const after = stepById.get(gateway.afterStepId);
    if (!after) continue;
    // MVP chưa hỗ trợ rẽ nhánh lồng trong nhánh (chờ chốt Q10).
    if (owner.has(gateway.afterStepId)) {
      errors.push({
        level: 'error',
        message: `Điểm rẽ nhánh “${gateway.name}” đang nằm trong một nhánh khác — chưa hỗ trợ rẽ nhánh lồng nhau.`,
        gatewayId: gateway.id,
        stepId: after.id,
      });
    }
    // Thứ tự hiển thị phải khớp cấu trúc: bước của nhánh đứng giữa bước đặt
    // gateway và điểm hợp, và theo đúng thứ tự chạy trong nhánh.
    const joinId = index.trunk[index.trunk.indexOf(gateway.afterStepId) + 1];
    const join = joinId ? stepById.get(joinId) : undefined;
    for (const branch of gateway.branches) {
      let previousOrder = after.order;
      for (const stepId of branch.stepIds) {
        const step = stepById.get(stepId);
        if (!step) continue;
        if (step.order <= previousOrder || (join && step.order >= join.order)) {
          errors.push({
            level: 'error',
            message: `Bước “${step.name}” của nhánh “${branch.label}” phải nằm giữa “${after.name}” và ${join ? `“${join.name}”` : 'cuối quy trình'}, theo đúng thứ tự trong nhánh.`,
            gatewayId: gateway.id,
            branchId: branch.id,
            stepId,
          });
        }
        previousOrder = step.order;
      }
    }
  }

  if (hasFlowCycle(index)) {
    errors.push({ level: 'error', message: 'Luồng quy trình có vòng lặp.' });
  }
  const reached = reachable(index);
  for (const step of definition.steps) {
    if (!reached.has(step.id)) {
      errors.push({ level: 'error', message: `Bước “${step.name}” không bao giờ được đi tới.`, stepId: step.id });
    }
  }

  // Vai S (khởi tạo) chỉ có nghĩa ở trục chính: nhánh chỉ được chọn sau khi hồ
  // sơ đã mở, nên S đặt trong nhánh không khởi tạo được gì (chờ chốt Q12).
  for (const step of definition.steps) {
    if (owner.has(step.id) && step.assignments.some((assignment) => assignment.role === 'S')) {
      errors.push({ level: 'error', message: `Bước “${step.name}” nằm trong nhánh nên không được gán vai S.`, stepId: step.id });
    }
  }

  for (const gateway of gateways) {
    if (!stepById.has(gateway.afterStepId)) continue;
    const allowedSteps = dominatorStepIds(index, gateway.afterStepId);
    allowedSteps.add(gateway.afterStepId);
    for (const branch of gateway.branches) {
      if (branch.isDefault) continue;
      for (const rule of branch.condition?.rules ?? []) {
        const where = { gatewayId: gateway.id, branchId: branch.id };
        const attribute = findAttribute(rule.attribute);
        if (!attribute) {
          errors.push({ level: 'error', message: `Nhánh “${branch.label}” dùng thuộc tính “${rule.attribute.code}” không tồn tại.`, ...where });
          continue;
        }
        if (rule.attribute.scope === 'step' && !allowedSteps.has(rule.attribute.stepId)) {
          const owningStep = stepById.get(rule.attribute.stepId);
          errors.push({
            level: 'error',
            message: `Nhánh “${branch.label}” dùng thuộc tính “${attribute.name}” của bước “${owningStep?.name ?? '?'}” — bước này không chắc chắn đã đi qua trước điểm rẽ nhánh.`,
            ...where,
          });
          continue;
        }
        if (!PROCEDURE_OPERATORS_BY_TYPE[attribute.type].includes(rule.operator)) {
          errors.push({
            level: 'error',
            message: `Nhánh “${branch.label}”: phép so sánh không dùng được với thuộc tính kiểu này (“${attribute.name}”).`,
            ...where,
          });
          continue;
        }
        const valueIssue = ruleValueIssue(rule, attribute);
        if (valueIssue) {
          errors.push({ level: 'error', message: `Nhánh “${branch.label}”, điều kiện “${attribute.name}”: ${valueIssue}.`, ...where });
          continue;
        }
        if (!attribute.required && rule.operator !== 'empty' && rule.operator !== 'not_empty') {
          warnings.push({
            level: 'warning',
            message: `“${attribute.name}” không bắt buộc — nếu để trống, hồ sơ sẽ đi nhánh mặc định của “${gateway.name}”.`,
            ...where,
          });
        }
      }
    }

    const labelOf = new Map(gateway.branches.map((branch) => [branch.id, branch.label]));
    const ruleText = (branchId: string) => {
      const branch = gateway.branches.find((item) => item.id === branchId);
      return (branch?.condition?.rules ?? [])
        .map((rule) => describeConditionRule(rule, findAttribute(rule.attribute)))
        .join(branch?.condition?.combinator === 'or' ? ' hoặc ' : ' và ');
    };
    for (const overlap of findBranchOverlaps(gateway)) {
      warnings.push({
        level: 'warning',
        message: overlap.shadowed
          ? `Nhánh “${labelOf.get(overlap.branchId)}” (${ruleText(overlap.branchId)}) bị nhánh “${labelOf.get(overlap.overlapsBranchId)}” che hoàn toàn nên sẽ không bao giờ được chọn.`
          : `Nhánh “${labelOf.get(overlap.branchId)}” chồng khoảng giá trị với nhánh “${labelOf.get(overlap.overlapsBranchId)}”; phần giao nhau sẽ đi nhánh đứng trước.`,
        gatewayId: gateway.id,
        branchId: overlap.branchId,
      });
    }
  }

  // Người duyệt động phải có dự phòng: leo tới gốc cây mà vẫn trống thì bước
  // không có ai làm, hồ sơ kẹt vĩnh viễn.
  for (const step of definition.steps) {
    for (const assignment of step.assignments) {
      if (assignment.subjectType !== 'initiator_manager') continue;
      if (!assignment.managerFallback?.subjectId?.trim()) {
        errors.push({
          level: 'error',
          message: `Bước “${step.name}”: vai ${assignment.role} theo “Quản lý trực tiếp của người khởi tạo” cần chọn người/chức danh dự phòng.`,
          stepId: step.id,
        });
      }
    }
  }

  return { errors, warnings };
}

/** Dành cho C(x): bước quay về phải chắc chắn đã đi qua trên mọi đường tới bước hiện tại. */
export function rollbackTargetsFor(definition: ProcedureDefinition, stepId: string): Set<string> {
  const index = buildFlowIndex(definition.steps, definition.gateways);
  return dominatorStepIds(index, stepId);
}
