import { randomUUID } from 'node:crypto';
import type { PriceSource } from '@enterprise-platform/contracts-crm';
import type { ContractLineRecord } from '../application/contract-store.port.js';
import { CrmConflictError, CrmNotFoundError } from '../domain/crm.error.js';
import { round3 } from '../domain/delivery-plan.js';
import { allocateOrderAdjustments } from '../domain/quote-allocation.js';
import type { CrmSqlClient } from './audit-log.js';

/**
 * Nguồn dữ liệu chung khi lấy hợp đồng từ báo giá khách chấp nhận: chuyển báo giá (`PostgresQuoteConversionStore`)
 * và lập hợp đồng có gắn báo giá (`PostgresContractStore.createContractFromQuote`) dùng cùng truy vấn, cùng cách
 * phân bổ chiết khấu, thuế tổng đơn và cùng cách gộp dòng, để hai đường ra đúng một bộ dòng hợp đồng.
 */

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

export interface QuoteLineRow {
  id: string;
  line_no: number;
  material_id: string;
  material_code: string;
  material_name: string;
  unit: string;
  material_kind: string;
  category: string | null;
  quantity: string;
  list_price: string;
  price_source: PriceSource;
  price_reference_id: string | null;
  price_reference_code: string | null;
  discount_percent: string;
  overridden: boolean;
  override_unit_price: string | null;
  override_discount_percent: string | null;
  override_vat_rate: string | null;
  unit_price: string;
  gross_amount: string;
  discount_amount: string;
  vat_rate: string;
  line_amount: string;
  vat_amount: string;
  line_total: string;
  est_unit_cost: string | null;
}

/** Phần đầu báo giá cần khi chuyển hoặc gắn hợp đồng. */
export interface QuoteSourceRow {
  code: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  opportunity_id: string | null;
  owner_user_id: string;
  status: string;
  accepted_version: number | null;
  converted_at: Date | null;
  customer_address: string | null;
}

/** Phiên bản khách chấp nhận. */
export interface AcceptedVersionRow {
  id: string;
  version_no: number;
  quote_name: string | null;
  priced_on: string | null;
  price_list_id: string | null;
  shipping_amount: string;
  shipping_vat_rate: string;
  gross_amount: string;
  discount_amount: string;
  net_amount: string;
  vat_amount: string;
  total_amount: string;
  discount_mode: 'LINE' | 'ORDER';
  tax_mode: 'LINE' | 'ORDER';
  order_discount_total: string;
  order_tax_total: string;
}

/** Đọc phần đầu báo giá; `lock` thì khoá dòng báo giá tới hết transaction (chống chuyển, gắn hai lần). */
export async function readQuoteSource(client: CrmSqlClient, quoteId: string, lock: boolean): Promise<QuoteSourceRow> {
  const quote = (
    await client.query<QuoteSourceRow>(
      `SELECT q.code, q.customer_id, c.code AS customer_code, c.name AS customer_name, q.opportunity_id, q.owner_user_id,
              q.status, q.accepted_version, q.converted_at, c.address AS customer_address
         FROM crm_schema.quotes q
         JOIN crm_schema.customers c ON c.id = q.customer_id
        WHERE q.id = $1
        ${lock ? 'FOR UPDATE OF q' : ''}`,
      [quoteId],
    )
  ).rows[0];
  if (!quote) throw new CrmNotFoundError('Không tìm thấy báo giá.');
  return quote;
}

/**
 * Phiên bản khách chấp nhận và dòng của nó, chiết khấu và thuế tổng đơn (mẫu ORDER) đã phân bổ xuống dòng để tổng
 * dòng khớp tổng báo giá (P2I-09). Không có phiên bản hoặc không có dòng: 409.
 */
export async function readAcceptedVersion(
  client: CrmSqlClient,
  quoteId: string,
  acceptedVersion: number,
): Promise<{ version: AcceptedVersionRow; lines: QuoteLineRow[] }> {
  const version = (
    await client.query<AcceptedVersionRow>(
      `SELECT id, version_no, quote_name, priced_on::text AS priced_on, price_list_id, shipping_amount, shipping_vat_rate, gross_amount,
              discount_amount, net_amount, vat_amount, total_amount, discount_mode, tax_mode, order_discount_total, order_tax_total
         FROM crm_schema.quote_versions WHERE quote_id = $1 AND version_no = $2`,
      [quoteId, acceptedVersion],
    )
  ).rows[0];
  if (!version) throw new CrmConflictError('QUOTE_NOT_ACCEPTED', 'Không tìm thấy phiên bản khách chấp nhận.');
  const sourceLines = (await client.query<QuoteLineRow>(`SELECT * FROM crm_schema.quote_lines WHERE version_id = $1 ORDER BY line_no`, [version.id])).rows;
  if (!sourceLines.length) throw new CrmConflictError('QUOTE_EMPTY', 'Báo giá không có dòng hàng nào.');
  return { version, lines: withOrderAdjustments(sourceLines, version) };
}

/**
 * Dòng báo giá đã đưa chiết khấu, thuế tổng đơn vào dòng (xem `allocateOrderAdjustments`). Báo giá mẫu theo dòng,
 * hoặc mẫu tổng đơn không nhập chiết khấu, thuế: dòng giữ nguyên.
 */
export function withOrderAdjustments(
  lines: readonly QuoteLineRow[],
  version: { discount_mode: 'LINE' | 'ORDER'; tax_mode: 'LINE' | 'ORDER'; order_discount_total: string; order_tax_total: string },
): QuoteLineRow[] {
  const allocated = allocateOrderAdjustments({
    lines: lines.map((line) => ({
      quantity: num(line.quantity),
      grossAmount: num(line.gross_amount),
      discountAmount: num(line.discount_amount),
      lineAmount: num(line.line_amount),
      vatAmount: num(line.vat_amount),
    })),
    discountMode: version.discount_mode,
    taxMode: version.tax_mode,
    orderDiscountTotal: num(version.order_discount_total),
    orderTaxTotal: num(version.order_tax_total),
  });
  return lines.map((line, index) => {
    const next = allocated[index];
    if (next.orderDiscountShare === 0 && next.vatAmount === num(line.vat_amount)) return line;
    const gross = num(line.gross_amount);
    return {
      ...line,
      discount_amount: String(next.discountAmount),
      line_amount: String(next.lineAmount),
      vat_amount: String(next.vatAmount),
      line_total: String(next.lineAmount + next.vatAmount),
      // Đơn giá và phần trăm chiết khấu hiển thị theo thành tiền mới (làm tròn 2 và 4 chữ số thập phân).
      unit_price: next.orderDiscountShare === 0 || next.quantity <= 0 ? line.unit_price : String(Math.round((next.lineAmount / next.quantity) * 100) / 100),
      discount_percent:
        next.orderDiscountShare === 0 || gross <= 0 ? line.discount_percent : String(Math.round((next.discountAmount / gross) * 100 * 10_000) / 10_000),
    };
  });
}

/** Dòng hợp đồng từ dòng báo giá; dòng trùng mặt hàng và đơn vị gộp số lượng, thành tiền. */
export function contractLines(lines: readonly QuoteLineRow[]): ContractLineRecord[] {
  const merged = new Map<string, ContractLineRecord>();
  for (const line of lines) {
    const key = `${line.material_id}|${line.unit.trim().toLowerCase()}`;
    const current = merged.get(key);
    if (current) {
      merged.set(key, {
        ...current,
        quantity: round3((current.quantity ?? 0) + num(line.quantity)),
        lineAmount: (current.lineAmount ?? 0) + num(line.line_amount),
      });
      continue;
    }
    merged.set(key, {
      id: randomUUID(),
      lineNo: merged.size + 1,
      materialId: line.material_id,
      materialCode: line.material_code,
      materialName: line.material_name,
      unit: line.unit,
      materialKind: line.material_kind,
      quantity: num(line.quantity),
      unitPrice: num(line.unit_price),
      vatRate: num(line.vat_rate),
      discountPercent: num(line.discount_percent),
      lineAmount: num(line.line_amount),
      note: null,
    });
  }
  return [...merged.values()];
}

/**
 * Báo giá gắn được vào hợp đồng mới: khách đã chấp nhận (có phiên bản chấp nhận), chưa chuyển hay gắn hợp đồng nào
 * và (khi có `customerId`) cùng khách của hợp đồng. Sai điều kiện: 409 kèm câu báo rõ. Trả số phiên bản chấp nhận.
 */
export function assertQuoteLinkable(quote: QuoteSourceRow, customerId?: string): number {
  if (quote.converted_at) {
    throw new CrmConflictError('QUOTE_CONVERTED', `Báo giá ${quote.code} đã chuyển hoặc gắn vào một hợp đồng khác.`);
  }
  if (quote.status !== 'ACCEPTED' || quote.accepted_version === null) {
    throw new CrmConflictError('QUOTE_NOT_ACCEPTED', `Chỉ gắn được báo giá khách đã chấp nhận; báo giá ${quote.code} chưa được khách chấp nhận.`);
  }
  if (customerId !== undefined && quote.customer_id !== customerId) {
    throw new CrmConflictError(
      'QUOTE_CUSTOMER_MISMATCH',
      `Báo giá ${quote.code} là của khách ${quote.customer_name}, khác khách của hợp đồng; vui lòng chọn lại khách hoặc báo giá.`,
    );
  }
  return quote.accepted_version;
}
