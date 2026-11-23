import {
  PROCEDURE_INVENTORY_STOCK_ISSUED_EVENT,
  type ProcedureInventoryStockIssuedPayload,
} from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureEngineApplication } from './procedure-engine.application.js';

/** Sự kiện của Kho mà Quy trình nghe (hàng đợi `procedure.integrations.v1`). */
export const PROCEDURE_INVENTORY_EVENT_TYPES = [PROCEDURE_INVENTORY_STOCK_ISSUED_EVENT] as const;

function isIssuedPayload(payload: unknown): payload is ProcedureInventoryStockIssuedPayload {
  if (!payload || typeof payload !== 'object') return false;
  const value = payload as Record<string, unknown>;
  return typeof value['documentId'] === 'string' && typeof value['documentCode'] === 'string';
}

/**
 * Kho ghi sổ chứng từ xuất theo yêu cầu cấp vật tư: Quy trình ghi lời báo đã cấp
 * vào hồ sơ. Chứng từ xuất khác (bán hàng, bảo hành...) cũng phát sự kiện này và
 * bị bỏ qua trong ứng dụng theo nguồn chứng từ. Payload thiếu trường thì bỏ qua
 * thay vì thử lại mãi.
 */
export class ProcedureInventoryEvents {
  constructor(private readonly procedures: ProcedureEngineApplication) {}

  async handle(tenantId: string, type: string, payload: unknown): Promise<void> {
    if (type !== PROCEDURE_INVENTORY_STOCK_ISSUED_EVENT || !isIssuedPayload(payload)) return;
    await this.procedures.applyInventoryStockIssued(tenantId, payload);
  }
}
