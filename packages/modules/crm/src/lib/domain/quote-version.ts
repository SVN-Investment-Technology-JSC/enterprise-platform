import type {
  PricedLine,
  PricingTotals,
  QuoteComparison,
  QuoteLine,
  QuoteLineDifference,
  QuoteTotals,
  QuoteVersion,
} from '@enterprise-platform/contracts-crm';
import { computeMargin, roundVnd } from './pricing-engine.js';

/**
 * Giá vốn, lợi nhuận và so sánh phiên bản báo giá: hàm thuần.
 *
 * Giá vốn ước tính của dòng = giá bình quân của Kho lúc tính × số lượng, làm
 * tròn đến đồng (D4, TC-QUO-03). Lợi nhuận = thành tiền sau chiết khấu − giá
 * vốn; với cả báo giá cộng thêm phí vận chuyển thu của khách và trừ chi phí vận
 * chuyển bên bán chịu (TC-QUO-04).
 */

export interface LineCost {
  readonly estUnitCost: number | null;
  readonly estCost: number;
  readonly margin: number | null;
}

/** Giá vốn và biên của một dòng; giá vốn chưa biết thì tính là 0 (chính sách duyệt bắt riêng). */
export function costLine(line: Pick<PricedLine, 'lineAmount' | 'quantity'>, estUnitCost: number | null): LineCost {
  const estCost = estUnitCost === null ? 0 : roundVnd(estUnitCost * line.quantity);
  return { estUnitCost, estCost, margin: computeMargin(line.lineAmount, estCost) };
}

/** Tổng báo giá từ tổng của engine giá, giá vốn từng dòng và chi phí vận chuyển bên bán chịu. */
export function quoteTotals(pricing: PricingTotals, costs: readonly LineCost[], shippingCost: number): QuoteTotals {
  const goodsCost = costs.reduce((sum, cost) => sum + cost.estCost, 0);
  const revenue = pricing.netAmount + pricing.shippingAmount;
  const estCost = goodsCost + roundVnd(shippingCost);
  const discountPercent =
    pricing.grossAmount > 0 ? Math.round((pricing.discountAmount / pricing.grossAmount) * 100 * 10_000) / 10_000 : 0;
  return {
    grossAmount: pricing.grossAmount,
    discountAmount: pricing.discountAmount,
    netAmount: pricing.netAmount,
    shippingAmount: pricing.shippingAmount,
    vatAmount: pricing.vatAmount,
    totalAmount: pricing.totalAmount,
    estCost,
    profit: revenue - estCost,
    marginPercent: computeMargin(revenue, estCost),
    discountPercent,
  };
}

type ComparedFields = Pick<QuoteLine, 'quantity' | 'unitPrice' | 'discountPercent' | 'vatRate' | 'lineAmount' | 'lineTotal'>;
const COMPARED_FIELDS: readonly (keyof ComparedFields)[] = [
  'quantity',
  'unitPrice',
  'discountPercent',
  'vatRate',
  'lineAmount',
  'lineTotal',
];

const lineKey = (line: Pick<QuoteLine, 'materialId' | 'unit'>) => `${line.materialId}|${line.unit.trim().toLowerCase()}`;
const pick = (line: QuoteLine): ComparedFields => ({
  quantity: line.quantity,
  unitPrice: line.unitPrice,
  discountPercent: line.discountPercent,
  vatRate: line.vatRate,
  lineAmount: line.lineAmount,
  lineTotal: line.lineTotal,
});

/**
 * Khác biệt từng dòng giữa hai phiên bản (QUO-02): khớp dòng theo mặt hàng và
 * đơn vị; dòng chỉ có ở bản sau là thêm, chỉ có ở bản trước là bỏ, có ở cả hai
 * mà khác số lượng, đơn giá, chiết khấu, thuế hay thành tiền là đổi. Dòng giống
 * hệt không trả về.
 */
export function compareQuoteVersions(quoteId: string, from: QuoteVersion, to: QuoteVersion): QuoteComparison {
  const before = new Map(from.lines.map((line) => [lineKey(line), line]));
  const after = new Map(to.lines.map((line) => [lineKey(line), line]));
  const differences: QuoteLineDifference[] = [];
  for (const line of to.lines) {
    const previous = before.get(lineKey(line));
    if (!previous) {
      differences.push({ ...identity(line), change: 'ADDED', fields: [], from: null, to: pick(line) });
      continue;
    }
    const fields = COMPARED_FIELDS.filter((field) => previous[field] !== line[field]);
    if (fields.length) differences.push({ ...identity(line), change: 'CHANGED', fields, from: pick(previous), to: pick(line) });
  }
  for (const line of from.lines) {
    if (!after.has(lineKey(line))) {
      differences.push({ ...identity(line), change: 'REMOVED', fields: [], from: pick(line), to: null });
    }
  }
  return {
    quoteId,
    from,
    to,
    lines: differences,
    totalsDelta: {
      netAmount: to.totals.netAmount - from.totals.netAmount,
      vatAmount: to.totals.vatAmount - from.totals.vatAmount,
      totalAmount: to.totals.totalAmount - from.totals.totalAmount,
      profit: to.totals.profit - from.totals.profit,
    },
  };
}

function identity(line: QuoteLine) {
  return { materialId: line.materialId, materialCode: line.materialCode, materialName: line.materialName, unit: line.unit };
}
