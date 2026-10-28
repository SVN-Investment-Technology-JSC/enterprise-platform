import type { IntegrationDispatcher, InventoryClient } from '../application/fulfillment.port.js';
import type { FinanceClient, FinanceReceiptVoucherRequest } from '../application/receivable-store.port.js';
import { CrmError } from '../domain/crm.error.js';
import type { CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';

/** Thao tác nhả giữ hàng ở Kho. */
export const RESERVATION_RELEASE_OPERATION = 'reservation.release';
/** Số lần thử tối đa trước khi bỏ một lệnh (lỗi hạ tầng). */
export const INTEGRATION_MAX_ATTEMPTS = 30;
/** Một tiến trình giữ lệnh tối đa chừng này giây khi đang gửi. */
const LEASE_SECONDS = 30;

/**
 * Xếp lệnh nhả phần giữ hàng ở Kho, trong transaction đang huỷ đơn hay hợp đồng
 * (mẫu "lưu yêu cầu cùng transaction, worker gửi và thử lại" của mục 3.1 kế
 * hoạch). Khoá `crm-release:<mã giữ hàng>`: xếp hai lần vẫn một lệnh; nhả ở Kho
 * cũng idempotent theo trạng thái.
 */
export async function enqueueReservationRelease(client: CrmSqlClient, reservationCode: string, reason: string): Promise<void> {
  await client.query(
    `INSERT INTO crm_schema.integration_requests (target, operation, idempotency_key, payload)
     VALUES ('inventory', $1, $2, $3::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [RESERVATION_RELEASE_OPERATION, `crm-release:${reservationCode}`, JSON.stringify({ reservationCode, reason })],
  );
}

/** Thao tác tạo phiếu thu có nguồn ở Tài chính cho một lần thu (T5-06). */
export const RECEIPT_VOUCHER_OPERATION = 'voucher-source.create';

interface ReceiptVoucherPayload {
  readonly receiptId: string;
  readonly request: FinanceReceiptVoucherRequest;
}

/**
 * Xếp lệnh tạo phiếu thu ở Tài chính trong transaction ghi lần thu. Khoá của
 * lệnh cũng là khoá chống lặp gửi Tài chính (`crm-receipt:<id>`, gửi lại thêm số
 * lần), nên Tài chính tắt rồi bật lại vẫn chỉ có một phiếu (TC-INT-08).
 */
export async function enqueueReceiptVoucher(client: CrmSqlClient, receiptId: string, request: FinanceReceiptVoucherRequest): Promise<void> {
  const payload: ReceiptVoucherPayload = { receiptId, request };
  await client.query(
    `INSERT INTO crm_schema.integration_requests (target, operation, idempotency_key, payload)
     VALUES ('finance', $1, $2, $3::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [RECEIPT_VOUCHER_OPERATION, request.idempotencyKey, JSON.stringify(payload)],
  );
}

/** Thao tác huỷ phiếu thu nháp ở Tài chính khi lần thu bị huỷ (T5-15). */
export const RECEIPT_VOUCHER_CANCEL_OPERATION = 'voucher-source.cancel';

interface ReceiptVoucherCancelPayload {
  readonly receiptId: string;
  readonly reason: string;
}

/**
 * Xếp lệnh huỷ phiếu thu nháp ở Tài chính trong transaction huỷ lần thu. Khoá
 * `crm-receipt-cancel:<id>`: huỷ một lần thu chỉ một lệnh; Tài chính huỷ cũng
 * idempotent (phiếu đã huỷ trả lại trạng thái).
 */
export async function enqueueReceiptVoucherCancel(client: CrmSqlClient, receiptId: string, reason: string): Promise<void> {
  const payload: ReceiptVoucherCancelPayload = { receiptId, reason };
  await client.query(
    `INSERT INTO crm_schema.integration_requests (target, operation, idempotency_key, payload)
     VALUES ('finance', $1, $2, $3::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [RECEIPT_VOUCHER_CANCEL_OPERATION, `crm-receipt-cancel:${receiptId}`, JSON.stringify(payload)],
  );
}

/**
 * Gửi lệnh đã xếp sang Kho, Tài chính. Giành lease ngắn để hai tiến trình (API vừa huỷ
 * đơn, worker) không cùng gửi; thành công thì SUCCEEDED; lỗi hạ tầng thì
 * FAILED và thử lại khi hết lease; Kho từ chối dữ liệu (4xx) thì FAILED không
 * thử lại.
 */
export class PostgresIntegrationRequests implements IntegrationDispatcher {
  constructor(
    private readonly database: CrmDatabase,
    private readonly inventory: InventoryClient,
    private readonly finance?: FinanceClient,
  ) {}

  /** Chỉ nhận lệnh mà tiến trình này gửi được (không có client Tài chính thì để lệnh phiếu thu cho nơi khác). */
  private operations(): string[] {
    return this.finance
      ? [RESERVATION_RELEASE_OPERATION, RECEIPT_VOUCHER_OPERATION, RECEIPT_VOUCHER_CANCEL_OPERATION]
      : [RESERVATION_RELEASE_OPERATION];
  }

  async dispatch(tenantId: string, limit = 20): Promise<number> {
    const pool = await this.database.pool(tenantId);
    const claimed = await pool.query<{
      id: string;
      operation: string;
      payload: { reservationCode?: string; reason?: string } & Partial<ReceiptVoucherPayload>;
    }>(
      `UPDATE crm_schema.integration_requests r
          SET status = 'PROCESSING', attempts = attempts + 1, lease_until = now() + ($1 || ' seconds')::interval,
              updated_at = now()
        WHERE r.id IN (
          SELECT id FROM crm_schema.integration_requests
           WHERE status IN ('PENDING', 'FAILED', 'PROCESSING') AND attempts < $2
             AND (lease_until IS NULL OR lease_until < now())
             AND operation = ANY($4::varchar[])
           ORDER BY created_at
           LIMIT $3
           FOR UPDATE SKIP LOCKED)
        RETURNING r.id, r.operation, r.payload`,
      [String(LEASE_SECONDS), INTEGRATION_MAX_ATTEMPTS, limit, this.operations()],
    );
    for (const row of claimed.rows) {
      try {
        if (row.operation === RECEIPT_VOUCHER_OPERATION && this.finance && row.payload?.receiptId && row.payload.request) {
          const state = await this.finance.createReceiptVoucher(tenantId, row.payload.request);
          // Chỉ áp khi lệnh còn là lần gửi hiện tại của lần thu (đã gửi lại thì lệnh cũ bỏ qua).
          await pool.query(
            `UPDATE crm_schema.receipts
                SET finance_voucher_id = $3, finance_voucher_code = NULLIF($4, ''), voucher_error = NULL,
                    status = CASE WHEN status = 'PENDING_VOUCHER' THEN 'VOUCHER_DRAFT' ELSE status END,
                    revision = revision + 1, updated_at = now()
              WHERE id = $1 AND idempotency_key = $2`,
            [row.payload.receiptId, row.payload.request.idempotencyKey, state.voucherId, state.voucherCode],
          );
        } else if (row.operation === RECEIPT_VOUCHER_CANCEL_OPERATION && this.finance && row.payload?.receiptId) {
          // Chưa có phiếu (404) thì không còn gì để huỷ.
          await this.finance.cancelReceiptVoucher(tenantId, row.payload.receiptId, row.payload.reason ?? 'Lần thu đã huỷ bên Bán hàng.');
        } else if (row.operation === RESERVATION_RELEASE_OPERATION && row.payload?.reservationCode) {
          await this.inventory.release(tenantId, row.payload.reservationCode);
        } else {
          throw new CrmError('UNKNOWN_OPERATION', `Thao tác không hỗ trợ: ${row.operation}.`, 400);
        }
        await pool.query(
          `UPDATE crm_schema.integration_requests
              SET status = 'SUCCEEDED', lease_until = NULL, last_error = NULL, result = '{}'::jsonb, updated_at = now()
            WHERE id = $1`,
          [row.id],
        );
      } catch (error) {
        const message = (error instanceof Error ? error.message : 'Không gửi được lệnh.').slice(0, 2000);
        const permanent = error instanceof CrmError && error.statusCode >= 400 && error.statusCode < 500;
        await pool.query(
          `UPDATE crm_schema.integration_requests
              SET status = 'FAILED', last_error = $2,
                  lease_until = CASE WHEN $3 THEN now() + interval '100 years'
                                     ELSE now() + make_interval(secs => LEAST(attempts * 30, 1800)) END,
                  updated_at = now()
            WHERE id = $1`,
          [row.id, message, permanent],
        );
        if (permanent && row.operation === RECEIPT_VOUCHER_OPERATION && row.payload?.receiptId && row.payload.request) {
          // Tài chính từ chối dữ liệu: hiện lý do trên lần thu để người thu sửa hoặc huỷ.
          await pool.query(
            `UPDATE crm_schema.receipts SET voucher_error = $3, revision = revision + 1, updated_at = now()
              WHERE id = $1 AND idempotency_key = $2`,
            [row.payload.receiptId, row.payload.request.idempotencyKey, message],
          );
        }
      }
    }
    return claimed.rows.length;
  }
}
