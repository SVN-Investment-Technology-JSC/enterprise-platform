import type {
  ProcedureInstance,
  ProcedureInstanceStep,
} from './procedure-engine.contracts.js';

export type ProcedureSlaState = 'none' | 'ok' | 'warning' | 'breached';

/** Ngưỡng cảnh báo vàng: còn từng này trở xuống thì coi là sắp trễ (AC-SLA-03). */
export const PROCEDURE_SLA_WARNING_MS = 4 * 60 * 60 * 1000;

export interface ProcedureSlaView {
  readonly state: ProcedureSlaState;
  readonly dueAt?: string;
  /** Còn lại (>0) hoặc đã quá hạn (<0), tính bằng mili giây. */
  readonly remainingMs?: number;
  /**
   * Đồng hồ đã dừng: bước đã xong hoặc hồ sơ đã đóng. Trạng thái SLA được chốt
   * tại thời điểm dừng thay vì tiếp tục đỏ dần (AC-SLA-05).
   */
  readonly frozen: boolean;
}

const NONE: ProcedureSlaView = { state: 'none', frozen: false };

/**
 * Trạng thái SLA của một bước.
 *
 * Không có cột `breached` nào được lưu: hệ thống không có cron để giữ cờ đó cho
 * đúng, mà một lá cờ cũ còn tệ hơn là không có. Trạng thái luôn suy ra từ
 * `slaDueAt` và mốc thời gian dừng.
 */
export function evaluateStepSla(
  step: Pick<ProcedureInstanceStep, 'slaDueAt' | 'completedAt'>,
  instance: Pick<ProcedureInstance, 'completedAt'>,
  now: Date = new Date(),
): ProcedureSlaView {
  if (!step.slaDueAt) return NONE;

  const stoppedAt = step.completedAt ?? instance.completedAt;
  const reference = stoppedAt ? Date.parse(stoppedAt) : now.getTime();
  const remainingMs = Date.parse(step.slaDueAt) - reference;

  return {
    state: remainingMs <= 0 ? 'breached' : remainingMs <= PROCEDURE_SLA_WARNING_MS ? 'warning' : 'ok',
    dueAt: step.slaDueAt,
    remainingMs,
    frozen: Boolean(stoppedAt),
  };
}

/** SLA của hồ sơ = SLA của bước đang chạy; dùng cho badge trên danh sách. */
export function evaluateInstanceSla(
  instance: Pick<ProcedureInstance, 'steps' | 'currentStepId' | 'completedAt'>,
  now: Date = new Date(),
): ProcedureSlaView {
  const current = instance.steps.find((step) => step.id === instance.currentStepId);
  return current ? evaluateStepSla(current, instance, now) : NONE;
}

/** Hạn của một bước khi nó bắt đầu; `undefined` khi bước không cài SLA. */
export function computeSlaDueAt(slaHours: number | undefined, startedAt: string): string | undefined {
  if (!slaHours || !Number.isFinite(slaHours)) return undefined;
  return new Date(Date.parse(startedAt) + slaHours * 3_600_000).toISOString();
}
