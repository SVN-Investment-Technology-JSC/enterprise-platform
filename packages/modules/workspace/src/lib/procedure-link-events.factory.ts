import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { DirectoryService } from './application/directory.service.js';
import { FinanceService } from './application/finance.service.js';
import { WorkspaceProcedureEvents } from './application/procedure-link-events.js';
import { ProjectService } from './application/project.service.js';
import { WorkItemService } from './application/work-item.service.js';
import { HttpOrganizationDirectory } from './infrastructure/http-organization-directory.js';
import { PostgresWorkspaceStore } from './infrastructure/postgres-workspace-store.js';

/**
 * Dựng bộ xử lý sự kiện Quy trình ngoài Nest (worker), cùng cách
 * `WorkspaceModule` nối các service, dùng chung registry DB của worker.
 */
export function createWorkspaceProcedureEvents(
  references: TenantDatabaseRegistry,
  pools: PostgresPoolRegistry,
): WorkspaceProcedureEvents {
  const store = new PostgresWorkspaceStore(references, pools);
  const projects = new ProjectService(store, new DirectoryService(new HttpOrganizationDirectory()));
  return new WorkspaceProcedureEvents(
    store,
    new WorkItemService(store, projects),
    new FinanceService(store, projects),
  );
}
