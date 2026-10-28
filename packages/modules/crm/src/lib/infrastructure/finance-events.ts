import { isUuid } from '../domain/fields.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { completeSettledOrders, RECEIPT_AUDIT_ENTITY } from './postgres-receivable.store.js';
import { insertReceivableEntry, receivablesReady, vietnamDateOf } from './receivable-recognition.js';

/**
 * Sự kiện phiếu thu của Tài chính Bán hàng nghe (khai ở
 * `@enterprise-platform/contracts-finance`; module không phụ thuộc package của
 * Tài chính nên chép lại tên, không đổi).
 */
export const FINANCE_VOUCHER_POSTED = 'finance.voucher.posted';
export const FINANCE_VOUCHER_RETURNED = 'finance.voucher.returned';
export const FINANCE_VOUCHER_STATUS_CHANGED = 'finance.voucher.status-changed';

/** Phân hệ nguồn của phiếu do Bán hàng yêu cầu. */
export const FINANCE_SOURCE_MODULE_CRM = 'crm';

/** Phần payload các sự kiện phiếu Bán hàng đọc. */
export interface FinanceVoucherEventPayload {
  readonly voucherId?: string;
  readonly code?: string;
  readonly voucherCode?: string;
  readonly amount?: number | string;
  readonly postedAt?: string;
  readonly postedBy?: string;
  readonly reason?: string;
  readonly actorId?: string;
  readonly actorUserId?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly sourceModule?: string | null;
  readonly sourceRef?: string | null;
}

/** Sự kiện của phiếu nguồn Bán hàng (lọc nhanh trước khi mở transaction). */
export function isCrmVoucherEvent(type: string, payload: FinanceVoucherEventPayload): boolean {
  if (payload.sourceModule !== FINANCE_SOURCE_MODULE_CRM || !isUuid(payload.sourceRef)) return false;
  if (type === FINANCE_VOUCHER_STATUS_CHANGED) return payload.status === 'REVERSED';
  return type === FINANCE_VOUCHER_POSTED || type === FINANCE_VOUCHER_RETURNED;
}

interface LockedReceipt {
  id: string;
  code: string;
  customer_id: string;
  amount: string;
  status: string;
  receipt_date: string;
  finance_voucher_id: string | null;
}

async function lockReceipt(client: CrmSqlClient, id: string): Promise<LockedReceipt | undefined> {
  return (
    await client.query<LockedReceipt>(
      `SELECT id, code, customer_id, amount, status, receipt_date::text AS receipt_date, finance_voucher_id
         FROM crm_schema.receipts WHERE id = $1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
}

/**
 * Áp trạng thái phiếu thu của Tài chính vào lần thu (T5-07, TC-INT-06, TC-INT-07):
 *
 * - `finance.voucher.posted`: lần thu Đã ghi sổ; mỗi phân bổ sinh dòng CREDIT vào
 *   khoản nợ, phần chưa phân bổ là CREDIT không gắn khoản (trả trước); đơn đã
 *   giao đủ mà hết nợ thì tự Hoàn tất (Q8);
 * - `finance.voucher.returned`: lần thu Bị trả lại (người thu sửa rồi gửi lại);
 * - `finance.voucher.status-changed` REVERSED: ghi bút đảo cho từng dòng CREDIT,
 *   nợ mở lại; lần thu Phiếu đã bị đảo.
 *
 * Nhận trùng hoặc đến muộn (lần thu đã ở trạng thái đích, phiếu khác) thì bỏ qua.
 */
export async function applyFinanceVoucherEvent(
  database: CrmDatabase,
  tenantId: string,
  type: string,
  payload: FinanceVoucherEventPayload,
): Promise<'applied' | 'ignored'> {
  if (!isCrmVoucherEvent(type, payload)) return 'ignored';
  const receiptId = payload.sourceRef as string;
  return database.transaction(tenantId, async (client) => {
    if (!(await receivablesReady(client))) return 'ignored';
    const receipt = await lockReceipt(client, receiptId);
    if (!receipt) return 'ignored';
    const voucherId = isUuid(payload.voucherId) ? payload.voucherId : null;
    if (receipt.finance_voucher_id && voucherId && receipt.finance_voucher_id !== voucherId) return 'ignored';
    if (type === FINANCE_VOUCHER_POSTED) return applyPosted(client, receipt, payload, voucherId);
    if (type === FINANCE_VOUCHER_RETURNED) return applyReturned(client, receipt, payload, voucherId);
    return applyReversed(client, receipt, payload);
  });
}

async function applyPosted(
  client: CrmSqlClient,
  receipt: LockedReceipt,
  payload: FinanceVoucherEventPayload,
  voucherId: string | null,
): Promise<'applied' | 'ignored'> {
  if (!['PENDING_VOUCHER', 'VOUCHER_DRAFT', 'RETURNED'].includes(receipt.status)) return 'ignored';
  const date = vietnamDateOf(payload.postedAt);
  const voucherCode = (payload.voucherCode ?? payload.code ?? '').slice(0, 100) || null;
  const allocations = (
    await client.query<{
      id: string;
      entry_id: string;
      amount: string;
      order_id: string | null;
      contract_id: string | null;
      payment_term_id: string | null;
    }>(
      `SELECT a.id, a.entry_id, a.amount, e.order_id, e.contract_id, e.payment_term_id
         FROM crm_schema.receipt_allocations a
         JOIN crm_schema.receivable_entries e ON e.id = a.entry_id
        WHERE a.receipt_id = $1 AND a.credit_entry_id IS NULL
        ORDER BY e.id
        FOR UPDATE OF a`,
      [receipt.id],
    )
  ).rows;
  // Khoá khoản nợ theo thứ tự id như khi phân bổ, tránh deadlock với lần thu khác.
  if (allocations.length) {
    await client.query(`SELECT id FROM crm_schema.receivable_entries WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [
      allocations.map((line) => line.entry_id),
    ]);
  }
  const orders = new Set<string>();
  let allocated = 0;
  for (const line of allocations) {
    const amount = Number(line.amount);
    allocated += amount;
    const creditId = await insertReceivableEntry(client, {
      kind: 'CREDIT',
      customerId: receipt.customer_id,
      orderId: line.order_id,
      contractId: line.contract_id,
      paymentTermId: line.payment_term_id,
      receiptId: receipt.id,
      amount: -amount,
      entryDate: date,
      refEntryId: line.entry_id,
      sourceType: 'receipt_allocation',
      sourceId: line.id,
      description: `Thu tiền lần ${receipt.code}${voucherCode ? `, phiếu ${voucherCode}` : ''}`,
    });
    if (creditId) {
      await client.query(`UPDATE crm_schema.receipt_allocations SET credit_entry_id = $2 WHERE id = $1`, [line.id, creditId]);
    }
    if (line.order_id) orders.add(line.order_id);
  }
  const unapplied = Math.round((Number(receipt.amount) - allocated) * 100) / 100;
  if (unapplied > 0) {
    await insertReceivableEntry(client, {
      kind: 'CREDIT',
      customerId: receipt.customer_id,
      receiptId: receipt.id,
      amount: -unapplied,
      entryDate: date,
      sourceType: 'receipt_unapplied',
      sourceId: receipt.id,
      description: `Thu tiền lần ${receipt.code} chưa phân bổ (trả trước)`,
    });
  }
  // Đợt thanh toán của hợp đồng đã thu đủ.
  await client.query(
    `UPDATE crm_schema.contract_payment_terms t SET status = 'PAID', updated_at = now()
      WHERE t.status = 'DUE' AND EXISTS (
        SELECT 1 FROM crm_schema.receivable_open_items i WHERE i.payment_term_id = t.id AND i.open_amount <= 0)
        AND t.id IN (SELECT e.payment_term_id FROM crm_schema.receivable_entries e WHERE e.receipt_id = $1 AND e.payment_term_id IS NOT NULL)`,
    [receipt.id],
  );
  await client.query(
    `UPDATE crm_schema.receipts
        SET status = 'POSTED', posted_at = COALESCE($2::timestamptz, now()), finance_voucher_id = COALESCE(finance_voucher_id, $3::uuid),
            finance_voucher_code = COALESCE($4, finance_voucher_code), voucher_error = NULL, return_reason = NULL,
            revision = revision + 1, updated_at = now()
      WHERE id = $1`,
    [receipt.id, isoOrNull(payload.postedAt), voucherId, voucherCode],
  );
  await writeAuditLog(client, {
    entityType: RECEIPT_AUDIT_ENTITY,
    entityId: receipt.id,
    fromStatus: receipt.status,
    toStatus: 'POSTED',
    action: 'post',
    actorId: isUuid(payload.postedBy) ? payload.postedBy : null,
    metadata: { code: receipt.code, voucherCode, allocated, unapplied: Math.max(unapplied, 0) },
  });
  await completeSettledOrders(client, [...orders], null);
  return 'applied';
}

async function applyReturned(
  client: CrmSqlClient,
  receipt: LockedReceipt,
  payload: FinanceVoucherEventPayload,
  voucherId: string | null,
): Promise<'applied' | 'ignored'> {
  if (receipt.status !== 'VOUCHER_DRAFT' && receipt.status !== 'PENDING_VOUCHER') return 'ignored';
  const reason = (payload.reason?.trim() || 'Kế toán trả lại phiếu thu.').slice(0, 2000);
  await client.query(
    `UPDATE crm_schema.receipts
        SET status = 'RETURNED', return_reason = $2, finance_voucher_id = COALESCE(finance_voucher_id, $3::uuid),
            revision = revision + 1, updated_at = now()
      WHERE id = $1`,
    [receipt.id, reason, voucherId],
  );
  await writeAuditLog(client, {
    entityType: RECEIPT_AUDIT_ENTITY,
    entityId: receipt.id,
    fromStatus: receipt.status,
    toStatus: 'RETURNED',
    action: 'return',
    actorId: isUuid(payload.actorId) ? payload.actorId : null,
    reason,
    metadata: { code: receipt.code },
  });
  return 'applied';
}

async function applyReversed(
  client: CrmSqlClient,
  receipt: LockedReceipt,
  payload: FinanceVoucherEventPayload,
): Promise<'applied' | 'ignored'> {
  if (receipt.status !== 'POSTED') return 'ignored';
  const date = vietnamDateOf(null);
  const credits = (
    await client.query<{
      id: string;
      ref_entry_id: string | null;
      amount: string;
      order_id: string | null;
      contract_id: string | null;
      payment_term_id: string | null;
    }>(
      `SELECT id, ref_entry_id, amount, order_id, contract_id, payment_term_id
         FROM crm_schema.receivable_entries
        WHERE receipt_id = $1 AND kind = 'CREDIT'
        ORDER BY id`,
      [receipt.id],
    )
  ).rows;
  for (const credit of credits) {
    await insertReceivableEntry(client, {
      kind: 'REVERSAL',
      customerId: receipt.customer_id,
      orderId: credit.order_id,
      contractId: credit.contract_id,
      paymentTermId: credit.payment_term_id,
      receiptId: receipt.id,
      amount: -Number(credit.amount),
      entryDate: date,
      refEntryId: credit.ref_entry_id,
      reversesEntryId: credit.id,
      sourceType: 'receipt_reversal',
      sourceId: credit.id,
      description: `Đảo thu tiền lần ${receipt.code} do phiếu thu bị đảo`,
    });
  }
  // Đợt thanh toán đã thu đủ mà phiếu bị đảo: về Đến hạn.
  await client.query(
    `UPDATE crm_schema.contract_payment_terms SET status = 'DUE', updated_at = now()
      WHERE status = 'PAID' AND id = ANY($1::uuid[])`,
    [credits.map((credit) => credit.payment_term_id).filter((id): id is string => !!id)],
  );
  const reason = (payload.summary?.trim() || 'Phiếu thu đã ghi sổ bị đảo bên Tài chính.').slice(0, 2000);
  await client.query(
    `UPDATE crm_schema.receipts SET status = 'REVERSED', reversed_at = now(), revision = revision + 1, updated_at = now() WHERE id = $1`,
    [receipt.id],
  );
  await writeAuditLog(client, {
    entityType: RECEIPT_AUDIT_ENTITY,
    entityId: receipt.id,
    fromStatus: 'POSTED',
    toStatus: 'REVERSED',
    action: 'reverse',
    actorId: isUuid(payload.actorUserId) ? payload.actorUserId : null,
    reason,
    metadata: { code: receipt.code, reversedCredits: credits.length },
  });
  return 'applied';
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
