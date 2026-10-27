import { randomUUID } from 'node:crypto';
import type { AppliedDiscountPolicy, ConvertQuoteResult, DiscountStacking, PriceSource } from '@enterprise-platform/contracts-crm';
import type { ContractLineRecord } from '../application/contract-store.port.js';
import type { OrderLineRecord, QuoteConversionStore } from '../application/sales-order-store.port.js';
import { CrmConflictError, CrmNotFoundError } from '../domain/crm.error.js';
import { round3 } from '../domain/delivery-plan.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { insertContract } from './postgres-contract.store.js';
import { QUOTE_AUDIT_ENTITY } from './postgres-quote.store.js';
import { insertDelivery, insertOrder } from './postgres-sales-order.store.js';

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

interface QuoteLineRow {
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
  unit_price: string;
  gross_amount: string;
  discount_amount: string;
  vat_rate: string;
  line_amount: string;
  vat_amount: string;
  line_total: string;
  est_unit_cost: string | null;
}

/**
 * Chuyển báo giá Khách chấp nhận thành hợp đồng mua bán (Nháp), đơn bán (Nháp,
 * cùng dòng, giá, VAT của phiên bản khách chấp nhận) và một đợt giao mặc định
 * gồm toàn bộ số lượng, trong một transaction (T4-06, TC-QUO-11).
 *
 * Đúng một lần (TC-QUO-13): khoá dòng báo giá trước; lần gọi sau (kể cả gọi
 * song song, chờ khoá) thấy `converted_at` và trả kết quả lần đầu. Unique theo
 * `quote_id` trên hợp đồng và đơn là chốt chặn thứ hai.
 */
export class PostgresQuoteConversionStore implements QuoteConversionStore {
  constructor(private readonly database: CrmDatabase) {}

  convert(
    tenantId: string,
    quoteId: string,
    options: { readonly today: string; readonly plannedDate: string },
    actorId: string,
  ): Promise<ConvertQuoteResult> {
    return this.database.transaction(tenantId, async (client) => {
      const quote = (
        await client.query<{
          code: string;
          customer_id: string;
          opportunity_id: string | null;
          owner_user_id: string;
          status: string;
          accepted_version: number | null;
          converted_at: Date | null;
          customer_address: string | null;
        }>(
          `SELECT q.code, q.customer_id, q.opportunity_id, q.owner_user_id, q.status, q.accepted_version, q.converted_at,
                  c.address AS customer_address
             FROM crm_schema.quotes q
             JOIN crm_schema.customers c ON c.id = q.customer_id
            WHERE q.id = $1
            FOR UPDATE OF q`,
          [quoteId],
        )
      ).rows[0];
      if (!quote) throw new CrmNotFoundError('Không tìm thấy báo giá.');
      if (quote.converted_at) return existing(client, quoteId);
      if (quote.status !== 'ACCEPTED' || quote.accepted_version === null) {
        throw new CrmConflictError('QUOTE_NOT_ACCEPTED', 'Chỉ chuyển được báo giá khách đã chấp nhận.');
      }
      const version = (
        await client.query<{
          id: string;
          version_no: number;
          priced_on: string | null;
          shipping_amount: string;
          shipping_vat_rate: string;
          gross_amount: string;
          discount_amount: string;
          net_amount: string;
          vat_amount: string;
          total_amount: string;
        }>(
          `SELECT id, version_no, priced_on::text AS priced_on, shipping_amount, shipping_vat_rate, gross_amount, discount_amount,
                  net_amount, vat_amount, total_amount
             FROM crm_schema.quote_versions WHERE quote_id = $1 AND version_no = $2`,
          [quoteId, quote.accepted_version],
        )
      ).rows[0];
      if (!version) throw new CrmConflictError('QUOTE_NOT_ACCEPTED', 'Không tìm thấy phiên bản khách chấp nhận.');
      const lines = (await client.query<QuoteLineRow>(`SELECT * FROM crm_schema.quote_lines WHERE version_id = $1 ORDER BY line_no`, [version.id])).rows;
      if (!lines.length) throw new CrmConflictError('QUOTE_EMPTY', 'Báo giá không có dòng hàng nào.');
      const policies = await client.query<{
        line_id: string;
        policy_id: string;
        code: string;
        name: string;
        stacking: DiscountStacking;
        exclusive: boolean;
        percent: string;
      }>(
        `SELECT p.line_id, p.policy_id, p.code, p.name, p.stacking, p.exclusive, p.percent
           FROM crm_schema.quote_line_policies p JOIN crm_schema.quote_lines l ON l.id = p.line_id
          WHERE l.version_id = $1 ORDER BY p.code`,
        [version.id],
      );
      const policiesOf = (lineId: string): AppliedDiscountPolicy[] =>
        policies.rows
          .filter((row) => row.line_id === lineId)
          .map((row) => ({ policyId: row.policy_id, code: row.code, name: row.name, stacking: row.stacking, exclusive: row.exclusive, percent: num(row.percent) }));

      const contractId = await insertContract(
        client,
        {
          type: 'SALE',
          customerId: quote.customer_id,
          title: `Hợp đồng theo báo giá ${quote.code}`,
          signedDate: null,
          validFrom: options.today,
          validTo: null,
          value: num(version.total_amount),
          warrantyMonths: null,
          warehouseCode: null,
          ownerUserId: quote.owner_user_id,
          note: `Sinh từ báo giá ${quote.code} phiên bản ${version.version_no}.`,
        },
        contractLines(lines),
        quoteId,
        actorId,
      );
      const orderLines: OrderLineRecord[] = lines.map((line, index) => ({
        id: randomUUID(),
        lineNo: index + 1,
        materialId: line.material_id,
        materialCode: line.material_code,
        materialName: line.material_name,
        unit: line.unit,
        materialKind: line.material_kind,
        category: line.category,
        quantity: num(line.quantity),
        listPrice: num(line.list_price),
        priceSource: line.price_source,
        priceReferenceId: line.price_reference_id,
        priceReferenceCode: line.price_reference_code,
        appliedPolicies: policiesOf(line.id),
        discountPercent: num(line.discount_percent),
        overridden: line.overridden,
        overrideUnitPrice: line.override_unit_price === null ? null : num(line.override_unit_price),
        overrideDiscountPercent: line.override_discount_percent === null ? null : num(line.override_discount_percent),
        unitPrice: num(line.unit_price),
        grossAmount: num(line.gross_amount),
        discountAmount: num(line.discount_amount),
        vatRate: num(line.vat_rate),
        lineAmount: num(line.line_amount),
        vatAmount: num(line.vat_amount),
        lineTotal: num(line.line_total),
        estUnitCost: line.est_unit_cost === null ? null : num(line.est_unit_cost),
      }));
      const order = await insertOrder(
        client,
        {
          source: 'QUOTE',
          customerId: quote.customer_id,
          contractId,
          quoteId,
          opportunityId: quote.opportunity_id,
          ownerUserId: quote.owner_user_id,
          orderDate: options.today,
          expectedDeliveryDate: options.plannedDate,
          warehouseCode: null,
          deliveryAddress: quote.customer_address,
          note: `Sinh từ báo giá ${quote.code} phiên bản ${version.version_no}.`,
          priceDate: version.priced_on,
          shipping: { amount: num(version.shipping_amount), vatRate: num(version.shipping_vat_rate) },
          totals: {
            grossAmount: num(version.gross_amount),
            discountAmount: num(version.discount_amount),
            netAmount: num(version.net_amount),
            shippingAmount: num(version.shipping_amount),
            vatAmount: num(version.vat_amount),
            totalAmount: num(version.total_amount),
          },
          lines: orderLines,
        },
        actorId,
      );
      const deliveryId = await insertDelivery(
        client,
        order.id,
        order.code,
        {
          plannedDate: options.plannedDate,
          warehouseCode: null,
          address: quote.customer_address,
          note: 'Đợt giao mặc định khi chuyển báo giá.',
          lines: orderLines.map((line) => ({ orderLineId: line.id, quantity: line.quantity })),
        },
        actorId,
      );
      await client.query(`UPDATE crm_schema.quotes SET converted_at = now(), updated_at = now(), updated_by = $2 WHERE id = $1`, [
        quoteId,
        actorId,
      ]);
      const contractCode = (await client.query<{ code: string }>(`SELECT code FROM crm_schema.contracts WHERE id = $1`, [contractId])).rows[0].code;
      await writeAuditLog(client, {
        entityType: QUOTE_AUDIT_ENTITY,
        entityId: quoteId,
        action: 'convert',
        actorId,
        reason: `Chuyển thành hợp đồng ${contractCode} và đơn ${order.code}`,
        metadata: { versionNo: version.version_no, contractId, contractCode, orderId: order.id, orderCode: order.code },
      });
      return { quoteId, contractId, contractCode, orderId: order.id, orderCode: order.code, deliveryId, created: true };
    });
  }
}

/** Dòng hợp đồng từ dòng báo giá; dòng trùng mặt hàng và đơn vị gộp số lượng, thành tiền. */
function contractLines(lines: readonly QuoteLineRow[]): ContractLineRecord[] {
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

async function existing(client: CrmSqlClient, quoteId: string): Promise<ConvertQuoteResult> {
  const row = (
    await client.query<{ contract_id: string; contract_code: string; order_id: string; order_code: string; delivery_id: string | null }>(
      `SELECT k.id AS contract_id, k.code AS contract_code, o.id AS order_id, o.code AS order_code,
              (SELECT d.id FROM crm_schema.delivery_plans d WHERE d.order_id = o.id ORDER BY d.seq LIMIT 1) AS delivery_id
         FROM crm_schema.contracts k
         JOIN crm_schema.sales_orders o ON o.quote_id = k.quote_id AND o.source = 'QUOTE'
        WHERE k.quote_id = $1`,
      [quoteId],
    )
  ).rows[0];
  if (!row) throw new CrmConflictError('QUOTE_CONVERTED', 'Báo giá đã được chuyển thành hợp đồng.');
  return {
    quoteId,
    contractId: row.contract_id,
    contractCode: row.contract_code,
    orderId: row.order_id,
    orderCode: row.order_code,
    deliveryId: row.delivery_id,
    created: false,
  };
}
