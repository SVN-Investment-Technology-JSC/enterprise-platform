import {
  PROCEDURE_KINDS,
  PROCEDURE_RACI_ROLES,
  PROCEDURE_STAGE_ORDER,
  type CreateProcedureDefinitionRequest,
  type ProcedureDefinition,
  type ProcedureValidationIssue,
  type ProcedureValidationReport,
} from '@enterprise-platform/contracts-procedure-engine';
import { validateAttributeDefinitions } from './procedure-attributes.js';
import { ProcedureEngineError } from './procedure-engine.error.js';
import {
  collectFlowIssues,
  rollbackTargetsFor,
  validateGatewaysDraft,
} from './procedure-flow.policy.js';

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/;
const STEP_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function validateDefinitionDraft(
  input: CreateProcedureDefinitionRequest,
): void {
  if (!CODE_PATTERN.test(input.code.trim())) {
    throw new ProcedureEngineError(
      'validation',
      'Mã quy trình phải dài 2–80 ký tự và chỉ gồm chữ, số, gạch ngang hoặc gạch dưới.',
    );
  }
  if (!input.name.trim() || input.name.trim().length > 180) {
    throw new ProcedureEngineError(
      'validation',
      'Tên quy trình là bắt buộc và không vượt quá 180 ký tự.',
    );
  }
  if (!PROCEDURE_KINDS.includes(input.kind)) {
    throw new ProcedureEngineError(
      'validation',
      'Loại quy trình không hợp lệ.',
    );
  }
  if (input.steps.length < 1 || input.steps.length > 300) {
    throw new ProcedureEngineError(
      'validation',
      'Quy trình phải có từ 1 đến 300 bước.',
    );
  }

  const keys = new Set<string>();
  const orders = new Set<number>();
  for (const step of input.steps) {
    if (!STEP_KEY_PATTERN.test(step.key.trim())) {
      throw new ProcedureEngineError(
        'validation',
        `Mã bước “${step.key}” không hợp lệ.`,
      );
    }
    const normalizedKey = step.key.trim().toUpperCase();
    if (keys.has(normalizedKey) || orders.has(step.order)) {
      throw new ProcedureEngineError(
        'validation',
        'Mã bước và thứ tự bước phải là duy nhất trong quy trình.',
      );
    }
    keys.add(normalizedKey);
    orders.add(step.order);
    if (!Number.isInteger(step.order) || step.order < 1) {
      throw new ProcedureEngineError(
        'validation',
        'Thứ tự bước phải là số nguyên dương.',
      );
    }
    if (!step.name.trim() || step.name.trim().length > 180) {
      throw new ProcedureEngineError(
        'validation',
        `Tên bước số ${step.order} không hợp lệ.`,
      );
    }
    if (step.slaHours !== undefined) {
      // Giờ nguyên dương; trần 1 năm để một con số gõ nhầm không tạo ra hạn vô nghĩa.
      if (!Number.isInteger(step.slaHours) || step.slaHours < 1 || step.slaHours > 8760) {
        throw new ProcedureEngineError(
          'validation',
          `SLA của bước “${step.name}” phải là số giờ nguyên từ 1 đến 8760.`,
        );
      }
    }
    if (step.assignments.length > 60) {
      throw new ProcedureEngineError(
        'validation',
        `Bước “${step.name}” có quá nhiều phân công RCSI.`,
      );
    }
    // BRD Epic 2 AC2: mỗi bước chỉ được phép có tối đa một người kiểm soát (C).
    if (step.assignments.filter((item) => item.role === 'C').length > 1) {
      throw new ProcedureEngineError(
        'validation',
        `Bước “${step.name}” chỉ được phép có tối đa 1 vai trò C.`,
      );
    }
    for (const assignment of step.assignments) {
      if (!PROCEDURE_RACI_ROLES.includes(assignment.role)) {
        throw new ProcedureEngineError(
          'validation',
          'Vai trò RCSI không hợp lệ.',
        );
      }
      // Chủ thể động không có id cố định; nó được phân giải lúc bước kích hoạt.
      if (assignment.subjectType !== 'initiator_manager' && !assignment.subjectId.trim()) {
        throw new ProcedureEngineError(
          'validation',
          `Bước “${step.name}” có đối tượng phân công trống.`,
        );
      }
      if (assignment.role === 'E' && !assignment.eTaskSource) {
        throw new ProcedureEngineError(
          'validation',
          `Vai trò E tại bước “${step.name}” phải có nguồn đầu việc.`,
        );
      }
    }
    validateAttributeDefinitions(step.attributes, `bước “${step.name}”`);
  }
  validateAttributeDefinitions(input.attributes, 'quy trình');
  validateGatewaysDraft(input.gateways);
}

export function validateDefinitionForPublish(
  definition: ProcedureDefinition,
): void {
  if (definition.status !== 'draft') {
    throw new ProcedureEngineError(
      'conflict',
      'Chỉ phiên bản nháp mới được công bố.',
    );
  }

  // Nhóm là bắt buộc trước khi công bố: màn tạo work order và workspace lọc
  // theo nhóm, một quy trình không nhóm sẽ rơi ra ngoài mọi bộ lọc. Chỉ chặn ở
  // đây chứ không chặn lúc lưu nháp, để người thiết kế dựng bước trước rồi mới
  // phân nhóm.
  if (!definition.category?.trim()) {
    throw new ProcedureEngineError(
      'validation',
      'Quy trình phải thuộc một nhóm trước khi công bố.',
    );
  }

  for (const step of definition.steps) {
    if (!step.assignments.length) {
      throw new ProcedureEngineError(
        'validation',
        `Bước “${step.name}” chưa được phân vai RCSI.`,
      );
    }
    if (
      !step.assignments.some((assignment) =>
        PROCEDURE_STAGE_ORDER.includes(assignment.role),
      )
    ) {
      throw new ProcedureEngineError(
        'validation',
        `Bước “${step.name}” chỉ có vai trò I nên không thể chuyển bước.`,
      );
    }

    // E must be reviewed: PROCEDURE_STAGE_ORDER runs E immediately before C,
    // so a step carrying E is only valid when it also carries C.
    // Note: E(x) subtask weights cannot be validated here — subtasks are runtime
    // entities created when the E holder decomposes their work, so the "weights
    // sum to 100" rule belongs to that runtime path, not to publish.
    // E là người phụ trách đơn vị: chỉ họ mới có cấp dưới để phân rã công việc.
    // Kiểm lúc CÔNG BỐ chứ không phải lúc lưu nháp: bản nháp PATCH nguyên mảng
    // bước mỗi lần sửa một ô, nên một ô E sai sẽ khoá mọi thao tác trên mọi ô
    // khác — kể cả thao tác sửa chính ô đó.
    for (const assignment of step.assignments) {
      if (
        assignment.role === 'E' &&
        assignment.subjectType !== 'organization_unit' &&
        assignment.subjectType !== 'position'
      ) {
        throw new ProcedureEngineError(
          'validation',
          `Vai trò E tại bước “${step.name}” chỉ được gán cho đơn vị hoặc chức danh quản lý. Hãy chuyển E sang một cột quản lý trước khi công bố.`,
        );
      }
    }

    const hasC = step.assignments.some((a) => a.role === 'C');
    const hasE = step.assignments.some((a) => a.role === 'E');
    if (hasE && !hasC) {
      throw new ProcedureEngineError(
        'validation',
        `Bước “${step.name}” có vai trò E nhưng thiếu vai trò C để nghiệm thu.`,
      );
    }

    // Bước quay về phải CHẮC CHẮN đã đi qua trên mọi đường tới bước này. Với quy
    // trình tuyến tính đó đúng là "mọi bước đứng trước"; khi có nhánh, một bước
    // ở điểm hợp không được quay về bước nằm trong một nhánh cụ thể.
    const rollbackCandidates = step.assignments.filter(
      (candidate) => candidate.role === 'C' && candidate.fixedRollbackStepId,
    );
    if (rollbackCandidates.length) {
      const allowed = rollbackTargetsFor(definition, step.id);
      for (const assignment of rollbackCandidates) {
        if (!allowed.has(assignment.fixedRollbackStepId ?? '')) {
          throw new ProcedureEngineError(
            'validation',
            `Bước quay về của vai trò C tại “${step.name}” phải là bước chắc chắn đã đi qua trước bước hiện tại.`,
          );
        }
      }
    }

    // Validate AND-logic for multiple R roles: all R assignees must be tracked
    const rAssignments = step.assignments.filter((a) => a.role === 'R');
    if (rAssignments.length > 1) {
      // Multiple R roles require all to approve before moving forward
      // This is tracked via action table in runtime, but we validate configuration here
      const rSubjectIds = new Set(rAssignments.map((a) => a.subjectId));
      if (rSubjectIds.size < rAssignments.length) {
        throw new ProcedureEngineError(
          'validation',
          `Bước “${step.name}” có trùng lặp trong vai trò R - mỗi chủ thể phải được gán một lần.`,
        );
      }
    }
  }

  const flow = collectFlowIssues(definition);
  const firstError = flow.errors[0];
  if (firstError) throw new ProcedureEngineError('validation', firstError.message);
}

/**
 * Kiểm tra trước khi công bố mà không ném: gom lỗi và cảnh báo để UI liệt kê.
 *
 * Luật cũ ném ở lỗi đầu tiên nên chỉ lấy được một lỗi từ đó; luật rẽ nhánh thì
 * liệt kê đủ. Cảnh báo không chặn công bố.
 */
export function inspectDefinitionForPublish(definition: ProcedureDefinition): ProcedureValidationReport {
  const flow = collectFlowIssues(definition);
  const errors: ProcedureValidationIssue[] = [...flow.errors];
  try {
    validateDefinitionForPublish({ ...definition, gateways: [] });
  } catch (error) {
    if (!(error instanceof ProcedureEngineError)) throw error;
    // Bản không-gateway có thể báo sai về rollback C khi luồng có nhánh; luật đó
    // đã được kiểm lại trên luồng thật ở dưới.
    if (!error.message.startsWith('Bước quay về của vai trò C')) {
      errors.unshift({ level: 'error', message: error.message });
    }
  }
  for (const step of definition.steps) {
    const allowed = rollbackTargetsFor(definition, step.id);
    for (const assignment of step.assignments) {
      if (assignment.role !== 'C' || !assignment.fixedRollbackStepId) continue;
      if (!allowed.has(assignment.fixedRollbackStepId)) {
        errors.push({
          level: 'error',
          message: `Bước quay về của vai trò C tại “${step.name}” phải là bước chắc chắn đã đi qua trước bước hiện tại.`,
          stepId: step.id,
        });
      }
    }
  }
  return { errors, warnings: flow.warnings };
}
