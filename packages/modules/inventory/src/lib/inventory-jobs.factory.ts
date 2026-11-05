import type {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
} from '@enterprise-platform/adapter-database';
import type { Reservation } from '@enterprise-platform/contracts-inventory';
import { ReservationExpiryJob } from './application/reservation-expiry.job.js';
import { PostgresInventoryStore } from './infrastructure/postgres-inventory-store.js';

/** Việc định kỳ của Kho cho worker; mỗi tenant gọi riêng, worker tự kiểm phân hệ đã bật. */
export interface InventoryJobs {
  /** DB tenant đã chạy migration 0012 (cột nguồn của giữ hàng). */
  ready(tenantId: string): Promise<boolean>;
  /** Nhả giữ hàng hết hạn, trả các giữ hàng vừa chuyển EXPIRED. */
  expireReservations(tenantId: string): Promise<Reservation[]>;
}

export function createInventoryJobs(
  references: TenantDatabaseRegistry,
  pools: PostgresPoolRegistry,
): InventoryJobs {
  const expiry = new ReservationExpiryJob(new PostgresInventoryStore(references, pools));
  return {
    ready: async (tenantId) => {
      const pool = await pools.forTenant(references.require(tenantId));
      const result = await pool.query<{ ready: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'inventory_schema' AND table_name = 'reservations'
              AND column_name = 'source_type'
         ) AS ready`,
      );
      return result.rows[0]?.ready === true;
    },
    expireReservations: (tenantId) => expiry.run(tenantId),
  };
}
