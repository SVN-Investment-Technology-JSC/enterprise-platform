import {
  PROCEDURE_CATEGORIES,
  PROCEDURE_KINDS,
  PROCEDURE_RACI_ROLES,
  PROCEDURE_STAGE_ORDER,
  type CreateProcedureDefinitionRequest,
  type ProcedureDefinition,
} from '@enterprise-platform/contracts-procedure-engine';
import { ProcedureEngineError } from './procedure-engine.error.js';

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
  if (input.category !== undefined && !PROCEDURE_CATEGORIES.includes(input.category)) {
    throw new ProcedureEngineError('validation', 'Nhóm quy trình không hợp lệ.');
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
      if (!assignment.subjectId.trim()) {
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
  }
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
  const stepIndexes = new Map(
    definition.steps.map((step, index) => [step.id, index]),
  );
  for (const [index, step] of definition.steps.entries()) {
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
      if (assignment.role === 'E' && assignment.subjectType !== 'organization_unit') {
        throw new ProcedureEngineError(
          'validation',
          `Vai trò E tại bước “${step.name}” chỉ được gán ở cấp đơn vị — nó định tuyến tới người phụ trách đơn vị đó. Hãy chuyển E sang một cột đơn vị trước khi công bố.`,
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

    for (const assignment of step.assignments.filter(
      (candidate) => candidate.role === 'C' && candidate.fixedRollbackStepId,
    )) {
      const rollbackIndex =
        stepIndexes.get(assignment.fixedRollbackStepId ?? '') ?? -1;
      if (rollbackIndex < 0 || rollbackIndex >= index) {
        throw new ProcedureEngineError(
          'validation',
          `Bước quay về của vai trò C tại “${step.name}” phải đứng trước bước hiện tại.`,
        );
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
}
