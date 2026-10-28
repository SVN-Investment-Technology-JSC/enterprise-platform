import { CreditApprovalService, CreditLimitService } from '../application/credit-limit.service.js';
import type { CrmDataScope } from '../application/data-scope.js';
import type { InventoryClient } from '../application/fulfillment.port.js';
import { CRM_ORDER_CREDIT_SOURCE_TYPE, type FinanceClient } from '../application/receivable-store.port.js';
import { SalesOrderService } from '../application/sales-order.service.js';
import type { CrmDatabase } from './crm.database.js';
import {
  applyFinanceVoucherEvent,
  FINANCE_VOUCHER_POSTED,
  FINANCE_VOUCHER_RETURNED,
  FINANCE_VOUCHER_STATUS_CHANGED,
  isCrmVoucherEvent,
  type FinanceVoucherEventPayload,
} from './finance-events.js';
import { HttpInventoryCatalogReader } from './http-inventory-catalog-reader.js';
import type { HttpProcedureClient } from './http-procedure-client.js';
import { PostgresIntegrationRequests } from './integration-requests.js';
import { PostgresContractStore, PostgresSalesSettingsStore } from './postgres-contract.store.js';
import { applyOrderCreditProcedureResult, PostgresCreditStore } from './postgres-credit.store.js';
import { PostgresCustomerStore } from './postgres-customer.store.js';
import { PostgresPricingStore } from './postgres-pricing.store.js';
import { PostgresReceivableStore } from './postgres-receivable.store.js';
import { PostgresSalesOrderStore } from './postgres-sales-order.store.js';
import { PostgresApprovalLinks, type ProcedureCompletedPayload } from './quote-procedure-links.js';
import { recognizeDateTerms } from './receivable-recognition.js';

/** Sự kiện Tài chính Bán hàng bind thêm vào hàng đợi của mình (T5-07). */
export const CRM_RECEIVABLE_BINDINGS: readonly string[] = [
  FINANCE_VOUCHER_POSTED,
  FINANCE_VOUCHER_RETURNED,
  FINANCE_VOUCHER_STATUS_CHANGED,
];

const ALL: CrmDataScope = { kind: 'all' };
/** Số bản ghi tối đa mỗi lượt của job công nợ. */
const RECEIVABLE_JOB_BATCH = 200;

export interface ReceivableDependencies {
  readonly inventory: InventoryClient;
  readonly finance: FinanceClient;
  readonly procedures: HttpProcedureClient;
}

/** Migration công nợ (0009) đã chạy chưa. */
export async function receivableTablesReady(database: CrmDatabase, tenantId: string): Promise<boolean> {
  const pool = await database.pool(tenantId);
  const result = await pool.query<{ ready: boolean }>(`SELECT to_regclass('crm_schema.order_credit_requests') IS NOT NULL AS ready`);
  return result.rows[0]?.ready === true;
}

/**
 * Dịch vụ duyệt vượt hạn mức dựng ngoài Nest (worker): xác nhận đơn sau khi Quy
 * trình duyệt cần giữ hàng ở Kho như khi người dùng xác nhận.
 */
export function createCreditApprovals(database: CrmDatabase, deps: ReceivableDependencies): CreditApprovalService {
  const credit = new PostgresCreditStore(database);
  const receivables = new PostgresReceivableStore(database);
  const orders = new SalesOrderService(
    new PostgresSalesOrderStore(database, receivables),
    new PostgresContractStore(database),
    new PostgresCustomerStore(database),
    new PostgresPricingStore(database),
    new HttpInventoryCatalogReader(),
    { resolve: async () => ALL },
    deps.inventory,
    new PostgresSalesSettingsStore(database),
    new CreditLimitService(credit, new PostgresApprovalLinks(database, deps.procedures)),
    new PostgresIntegrationRequests(database, deps.inventory, deps.finance),
  );
  return new CreditApprovalService(credit, orders);
}

/**
 * Sự kiện công nợ: phiếu thu Tài chính (posted, returned, status-changed
 * REVERSED, lọc `sourceModule = crm`) và kết quả duyệt vượt hạn mức trên Quy
 * trình (`crm_order_credit`). Trả `false` khi sự kiện không thuộc phần này.
 */
export async function handleReceivableEvent(
  database: CrmDatabase,
  approvals: () => CreditApprovalService,
  tenantId: string,
  type: string,
  payload: unknown,
): Promise<boolean> {
  if (CRM_RECEIVABLE_BINDINGS.includes(type)) {
    const event = (payload ?? {}) as FinanceVoucherEventPayload;
    // Phiếu của nguồn khác (Quy trình, phiếu thường): bỏ qua nhanh, không mở transaction.
    if (!isCrmVoucherEvent(type, event)) return true;
    if (!(await receivableTablesReady(database, tenantId))) return true;
    await applyFinanceVoucherEvent(database, tenantId, type, event);
    return true;
  }
  const procedure = (payload ?? {}) as ProcedureCompletedPayload;
  if (procedure.sourceType === CRM_ORDER_CREDIT_SOURCE_TYPE) {
    if (!(await receivableTablesReady(database, tenantId))) return true;
    const outcome = await applyOrderCreditProcedureResult(database, tenantId, procedure);
    // Duyệt xong mới giữ hàng; lỗi hạ tầng ném ra (job thử lại yêu cầu đã duyệt mà đơn chưa xác nhận).
    if (outcome !== 'ignored' && outcome.approved) await approvals().confirmApproved(tenantId, outcome.orderId, null);
    return true;
  }
  return false;
}

/**
 * Việc định kỳ của công nợ (mỗi phút): đợt "theo ngày" của hợp đồng tới ngày
 * (T5-05), cảnh báo quá hạn và vượt hạn mức (T5-09), giữ hàng lại cho đơn đã
 * được duyệt vượt hạn mức mà lần trước lỗi hạ tầng, chuyển yêu cầu có phiên
 * Quy trình lỗi vĩnh viễn sang duyệt trực tiếp (T5-17).
 */
export async function runReceivableJobs(
  database: CrmDatabase,
  approvals: () => CreditApprovalService,
  tenantId: string,
  today: string,
): Promise<void> {
  if (!(await receivableTablesReady(database, tenantId))) return;
  await database.transaction(tenantId, (client) => recognizeDateTerms(client, today, RECEIVABLE_JOB_BATCH));
  await new PostgresReceivableStore(database).notifyAlerts(tenantId, today, RECEIVABLE_JOB_BATCH);
  await approvals().retryApproved(tenantId, 20);
  await approvals().redirectFailedProcedures(tenantId, 20);
}
