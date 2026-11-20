export const PROCEDURE_INSTANCE_READER = Symbol('PROCEDURE_INSTANCE_READER');

/** Trạng thái một hồ sơ Quy trình, đọc qua API nội bộ của Quy trình (luật 4: không đọc schema của phân hệ khác). */
export interface ProcedureInstanceState {
  readonly instanceId: string;
  readonly instanceCode: string | null;
  /** `running`, `completed`, `rejected`, `cancelled`, `reversed`. */
  readonly status: string;
}

export interface ProcedureInstanceReader {
  /** Hồ sơ không còn (không có hoặc đã xoá) thì `null`; Quy trình không trả lời được thì ném lỗi 503. */
  instanceState(tenantId: string, instanceId: string): Promise<ProcedureInstanceState | null>;
}
