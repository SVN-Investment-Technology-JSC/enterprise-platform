import {
  FINANCE_VOUCHER_LINKED,
  FINANCE_VOUCHER_POSTED,
  FINANCE_VOUCHER_RETURNED,
  type FinanceVoucherLinkedPayload,
  type FinanceVoucherPostedPayload,
  type FinanceVoucherReturnedPayload,
} from '@enterprise-platform/contracts-procedure-engine';
import type { ProcedureEngineApplication } from './procedure-engine.application.js';

/** Sự kiện từ module Tài chính mà Quy trình xử lý (bước Tài chính). */
export const PROCEDURE_FINANCE_EVENT_TYPES = [
  FINANCE_VOUCHER_LINKED,
  FINANCE_VOUCHER_POSTED,
  FINANCE_VOUCHER_RETURNED,
] as const;

/** Payload tối thiểu để biết sự kiện nhắm tới bước nào; thiếu thì bỏ qua thay vì thử lại mãi. */
function targetsStep(payload: unknown): payload is { instanceId: string; stepInstanceId: string; activation: number } {
  if (!payload || typeof payload !== 'object') return false;
  const value = payload as Record<string, unknown>;
  return (
    typeof value['instanceId'] === 'string' &&
    value['instanceId'].length > 0 &&
    typeof value['stepInstanceId'] === 'string' &&
    value['stepInstanceId'].length > 0 &&
    Number.isInteger(value['activation'])
  );
}

/**
 * Xử lý kết quả của Tài chính cho bước Tài chính. Tài chính tự ghi phiếu của nó;
 * Quy trình chỉ đóng bước hoặc trả hồ sơ về. Sự kiện muộn (lần kích hoạt cũ, bước
 * đã rời đi) bị bỏ qua trong ứng dụng; trùng lặp do broker giao lại được chặn bởi
 * hộp thư của worker và khoá idempotency trong state.
 */
export class ProcedureFinanceEvents {
  constructor(private readonly procedures: ProcedureEngineApplication) {}

  async handle(tenantId: string, type: string, payload: unknown): Promise<void> {
    if (!targetsStep(payload)) return;
    if (type === FINANCE_VOUCHER_LINKED) {
      await this.procedures.applyFinanceVoucherLinked(tenantId, payload as FinanceVoucherLinkedPayload);
    } else if (type === FINANCE_VOUCHER_POSTED) {
      await this.procedures.applyFinanceVoucherPosted(tenantId, payload as FinanceVoucherPostedPayload);
    } else if (type === FINANCE_VOUCHER_RETURNED) {
      await this.procedures.applyFinanceVoucherReturned(tenantId, payload as FinanceVoucherReturnedPayload);
    }
  }
}
