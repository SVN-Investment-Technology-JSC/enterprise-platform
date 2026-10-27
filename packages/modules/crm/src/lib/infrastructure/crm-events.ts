import type { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { UnknownOrderBalanceReader, type InventoryClient, type OrderBalanceReader } from '../application/fulfillment.port.js';
import { vietnamToday } from '../application/pricing.service.js';
import { CrmDatabase } from './crm.database.js';
import { HttpInventoryClient } from './http-inventory-client.js';
import { HttpProcedureClient } from './http-procedure-client.js';
import { PostgresIntegrationRequests } from './integration-requests.js';
import {
  applyReservationExpired,
  applyStockIssued,
  INVENTORY_RESERVATION_EXPIRED,
  INVENTORY_STOCK_ISSUED,
  type ReservationExpiredPayload,
  type StockIssuedPayload,
} from './inventory-events.js';
import { PostgresContractStore } from './postgres-contract.store.js';
import { PostgresQuoteStore } from './postgres-quote.store.js';
import { PostgresSalesOrderStore } from './postgres-sales-order.store.js';
import { notifyLateDeliveries } from '../application/delivery-late.job.js';
import { applyQuoteProcedureResult, PostgresApprovalLinks, type ProcedureCompletedPayload } from './quote-procedure-links.js';

/** Hàng đợi của Bán hàng trên exchange `enterprise.events` (`apps/worker/src/main.ts`). */
export const CRM_INTEGRATION_QUEUE = 'crm.integrations.v1';

/** Quy trình phát khi hồ sơ kết thúc (duyệt, từ chối, huỷ), phân biệt bằng `status`. */
export const PROCEDURE_INSTANCE_COMPLETED = 'procedure.instance.completed';

/**
 * Loại sự kiện worker bind vào hàng đợi của Bán hàng: kết quả duyệt báo giá từ
 * Quy trình (T3-13); kết quả xuất kho của đợt giao và giữ hàng hết hạn từ Kho
 * (T4-12, T4-13). Các giai đoạn sau thêm sự kiện của Tài chính vào đây.
 */
export const CRM_INTEGRATION_BINDINGS: readonly string[] = [
  PROCEDURE_INSTANCE_COMPLETED,
  INVENTORY_STOCK_ISSUED,
  INVENTORY_RESERVATION_EXPIRED,
];

/**
 * Job hết hạn báo giá, hết hạn hợp đồng, báo giao trễ chạy mỗi phút; tạo phiên
 * Quy trình còn chờ và gửi lại lệnh sang Kho (nhả giữ hàng) mỗi 15 giây.
 */
const QUOTE_EXPIRY_INTERVAL_MS = 60_000;
const PROCEDURE_SYNC_INTERVAL_MS = 15_000;
/** Số bản ghi tối đa mỗi lượt của job theo ngày (lượt sau làm tiếp). */
const QUOTE_EXPIRY_BATCH = 200;

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
  options: { readonly balances?: OrderBalanceReader } = {},
): CrmEventHandler {
  const database = new CrmDatabase(references, pools);
  const balances = options.balances ?? new UnknownOrderBalanceReader();
  return {
    ready: (tenantId) => crmTablesReady(references, pools, tenantId),
    handle: async (tenantId, type, payload) => {
      if (type === PROCEDURE_INSTANCE_COMPLETED) {
        const event = (payload ?? {}) as ProcedureCompletedPayload;
        // Hồ sơ của phân hệ khác: bỏ qua nhanh, không mở transaction.
        if (event.sourceType !== 'crm_quote') return;
        if (!(await quoteTablesReady(database, tenantId))) return;
        await applyQuoteProcedureResult(database, tenantId, event);
        return;
      }
      if (type === INVENTORY_STOCK_ISSUED) {
        const event = (payload ?? {}) as StockIssuedPayload;
        // Chứng từ xuất không phải của đợt giao Bán hàng (xuất khác, bảo hành...): bỏ qua nhanh.
        if (event.sourceType !== 'crm_delivery') return;
        if (!(await salesTablesReady(database, tenantId))) return;
        await applyStockIssued(database, tenantId, event, balances);
        return;
      }
      if (type === INVENTORY_RESERVATION_EXPIRED) {
        const event = (payload ?? {}) as ReservationExpiredPayload;
        if (event.sourceType !== 'crm_order' && event.sourceType !== 'crm_contract') return;
        if (!(await salesTablesReady(database, tenantId))) return;
        await applyReservationExpired(database, tenantId, event);
      }
    },
  };
}

/**
 * Việc định kỳ của Bán hàng. Worker gọi mỗi tick (1 giây); module tự giãn nhịp:
 * - hết hạn báo giá (T3-11): báo giá Đã duyệt, Đã gửi khách quá hạn hiệu lực
 *   chuyển Hết hạn, nhật ký người làm là hệ thống, báo người phụ trách;
 * - tạo phiên Quy trình cho liên kết duyệt còn chờ hoặc lỗi tạm (T3-12);
 * - hết hạn hợp đồng (mục 5.3) và báo giao trễ một lần mỗi đợt (T4-14);
 * - gửi lại lệnh sang Kho đang chờ hoặc lỗi tạm (nhả giữ hàng khi huỷ).
 */
export function createCrmJobs(
  references: TenantDatabaseRegistry,
  pools: PostgresPoolRegistry,
  options: { readonly now?: () => Date; readonly procedures?: HttpProcedureClient; readonly inventory?: InventoryClient } = {},
): CrmJobs {
  const database = new CrmDatabase(references, pools);
  const quotes = new PostgresQuoteStore(database);
  const contracts = new PostgresContractStore(database);
  const orders = new PostgresSalesOrderStore(database, new UnknownOrderBalanceReader());
  const links = new PostgresApprovalLinks(database, options.procedures ?? new HttpProcedureClient());
  const requests = new PostgresIntegrationRequests(database, options.inventory ?? new HttpInventoryClient());
  const now = options.now ?? (() => new Date());
  const lastRun = new Map<string, { expiry: number; sync: number }>();
  return {
    ready: (tenantId) => crmTablesReady(references, pools, tenantId),
    run: async (tenantId) => {
      const at = now().getTime();
      const last = lastRun.get(tenantId) ?? { expiry: 0, sync: 0 };
      const dueExpiry = at - last.expiry >= QUOTE_EXPIRY_INTERVAL_MS;
      const dueSync = at - last.sync >= PROCEDURE_SYNC_INTERVAL_MS;
      if (!dueExpiry && !dueSync) return;
      if (!(await quoteTablesReady(database, tenantId))) return;
      // Đặt mốc trước khi chạy để một lần lỗi không làm tick gọi lại liên tục.
      lastRun.set(tenantId, { expiry: dueExpiry ? at : last.expiry, sync: dueSync ? at : last.sync });
      const today = vietnamToday(now());
      if (dueExpiry) await quotes.expireDue(tenantId, today, QUOTE_EXPIRY_BATCH);
      if (dueSync) await links.sync(tenantId);
      if (!(await salesTablesReady(database, tenantId))) return;
      if (dueExpiry) {
        // Hợp đồng quá ngày kết thúc (mục 5.3), đợt giao quá ngày dự kiến chưa xuất (T4-14).
        await contracts.expireDue(tenantId, today, QUOTE_EXPIRY_BATCH);
        await notifyLateDeliveries(orders, tenantId, today, QUOTE_EXPIRY_BATCH);
      }
      if (dueSync) await requests.dispatch(tenantId);
    },
  };
}

/** Migration đơn bán (0008) đã chạy chưa. */
async function salesTablesReady(database: CrmDatabase, tenantId: string): Promise<boolean> {
  const pool = await database.pool(tenantId);
  const result = await pool.query<{ ready: boolean }>(
    `SELECT to_regclass('crm_schema.delivery_issue_documents') IS NOT NULL AS ready`,
  );
  return result.rows[0]?.ready === true;
}

/** Migration báo giá (0006) đã chạy chưa. */
async function quoteTablesReady(database: CrmDatabase, tenantId: string): Promise<boolean> {
  const pool = await database.pool(tenantId);
  const result = await pool.query<{ ready: boolean }>(
    `SELECT to_regclass('crm_schema.procedure_links') IS NOT NULL AS ready`,
  );
  return result.rows[0]?.ready === true;
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
