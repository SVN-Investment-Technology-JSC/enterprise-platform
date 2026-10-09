import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { ProcedureEngineApplication } from './application/procedure-engine.application.js';
import { ProcedureWorkspaceEvents } from './application/workspace-link-events.js';
import { HttpDirectManagerResolver } from './infrastructure/http-direct-manager.resolver.js';
import { HttpInitiatorActorResolver } from './infrastructure/http-initiator-actor.resolver.js';
import { HttpInventoryTaskTemplateResolver } from './infrastructure/http-inventory-task-template.resolver.js';
import { PostgresProcedureStore } from './infrastructure/postgres-procedure-store.js';
import {
  SystemProcedureClock,
  UuidProcedureIdGenerator,
} from './infrastructure/system-procedure-services.js';

/**
 * Dựng bộ xử lý sự kiện Workspace ngoài Nest (worker), cùng cách
 * `ProcedureEngineModule` nối ứng dụng, dùng chung registry DB của worker.
 */
export function createProcedureWorkspaceEvents(
  references: TenantDatabaseRegistry,
  pools: PostgresPoolRegistry,
): ProcedureWorkspaceEvents {
  const store = new PostgresProcedureStore(references, pools);
  const procedures = new ProcedureEngineApplication(
    store,
    new SystemProcedureClock(),
    new UuidProcedureIdGenerator(),
    new HttpInventoryTaskTemplateResolver(),
    undefined,
    new HttpDirectManagerResolver(),
    new HttpInitiatorActorResolver(),
  );
  return new ProcedureWorkspaceEvents(procedures, (tenantId, input) =>
    store.emitIntegrationEvent(tenantId, input),
  );
}
