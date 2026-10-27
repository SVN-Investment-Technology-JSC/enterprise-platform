import type { IntegrationDispatcher, InventoryClient } from '../application/fulfillment.port.js';
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

/**
 * Gửi lệnh đã xếp sang Kho. Giành lease ngắn để hai tiến trình (API vừa huỷ
 * đơn, worker) không cùng gửi; thành công thì SUCCEEDED; lỗi hạ tầng thì
 * FAILED và thử lại khi hết lease; Kho từ chối dữ liệu (4xx) thì FAILED không
 * thử lại.
 */
export class PostgresIntegrationRequests implements IntegrationDispatcher {
  constructor(
    private readonly database: CrmDatabase,
    private readonly inventory: InventoryClient,
  ) {}

  async dispatch(tenantId: string, limit = 20): Promise<number> {
    const pool = await this.database.pool(tenantId);
    const claimed = await pool.query<{ id: string; operation: string; payload: { reservationCode?: string } }>(
      `UPDATE crm_schema.integration_requests r
          SET status = 'PROCESSING', attempts = attempts + 1, lease_until = now() + ($1 || ' seconds')::interval,
              updated_at = now()
        WHERE r.id IN (
          SELECT id FROM crm_schema.integration_requests
           WHERE status IN ('PENDING', 'FAILED', 'PROCESSING') AND attempts < $2
             AND (lease_until IS NULL OR lease_until < now())
           ORDER BY created_at
           LIMIT $3
           FOR UPDATE SKIP LOCKED)
        RETURNING r.id, r.operation, r.payload`,
      [String(LEASE_SECONDS), INTEGRATION_MAX_ATTEMPTS, limit],
    );
    for (const row of claimed.rows) {
      try {
        if (row.operation !== RESERVATION_RELEASE_OPERATION || !row.payload?.reservationCode) {
          throw new CrmError('UNKNOWN_OPERATION', `Thao tác không hỗ trợ: ${row.operation}.`, 400);
        }
        await this.inventory.release(tenantId, row.payload.reservationCode);
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
      }
    }
    return claimed.rows.length;
  }
}
