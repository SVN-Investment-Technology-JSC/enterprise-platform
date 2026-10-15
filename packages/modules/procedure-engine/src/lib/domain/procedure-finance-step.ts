/**
 * Bước Tài chính: cấu hình, luật công bố, giá trị gửi sang Tài chính và sự kiện yêu cầu.
 *
 * Quy trình không biết gì về kế toán. Nó chỉ (1) bảo đảm cấu hình bước hợp lệ,
 * (2) khi hồ sơ tới bước thì phát `procedure.step.finance_voucher_requested` kèm giá
 * trị thuộc tính, (3) giữ bước ở trạng thái chờ cho tới khi Tài chính báo kết quả.
 * Quyền "ai được ghi sổ" nằm ở `procedure-authorization.ts` (can-act).
 */
import {
  FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES,
  FINANCE_VOUCHER_SOURCE_FIELDS,
  FINANCE_VOUCHER_SOURCE_FIELD_LABELS,
  FINANCE_VOUCHER_SOURCE_FIELD_TYPES,
  PROCEDURE_FINANCE_VOUCHER_KINDS,
  PROCEDURE_FINANCE_VOUCHER_KIND_LABELS,
  PROCEDURE_STEP_FINANCE_VOUCHER_REQUESTED,
  buildFlowIndex,
  dominatorStepIds,
  possibleNextStepIds,
  type CreateProcedureStepInput,
  type FinanceVoucherSourceField,
  type ProcedureAttributeDefinition,
  type ProcedureAttributeValue,
  type ProcedureDefinition,
  type ProcedureFinanceStepAssigneeSubject,
  type ProcedureFinanceVoucherRequestedPayload,
  type ProcedureFinanceVoucherRequestedValues,
  type ProcedureInstance,
  type ProcedureInstanceStep,
  type ProcedureStepDefinition,
  type ProcedureStepIntegration,
  type ProcedureValidationIssue,
  type ProcedureValidationReport,
} from '@enterprise-platform/contracts-procedure-engine';
import { ProcedureEngineError } from './procedure-engine.error.js';
import { livePath } from './procedure-runtime-flow.js';

/** Tiền tố mọi lỗi công bố của bước Tài chính; `inspectDefinitionForPublish` dựa vào nó. */
export const FINANCE_STEP_ISSUE_PREFIX = 'Bước Tài chính';

/** Vai được phép ở bước Tài chính: R là người ghi sổ, I chỉ theo dõi. */
const FINANCE_STEP_ROLES: readonly string[] = ['R', 'I'];

export function isFinanceStep(step: { readonly integration?: ProcedureStepIntegration } | undefined): boolean {
  return step?.integration?.module === 'finance' && step.integration.action === 'voucher';
}

/** Bước Tài chính đang chờ Tài chính ghi sổ: không ai hoàn thành/duyệt được bằng tay. */
export function isFinanceStepWaiting(step: ProcedureInstanceStep | undefined): boolean {
  return (
    !!step &&
    isFinanceStep(step) &&
    (step.status === 'active' || step.status === 'ready') &&
    step.financeVoucher?.state !== 'posted'
  );
}

/**
 * Hồ sơ đã có phiếu bên Tài chính (ở bất kỳ bước Tài chính nào): huỷ hiệu lực phải hỏi Tài chính trước,
 * bất kể hồ sơ mở từ nguồn nào. Dựa vào `voucherId`, hoặc trạng thái linked/posted khi id chưa kịp ghi.
 */
export function hasFinanceVoucher(instance: Pick<ProcedureInstance, 'steps'>): boolean {
  return instance.steps.some(
    (step) =>
      !!step.financeVoucher &&
      (!!step.financeVoucher.voucherId || step.financeVoucher.state === 'linked' || step.financeVoucher.state === 'posted'),
  );
}

/* ------------------------------ Khoá thuộc tính ------------------------------ */

type ParsedKey = { scope: 'process'; code: string } | { scope: 'step'; stepRef: string; code: string };

/** `process:<code>` hoặc `step:<id hoặc mã bước>:<code>`. */
export function parseAttributeKey(key: string): ParsedKey | null {
  const parts = key.split(':');
  if (parts[0] === 'process' && parts.length === 2 && parts[1]) return { scope: 'process', code: parts[1] };
  if (parts[0] === 'step' && parts.length === 3 && parts[1] && parts[2]) {
    return { scope: 'step', stepRef: parts[1], code: parts[2] };
  }
  return null;
}

/* --------------------------------- Lưu nháp --------------------------------- */

/** Kiểm hình dạng cấu hình lúc lưu nháp. Luật về luồng chờ tới lúc công bố. */
export function validateStepIntegrationDraft(step: CreateProcedureStepInput): void {
  const integration = step.integration as unknown;
  if (integration === undefined || integration === null) return;
  const where = `Bước “${step.name}”`;
  if (typeof integration !== 'object') {
    throw new ProcedureEngineError('validation', `${where}: cấu hình tích hợp không hợp lệ.`);
  }
  const value = integration as Partial<ProcedureStepIntegration>;
  if (value.module !== 'finance' || value.action !== 'voucher') {
    throw new ProcedureEngineError('validation', `${where}: chỉ hỗ trợ tích hợp Tài chính (tạo phiếu).`);
  }
  if (!PROCEDURE_FINANCE_VOUCHER_KINDS.includes(value.voucherKind as never)) {
    throw new ProcedureEngineError('validation', `${where}: loại phiếu phải là phiếu chi hoặc phiếu thu.`);
  }
  if (value.mapping !== undefined) {
    if (!value.mapping || typeof value.mapping !== 'object' || Array.isArray(value.mapping)) {
      throw new ProcedureEngineError('validation', `${where}: bảng ánh xạ không hợp lệ.`);
    }
    for (const [field, key] of Object.entries(value.mapping)) {
      if (!FINANCE_VOUCHER_SOURCE_FIELDS.includes(field as FinanceVoucherSourceField)) {
        throw new ProcedureEngineError('validation', `${where}: trường phiếu “${field}” không hỗ trợ.`);
      }
      if (key === undefined || key === '') continue;
      if (typeof key !== 'string' || !parseAttributeKey(key)) {
        throw new ProcedureEngineError(
          'validation',
          `${where}: ánh xạ “${FINANCE_VOUCHER_SOURCE_FIELD_LABELS[field as FinanceVoucherSourceField]}” phải trỏ tới một thuộc tính.`,
        );
      }
    }
  }
  if (value.returnToStepId !== undefined && typeof value.returnToStepId !== 'string') {
    throw new ProcedureEngineError('validation', `${where}: bước nhận hồ sơ khi trả về không hợp lệ.`);
  }
}

/**
 * Chuẩn hoá cấu hình sau khi các bước đã có id: đổi mã bước sang id ở `returnToStepId`
 * và ở khoá `step:<mã>:<code>` trong ánh xạ (bước vừa thêm chưa có id lúc client gửi).
 */
export function normalizeStepIntegrations(steps: ProcedureStepDefinition[]): void {
  const idByRef = new Map<string, string>();
  for (const step of steps) {
    idByRef.set(step.id, step.id);
    idByRef.set(step.key.toUpperCase(), step.id);
  }
  const resolve = (ref: string) => idByRef.get(ref) ?? idByRef.get(ref.trim().toUpperCase()) ?? ref;
  for (const step of steps) {
    const integration = step.integration;
    if (!integration) continue;
    const mapping: Partial<Record<FinanceVoucherSourceField, string>> = {};
    for (const field of FINANCE_VOUCHER_SOURCE_FIELDS) {
      const key = integration.mapping?.[field]?.trim();
      if (!key) continue;
      const parsed = parseAttributeKey(key);
      mapping[field] = parsed?.scope === 'step' ? `step:${resolve(parsed.stepRef)}:${parsed.code}` : key;
    }
    const returnTo = integration.returnToStepId?.trim();
    step.integration = {
      module: 'finance',
      action: 'voucher',
      voucherKind: integration.voucherKind,
      ...(Object.keys(mapping).length ? { mapping } : {}),
      ...(returnTo ? { returnToStepId: resolve(returnTo) } : {}),
    };
  }
}

/* --------------------------------- Công bố --------------------------------- */

interface AttributeCandidate {
  readonly key: string;
  readonly attribute: ProcedureAttributeDefinition;
}

/** Thuộc tính đọc được khi hồ sơ tới bước: của quy trình, hoặc của bước chắc chắn đã đi qua. */
function attributesBefore(definition: ProcedureDefinition, before: ReadonlySet<string>): AttributeCandidate[] {
  const candidates: AttributeCandidate[] = (definition.attributes ?? []).map((attribute) => ({
    key: `process:${attribute.code}`,
    attribute,
  }));
  for (const step of definition.steps) {
    if (!before.has(step.id)) continue;
    for (const attribute of step.attributes ?? []) {
      candidates.push({ key: `step:${step.id}:${attribute.code}`, attribute });
    }
  }
  return candidates;
}

function autoMatch(field: FinanceVoucherSourceField, candidates: readonly AttributeCandidate[]): AttributeCandidate | undefined {
  for (const code of FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES[field]) {
    const match = candidates.find(
      (candidate) =>
        candidate.attribute.code.toLowerCase() === code &&
        FINANCE_VOUCHER_SOURCE_FIELD_TYPES[field].includes(candidate.attribute.type),
    );
    if (match) return match;
  }
  return undefined;
}

/** Các bước có thể đi tới SAU một bước (không gồm chính nó). */
function stepsAfter(definition: ProcedureDefinition, stepId: string): Set<string> {
  const index = buildFlowIndex(definition.steps, definition.gateways);
  const seen = new Set<string>();
  const queue = [stepId];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const next of possibleNextStepIds(index, current)) {
      if (!next || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  seen.delete(stepId);
  return seen;
}

/**
 * Luật công bố của bước Tài chính. Trả lỗi và cảnh báo thay vì ném, cùng khuôn với
 * `collectFlowIssues`. Mọi thông điệp mở đầu bằng `FINANCE_STEP_ISSUE_PREFIX`.
 */
export function collectFinanceStepIssues(definition: ProcedureDefinition): ProcedureValidationReport {
  const errors: ProcedureValidationIssue[] = [];
  const warnings: ProcedureValidationIssue[] = [];
  const financeSteps = definition.steps.filter((step) => isFinanceStep(step));
  if (!financeSteps.length) return { errors, warnings };
  const financeIds = new Set(financeSteps.map((step) => step.id));
  const index = buildFlowIndex(definition.steps, definition.gateways);

  for (const step of financeSteps) {
    const integration = step.integration as ProcedureStepIntegration;
    const at = { stepId: step.id };
    const prefix = `${FINANCE_STEP_ISSUE_PREFIX} “${step.name}”`;

    // Vai: phải có R (người ghi sổ); chỉ R và I. Vai khác (S/E/C/A) sẽ là pha người
    // phải bấm hoàn thành/duyệt — ở bước chờ Tài chính thì không ai bấm được.
    if (!step.assignments.some((assignment) => assignment.role === 'R')) {
      errors.push({ level: 'error', message: `${prefix}: cần gán vai R (người ghi sổ).`, ...at });
    }
    const extraRoles = [...new Set(step.assignments.map((assignment) => assignment.role))].filter(
      (role) => !FINANCE_STEP_ROLES.includes(role),
    );
    if (extraRoles.length) {
      errors.push({
        level: 'error',
        message: `${prefix}: chỉ được gán vai R và I (đang có ${extraRoles.join(', ')}).`,
        ...at,
      });
    }

    // Một hồ sơ một phiếu, và bước Tài chính là bước có hành động cuối cùng.
    const after = stepsAfter(definition, step.id);
    const laterFinance = [...after].filter((id) => financeIds.has(id));
    if (laterFinance.length) {
      const names = laterFinance.map((id) => definition.steps.find((item) => item.id === id)?.name ?? '?');
      errors.push({
        level: 'error',
        message: `${prefix}: một đường đi chỉ được có một bước Tài chính (sau bước này còn “${names.join('”, “')}”).`,
        ...at,
      });
    } else if (after.size) {
      errors.push({
        level: 'error',
        message: `${prefix}: phải là bước có hành động cuối cùng của quy trình; sau bước này không được còn bước nào.`,
        ...at,
      });
    }

    // Thuộc tính: chỉ đọc được của quy trình hoặc của bước chắc chắn đã đi qua.
    const before = dominatorStepIds(index, step.id);
    const candidates = attributesBefore(definition, before);
    for (const field of FINANCE_VOUCHER_SOURCE_FIELDS) {
      const mapped = integration.mapping?.[field];
      const label = FINANCE_VOUCHER_SOURCE_FIELD_LABELS[field];
      if (mapped) {
        const parsed = parseAttributeKey(mapped);
        const target = candidates.find((candidate) => candidate.key === mapped);
        if (!target) {
          const ownStep = parsed?.scope === 'step' && parsed.stepRef === step.id;
          errors.push({
            level: 'error',
            message: ownStep
              ? `${prefix}: “${label}” không lấy được từ thuộc tính của chính bước Tài chính; hãy nhập ở bước trước.`
              : `${prefix}: “${label}” trỏ tới thuộc tính không tồn tại hoặc không chắc chắn đã nhập trước bước này.`,
            ...at,
          });
          continue;
        }
        if (!FINANCE_VOUCHER_SOURCE_FIELD_TYPES[field].includes(target.attribute.type)) {
          errors.push({
            level: 'error',
            message: `${prefix}: “${label}” không nhận thuộc tính kiểu này (“${target.attribute.name}”).`,
            ...at,
          });
        }
        continue;
      }
      if (field === 'amount' && !autoMatch(field, candidates)) {
        errors.push({
          level: 'error',
          message: `${prefix}: cần thuộc tính số tiền (kiểu Số tiền hoặc Số) nhập trước bước này — ánh xạ “Số tiền” hoặc đặt mã so_tien.`,
          ...at,
        });
      }
    }

    if (integration.returnToStepId && !before.has(integration.returnToStepId)) {
      errors.push({
        level: 'error',
        message: `${prefix}: bước nhận hồ sơ khi trả về phải là bước chắc chắn đã đi qua trước bước này.`,
        ...at,
      });
    }

    // Quy trình không đọc được quyền của Tài chính (thuộc Platform/Core, không có đường
    // đọc nội bộ cho Quy trình) — nhắc người thiết kế thay vì kiểm.
    warnings.push({
      level: 'warning',
      message: `${prefix}: người giữ vai R phải có quyền ${
        integration.voucherKind === 'PAYMENT' ? 'finance.payment.approve' : 'finance.receipt.approve'
      } bên Tài chính mới ghi sổ được ${PROCEDURE_FINANCE_VOUCHER_KIND_LABELS[integration.voucherKind].toLowerCase()}.`,
      ...at,
    });
  }
  return { errors, warnings };
}

/* ------------------------------- Lúc chạy ------------------------------- */

function textOf(value: ProcedureAttributeValue | undefined, attribute?: ProcedureAttributeDefinition): string | null {
  if (!value) return null;
  switch (value.type) {
    case 'text':
    case 'date':
      return value.value.trim() || null;
    case 'select':
      return attribute?.options?.find((option) => option.code === value.value)?.label ?? (value.value || null);
    case 'user':
      return value.label?.trim() || value.value || null;
    case 'number':
    case 'money':
    case 'percent':
      return String(value.value);
    default:
      return null;
  }
}

function amountOf(value: ProcedureAttributeValue | undefined): number | null {
  if (!value) return null;
  if ((value.type === 'money' || value.type === 'number') && Number.isFinite(value.value)) return value.value;
  return null;
}

interface InstanceSlot {
  readonly key: string;
  readonly attribute: ProcedureAttributeDefinition;
}

/** Thuộc tính của hồ sơ đọc được ở bước: của quy trình, và của các bước đã đi qua trước nó. */
function instanceSlotsBefore(instance: ProcedureInstance, step: ProcedureInstanceStep): InstanceSlot[] {
  const slots: InstanceSlot[] = (instance.flow?.attributes ?? []).map((attribute) => ({
    key: `process:${attribute.code}`,
    attribute,
  }));
  const path = livePath(instance).map((entry) => entry.stepInstanceId);
  const position = path.lastIndexOf(step.id);
  const passed = new Set(position < 0 ? path : path.slice(0, position));
  // Bước đi qua gần nhất đứng trước: khi trùng mã, giá trị mới nhất thắng.
  const ordered = [...instance.steps]
    .filter((candidate) => passed.has(candidate.id) && candidate.id !== step.id)
    .sort((left, right) => right.order - left.order);
  for (const candidate of ordered) {
    for (const attribute of candidate.attributes ?? []) {
      slots.push({ key: `step:${candidate.definitionStepId}:${attribute.code}`, attribute });
    }
  }
  return slots;
}

/** Giá trị gửi sang Tài chính: theo ánh xạ của bước, thiếu thì tự khớp theo mã chuẩn. */
export function resolveFinanceVoucherValues(
  instance: ProcedureInstance,
  step: ProcedureInstanceStep,
): ProcedureFinanceVoucherRequestedValues {
  const slots = instanceSlotsBefore(instance, step);
  const valueAt = (key: string) => instance.attributeValues?.[key]?.value;
  const pick = (field: FinanceVoucherSourceField): { value?: ProcedureAttributeValue; attribute?: ProcedureAttributeDefinition } => {
    const mapped = step.integration?.mapping?.[field];
    if (mapped) {
      return { value: valueAt(mapped), attribute: slots.find((slot) => slot.key === mapped)?.attribute };
    }
    for (const code of FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES[field]) {
      for (const slot of slots) {
        if (slot.attribute.code.toLowerCase() !== code) continue;
        if (!FINANCE_VOUCHER_SOURCE_FIELD_TYPES[field].includes(slot.attribute.type)) continue;
        const value = valueAt(slot.key);
        if (value !== undefined) return { value, attribute: slot.attribute };
      }
    }
    return {};
  };
  const text = (field: FinanceVoucherSourceField) => {
    const { value, attribute } = pick(field);
    return textOf(value, attribute);
  };
  const date = pick('voucherDate').value;
  return {
    amount: amountOf(pick('amount').value),
    content: text('content'),
    counterpartyName: text('counterpartyName'),
    counterpartyAccountNo: text('counterpartyAccountNo'),
    counterpartyBank: text('counterpartyBank'),
    voucherDate: date?.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(date.value) ? date.value.slice(0, 10) : null,
  };
}

function rAssignees(step: ProcedureInstanceStep): {
  ids: string[];
  subjects: ProcedureFinanceStepAssigneeSubject[];
  label?: string;
} {
  const assignments = step.assignments.filter((assignment) => assignment.role === 'R');
  const ids = [...new Set(assignments.filter((item) => item.subjectType === 'user').map((item) => item.subjectId))];
  const subjects = assignments
    .filter((item) => item.subjectType !== 'user' && item.subjectType !== 'everyone' && item.subjectId)
    .map((item) => ({ subjectType: item.subjectType, subjectId: item.subjectId, subjectLabel: item.subjectLabel }));
  const labels = [...new Set(assignments.map((item) => item.subjectLabel?.trim()).filter((label): label is string => !!label))];
  return { ids, subjects, label: labels.length ? labels.join(', ') : undefined };
}

export function buildFinanceVoucherRequestedPayload(
  instance: ProcedureInstance,
  step: ProcedureInstanceStep,
): ProcedureFinanceVoucherRequestedPayload {
  const integration = step.integration as ProcedureStepIntegration;
  const voucher = step.financeVoucher;
  const assignees = rAssignees(step);
  const start = [...instance.activity].reverse().find((entry) => entry.action === 'start');
  const workItemId = instance.sourceType === 'workspace_work_item' ? instance.sourceId : undefined;
  return {
    instanceId: instance.id,
    instanceCode: instance.code,
    instanceTitle: instance.title,
    definitionId: instance.definitionId,
    definitionName: instance.definitionName,
    stepInstanceId: step.id,
    stepName: step.name,
    activation: voucher?.activation ?? 1,
    voucherKind: integration.voucherKind,
    values: resolveFinanceVoucherValues(instance, step),
    ...(instance.workspaceLink?.projectId ? { projectId: instance.workspaceLink.projectId } : {}),
    ...(workItemId ? { workItemId } : {}),
    initiatedBy: instance.initiatedBy,
    ...(start?.actorName ? { initiatedByName: start.actorName } : {}),
    assigneeIds: assignees.ids,
    assigneeSubjects: assignees.subjects,
    ...(assignees.label ? { assigneeLabel: assignees.label } : {}),
    requestedAt: voucher?.requestedAt ?? step.startedAt ?? instance.startedAt,
  };
}

export interface FinanceStepOutboxEvent {
  readonly type: typeof PROCEDURE_STEP_FINANCE_VOUCHER_REQUESTED;
  readonly aggregateId: string;
  readonly payload: ProcedureFinanceVoucherRequestedPayload;
}

/**
 * Sự kiện yêu cầu tạo phiếu, suy từ hai bản chụp trước/sau của một transaction:
 * phát đúng một lần cho mỗi lần bước Tài chính được kích hoạt (`activation` tăng).
 */
export function financeStepEvents(
  before: readonly ProcedureInstance[],
  after: readonly ProcedureInstance[],
): FinanceStepOutboxEvent[] {
  const previous = new Map(before.map((instance) => [instance.id, instance]));
  const events: FinanceStepOutboxEvent[] = [];
  for (const instance of after) {
    if (instance.status !== 'running') continue;
    const step = instance.steps.find((candidate) => candidate.id === instance.currentStepId);
    if (!step || !isFinanceStep(step) || step.financeVoucher?.state !== 'requested') continue;
    const prior = previous.get(instance.id)?.steps.find((candidate) => candidate.id === step.id);
    if (prior?.financeVoucher?.activation === step.financeVoucher.activation) continue;
    events.push({
      type: PROCEDURE_STEP_FINANCE_VOUCHER_REQUESTED,
      aggregateId: instance.id,
      payload: buildFinanceVoucherRequestedPayload(instance, step),
    });
  }
  return events;
}
