export const PROCEDURE_INSTANCE_READER = Symbol('PROCEDURE_INSTANCE_READER');

/** Trạng thái một hồ sơ Quy trình, đọc qua API nội bộ của Quy trình (luật 4: không đọc schema của phân hệ khác). */
export interface ProcedureInstanceState {
  readonly instanceId: string;
  readonly instanceCode: string | null;
  /** `running`, `completed`, `rejected`, `cancelled`, `reversed`. */
  readonly status: string;
}

/** Đơn vật tư xuất kho ghi trên hồ sơ Quy trình (`GET /v1/internal/material-orders`). */
export interface ProcedureIssueOrder {
  readonly orderCode: string;
  readonly createdAt: string;
  readonly lines: readonly {
    readonly materialCode: string;
    readonly quantity: number;
    readonly materialName?: string;
    readonly unit?: string;
  }[];
  readonly instanceId?: string;
  readonly instanceTitle?: string;
  readonly instanceStatus?: string;
  readonly parentInstanceId: string;
  readonly parentCode: string;
  readonly parentTitle: string;
  readonly assetCode?: string;
}

export interface ProcedureInstanceReader {
  /** Hồ sơ không còn (không có hoặc đã xoá) thì `null`; Quy trình không trả lời được thì ném lỗi 503. */
  instanceState(tenantId: string, instanceId: string): Promise<ProcedureInstanceState | null>;
  /** Mọi đơn vật tư xuất kho của tenant; Quy trình không trả lời được thì ném lỗi 503. */
  listIssueOrders(tenantId: string): Promise<ProcedureIssueOrder[]>;
}
