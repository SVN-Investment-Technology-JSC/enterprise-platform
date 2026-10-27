import type { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';

/** Hàng đợi của Bán hàng trên exchange `enterprise.events` (`apps/worker/src/main.ts`). */
export const CRM_INTEGRATION_QUEUE = 'crm.integrations.v1';

/**
 * Loại sự kiện worker bind vào hàng đợi của Bán hàng. GĐ0 chưa nghe sự kiện
 * nào; các giai đoạn sau thêm sự kiện của Kho, Tài chính, Quy trình vào đây
 * (hằng số khai trong contracts của bên phát, không gõ lại chuỗi).
 */
export const CRM_INTEGRATION_BINDINGS: readonly string[] = [];

/** Cùng hình dạng với bộ xử lý của Workspace, Mạng nội bộ để worker dùng chung `handleLinkEvent`. */
export interface CrmEventHandler {
  /** Bảng của phân hệ đã có ở tenant này chưa (migration đã chạy). */
  ready(tenantId: string): Promise<boolean>;
  handle(tenantId: string, type: string, payload: unknown): Promise<void>;
}

/** Việc định kỳ của Bán hàng chạy trong tick của worker. */
export interface CrmJobs {
  ready(tenantId: string): Promise<boolean>;
  /** Chạy các việc đến hạn của một tenant; phải chịu được chạy lại (idempotent). */
  run(tenantId: string): Promise<void>;
}

/**
 * Dựng bộ xử lý sự kiện của Bán hàng ngoài Nest (worker), dùng chung registry
 * DB của worker. Worker bọc mỗi lời gọi `handle` trong `IdempotentInbox` nên
 * sự kiện nhận trùng không chạy lại; handler vẫn phải kiểm trạng thái đích
 * trước khi ghi. Loại sự kiện chưa biết thì bỏ qua (ack).
 */
export function createCrmIntegrationEvents(
  references: TenantDatabaseRegistry,
  pools: PostgresPoolRegistry,
): CrmEventHandler {
  return {
    ready: (tenantId) => crmTablesReady(references, pools, tenantId),
    handle: async () => {
      // GĐ0 chưa bind sự kiện nào; các giai đoạn sau rẽ nhánh theo `type` ở đây.
    },
  };
}

/**
 * Việc định kỳ của Bán hàng (nhả giữ hàng quá hạn, hết hạn báo giá, đợt thanh
 * toán đến hạn — từ GĐ1). GĐ0 chỉ có khung để worker gọi.
 */
export function createCrmJobs(references: TenantDatabaseRegistry, pools: PostgresPoolRegistry): CrmJobs {
  return {
    ready: (tenantId) => crmTablesReady(references, pools, tenantId),
    run: async () => {
      // Chưa có việc nào ở GĐ0.
    },
  };
}

async function crmTablesReady(
  references: TenantDatabaseRegistry,
  pools: PostgresPoolRegistry,
  tenantId: string,
): Promise<boolean> {
  const pool = await pools.forTenant(references.require(tenantId));
  const result = await pool.query<{ ready: boolean }>(
    `SELECT to_regclass('crm_schema.integration_requests') IS NOT NULL AS ready`,
  );
  return result.rows[0]?.ready === true;
}
