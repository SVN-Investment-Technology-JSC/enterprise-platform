import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { DirectoryService } from './application/directory.service.js';
import { FinanceService } from './application/finance.service.js';
import { WorkspaceProcedureEvents } from './application/procedure-link-events.js';
import { ProjectService } from './application/project.service.js';
import { WorkItemService } from './application/work-item.service.js';
import { HttpOrganizationDirectory } from './infrastructure/http-organization-directory.js';
import { PostgresWorkspaceStore } from './infrastructure/postgres-workspace-store.js';

/** Bộ xử lý sự kiện liên kết mà worker chạy cho một module. */
export interface LinkEventHandler {
  /** Bảng của module đã có ở tenant này chưa (migration đã chạy). */
  ready(tenantId: string): Promise<boolean>;
  handle(tenantId: string, type: string, payload: unknown): Promise<void>;
}

/**
 * Dựng bộ xử lý sự kiện Quy trình ngoài Nest (worker), cùng cách
 * `WorkspaceModule` nối các service, dùng chung registry DB của worker.
 * Worker chỉ gọi qua đây, không tự đọc bảng nào của Workspace.
 */
export function createWorkspaceProcedureEvents(
  references: TenantDatabaseRegistry,
  pools: PostgresPoolRegistry,
): LinkEventHandler {
  const store = new PostgresWorkspaceStore(references, pools);
  const projects = new ProjectService(store, new DirectoryService(new HttpOrganizationDirectory()));
  const events = new WorkspaceProcedureEvents(
    store,
    new WorkItemService(store, projects),
    new FinanceService(store, projects),
  );
  return {
    ready: async (tenantId) => {
      const pool = await pools.forTenant(references.require(tenantId));
      const result = await pool.query<{ relation: string | null }>(
        `SELECT to_regclass('workspace_schema.work_item_procedure_requests')::text AS relation`,
      );
      return Boolean(result.rows[0]?.relation);
    },
    handle: (tenantId, type, payload) => events.handle(tenantId, type, payload),
  };
}
