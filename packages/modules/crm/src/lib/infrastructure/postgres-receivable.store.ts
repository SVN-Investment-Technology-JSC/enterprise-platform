import { randomUUID } from 'node:crypto';
import {
  CRM_CUSTOMER_CREDIT_EXCEEDED,
  CRM_RECEIVABLE_OVERDUE,
  receivableDeepLink,
  type AdjustmentDirection,
  type AdjustmentStatus,
  type CrmCustomerCreditExceededPayload,
  type CrmPage,
  type CrmReceivableOverduePayload,
  type CustomerAgingRow,
  type CustomerLedger,
  type ReceiptAllocation,
  type ReceiptDetail,
  type ReceiptMethod,
  type ReceiptStatus,
  type ReceiptSummary,
  type ReceivableAdjustment,
  type ReceivableEntry,
  type ReceivableEntryKind,
  type ReceivableOpenItem,
  type ReceivableSettings,
} from '@enterprise-platform/contracts-crm';
import type { CrmDataScope } from '../application/data-scope.js';
import { CRM_WARRANTY_SOURCE_TYPE, WARRANTY_AUDIT_ENTITY } from '../application/warranty.port.js';
import type { BalanceQueryRunner, OrderBalanceReader } from '../application/fulfillment.port.js';
import type {
  AdjustmentFilter,
  AgingFilter,
  NewAdjustmentRecord,
  NewReceiptRecord,
  ReceiptChanges,
  ReceiptFilter,
  ReceivableStore,
} from '../application/receivable-store.port.js';
import { CrmConflictError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid } from '../domain/fields.js';
import { roundVnd } from '../domain/pricing-engine.js';
import {
  addDays,
  agingBucket,
  allocateInOrder,
  assertAllocatable,
  daysOverdue,
  formatAdjustmentCode,
  formatReceiptCode,
  formatVnd,
  receiptIdempotencyKey,
  summarizeAging,
  type AllocatableItem,
  type AllocationInput,
} from '../domain/receivables.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { writeCrmOutbox } from './crm-outbox.js';
import { enqueueReceiptVoucher, enqueueReceiptVoucherCancel, RECEIPT_VOUCHER_OPERATION } from './integration-requests.js';
import { CREDIT_LIMIT_SETTING_KEY, parseCreditLimitMode } from './postgres-credit.store.js';
import { readHistory } from './postgres-contract.store.js';
import { lockOrder, setStatus } from './postgres-sales-order.store.js';
import { insertReceivableEntry, RECOGNITION_SETTING_KEY, recognizeTermManually } from './receivable-recognition.js';
import { SqlConditions, cursorAt, keysetPage, prefixPattern, prefixTsQuery, toDateOnly, toIso } from './sql-helpers.js';

/** Thực thể ghi `audit_log`. */
export const RECEIPT_AUDIT_ENTITY = 'receipt';
export const ADJUSTMENT_AUDIT_ENTITY = 'receivable_adjustment';
export const RECEIVABLE_ALERTS_SETTING_KEY = 'receivable.alerts';

/** Lần thu còn "giữ chỗ" trên khoản nợ (chưa ghi sổ, chưa huỷ). */
export const HOLDING_RECEIPT_STATUSES = ['PENDING_VOUCHER', 'VOUCHER_DRAFT', 'RETURNED'] as const;

const num = (value: string | number | null | undefined): number => Number(value ?? 0);
const AGING_LIMIT_MAX = 500;

const STALE_RECEIPT = () =>
  new CrmConflictError('STALE_VERSION', 'Lần thu vừa được cập nhật. Vui lòng tải lại rồi thao tác lại.');
const STALE_ADJUSTMENT = () =>
  new CrmConflictError('STALE_VERSION', 'Điều chỉnh vừa được cập nhật. Vui lòng tải lại rồi thao tác lại.');

interface EntryRow {
  id: string;
  kind: ReceivableEntryKind;
  customer_id: string;
  order_id: string | null;
  order_code: string | null;
  contract_id: string | null;
  contract_code: string | null;
  receipt_id: string | null;
  receipt_code: string | null;
  adjustment_id: string | null;
  adjustment_code: string | null;
  amount: string;
  entry_date: string;
  due_date: string | null;
  ref_entry_id: string | null;
  reverses_entry_id: string | null;
  source_type: string;
  description: string | null;
  created_at: Date;
  created_by: string | null;
}

interface OpenItemRow {
  id: string;
  kind: ReceivableEntryKind;
  customer_id: string;
  order_id: string | null;
  order_code: string | null;
  contract_id: string | null;
  contract_code: string | null;
  description: string | null;
  entry_date: string;
  due_date: string | null;
  amount: string;
  open_amount: string;
  pending_amount: string;
}

interface ReceiptRow {
  id: string;
  code: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  amount: string;
  allocated_amount: string;
  method: ReceiptMethod;
  receipt_date: string;
  status: ReceiptStatus;
  finance_voucher_id: string | null;
  finance_voucher_code: string | null;
  note: string | null;
  voucher_error: string | null;
  return_reason: string | null;
  posted_at: Date | null;
  reversed_at: Date | null;
  revision: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  cursor_at: string;
}

interface AdjustmentRow {
  id: string;
  code: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  order_id: string | null;
  order_code: string | null;
  entry_id: string | null;
  direction: AdjustmentDirection;
  amount: string;
  reason: string;
  status: AdjustmentStatus;
  source_type: string | null;
  source_id: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  cancel_reason: string | null;
  revision: number;
  created_by: string;
  created_at: Date;
  cursor_at: string;
}

const OPEN_ITEM_COLUMNS = `
  i.id, i.kind, i.customer_id, i.order_id, o.code AS order_code, i.contract_id, k.code AS contract_code, i.description,
  i.entry_date::text AS entry_date, i.due_date::text AS due_date, i.amount, i.open_amount,
  COALESCE((SELECT sum(a.amount) FROM crm_schema.receipt_allocations a
             JOIN crm_schema.receipts r ON r.id = a.receipt_id
            WHERE a.entry_id = i.id AND r.status IN ('PENDING_VOUCHER', 'VOUCHER_DRAFT', 'RETURNED')), 0) AS pending_amount`;

const OPEN_ITEM_FROM = `
  FROM crm_schema.receivable_open_items i
  LEFT JOIN crm_schema.sales_orders o ON o.id = i.order_id
  LEFT JOIN crm_schema.contracts k ON k.id = i.contract_id`;

const RECEIPT_COLUMNS = `
  r.id, r.code, r.customer_id, c.code AS customer_code, c.name AS customer_name, r.amount,
  COALESCE((SELECT sum(a.amount) FROM crm_schema.receipt_allocations a WHERE a.receipt_id = r.id), 0) AS allocated_amount,
  r.method, r.receipt_date::text AS receipt_date, r.status, r.finance_voucher_id, r.finance_voucher_code, r.note,
  r.voucher_error, r.return_reason, r.posted_at, r.reversed_at, r.revision, r.created_by, r.created_at, r.updated_at,
  ${cursorAt('r.created_at')} AS cursor_at`;

const ADJUSTMENT_COLUMNS = `
  d.id, d.code, d.customer_id, c.code AS customer_code, c.name AS customer_name, d.order_id, o.code AS order_code, d.entry_id,
  d.direction, d.amount, d.reason, d.status, d.source_type, d.source_id, d.approved_by, d.approved_at, d.cancel_reason,
  d.revision, d.created_by, d.created_at, ${cursorAt('d.created_at')} AS cursor_at`;

/**
 * Sổ công nợ, lần thu, phân bổ, điều chỉnh (T5-03 đến T5-11). Đọc lọc theo
 * người phụ trách khách hàng. Ghi khoá khoản nợ `FOR UPDATE` trước khi tính số
 * còn phân bổ được, nên hai lần thu cùng lúc vào một khoản không bao giờ vượt số
 * còn nợ (TC-CONC-09). Sổ chỉ ghi thêm: không có hàm sửa, xoá dòng sổ.
 */
export class PostgresReceivableStore implements ReceivableStore, OrderBalanceReader {
  constructor(private readonly database: CrmDatabase) {}

  // -------------------------------------------------------------------------
  // Đọc
  // -------------------------------------------------------------------------

  async outstanding(tenantId: string, orderId: string, within?: BalanceQueryRunner): Promise<number | 'unknown'> {
    const runner: BalanceQueryRunner = within ?? (await this.database.pool(tenantId));
    const ready = await runner.query<{ ready: boolean }>(`SELECT to_regclass('crm_schema.receivable_entries') IS NOT NULL AS ready`);
    if (ready.rows[0]?.ready !== true) return 'unknown';
    const result = await runner.query<{ outstanding: string }>(
      `SELECT COALESCE(sum(amount), 0) AS outstanding FROM crm_schema.receivable_entries WHERE order_id = $1`,
      [orderId],
    );
    return roundVnd(num(result.rows[0]?.outstanding));
  }

  async agingReport(tenantId: string, scope: CrmDataScope, filter: AgingFilter): Promise<CrmPage<CustomerAgingRow>> {
    const where = new SqlConditions();
    const today = where.param(filter.today);
    where.scope(scope, 'c.owner_user_id');
    where.add(`EXISTS (SELECT 1 FROM crm_schema.receivable_entries x WHERE x.customer_id = c.id)`);
    if (filter.ownerUserId) where.add(`c.owner_user_id = ${where.param(filter.ownerUserId)}::uuid`);
    if (filter.q) {
      const tsQuery = prefixTsQuery(filter.q);
      const code = `lower(c.code) LIKE ${where.param(prefixPattern(filter.q.toLowerCase()))}`;
      where.add(
        tsQuery
          ? `(${code} OR to_tsvector('simple'::regconfig, c.name) @@ to_tsquery('simple'::regconfig, ${where.param(tsQuery)}))`
          : code,
      );
    }
    const limit = Math.min(Math.max(filter.limit, 1), AGING_LIMIT_MAX);
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<{
      id: string;
      code: string;
      name: string;
      owner_user_id: string;
      credit_limit: string | null;
      payment_term_days: number | null;
      balance: string;
      not_due: string;
      d0_30: string;
      d31_60: string;
      d61_90: string;
      d90_plus: string;
    }>(
      `SELECT c.id, c.code, c.name, c.owner_user_id, c.credit_limit, c.payment_term_days,
              COALESCE(b.balance, 0) AS balance,
              COALESCE(a.not_due, 0) AS not_due, COALESCE(a.d0_30, 0) AS d0_30, COALESCE(a.d31_60, 0) AS d31_60,
              COALESCE(a.d61_90, 0) AS d61_90, COALESCE(a.d90_plus, 0) AS d90_plus
         FROM crm_schema.customers c
         LEFT JOIN crm_schema.receivable_customer_balances b ON b.customer_id = c.id
         LEFT JOIN LATERAL (
              SELECT sum(i.open_amount) FILTER (WHERE i.due_date IS NULL OR i.due_date > ${today}::date) AS not_due,
                     sum(i.open_amount) FILTER (WHERE ${today}::date - i.due_date BETWEEN 0 AND 30) AS d0_30,
                     sum(i.open_amount) FILTER (WHERE ${today}::date - i.due_date BETWEEN 31 AND 60) AS d31_60,
                     sum(i.open_amount) FILTER (WHERE ${today}::date - i.due_date BETWEEN 61 AND 90) AS d61_90,
                     sum(i.open_amount) FILTER (WHERE ${today}::date - i.due_date > 90) AS d90_plus
                FROM crm_schema.receivable_open_items i
               WHERE i.customer_id = c.id AND i.open_amount > 0
         ) a ON TRUE
         ${where.where()}
         ${filter.overdue ? `AND COALESCE(a.d0_30, 0) + COALESCE(a.d31_60, 0) + COALESCE(a.d61_90, 0) + COALESCE(a.d90_plus, 0) > 0` : ''}
        ORDER BY COALESCE(a.d90_plus, 0) + COALESCE(a.d61_90, 0) + COALESCE(a.d31_60, 0) + COALESCE(a.d0_30, 0) DESC,
                 COALESCE(b.balance, 0) DESC, c.code
        LIMIT ${where.param(limit)}`,
      where.params,
    );
    const items = result.rows.map((row): CustomerAgingRow => {
      const buckets = {
        NOT_DUE: num(row.not_due),
        D0_30: num(row.d0_30),
        D31_60: num(row.d31_60),
        D61_90: num(row.d61_90),
        D90_PLUS: num(row.d90_plus),
      };
      const creditLimit = row.credit_limit === null ? null : num(row.credit_limit);
      const balance = num(row.balance);
      return {
        customerId: row.id,
        customerCode: row.code,
        customerName: row.name,
        ownerUserId: row.owner_user_id,
        creditLimit,
        paymentTermDays: row.payment_term_days,
        balance,
        // Nhóm 0–30 gồm cả khoản đến hạn đúng hôm nay (chưa quá hạn).
        overdueAmount: roundVnd(buckets.D0_30 + buckets.D31_60 + buckets.D61_90 + buckets.D90_PLUS),
        buckets,
        creditExceeded: creditLimit !== null && balance > creditLimit,
      };
    });
    return { items, nextCursor: null };
  }

  async ledger(tenantId: string, scope: CrmDataScope, customerId: string, today: string): Promise<CustomerLedger | undefined> {
    const pool = await this.database.pool(tenantId);
    const where = new SqlConditions();
    where.add(`c.id = ${where.param(customerId)}::uuid`);
    where.scope(scope, 'c.owner_user_id');
    const customer = (
      await pool.query<{ id: string; code: string; name: string; owner_user_id: string; credit_limit: string | null; payment_term_days: number | null }>(
        `SELECT c.id, c.code, c.name, c.owner_user_id, c.credit_limit, c.payment_term_days FROM crm_schema.customers c ${where.where()}`,
        where.params,
      )
    ).rows[0];
    if (!customer) return undefined;
    const [items, entries, totals] = await Promise.all([
      pool.query<OpenItemRow>(
        `SELECT ${OPEN_ITEM_COLUMNS} ${OPEN_ITEM_FROM}
          WHERE i.customer_id = $1 AND i.open_amount <> 0
          ORDER BY i.due_date NULLS LAST, i.entry_date, i.id`,
        [customerId],
      ),
      pool.query<EntryRow>(
        `${ENTRY_SELECT} WHERE e.customer_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 500`,
        [customerId],
      ),
      pool.query<{ balance: string; unapplied: string }>(
        `SELECT COALESCE(sum(amount), 0) AS balance,
                COALESCE(-sum(amount) FILTER (WHERE ref_entry_id IS NULL AND kind IN ('CREDIT', 'REVERSAL')), 0) AS unapplied
           FROM crm_schema.receivable_entries WHERE customer_id = $1`,
        [customerId],
      ),
    ]);
    const openItems = items.rows.map((row) => toOpenItem(row, today));
    const aging = summarizeAging(openItems, today);
    const creditLimit = customer.credit_limit === null ? null : num(customer.credit_limit);
    const balance = num(totals.rows[0]?.balance);
    return {
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      ownerUserId: customer.owner_user_id,
      creditLimit,
      paymentTermDays: customer.payment_term_days,
      balance,
      overdueAmount: roundVnd(aging.buckets.D0_30 + aging.buckets.D31_60 + aging.buckets.D61_90 + aging.buckets.D90_PLUS),
      buckets: aging.buckets,
      creditExceeded: creditLimit !== null && balance > creditLimit,
      unappliedAmount: num(totals.rows[0]?.unapplied),
      openItems,
      entries: entries.rows.map(toEntry),
    };
  }

  async listReceipts(tenantId: string, scope: CrmDataScope, filter: ReceiptFilter): Promise<CrmPage<ReceiptSummary>> {
    const where = new SqlConditions();
    where.scope(scope, 'c.owner_user_id');
    if (filter.customerId) where.add(`r.customer_id = ${where.param(filter.customerId)}::uuid`);
    if (filter.status) where.add(`r.status = ${where.param(filter.status)}`);
    where.after(filter.cursor, 'r.created_at', 'r.id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<ReceiptRow>(
      `SELECT ${RECEIPT_COLUMNS} FROM crm_schema.receipts r JOIN crm_schema.customers c ON c.id = r.customer_id
        ${where.where()}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${where.param(filter.limit + 1)}`,
      where.params,
    );
    return keysetPage(result.rows, filter.limit, toReceiptSummary);
  }

  async getReceipt(tenantId: string, scope: CrmDataScope, id: string): Promise<ReceiptDetail | undefined> {
    const pool = await this.database.pool(tenantId);
    const where = new SqlConditions();
    where.add(`r.id = ${where.param(id)}::uuid`);
    where.scope(scope, 'c.owner_user_id');
    const row = (
      await pool.query<ReceiptRow>(
        `SELECT ${RECEIPT_COLUMNS} FROM crm_schema.receipts r JOIN crm_schema.customers c ON c.id = r.customer_id ${where.where()}`,
        where.params,
      )
    ).rows[0];
    if (!row) return undefined;
    const [allocations, history] = await Promise.all([
      pool.query<{
        id: string;
        entry_id: string;
        order_id: string | null;
        order_code: string | null;
        description: string | null;
        due_date: string | null;
        amount: string;
        credit_entry_id: string | null;
      }>(
        `SELECT a.id, a.entry_id, e.order_id, o.code AS order_code, e.description, e.due_date::text AS due_date, a.amount,
                a.credit_entry_id
           FROM crm_schema.receipt_allocations a
           JOIN crm_schema.receivable_entries e ON e.id = a.entry_id
           LEFT JOIN crm_schema.sales_orders o ON o.id = e.order_id
          WHERE a.receipt_id = $1
          ORDER BY e.due_date NULLS LAST, a.created_at`,
        [id],
      ),
      readHistory(pool, RECEIPT_AUDIT_ENTITY, id),
    ]);
    return {
      ...toReceiptSummary(row),
      note: row.note,
      voucherError: row.voucher_error,
      returnReason: row.return_reason,
      postedAt: toIso(row.posted_at),
      reversedAt: toIso(row.reversed_at),
      revision: row.revision,
      allocations: allocations.rows.map(
        (line): ReceiptAllocation => ({
          id: line.id,
          entryId: line.entry_id,
          orderId: line.order_id,
          orderCode: line.order_code,
          entryDescription: line.description,
          dueDate: toDateOnly(line.due_date),
          amount: num(line.amount),
          effective: row.status === 'POSTED' && !!line.credit_entry_id,
        }),
      ),
      history,
    };
  }

  async listAdjustments(tenantId: string, scope: CrmDataScope, filter: AdjustmentFilter): Promise<CrmPage<ReceivableAdjustment>> {
    const where = new SqlConditions();
    where.scope(scope, 'c.owner_user_id');
    if (filter.customerId) where.add(`d.customer_id = ${where.param(filter.customerId)}::uuid`);
    if (filter.status) where.add(`d.status = ${where.param(filter.status)}`);
    where.after(filter.cursor, 'd.created_at', 'd.id');
    const pool = await this.database.pool(tenantId);
    const result = await pool.query<AdjustmentRow>(
      `SELECT ${ADJUSTMENT_COLUMNS} ${ADJUSTMENT_FROM} ${where.where()}
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT ${where.param(filter.limit + 1)}`,
      where.params,
    );
    return keysetPage(result.rows, filter.limit, toAdjustment);
  }

  async getAdjustment(tenantId: string, scope: CrmDataScope, id: string): Promise<ReceivableAdjustment | undefined> {
    const pool = await this.database.pool(tenantId);
    const where = new SqlConditions();
    where.add(`d.id = ${where.param(id)}::uuid`);
    where.scope(scope, 'c.owner_user_id');
    const row = (await pool.query<AdjustmentRow>(`SELECT ${ADJUSTMENT_COLUMNS} ${ADJUSTMENT_FROM} ${where.where()}`, where.params)).rows[0];
    return row ? toAdjustment(row) : undefined;
  }

  async settings(tenantId: string): Promise<ReceivableSettings> {
    const pool = await this.database.pool(tenantId);
    const rows = (
      await pool.query<{ key: string; value: unknown }>(`SELECT key, value FROM crm_schema.settings WHERE key = ANY($1::varchar[])`, [
        [RECOGNITION_SETTING_KEY, CREDIT_LIMIT_SETTING_KEY, RECEIVABLE_ALERTS_SETTING_KEY],
      ])
    ).rows;
    const value = (key: string) => rows.find((row) => row.key === key)?.value;
    return {
      recognitionMode: 'ON_DELIVERY',
      creditLimitMode: parseCreditLimitMode(value(CREDIT_LIMIT_SETTING_KEY)),
      alertUserIds: alertUserIds(value(RECEIVABLE_ALERTS_SETTING_KEY)),
    };
  }

  saveSettings(tenantId: string, settings: ReceivableSettings, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const values: [string, unknown][] = [
        [RECOGNITION_SETTING_KEY, { mode: settings.recognitionMode }],
        [CREDIT_LIMIT_SETTING_KEY, { mode: settings.creditLimitMode }],
        [RECEIVABLE_ALERTS_SETTING_KEY, { userIds: settings.alertUserIds }],
      ];
      for (const [key, value] of values) {
        await client.query(
          `INSERT INTO crm_schema.settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, version = crm_schema.settings.version + 1, updated_at = now(), updated_by = EXCLUDED.updated_by`,
          [key, JSON.stringify(value), actorId],
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // Lần thu (T5-06)
  // -------------------------------------------------------------------------

  createReceipt(tenantId: string, record: NewReceiptRecord, actorId: string): Promise<string> {
    return this.database.transaction(tenantId, async (client) => {
      const customer = (
        await client.query<{ code: string; name: string }>(`SELECT code, name FROM crm_schema.customers WHERE id = $1`, [record.customerId])
      ).rows[0];
      if (!customer) throw new CrmNotFoundError('Không tìm thấy khách hàng.');
      await lockAllocatable(client, record.allocations, record.customerId, null);
      const id = randomUUID();
      const code = await nextCode(client, 'crm_schema.receipt_code_seq', formatReceiptCode);
      const key = receiptIdempotencyKey(id, 1);
      await client.query(
        `INSERT INTO crm_schema.receipts
           (id, code, customer_id, amount, method, receipt_date, note, idempotency_key, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [id, code, record.customerId, record.amount, record.method, record.receiptDate, record.note, key, actorId],
      );
      await insertAllocations(client, id, record.allocations);
      await enqueueReceiptVoucher(client, id, voucherRequest(id, code, key, customer, record, actorId));
      await writeAuditLog(client, {
        entityType: RECEIPT_AUDIT_ENTITY,
        entityId: id,
        toStatus: 'PENDING_VOUCHER',
        action: 'create',
        actorId,
        metadata: { code, customerId: record.customerId, amount: record.amount, allocations: record.allocations.length },
      });
      return id;
    });
  }

  resendReceipt(tenantId: string, id: string, revision: number, changes: ReceiptChanges, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const receipt = await lockReceipt(client, id, revision);
      const resendable = receipt.status === 'RETURNED' || (receipt.status === 'PENDING_VOUCHER' && !!receipt.voucher_error);
      if (!resendable) {
        throw new CrmConflictError('RECEIPT_NOT_RESENDABLE', 'Chỉ sửa và gửi lại được lần thu bị Tài chính trả lại hoặc từ chối.');
      }
      const customer = (
        await client.query<{ code: string; name: string }>(`SELECT code, name FROM crm_schema.customers WHERE id = $1`, [receipt.customer_id])
      ).rows[0];
      await client.query(`DELETE FROM crm_schema.receipt_allocations WHERE receipt_id = $1`, [id]);
      await lockAllocatable(client, changes.allocations, receipt.customer_id, id);
      await insertAllocations(client, id, changes.allocations);
      const attempt = receipt.voucher_attempt + 1;
      const key = receiptIdempotencyKey(id, attempt);
      await stopVoucherRequest(client, receipt.idempotency_key);
      await client.query(
        `UPDATE crm_schema.receipts
            SET amount = $2, method = $3, receipt_date = $4, note = $5, status = 'PENDING_VOUCHER', voucher_attempt = $6,
                idempotency_key = $7, voucher_error = NULL, revision = revision + 1, updated_at = now(), updated_by = $8
          WHERE id = $1`,
        [id, changes.amount, changes.method, changes.receiptDate, changes.note, attempt, key, actorId],
      );
      await enqueueReceiptVoucher(client, id, voucherRequest(id, receipt.code, key, customer, changes, actorId));
      await writeAuditLog(client, {
        entityType: RECEIPT_AUDIT_ENTITY,
        entityId: id,
        fromStatus: receipt.status,
        toStatus: 'PENDING_VOUCHER',
        action: 'resend',
        actorId,
        metadata: { code: receipt.code, amount: changes.amount, attempt },
      });
    });
  }

  cancelReceipt(tenantId: string, id: string, revision: number, reason: string, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const receipt = await lockReceipt(client, id, revision);
      const cancellable = receipt.status === 'RETURNED' || (receipt.status === 'PENDING_VOUCHER' && !!receipt.voucher_error);
      if (!cancellable) {
        throw new CrmConflictError(
          'RECEIPT_NOT_CANCELLABLE',
          'Chỉ huỷ được lần thu bị Tài chính trả lại hoặc từ chối; phiếu đã ghi sổ thì Tài chính đảo phiếu.',
        );
      }
      await stopVoucherRequest(client, receipt.idempotency_key);
      // Phiếu nháp bên Tài chính (lần thu bị trả lại) huỷ theo qua lệnh gửi sau commit (T5-15).
      if (receipt.status === 'RETURNED' || receipt.finance_voucher_id) await enqueueReceiptVoucherCancel(client, id, reason);
      await client.query(
        `UPDATE crm_schema.receipts SET status = 'CANCELLED', revision = revision + 1, updated_at = now(), updated_by = $2 WHERE id = $1`,
        [id, actorId],
      );
      await writeAuditLog(client, {
        entityType: RECEIPT_AUDIT_ENTITY,
        entityId: id,
        fromStatus: receipt.status,
        toStatus: 'CANCELLED',
        action: 'cancel',
        actorId,
        reason,
        metadata: { code: receipt.code, financeVoucherCode: receipt.finance_voucher_code },
      });
    });
  }

  async entryCustomer(tenantId: string, entryId: string): Promise<string | undefined> {
    const pool = await this.database.pool(tenantId);
    return (await pool.query<{ customer_id: string }>(`SELECT customer_id FROM crm_schema.receivable_entries WHERE id = $1`, [entryId])).rows[0]
      ?.customer_id;
  }

  applyCredit(
    tenantId: string,
    creditEntryId: string,
    allocations: readonly AllocationInput[],
    actorId: string,
    today: string,
  ): Promise<{ customerId: string }> {
    return this.database.transaction(tenantId, async (client) => {
      const credit = (
        await client.query<{ id: string; kind: string; customer_id: string; receipt_id: string | null; ref_entry_id: string | null; amount: string }>(
          `SELECT id, kind, customer_id, receipt_id, ref_entry_id, amount FROM crm_schema.receivable_entries WHERE id = $1`,
          [creditEntryId],
        )
      ).rows[0];
      if (!credit) throw new CrmNotFoundError('Không tìm thấy khoản tiền thu chưa phân bổ.');
      if (credit.kind !== 'CREDIT' || credit.ref_entry_id) {
        throw new CrmConflictError('CREDIT_NOT_UNAPPLIED', 'Dòng sổ này không phải tiền thu chưa phân bổ.');
      }
      // Khoá dòng trả trước cùng các khoản nợ theo thứ tự id (cùng thứ tự với lần thu, điều chỉnh).
      await lockEntries(client, [credit.id, ...allocations.map((line) => line.entryId)]);
      const used = (
        await client.query<{ used: string }>(
          `SELECT COALESCE(sum(amount), 0) AS used FROM crm_schema.receivable_entries WHERE reverses_entry_id = $1`,
          [credit.id],
        )
      ).rows[0];
      const remaining = roundVnd(-(num(credit.amount) + num(used?.used)));
      const total = roundVnd(allocations.reduce((sum, line) => sum + line.amount, 0));
      if (total > remaining) {
        throw new CrmValidationError(
          'CREDIT_EXCEEDS_UNAPPLIED',
          `Tổng phân bổ vượt số tiền trả trước còn lại (còn ${formatVnd(Math.max(remaining, 0))} đ).`,
          { remaining: Math.max(remaining, 0) },
        );
      }
      await lockAllocatable(client, allocations, credit.customer_id, null);
      const targets = new Map(
        (
          await client.query<{ id: string; order_id: string | null; contract_id: string | null; payment_term_id: string | null }>(
            `SELECT id, order_id, contract_id, payment_term_id FROM crm_schema.receivable_entries WHERE id = ANY($1::uuid[])`,
            [allocations.map((line) => line.entryId)],
          )
        ).rows.map((row) => [row.id, row]),
      );
      const applicationId = randomUUID();
      const orders = new Set<string>();
      for (const [index, line] of allocations.entries()) {
        const target = targets.get(line.entryId);
        const key = `${applicationId}:${index + 1}`;
        // Phần trả trước giảm đi (bút đảo một phần dòng CREDIT chưa phân bổ), cùng số đó ghi CREDIT vào khoản nợ.
        await insertReceivableEntry(client, {
          kind: 'REVERSAL',
          customerId: credit.customer_id,
          receiptId: credit.receipt_id,
          amount: line.amount,
          entryDate: today,
          reversesEntryId: credit.id,
          sourceType: 'credit_application_release',
          sourceId: key,
          description: 'Chuyển tiền trả trước sang khoản nợ',
          createdBy: actorId,
        });
        await insertReceivableEntry(client, {
          kind: 'CREDIT',
          customerId: credit.customer_id,
          orderId: target?.order_id ?? null,
          contractId: target?.contract_id ?? null,
          paymentTermId: target?.payment_term_id ?? null,
          receiptId: credit.receipt_id,
          amount: -line.amount,
          entryDate: today,
          refEntryId: line.entryId,
          sourceType: 'credit_application',
          sourceId: key,
          description: 'Phân bổ tiền trả trước',
          createdBy: actorId,
        });
        if (target?.order_id) orders.add(target.order_id);
      }
      // Đợt thanh toán của hợp đồng đã thu đủ.
      await client.query(
        `UPDATE crm_schema.contract_payment_terms t SET status = 'PAID', updated_at = now()
          WHERE t.status = 'DUE' AND t.id = ANY($1::uuid[])
            AND EXISTS (SELECT 1 FROM crm_schema.receivable_open_items i WHERE i.payment_term_id = t.id AND i.open_amount <= 0)`,
        [[...targets.values()].map((row) => row.payment_term_id).filter((id): id is string => !!id)],
      );
      if (credit.receipt_id) {
        await writeAuditLog(client, {
          entityType: RECEIPT_AUDIT_ENTITY,
          entityId: credit.receipt_id,
          action: 'apply-credit',
          actorId,
          metadata: { creditEntryId: credit.id, amount: total, allocations: allocations.length, remaining: roundVnd(remaining - total) },
        });
      }
      await completeSettledOrders(client, [...orders], actorId);
      return { customerId: credit.customer_id };
    });
  }

  // -------------------------------------------------------------------------
  // Điều chỉnh (T5-08)
  // -------------------------------------------------------------------------

  createAdjustment(tenantId: string, record: NewAdjustmentRecord, actorId: string): Promise<{ id: string; created: boolean }> {
    return this.database.transaction(tenantId, async (client) => {
      if (record.sourceType && record.sourceId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM crm_schema.receivable_adjustments WHERE source_type = $1 AND source_id = $2`,
          [record.sourceType, record.sourceId],
        );
        if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
      }
      const customer = (await client.query(`SELECT 1 FROM crm_schema.customers WHERE id = $1`, [record.customerId])).rows[0];
      if (!customer) throw new CrmNotFoundError('Không tìm thấy khách hàng.');
      if (record.orderId) {
        const order = await client.query(`SELECT 1 FROM crm_schema.sales_orders WHERE id = $1 AND customer_id = $2`, [
          record.orderId,
          record.customerId,
        ]);
        if (!order.rows.length) throw new CrmValidationError('ORDER_MISMATCH', 'Đơn bán không thuộc khách hàng này.');
      }
      if (record.entryId) {
        const entry = await client.query(
          `SELECT 1 FROM crm_schema.receivable_open_items WHERE id = $1 AND customer_id = $2`,
          [record.entryId, record.customerId],
        );
        if (!entry.rows.length) throw new CrmValidationError('ENTRY_NOT_OPEN', 'Khoản nợ được chọn không thuộc khách hàng này.');
      }
      const code = await nextCode(client, 'crm_schema.receivable_adjustment_code_seq', formatAdjustmentCode);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO crm_schema.receivable_adjustments
           (code, customer_id, order_id, entry_id, direction, amount, reason, source_type, source_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         ON CONFLICT (source_type, source_id) WHERE source_type IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          code,
          record.customerId,
          record.orderId,
          record.entryId,
          record.direction,
          record.amount,
          record.reason,
          record.sourceType,
          record.sourceId,
          actorId,
        ],
      );
      const id = inserted.rows[0]?.id;
      if (!id) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM crm_schema.receivable_adjustments WHERE source_type = $1 AND source_id = $2`,
          [record.sourceType, record.sourceId],
        );
        return { id: existing.rows[0].id, created: false };
      }
      await writeAuditLog(client, {
        entityType: ADJUSTMENT_AUDIT_ENTITY,
        entityId: id,
        toStatus: 'DRAFT',
        action: 'create',
        actorId,
        reason: record.reason,
        metadata: { code, customerId: record.customerId, direction: record.direction, amount: record.amount, sourceType: record.sourceType },
      });
      return { id, created: true };
    });
  }

  approveAdjustment(tenantId: string, id: string, revision: number, actorId: string, today: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const adjustment = await lockAdjustment(client, id, revision);
      const touchedOrders = new Set<string>();
      if (adjustment.direction === 'DECREASE') {
        const targets = (
          await client.query<{ id: string; order_id: string | null; contract_id: string | null; open_amount: string }>(
            `SELECT i.id, i.order_id, i.contract_id, i.open_amount
               FROM crm_schema.receivable_open_items i
              WHERE i.customer_id = $1 AND i.open_amount > 0
                AND ($2::uuid IS NULL OR i.id = $2) AND ($3::uuid IS NULL OR i.order_id = $3)
              ORDER BY i.due_date NULLS LAST, i.entry_date, i.id`,
            [adjustment.customer_id, adjustment.entry_id, adjustment.order_id],
          )
        ).rows;
        await lockEntries(client, targets.map((row) => row.id));
        const pending = await pendingByEntry(client, targets.map((row) => row.id), null);
        const fresh = await openAmounts(client, targets.map((row) => row.id));
        const items = targets.map((row) => ({
          ...row,
          available: roundVnd((fresh.get(row.id) ?? 0) - (pending.get(row.id) ?? 0)),
        }));
        const amount = num(adjustment.amount);
        const { parts, remainder } = allocateInOrder(items, amount);
        if (remainder > 0) {
          const available = roundVnd(items.reduce((sum, item) => sum + Math.max(item.available, 0), 0));
          throw new CrmConflictError(
            'ADJUSTMENT_EXCEEDS_OPEN',
            `Số giảm trừ ${formatVnd(amount)} đ vượt số còn nợ có thể giảm (${formatVnd(available)} đ).`,
          );
        }
        for (const [index, part] of parts.entries()) {
          await insertReceivableEntry(client, {
            kind: 'ADJUSTMENT',
            customerId: adjustment.customer_id,
            orderId: part.item.order_id,
            contractId: part.item.contract_id,
            adjustmentId: id,
            amount: -part.amount,
            entryDate: today,
            refEntryId: part.item.id,
            sourceType: 'adjustment',
            sourceId: `${id}:${index + 1}`,
            description: `Điều chỉnh ${adjustment.code}: ${adjustment.reason}`,
            createdBy: actorId,
          });
          if (part.item.order_id) touchedOrders.add(part.item.order_id);
        }
      } else {
        const customer = (
          await client.query<{ payment_term_days: number | null }>(`SELECT payment_term_days FROM crm_schema.customers WHERE id = $1`, [
            adjustment.customer_id,
          ])
        ).rows[0];
        await insertReceivableEntry(client, {
          kind: 'ADJUSTMENT',
          customerId: adjustment.customer_id,
          orderId: adjustment.order_id,
          adjustmentId: id,
          amount: num(adjustment.amount),
          entryDate: today,
          dueDate: addDays(today, customer?.payment_term_days ?? 0),
          sourceType: 'adjustment',
          sourceId: `${id}:1`,
          description: `Điều chỉnh ${adjustment.code}: ${adjustment.reason}`,
          createdBy: actorId,
        });
      }
      await client.query(
        `UPDATE crm_schema.receivable_adjustments
            SET status = 'APPROVED', approved_by = $2, approved_at = now(), revision = revision + 1, updated_at = now(), updated_by = $2
          WHERE id = $1`,
        [id, actorId],
      );
      await writeAuditLog(client, {
        entityType: ADJUSTMENT_AUDIT_ENTITY,
        entityId: id,
        fromStatus: 'DRAFT',
        toStatus: 'APPROVED',
        action: 'approve',
        actorId,
        reason: adjustment.reason,
        metadata: { code: adjustment.code, direction: adjustment.direction, amount: num(adjustment.amount) },
      });
      if (adjustment.source_type === CRM_WARRANTY_SOURCE_TYPE) await markWarrantyCreditPosted(client, id, adjustment.code, actorId);
      await completeSettledOrders(client, [...touchedOrders], actorId);
    });
  }

  cancelAdjustment(tenantId: string, id: string, revision: number, reason: string, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const adjustment = await lockAdjustment(client, id, revision);
      await client.query(
        `UPDATE crm_schema.receivable_adjustments
            SET status = 'CANCELLED', cancel_reason = $2, revision = revision + 1, updated_at = now(), updated_by = $3
          WHERE id = $1`,
        [id, reason, actorId],
      );
      await writeAuditLog(client, {
        entityType: ADJUSTMENT_AUDIT_ENTITY,
        entityId: id,
        fromStatus: 'DRAFT',
        toStatus: 'CANCELLED',
        action: 'cancel',
        actorId,
        reason,
        metadata: { code: adjustment.code },
      });
    });
  }

  // -------------------------------------------------------------------------
  // Đợt thanh toán (T5-05)
  // -------------------------------------------------------------------------

  triggerPaymentTerm(tenantId: string, contractId: string, termId: string, date: string, actorId: string): Promise<void> {
    return this.database.transaction(tenantId, async (client) => {
      const contract = (
        await client.query<{ status: string }>(`SELECT status FROM crm_schema.contracts WHERE id = $1 FOR UPDATE`, [contractId])
      ).rows[0];
      if (!contract) throw new CrmNotFoundError('Không tìm thấy hợp đồng.');
      if (contract.status !== 'ACTIVE' && contract.status !== 'COMPLETED') {
        throw new CrmConflictError('CONTRACT_NOT_ACTIVE', 'Chỉ ghi nhận đợt thanh toán của hợp đồng đang hiệu lực.');
      }
      const outcome = await recognizeTermManually(client, contractId, termId, date, actorId);
      if (outcome === 'not-found') throw new CrmNotFoundError('Không tìm thấy đợt thanh toán.');
      if (outcome === 'invalid-condition') {
        throw new CrmConflictError('TERM_CONDITION', 'Chỉ ghi nhận bằng tay đợt điều kiện nghiệm thu, giao hàng hoặc giao đủ hàng.');
      }
      if (outcome === 'not-pending') throw new CrmConflictError('TERM_NOT_PENDING', 'Đợt thanh toán đã đến hạn hoặc đã thu.');
      await client.query(`UPDATE crm_schema.contracts SET revision = revision + 1, updated_at = now(), updated_by = $2 WHERE id = $1`, [
        contractId,
        actorId,
      ]);
    });
  }

  // -------------------------------------------------------------------------
  // Cảnh báo (T5-09)
  // -------------------------------------------------------------------------

  /**
   * Job: báo khoản quá hạn (mỗi khoản một lần cho mỗi hạn) và khách vượt hạn mức
   * (mỗi đợt vượt một lần) tới người phụ trách khách, người phụ trách đơn và người
   * nhận cấu hình (kế toán công nợ). Trả số thông báo đã xếp.
   */
  notifyAlerts(tenantId: string, today: string, limit: number): Promise<number> {
    return this.database.transaction(tenantId, async (client) => {
      const setting = await client.query<{ value: unknown }>(`SELECT value FROM crm_schema.settings WHERE key = $1`, [
        RECEIVABLE_ALERTS_SETTING_KEY,
      ]);
      const extra = alertUserIds(setting.rows[0]?.value);
      let sent = 0;
      const overdue = (
        await client.query<{
          id: string;
          customer_id: string;
          customer_code: string;
          customer_name: string;
          customer_owner: string;
          order_id: string | null;
          order_code: string | null;
          order_owner: string | null;
          due_date: string;
          open_amount: string;
        }>(
          `SELECT i.id, i.customer_id, c.code AS customer_code, c.name AS customer_name, c.owner_user_id AS customer_owner,
                  i.order_id, o.code AS order_code, o.owner_user_id AS order_owner, i.due_date::text AS due_date, i.open_amount
             FROM crm_schema.receivable_open_items i
             JOIN crm_schema.customers c ON c.id = i.customer_id
             LEFT JOIN crm_schema.sales_orders o ON o.id = i.order_id
            WHERE i.open_amount > 0 AND i.due_date < $1::date
              AND NOT EXISTS (SELECT 1 FROM crm_schema.receivable_alerts a WHERE a.alert_key = 'overdue:' || i.id || ':' || i.due_date)
            ORDER BY i.due_date, i.id
            LIMIT $2`,
          [today, limit],
        )
      ).rows;
      for (const row of overdue) {
        const claimed = await client.query(
          `INSERT INTO crm_schema.receivable_alerts (alert_key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING alert_key`,
          [`overdue:${row.id}:${row.due_date}`],
        );
        if (!claimed.rows.length) continue;
        const days = daysOverdue(row.due_date, today) ?? 0;
        const amount = num(row.open_amount);
        const payload: CrmReceivableOverduePayload = {
          customerId: row.customer_id,
          customerCode: row.customer_code,
          entryId: row.id,
          orderId: row.order_id,
          orderCode: row.order_code,
          dueDate: row.due_date,
          openAmount: amount,
          daysOverdue: days,
          actorUserId: null,
          recipientUserIds: unique([row.customer_owner, row.order_owner, ...extra]),
          summary:
            `Khách ${row.customer_code} - ${row.customer_name} còn nợ ${formatVnd(amount)} đ` +
            `${row.order_code ? ` của đơn ${row.order_code}` : ''}, quá hạn ${days} ngày (hạn ${row.due_date.split('-').reverse().join('/')}).`,
          deepLink: receivableDeepLink(row.customer_id),
        };
        await writeCrmOutbox(client, tenantId, { type: CRM_RECEIVABLE_OVERDUE, aggregateType: 'crm-receivable', aggregateId: row.id, payload });
        sent += 1;
      }
      // Hết vượt hạn mức thì xoá mốc để lần vượt sau báo lại.
      await client.query(
        `DELETE FROM crm_schema.receivable_alerts a
          WHERE a.alert_key LIKE 'credit:%'
            AND NOT EXISTS (
              SELECT 1 FROM crm_schema.customers c
                JOIN crm_schema.receivable_customer_balances b ON b.customer_id = c.id
               WHERE a.alert_key = 'credit:' || c.id AND c.credit_limit IS NOT NULL AND b.balance > c.credit_limit)`,
      );
      const exceeded = (
        await client.query<{ id: string; code: string; name: string; owner_user_id: string; credit_limit: string; balance: string }>(
          `SELECT c.id, c.code, c.name, c.owner_user_id, c.credit_limit, b.balance
             FROM crm_schema.customers c
             JOIN crm_schema.receivable_customer_balances b ON b.customer_id = c.id
            WHERE c.credit_limit IS NOT NULL AND b.balance > c.credit_limit
              AND NOT EXISTS (SELECT 1 FROM crm_schema.receivable_alerts a WHERE a.alert_key = 'credit:' || c.id)
            ORDER BY b.balance - c.credit_limit DESC
            LIMIT $1`,
          [limit],
        )
      ).rows;
      for (const row of exceeded) {
        const claimed = await client.query(
          `INSERT INTO crm_schema.receivable_alerts (alert_key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING alert_key`,
          [`credit:${row.id}`],
        );
        if (!claimed.rows.length) continue;
        const balance = num(row.balance);
        const creditLimit = num(row.credit_limit);
        const payload: CrmCustomerCreditExceededPayload = {
          customerId: row.id,
          customerCode: row.code,
          balance,
          creditLimit,
          actorUserId: null,
          recipientUserIds: unique([row.owner_user_id, ...extra]),
          summary: `Khách ${row.code} - ${row.name} có dư nợ ${formatVnd(balance)} đ, vượt hạn mức ${formatVnd(creditLimit)} đ.`,
          deepLink: receivableDeepLink(row.id),
        };
        await writeCrmOutbox(client, tenantId, {
          type: CRM_CUSTOMER_CREDIT_EXCEEDED,
          aggregateType: 'crm-customer',
          aggregateId: row.id,
          payload,
        });
        sent += 1;
      }
      return sent;
    });
  }
}

// ---------------------------------------------------------------------------
// Ghi trong transaction của bên gọi
// ---------------------------------------------------------------------------

/**
 * Đơn Đã giao đủ mà số còn phải thu về 0 (thu đủ, điều chỉnh): tự Hoàn tất (Q8).
 * Gọi trong transaction vừa ghi sổ.
 */
export async function completeSettledOrders(client: CrmSqlClient, orderIds: readonly string[], actorId: string | null): Promise<void> {
  for (const orderId of [...new Set(orderIds)].sort()) {
    const locked = await lockOrder(client, orderId, null);
    if (locked.status !== 'DELIVERED') continue;
    const balance = await client.query<{ outstanding: string }>(
      `SELECT COALESCE(sum(amount), 0) AS outstanding FROM crm_schema.receivable_entries WHERE order_id = $1`,
      [orderId],
    );
    if (roundVnd(num(balance.rows[0]?.outstanding)) !== 0) continue;
    await setStatus(client, orderId, 'DELIVERED', 'DONE', 'auto-complete', actorId, 'Đã giao đủ và còn phải thu bằng 0', { code: locked.code });
    await client.query(`UPDATE crm_schema.sales_orders SET revision = revision + 1, updated_at = now() WHERE id = $1`, [orderId]);
  }
}

const ENTRY_SELECT = `
  SELECT e.id, e.kind, e.customer_id, e.order_id, o.code AS order_code, e.contract_id, k.code AS contract_code, e.receipt_id,
         r.code AS receipt_code, e.adjustment_id, d.code AS adjustment_code, e.amount, e.entry_date::text AS entry_date,
         e.due_date::text AS due_date, e.ref_entry_id, e.reverses_entry_id, e.source_type, e.description, e.created_at, e.created_by
    FROM crm_schema.receivable_entries e
    LEFT JOIN crm_schema.sales_orders o ON o.id = e.order_id
    LEFT JOIN crm_schema.contracts k ON k.id = e.contract_id
    LEFT JOIN crm_schema.receipts r ON r.id = e.receipt_id
    LEFT JOIN crm_schema.receivable_adjustments d ON d.id = e.adjustment_id`;

const ADJUSTMENT_FROM = `
  FROM crm_schema.receivable_adjustments d
  JOIN crm_schema.customers c ON c.id = d.customer_id
  LEFT JOIN crm_schema.sales_orders o ON o.id = d.order_id`;

async function nextCode(client: CrmSqlClient, sequence: string, format: (year: number, seq: number) => string): Promise<string> {
  const result = await client.query<{ seq: string; year: number }>(
    `SELECT nextval('${sequence}') AS seq, extract(year FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS year`,
  );
  return format(result.rows[0].year, Number(result.rows[0].seq));
}

/** Khoá các dòng sổ theo thứ tự id (tránh deadlock khi hai lần thu khoá chéo). */
async function lockEntries(client: CrmSqlClient, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  await client.query(`SELECT id FROM crm_schema.receivable_entries WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [[...ids]]);
}

/** Phần lần thu chưa ghi sổ đang giữ chỗ trên từng khoản (trừ lần thu `except`). */
async function pendingByEntry(client: CrmSqlClient, ids: readonly string[], except: string | null): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const result = await client.query<{ entry_id: string; amount: string }>(
    `SELECT a.entry_id, sum(a.amount) AS amount
       FROM crm_schema.receipt_allocations a
       JOIN crm_schema.receipts r ON r.id = a.receipt_id
      WHERE a.entry_id = ANY($1::uuid[]) AND r.status = ANY($2::varchar[]) AND ($3::uuid IS NULL OR r.id <> $3)
      GROUP BY a.entry_id`,
    [[...ids], [...HOLDING_RECEIPT_STATUSES], except],
  );
  return new Map(result.rows.map((row) => [row.entry_id, num(row.amount)]));
}

/** Số còn nợ hiện tại (sau khi đã khoá) của các khoản. */
async function openAmounts(client: CrmSqlClient, ids: readonly string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const result = await client.query<{ id: string; open_amount: string }>(
    `SELECT id, open_amount FROM crm_schema.receivable_open_items WHERE id = ANY($1::uuid[])`,
    [[...ids]],
  );
  return new Map(result.rows.map((row) => [row.id, num(row.open_amount)]));
}

/**
 * Khoá khoản nợ được phân bổ rồi kiểm: đúng khách, là khoản nợ (không phải dòng
 * thu, điều chỉnh giảm), số phân bổ không vượt số còn nợ trừ phần lần thu khác
 * đang giữ chỗ (TC-AR-04, TC-CONC-09).
 */
async function lockAllocatable(
  client: CrmSqlClient,
  allocations: readonly AllocationInput[],
  customerId: string,
  except: string | null,
): Promise<void> {
  if (!allocations.length) return;
  const ids = allocations.map((line) => line.entryId);
  await lockEntries(client, ids);
  const rows = (
    await client.query<{ id: string; customer_id: string; open_amount: string; order_code: string | null; due_date: string | null }>(
      `SELECT i.id, i.customer_id, i.open_amount, o.code AS order_code, i.due_date::text AS due_date
         FROM crm_schema.receivable_open_items i
         LEFT JOIN crm_schema.sales_orders o ON o.id = i.order_id
        WHERE i.id = ANY($1::uuid[])`,
      [ids],
    )
  ).rows;
  const pending = await pendingByEntry(client, ids, except);
  const items = new Map<string, AllocatableItem>(
    rows.map((row) => [
      row.id,
      {
        entryId: row.id,
        customerId: row.customer_id,
        label: row.order_code ? `khoản nợ của đơn ${row.order_code}` : `khoản nợ hạn ${row.due_date ?? 'không xác định'}`,
        allocatable: roundVnd(num(row.open_amount) - (pending.get(row.id) ?? 0)),
      },
    ]),
  );
  assertAllocatable(allocations, items, customerId);
}

async function insertAllocations(client: CrmSqlClient, receiptId: string, allocations: readonly AllocationInput[]): Promise<void> {
  for (const line of allocations) {
    await client.query(`INSERT INTO crm_schema.receipt_allocations (receipt_id, entry_id, amount) VALUES ($1, $2, $3)`, [
      receiptId,
      line.entryId,
      line.amount,
    ]);
  }
}

/** Lệnh tạo phiếu của lần gửi cũ không gửi nữa (đã gửi lại bằng khoá mới, hoặc huỷ lần thu). */
async function stopVoucherRequest(client: CrmSqlClient, key: string): Promise<void> {
  await client.query(
    `UPDATE crm_schema.integration_requests
        SET status = 'FAILED', lease_until = now() + interval '100 years', last_error = 'Lần thu đã gửi lại hoặc đã huỷ.', updated_at = now()
      WHERE idempotency_key = $1 AND operation = $2 AND status <> 'SUCCEEDED'`,
    [key, RECEIPT_VOUCHER_OPERATION],
  );
}

function voucherRequest(
  receiptId: string,
  code: string,
  key: string,
  customer: { code: string; name: string },
  record: { amount: number; receiptDate: string; note: string | null; actorName: string },
  actorId: string,
) {
  return {
    idempotencyKey: key,
    sourceRef: receiptId,
    sourceCode: code,
    amount: record.amount,
    content: `Thu tiền khách hàng ${customer.code} - ${customer.name} (lần thu ${code})`.slice(0, 500),
    counterpartyName: customer.name.slice(0, 255),
    voucherDate: record.receiptDate,
    initiatedBy: actorId,
    initiatedByName: record.actorName.slice(0, 255),
    ...(record.note ? { description: record.note.slice(0, 500) } : {}),
  };
}

interface LockedReceipt {
  code: string;
  customer_id: string;
  status: ReceiptStatus;
  revision: number;
  idempotency_key: string;
  voucher_attempt: number;
  voucher_error: string | null;
  finance_voucher_id: string | null;
  finance_voucher_code: string | null;
}

async function lockReceipt(client: CrmSqlClient, id: string, revision: number): Promise<LockedReceipt> {
  const row = (
    await client.query<LockedReceipt>(
      `SELECT code, customer_id, status, revision, idempotency_key, voucher_attempt, voucher_error, finance_voucher_id, finance_voucher_code
         FROM crm_schema.receipts WHERE id = $1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
  if (!row || row.revision !== revision) throw STALE_RECEIPT();
  return row;
}

interface LockedAdjustment {
  code: string;
  customer_id: string;
  order_id: string | null;
  entry_id: string | null;
  direction: AdjustmentDirection;
  amount: string;
  reason: string;
  status: AdjustmentStatus;
  revision: number;
  source_type: string | null;
  source_id: string | null;
}

/**
 * Điều chỉnh giảm trừ của dòng bảo hành vừa được duyệt (T6-12): chứng từ giảm
 * trừ, hoàn tiền của dòng chuyển Đã ghi sổ ngay trong transaction duyệt, ghi
 * nhật ký yêu cầu bảo hành; không phải bấm "Gửi lại chứng từ".
 */
async function markWarrantyCreditPosted(client: CrmSqlClient, adjustmentId: string, code: string, actorId: string): Promise<void> {
  const posted = await client.query<{ case_id: string; kind: string }>(
    `UPDATE crm_schema.warranty_documents
        SET status = 'POSTED', posted_at = now(), last_error = NULL, updated_at = now()
      WHERE document_id = $1 AND kind IN ('CREDIT', 'REFUND') AND status IN ('PENDING_RECEIVABLE', 'PENDING')
      RETURNING case_id, kind`,
    [adjustmentId],
  );
  for (const row of posted.rows) {
    await writeAuditLog(client, {
      entityType: WARRANTY_AUDIT_ENTITY,
      entityId: row.case_id,
      action: 'credit-posted',
      actorId,
      reason: `Điều chỉnh công nợ ${code} đã được duyệt`,
      metadata: { kind: row.kind, documentCode: code },
    });
  }
}

async function lockAdjustment(client: CrmSqlClient, id: string, revision: number): Promise<LockedAdjustment> {
  const row = (
    await client.query<LockedAdjustment>(
      `SELECT code, customer_id, order_id, entry_id, direction, amount, reason, status, revision, source_type, source_id
         FROM crm_schema.receivable_adjustments WHERE id = $1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
  if (!row || row.revision !== revision) throw STALE_ADJUSTMENT();
  if (row.status !== 'DRAFT') throw new CrmConflictError('ADJUSTMENT_NOT_DRAFT', 'Điều chỉnh đã được duyệt hoặc đã huỷ.');
  return row;
}

function alertUserIds(value: unknown): string[] {
  const raw = (value as { userIds?: unknown } | null | undefined)?.userIds;
  return Array.isArray(raw) ? unique(raw.filter((id): id is string => isUuid(id))).slice(0, 50) : [];
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

function toOpenItem(row: OpenItemRow, today: string): ReceivableOpenItem {
  const openAmount = num(row.open_amount);
  const pendingAmount = num(row.pending_amount);
  const dueDate = toDateOnly(row.due_date);
  const overdue = daysOverdue(dueDate, today);
  return {
    entryId: row.id,
    kind: row.kind,
    customerId: row.customer_id,
    orderId: row.order_id,
    orderCode: row.order_code,
    contractId: row.contract_id,
    contractCode: row.contract_code,
    description: row.description,
    entryDate: toDateOnly(row.entry_date) ?? '',
    dueDate,
    amount: num(row.amount),
    openAmount,
    pendingAmount,
    allocatableAmount: Math.max(roundVnd(openAmount - pendingAmount), 0),
    daysOverdue: overdue,
    bucket: agingBucket(overdue),
  };
}

function toEntry(row: EntryRow): ReceivableEntry {
  return {
    id: row.id,
    kind: row.kind,
    customerId: row.customer_id,
    orderId: row.order_id,
    orderCode: row.order_code,
    contractId: row.contract_id,
    contractCode: row.contract_code,
    receiptId: row.receipt_id,
    receiptCode: row.receipt_code,
    adjustmentId: row.adjustment_id,
    adjustmentCode: row.adjustment_code,
    amount: num(row.amount),
    entryDate: toDateOnly(row.entry_date) ?? '',
    dueDate: toDateOnly(row.due_date),
    refEntryId: row.ref_entry_id,
    reversesEntryId: row.reverses_entry_id,
    sourceType: row.source_type,
    description: row.description,
    createdAt: toIso(row.created_at) ?? '',
    createdBy: row.created_by,
  };
}

function toReceiptSummary(row: ReceiptRow): ReceiptSummary {
  return {
    id: row.id,
    code: row.code,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    amount: num(row.amount),
    allocatedAmount: num(row.allocated_amount),
    method: row.method,
    receiptDate: toDateOnly(row.receipt_date) ?? '',
    status: row.status,
    financeVoucherId: row.finance_voucher_id,
    financeVoucherCode: row.finance_voucher_code,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

function toAdjustment(row: AdjustmentRow): ReceivableAdjustment {
  return {
    id: row.id,
    code: row.code,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    orderId: row.order_id,
    orderCode: row.order_code,
    entryId: row.entry_id,
    direction: row.direction,
    amount: num(row.amount),
    reason: row.reason,
    status: row.status,
    sourceType: row.source_type,
    sourceId: row.source_id,
    approvedBy: row.approved_by,
    approvedAt: toIso(row.approved_at),
    cancelReason: row.cancel_reason,
    revision: row.revision,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at) ?? '',
  };
}
