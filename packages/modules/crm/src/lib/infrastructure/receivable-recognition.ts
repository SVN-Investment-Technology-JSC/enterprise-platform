import { vietnamToday } from '../application/pricing.service.js';
import { addDays, deliveryReceivableAmount, formatVnd } from '../domain/receivables.js';
import { roundVnd } from '../domain/pricing-engine.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';

/**
 * Ghi nhận nợ phải thu (D3, T5-04, T5-05), gọi trong transaction của bên gọi:
 *
 * - Đơn không thuộc hợp đồng có đợt thanh toán: khi số đã giao đổi (chứng từ xuất
 *   ghi sổ, đợt chỉ có dịch vụ), ghi DEBIT bằng giá trị gồm VAT của phần vừa giao
 *   (luỹ kế sau trừ luỹ kế trước, làm tròn đến đồng), hạn = ngày giao + thời hạn
 *   thanh toán của khách; chứng từ đảo ghi REVERSAL vào khoản nợ của chứng từ gốc.
 * - Đơn thuộc hợp đồng có đợt: không ghi theo xuất kho (TC-AR-02); mỗi lần giao
 *   kích hoạt đợt "khi giao hàng" kế tiếp chưa đến hạn (TC-CON-06); đợt "khi
 *   giao đủ hàng" đến hạn ở lần giao làm mọi dòng (hàng kho và dịch vụ) của mọi
 *   đơn đã cam kết (không Nháp, không huỷ) thuộc hợp đồng giao đủ số lượng
 *   (`contractFullyDelivered`).
 * - Đợt "khi ký" ghi khi xác nhận hợp đồng; đợt "theo ngày" do job ghi khi tới
 *   ngày; đợt "khi nghiệm thu" ghi bằng tay (tới khi có nghiệm thu, CON-04).
 *
 * Mỗi chứng từ, mỗi đợt chỉ ghi một lần nhờ unique `(source_type, source_id)`.
 */

/** Thực thể ghi `audit_log` khi đợt thanh toán đến hạn (cùng thực thể với hợp đồng). */
const CONTRACT_ENTITY = 'contract';

export const RECOGNITION_SETTING_KEY = 'receivable.recognition';

/** Migration 0009 đã chạy chưa (sự kiện Kho có thể đến khi tenant còn ở 0008). */
export async function receivablesReady(client: CrmSqlClient): Promise<boolean> {
  const result = await client.query<{ ready: boolean }>(`SELECT to_regclass('crm_schema.receivable_entries') IS NOT NULL AS ready`);
  return result.rows[0]?.ready === true;
}

export interface NewEntry {
  readonly kind: 'DEBIT' | 'CREDIT' | 'ADJUSTMENT' | 'REVERSAL';
  readonly customerId: string;
  readonly orderId?: string | null;
  readonly contractId?: string | null;
  readonly paymentTermId?: string | null;
  readonly deliveryId?: string | null;
  readonly receiptId?: string | null;
  readonly adjustmentId?: string | null;
  readonly amount: number;
  readonly entryDate: string;
  readonly dueDate?: string | null;
  readonly refEntryId?: string | null;
  readonly reversesEntryId?: string | null;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly description?: string | null;
  readonly createdBy?: string | null;
}

/** Ghi một dòng sổ; chứng từ nguồn đã ghi thì không ghi lại (trả `null`). */
export async function insertReceivableEntry(client: CrmSqlClient, entry: NewEntry): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO crm_schema.receivable_entries
       (kind, customer_id, order_id, contract_id, payment_term_id, delivery_id, receipt_id, adjustment_id, amount, entry_date,
        due_date, ref_entry_id, reverses_entry_id, source_type, source_id, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (source_type, source_id) DO NOTHING
     RETURNING id`,
    [
      entry.kind,
      entry.customerId,
      entry.orderId ?? null,
      entry.contractId ?? null,
      entry.paymentTermId ?? null,
      entry.deliveryId ?? null,
      entry.receiptId ?? null,
      entry.adjustmentId ?? null,
      roundVnd(entry.amount),
      entry.entryDate,
      entry.dueDate ?? null,
      entry.refEntryId ?? null,
      entry.reversesEntryId ?? null,
      entry.sourceType,
      entry.sourceId.slice(0, 200),
      entry.description?.slice(0, 500) ?? null,
      entry.createdBy ?? null,
    ],
  );
  return result.rows[0]?.id ?? null;
}

/** Số đã giao từng dòng đơn ngay lúc gọi (chụp trước khi áp chứng từ). */
export async function deliveredSnapshot(client: CrmSqlClient, orderId: string): Promise<Map<string, number>> {
  const result = await client.query<{ id: string; delivered_quantity: string }>(
    `SELECT id, delivered_quantity FROM crm_schema.sales_order_lines WHERE order_id = $1`,
    [orderId],
  );
  return new Map(result.rows.map((row) => [row.id, Number(row.delivered_quantity)]));
}

/** Ngày (giờ Việt Nam) của mốc ghi sổ; không hợp lệ thì hôm nay. */
export function vietnamDateOf(value: string | null | undefined): string {
  const time = value ? Date.parse(value) : Number.NaN;
  return vietnamToday(Number.isNaN(time) ? new Date() : new Date(time));
}

interface OrderRow {
  customer_id: string;
  contract_id: string | null;
  code: string;
  total_amount: string;
  payment_term_days: number | null;
}

/**
 * Áp thay đổi số đã giao của đơn vào sổ công nợ. `before` là số đã giao từng
 * dòng trước khi áp chứng từ (`deliveredSnapshot`); số sau đọc lại trong cùng
 * transaction.
 */
export async function recognizeOrderDelivery(
  client: CrmSqlClient,
  input: {
    readonly orderId: string;
    readonly deliveryId: string;
    readonly before: ReadonlyMap<string, number>;
    /** `stock_issue` (chứng từ xuất Kho) hoặc `service_delivery` (đợt chỉ có dịch vụ). */
    readonly sourceType: 'stock_issue' | 'service_delivery';
    readonly sourceId: string;
    /** Chứng từ đảo: id chứng từ gốc. */
    readonly reversesSourceId: string | null;
    readonly documentCode: string | null;
    readonly date: string;
    readonly actorId: string | null;
  },
): Promise<void> {
  if (!(await receivablesReady(client))) return;
  const setting = await client.query<{ value: { mode?: unknown } }>(`SELECT value FROM crm_schema.settings WHERE key = $1`, [
    RECOGNITION_SETTING_KEY,
  ]);
  const mode = setting.rows[0]?.value?.mode ?? 'ON_DELIVERY';
  if (mode !== 'ON_DELIVERY') return;
  const order = (
    await client.query<OrderRow>(
      `SELECT o.customer_id, o.contract_id, o.code, o.total_amount, c.payment_term_days
         FROM crm_schema.sales_orders o JOIN crm_schema.customers c ON c.id = o.customer_id
        WHERE o.id = $1`,
      [input.orderId],
    )
  ).rows[0];
  if (!order) return;
  const lines = (
    await client.query<{ id: string; quantity: string; line_total: string; delivered_quantity: string }>(
      `SELECT id, quantity, line_total, delivered_quantity FROM crm_schema.sales_order_lines WHERE order_id = $1`,
      [input.orderId],
    )
  ).rows;
  const changes = lines.map((line) => ({
    quantity: Number(line.quantity),
    lineTotal: Number(line.line_total),
    deliveredBefore: input.before.get(line.id) ?? 0,
    deliveredAfter: Number(line.delivered_quantity),
  }));
  const forward = changes.some((line) => line.deliveredAfter > line.deliveredBefore);

  if (order.contract_id && (await contractHasTerms(client, order.contract_id))) {
    // Hợp đồng có đợt thanh toán: nợ theo đợt, không theo xuất kho (TC-AR-02).
    if (forward && !input.reversesSourceId) {
      const options = {
        contractId: order.contract_id,
        orderId: input.orderId,
        deliveryId: input.deliveryId,
        date: input.date,
        actorId: input.actorId,
      };
      // Đợt "khi giao hàng" xét trước: nó chặn theo `delivery_id` đã có khoản theo đợt.
      await recognizeNextDeliveryTerm(client, options);
      await recognizeFullDeliveryTerms(client, options);
    }
    return;
  }

  const linesTotal = changes.reduce((sum, line) => sum + line.lineTotal, 0);
  const shippingTotal = Math.max(roundVnd(Number(order.total_amount) - linesTotal), 0);
  const amount = deliveryReceivableAmount(changes, shippingTotal);
  if (amount === 0) return;
  const label = input.documentCode ? `chứng từ ${input.documentCode}` : 'đợt giao dịch vụ';
  if (amount > 0) {
    await insertReceivableEntry(client, {
      kind: 'DEBIT',
      customerId: order.customer_id,
      orderId: input.orderId,
      contractId: order.contract_id,
      deliveryId: input.deliveryId,
      amount,
      entryDate: input.date,
      dueDate: addDays(input.date, order.payment_term_days ?? 0),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      description: `Giao hàng đơn ${order.code}, ${label}`,
      createdBy: input.actorId,
    });
    return;
  }
  // Chứng từ đảo: ghi bút đảo vào khoản nợ của chứng từ gốc (không có thì khoản nợ mới nhất của đơn).
  const target = (
    await client.query<{ id: string }>(
      `SELECT id FROM crm_schema.receivable_entries
        WHERE kind = 'DEBIT' AND order_id = $1
        ORDER BY (source_type = 'stock_issue' AND source_id = $2) DESC, created_at DESC
        LIMIT 1`,
      [input.orderId, input.reversesSourceId ?? ''],
    )
  ).rows[0];
  if (!target) return;
  await insertReceivableEntry(client, {
    kind: 'REVERSAL',
    customerId: order.customer_id,
    orderId: input.orderId,
    contractId: order.contract_id,
    deliveryId: input.deliveryId,
    amount,
    entryDate: input.date,
    refEntryId: target.id,
    reversesEntryId: target.id,
    sourceType: `${input.sourceType}_reversal`,
    sourceId: input.sourceId,
    description: `Đảo giao hàng đơn ${order.code}, ${label} (${formatVnd(-amount)} đ)`,
    createdBy: input.actorId,
  });
}

async function contractHasTerms(client: CrmSqlClient, contractId: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM crm_schema.contract_payment_terms WHERE contract_id = $1 LIMIT 1`, [contractId]);
  return result.rows.length > 0;
}

interface TermRow {
  id: string;
  status: string;
  contract_id: string;
  seq: number;
  name: string;
  amount: string;
  condition: 'DATE' | 'SIGN' | 'DELIVERY' | 'FULL_DELIVERY' | 'ACCEPTANCE';
  due_date: string | null;
  due_days: number | null;
  customer_id: string;
  contract_code: string;
  payment_term_days: number | null;
}

const TERM_SELECT = `
  SELECT t.id, t.status, t.contract_id, t.seq, t.name, t.amount, t.condition, t.due_date::text AS due_date, t.due_days,
         k.customer_id, k.code AS contract_code, c.payment_term_days
    FROM crm_schema.contract_payment_terms t
    JOIN crm_schema.contracts k ON k.id = t.contract_id
    JOIN crm_schema.customers c ON c.id = k.customer_id`;

/**
 * Đợt thanh toán đến điều kiện: ghi DEBIT bằng số tiền của đợt, đợt sang Đến
 * hạn. Hạn: đợt "theo ngày" là ngày của đợt; đợt khác là ngày xảy ra điều kiện
 * + số ngày phải thu của đợt (không nhập thì thời hạn thanh toán của khách).
 */
async function recognizeTerm(
  client: CrmSqlClient,
  term: TermRow,
  options: { readonly date: string; readonly orderId?: string | null; readonly deliveryId?: string | null; readonly actorId: string | null },
): Promise<boolean> {
  const claimed = await client.query(
    `UPDATE crm_schema.contract_payment_terms SET status = 'DUE', updated_at = now() WHERE id = $1 AND status = 'PENDING' RETURNING id`,
    [term.id],
  );
  if (!claimed.rows.length) return false;
  const amount = roundVnd(Number(term.amount));
  const dueDate =
    term.condition === 'DATE' && term.due_date ? term.due_date : addDays(options.date, term.due_days ?? term.payment_term_days ?? 0);
  if (amount > 0) {
    await insertReceivableEntry(client, {
      kind: 'DEBIT',
      customerId: term.customer_id,
      orderId: options.orderId ?? null,
      contractId: term.contract_id,
      paymentTermId: term.id,
      deliveryId: options.deliveryId ?? null,
      amount,
      entryDate: options.date,
      dueDate,
      sourceType: 'contract_term',
      sourceId: term.id,
      description: `Hợp đồng ${term.contract_code}, đợt ${term.seq}: ${term.name}`,
      createdBy: options.actorId,
    });
  }
  await writeAuditLog(client, {
    entityType: CONTRACT_ENTITY,
    entityId: term.contract_id,
    action: 'payment-term-due',
    actorId: options.actorId,
    reason: `Đợt ${term.seq} (${term.name}) đến hạn thu ${formatVnd(amount)} đ, hạn thanh toán ${dueDate.split('-').reverse().join('/')}.`,
    metadata: { code: term.contract_code, termId: term.id, seq: term.seq, amount, dueDate },
  });
  return true;
}

/** Hợp đồng vừa xác nhận: các đợt "khi ký" đến hạn (ngày ký, không có thì hôm nay). */
export async function recognizeSignTerms(client: CrmSqlClient, contractId: string, actorId: string | null): Promise<number> {
  if (!(await receivablesReady(client))) return 0;
  const signed = await client.query<{ signed_date: string | null }>(
    `SELECT signed_date::text AS signed_date FROM crm_schema.contracts WHERE id = $1`,
    [contractId],
  );
  const date = signed.rows[0]?.signed_date ?? vietnamToday(new Date());
  const terms = (
    await client.query<TermRow>(`${TERM_SELECT} WHERE t.contract_id = $1 AND t.condition = 'SIGN' AND t.status = 'PENDING' ORDER BY t.seq`, [
      contractId,
    ])
  ).rows;
  let count = 0;
  for (const term of terms) if (await recognizeTerm(client, term, { date, actorId })) count += 1;
  return count;
}

/** Một lần giao của đơn thuộc hợp đồng: đợt "khi giao hàng" kế tiếp còn chờ đến hạn. */
async function recognizeNextDeliveryTerm(
  client: CrmSqlClient,
  options: { readonly contractId: string; readonly orderId: string; readonly deliveryId: string; readonly date: string; readonly actorId: string | null },
): Promise<void> {
  // Mỗi đợt giao chỉ kích hoạt một đợt thanh toán dù nhận nhiều chứng từ xuất.
  const already = await client.query(
    `SELECT 1 FROM crm_schema.receivable_entries WHERE source_type = 'contract_term' AND delivery_id = $1 LIMIT 1`,
    [options.deliveryId],
  );
  if (already.rows.length) return;
  const term = (
    await client.query<TermRow>(
      `${TERM_SELECT} WHERE t.contract_id = $1 AND t.condition = 'DELIVERY' AND t.status = 'PENDING' ORDER BY t.seq LIMIT 1 FOR UPDATE OF t`,
      [options.contractId],
    )
  ).rows[0];
  if (!term) return;
  await recognizeTerm(client, term, options);
}

/**
 * Trạng thái đơn không tính khi xét hợp đồng giao đủ: đơn Nháp chưa là cam kết
 * (đơn nháp bị bỏ dở không chặn đợt "khi giao đủ hàng", T8-08), đơn đã huỷ.
 * Đơn Chờ duyệt hạn mức vẫn tính là chưa giao (đơn sẽ còn giao).
 */
export const FULL_DELIVERY_IGNORED_ORDER_STATUSES: readonly string[] = ['DRAFT', 'CANCELLED'];

/**
 * Mọi đơn đã cam kết thuộc hợp đồng đã giao đủ: mỗi dòng (hàng kho và dịch vụ)
 * có số đã giao không nhỏ hơn số đặt, và hợp đồng có ít nhất một dòng đơn như
 * vậy. Bỏ qua đơn trong `FULL_DELIVERY_IGNORED_ORDER_STATUSES`. Gọi trong
 * transaction đã khoá đơn vừa giao, đọc số sau khi áp chứng từ.
 */
export async function contractFullyDelivered(client: CrmSqlClient, contractId: string): Promise<boolean> {
  const result = await client.query<{ total: number; open: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE l.delivered_quantity < l.quantity)::int AS open
       FROM crm_schema.sales_order_lines l
       JOIN crm_schema.sales_orders o ON o.id = l.order_id
      WHERE o.contract_id = $1 AND o.status <> ALL($2::text[])`,
    [contractId, [...FULL_DELIVERY_IGNORED_ORDER_STATUSES]],
  );
  const row = result.rows[0];
  return !!row && row.total > 0 && row.open === 0;
}

/**
 * Lần giao làm hợp đồng giao đủ: mọi đợt "khi giao đủ hàng" còn chờ đến hạn
 * (TC-CON-06b). Giao một phần không kích hoạt. Chứng từ đảo sau đó không đảo
 * khoản đã ghi (như đợt "khi giao hàng"); điều chỉnh bằng bút toán điều chỉnh.
 */
async function recognizeFullDeliveryTerms(
  client: CrmSqlClient,
  options: { readonly contractId: string; readonly orderId: string; readonly deliveryId: string; readonly date: string; readonly actorId: string | null },
): Promise<void> {
  const terms = (
    await client.query<TermRow>(
      `${TERM_SELECT} WHERE t.contract_id = $1 AND t.condition = 'FULL_DELIVERY' AND t.status = 'PENDING' ORDER BY t.seq FOR UPDATE OF t`,
      [options.contractId],
    )
  ).rows;
  if (!terms.length || !(await contractFullyDelivered(client, options.contractId))) return;
  for (const term of terms) await recognizeTerm(client, term, options);
}

/**
 * Ghi nhận bằng tay một đợt "khi nghiệm thu" (hoặc "khi giao hàng" chưa tự kích
 * hoạt, hay "khi giao đủ hàng" khi còn đơn treo không giao). Trả `false` khi đợt không còn chờ.
 */
export async function recognizeTermManually(
  client: CrmSqlClient,
  contractId: string,
  termId: string,
  date: string,
  actorId: string,
): Promise<'applied' | 'not-found' | 'not-pending' | 'invalid-condition'> {
  const term = (
    await client.query<TermRow>(
      `${TERM_SELECT} WHERE t.id = $1 AND t.contract_id = $2 FOR UPDATE OF t`,
      [termId, contractId],
    )
  ).rows[0];
  if (!term) return 'not-found';
  if (term.condition !== 'ACCEPTANCE' && term.condition !== 'DELIVERY' && term.condition !== 'FULL_DELIVERY') return 'invalid-condition';
  if (term.status !== 'PENDING') return 'not-pending';
  return (await recognizeTerm(client, term, { date, actorId })) ? 'applied' : 'not-pending';
}

/** Job: đợt "theo ngày" của hợp đồng Hiệu lực đã tới ngày. Trả số đợt đã ghi. */
export async function recognizeDateTerms(client: CrmSqlClient, today: string, limit: number): Promise<number> {
  const terms = (
    await client.query<TermRow>(
      `${TERM_SELECT}
        WHERE t.condition = 'DATE' AND t.status = 'PENDING' AND t.due_date <= $1::date AND k.status IN ('ACTIVE', 'COMPLETED')
        ORDER BY t.due_date, t.id
        LIMIT $2
        FOR UPDATE OF t SKIP LOCKED`,
      [today, limit],
    )
  ).rows;
  let count = 0;
  for (const term of terms) if (await recognizeTerm(client, term, { date: term.due_date ?? today, actorId: null })) count += 1;
  return count;
}

/**
 * Hợp đồng bị huỷ: mỗi khoản nợ theo đợt còn nợ được đảo đúng phần còn nợ (phần
 * đã thu giữ nguyên trên sổ); đợt chưa thu đủ chuyển Đã huỷ.
 */
export async function reverseContractTerms(client: CrmSqlClient, contractId: string, code: string, actorId: string | null): Promise<void> {
  if (!(await receivablesReady(client))) return;
  const open = (
    await client.query<{ id: string; customer_id: string; order_id: string | null; payment_term_id: string | null; open_amount: string }>(
      `SELECT id, customer_id, order_id, payment_term_id, open_amount FROM crm_schema.receivable_open_items
        WHERE contract_id = $1 AND source_type = 'contract_term' AND open_amount > 0
        ORDER BY id`,
      [contractId],
    )
  ).rows;
  if (open.length) {
    await client.query(`SELECT id FROM crm_schema.receivable_entries WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [open.map((row) => row.id)]);
  }
  const date = vietnamToday(new Date());
  for (const row of open) {
    await insertReceivableEntry(client, {
      kind: 'REVERSAL',
      customerId: row.customer_id,
      orderId: row.order_id,
      contractId,
      paymentTermId: row.payment_term_id,
      amount: -Number(row.open_amount),
      entryDate: date,
      refEntryId: row.id,
      reversesEntryId: row.id,
      sourceType: 'contract_cancel',
      sourceId: row.id,
      description: `Huỷ hợp đồng ${code}: đảo phần còn nợ của đợt thanh toán`,
      createdBy: actorId,
    });
  }
  await client.query(
    `UPDATE crm_schema.contract_payment_terms SET status = 'CANCELLED', updated_at = now()
      WHERE contract_id = $1 AND status IN ('PENDING', 'DUE')`,
    [contractId],
  );
}
