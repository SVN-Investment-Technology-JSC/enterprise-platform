import type {
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
} from '@enterprise-platform/adapter-database';
import { MaintenanceApplication } from './application/maintenance.application.js';
import { PostgresMaintenanceStore } from './infrastructure/postgres-maintenance-store.js';

/** Việc định kỳ của Bảo trì cho worker; mỗi tenant gọi riêng, worker tự kiểm phân hệ đã bật. */
export interface MaintenanceJobs {
  /** DB tenant đã chạy migration 0009 (cột đếm lần gửi sang Quy trình). */
  ready(tenantId: string): Promise<boolean>;
  /**
   * Sinh phiếu đến hạn rồi gửi lại các phiếu kẹt ở 'dispatch_pending'. Hai bước độc lập: bước đầu lỗi vẫn chạy bước
   * sau. Chạy lặp an toàn (khoá advisory và idempotencyKey).
   */
  run(tenantId: string): Promise<{ readonly generated: number; readonly recovered: number }>;
}

export function createMaintenanceJobs(
  references: TenantDatabaseRegistry,
  pools: PostgresPoolRegistry,
): MaintenanceJobs {
  const store = new PostgresMaintenanceStore(references, pools);
  const app = new MaintenanceApplication(store);
  return {
    ready: async (tenantId) => {
      const pool = await pools.forTenant(references.require(tenantId));
      const result = await pool.query<{ ready: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'maintenance_schema' AND table_name = 'occurrences'
              AND column_name = 'dispatch_attempted_at'
         ) AS ready`,
      );
      return result.rows[0]?.ready === true;
    },
    run: async (tenantId) => {
      let generated = 0;
      let recovered = 0;
      const errors: unknown[] = [];
      try {
        generated = await app.generateDueOccurrences(tenantId);
      } catch (error) {
        errors.push(error);
      }
      try {
        recovered = await app.reconcileStuckDispatches(tenantId);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) throw errors[0];
      return { generated, recovered };
    },
  };
}
