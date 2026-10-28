import { factAmounts } from '../domain/sales-report.js';
import type { CrmSqlClient } from './audit-log.js';

/**
 * Ghi `sales_facts` (T7-01), gọi trong transaction của bên gọi, ngay sau khi số
 * đã giao, giá vốn thực tế của dòng đơn đã đổi:
 *
 * - chứng từ xuất kho ghi sổ (`inventory.stock.issued`), kể cả dòng dịch vụ của
 *   đợt được ghi nhận cùng chứng từ đó;
 * - đợt chỉ có dịch vụ (không qua Kho);
 * - chứng từ đảo: dòng âm (số lượng, doanh thu, VAT, giá vốn đều âm).
 *
 * Mỗi dòng đơn có số đã giao hoặc giá vốn đổi sinh một dòng; khoá
 * `(document_id, order_line_id)` để nhận trùng không ghi lại.
 */

/** Số đã giao và giá vốn thực tế của từng dòng đơn ngay lúc gọi. */
export type SalesFactSnapshot = ReadonlyMap<string, { readonly delivered: number; readonly cost: number }>;

/** Migration 0011 đã chạy chưa (sự kiện Kho có thể đến khi tenant còn ở 0010). */
async function salesFactsReady(client: CrmSqlClient): Promise<boolean> {
  const result = await client.query<{ ready: boolean }>(`SELECT to_regclass('crm_schema.sales_facts') IS NOT NULL AS ready`);
  return result.rows[0]?.ready === true;
}

/** Chụp số đã giao, giá vốn của các dòng đơn trước khi áp chứng từ. */
export async function salesFactSnapshot(client: CrmSqlClient, orderId: string): Promise<SalesFactSnapshot> {
  const result = await client.query<{ id: string; delivered_quantity: string; actual_cost: string }>(
    `SELECT id, delivered_quantity, actual_cost FROM crm_schema.sales_order_lines WHERE order_id = $1`,
    [orderId],
  );
  return new Map(result.rows.map((row) => [row.id, { delivered: Number(row.delivered_quantity), cost: Number(row.actual_cost) }]));
}

interface LineRow {
  id: string;
  material_id: string;
  material_code: string;
  material_name: string;
  material_kind: string;
  category: string | null;
  quantity: string;
  line_amount: string;
  vat_amount: string;
  delivered_quantity: string;
  actual_cost: string;
}

/** Ghi các dòng giao của một chứng từ; trả số dòng đã ghi. */
export async function recordSalesFacts(
  client: CrmSqlClient,
  input: {
    readonly orderId: string;
    readonly deliveryId: string;
    readonly before: SalesFactSnapshot;
    readonly sourceType: 'stock_issue' | 'service_delivery';
    /** Id chứng từ xuất của Kho; đợt chỉ có dịch vụ: id đợt giao. */
    readonly documentId: string;
    readonly documentCode: string | null;
    readonly reversesDocumentId: string | null;
    /** Thời điểm ghi sổ (ISO); rỗng thì lúc ghi. */
    readonly deliveredAt: string | null;
    /** Ngày giao theo giờ Việt Nam. */
    readonly deliveredDate: string;
  },
): Promise<number> {
  if (!(await salesFactsReady(client))) return 0;
  const lines = (
    await client.query<LineRow>(
      `SELECT id, material_id, material_code, material_name, material_kind, category, quantity, line_amount, vat_amount,
              delivered_quantity, actual_cost
         FROM crm_schema.sales_order_lines WHERE order_id = $1 ORDER BY line_no`,
      [input.orderId],
    )
  ).rows;
  let written = 0;
  for (const line of lines) {
    const before = input.before.get(line.id) ?? { delivered: 0, cost: 0 };
    const delivered = Number(line.delivered_quantity);
    const quantity = Math.round((delivered - before.delivered) * 1000) / 1000;
    const cost = Math.round((Number(line.actual_cost) - before.cost) * 100) / 100;
    if (!quantity && !cost) continue;
    const amounts = factAmounts(
      { quantity: Number(line.quantity), lineAmount: Number(line.line_amount), vatAmount: Number(line.vat_amount) },
      before.delivered,
      delivered,
    );
    const inserted = await client.query(
      `INSERT INTO crm_schema.sales_facts
         (source_type, document_id, document_code, reverses_document_id, delivery_id, order_id, order_line_id, contract_id,
          customer_id, customer_group_id, region, province, owner_user_id, material_id, material_code, material_name,
          material_kind, category, delivered_at, delivered_date, quantity, revenue, vat_amount, cost_amount)
       SELECT $1, $2, $3, $4, $5, o.id, $6, o.contract_id, o.customer_id, c.group_id, c.region, c.province, o.owner_user_id,
              $7, $8, $9, $10, $11, COALESCE($12::timestamptz, now()), $13::date, $14, $15, $16, $17
         FROM crm_schema.sales_orders o JOIN crm_schema.customers c ON c.id = o.customer_id
        WHERE o.id = $18
       ON CONFLICT (document_id, order_line_id) DO NOTHING
       RETURNING id`,
      [
        input.sourceType,
        input.documentId,
        input.documentCode?.slice(0, 100) ?? null,
        input.reversesDocumentId,
        input.deliveryId,
        line.id,
        line.material_id,
        line.material_code,
        line.material_name,
        line.material_kind,
        line.category,
        input.deliveredAt,
        input.deliveredDate,
        quantity,
        amounts.revenue,
        amounts.vatAmount,
        cost,
        input.orderId,
      ],
    );
    written += inserted.rows.length;
  }
  return written;
}
