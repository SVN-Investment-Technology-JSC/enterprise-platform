import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { ProcedureEngineApplication } from './application/procedure-engine.application.js';
import { PROCEDURE_FINANCE_EVENT_TYPES, ProcedureFinanceEvents } from './application/finance-step-events.js';
import { PROCEDURE_INVENTORY_EVENT_TYPES, ProcedureInventoryEvents } from './application/inventory-issue-events.js';
import { ProcedureWorkspaceEvents } from './application/workspace-link-events.js';
import { HttpDirectManagerResolver } from './infrastructure/http-direct-manager.resolver.js';
import { HttpInitiatorActorResolver } from './infrastructure/http-initiator-actor.resolver.js';
import { HttpInstanceReversalGuard } from './infrastructure/http-instance-reversal.guard.js';
import { HttpInventoryTaskTemplateResolver } from './infrastructure/http-inventory-task-template.resolver.js';
import { PostgresProcedureStore } from './infrastructure/postgres-procedure-store.js';
import {
  SystemProcedureClock,
  UuidProcedureIdGenerator,
} from './infrastructure/system-procedure-services.js';

/**
 * Dựng bộ xử lý sự kiện tích hợp của Quy trình ngoài Nest (worker), cùng cách
 * `ProcedureEngineModule` nối ứng dụng, dùng chung registry DB của worker.
 * Một hàng đợi `procedure.integrations.v1` nhận sự kiện của Workspace, kết quả
 * bước Tài chính (`finance.voucher.*`) và chứng từ xuất của Kho (`inventory.stock.issued`);
 * hai consumer trên một hàng đợi sẽ chia sự kiện cho nhau nên phân luồng ở đây.
 */
export function createProcedureWorkspaceEvents(
  references: TenantDatabaseRegistry,
  pools: PostgresPoolRegistry,
): {
  ready(tenantId: string): Promise<boolean>;
  handle(tenantId: string, type: string, payload: unknown): Promise<void>;
} {
  const store = new PostgresProcedureStore(references, pools);
  const procedures = new ProcedureEngineApplication(
    store,
    new SystemProcedureClock(),
    new UuidProcedureIdGenerator(),
    new HttpInventoryTaskTemplateResolver(),
    undefined,
    new HttpDirectManagerResolver(),
    new HttpInitiatorActorResolver(),
    new HttpInstanceReversalGuard(),
  );
  const events = new ProcedureWorkspaceEvents(procedures, (tenantId, input) =>
    store.emitIntegrationEvent(tenantId, input),
  );
  const finance = new ProcedureFinanceEvents(procedures);
  const financeTypes: readonly string[] = PROCEDURE_FINANCE_EVENT_TYPES;
  const inventory = new ProcedureInventoryEvents(procedures);
  const inventoryTypes: readonly string[] = PROCEDURE_INVENTORY_EVENT_TYPES;
  // Worker chỉ gọi qua đây, không tự đọc bảng nào của Quy trình.
  return {
    ready: async (tenantId) => {
      const pool = await pools.forTenant(references.require(tenantId));
      const result = await pool.query<{ relation: string | null }>(
        `SELECT to_regclass('procedure_schema.runtime_state')::text AS relation`,
      );
      return Boolean(result.rows[0]?.relation);
    },
    handle: (tenantId, type, payload) => {
      if (financeTypes.includes(type)) return finance.handle(tenantId, type, payload);
      if (inventoryTypes.includes(type)) return inventory.handle(tenantId, type, payload);
      return events.handle(tenantId, type, payload);
    },
  };
}
