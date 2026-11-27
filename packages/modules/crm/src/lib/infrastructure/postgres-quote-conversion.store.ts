import { randomUUID } from 'node:crypto';
import type { AppliedDiscountPolicy, ConvertQuoteResult, DiscountStacking } from '@enterprise-platform/contracts-crm';
import type { OrderLineRecord, QuoteConversionStore } from '../application/sales-order-store.port.js';
import { CrmConflictError } from '../domain/crm.error.js';
import { writeAuditLog, type CrmSqlClient } from './audit-log.js';
import type { CrmDatabase } from './crm.database.js';
import { insertContract } from './postgres-contract.store.js';
import { QUOTE_AUDIT_ENTITY } from './postgres-quote.store.js';
import { insertDelivery, insertOrder } from './postgres-sales-order.store.js';
import { contractLines, readAcceptedVersion, readQuoteSource } from './quote-contract-source.js';

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

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
      const quote = await readQuoteSource(client, quoteId, true);
      if (quote.converted_at) return existing(client, quoteId);
      if (quote.status !== 'ACCEPTED' || quote.accepted_version === null) {
        throw new CrmConflictError('QUOTE_NOT_ACCEPTED', 'Chỉ chuyển được báo giá khách đã chấp nhận.');
      }
      // Chiết khấu và thuế tổng đơn (mẫu ORDER) được phân bổ xuống dòng để tổng dòng khớp tổng báo giá (P2I-09).
      const { version, lines } = await readAcceptedVersion(client, quoteId, quote.accepted_version);
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
        overrideVatRate: line.override_vat_rate === null ? null : num(line.override_vat_rate),
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
          // Đơn từ báo giá dùng đúng bảng giá của phiên bản khách chấp nhận (không đổi được).
          priceListId: version.price_list_id,
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

async function existing(client: CrmSqlClient, quoteId: string): Promise<ConvertQuoteResult> {
  const row = (
    await client.query<{ contract_id: string; contract_code: string; order_id: string | null; order_code: string | null; delivery_id: string | null }>(
      `SELECT k.id AS contract_id, k.code AS contract_code, o.id AS order_id, o.code AS order_code,
              (SELECT d.id FROM crm_schema.delivery_plans d WHERE d.order_id = o.id ORDER BY d.seq LIMIT 1) AS delivery_id
         FROM crm_schema.contracts k
         LEFT JOIN crm_schema.sales_orders o ON o.quote_id = k.quote_id AND o.source = 'QUOTE'
        WHERE k.quote_id = $1`,
      [quoteId],
    )
  ).rows[0];
  if (!row) throw new CrmConflictError('QUOTE_CONVERTED', 'Báo giá đã được chuyển thành hợp đồng.');
  // Báo giá gắn vào hợp đồng lập tay: không có đơn từ báo giá, đơn lập từ hợp đồng.
  if (!row.order_id || !row.order_code) {
    throw new CrmConflictError(
      'QUOTE_LINKED_TO_CONTRACT',
      `Báo giá đã gắn vào hợp đồng ${row.contract_code}; lập đơn bán từ hợp đồng đó.`,
      { contractId: row.contract_id, contractCode: row.contract_code },
    );
  }
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
