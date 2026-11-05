import type { QuoteLine, QuoteVersion } from '@enterprise-platform/contracts-crm';
import { priceQuote } from './pricing-engine.js';
import { compareQuoteVersions, costLine, quoteTotals } from './quote-version.js';

const CAP = '11111111-1111-4111-8111-111111111111';
const BT = '22222222-2222-4222-8222-222222222222';

describe('giá vốn và lợi nhuận', () => {
  it('TC-QUO-03: giá vốn dòng bằng giá bình quân của Kho × số lượng', () => {
    expect(costLine({ lineAmount: 9_500_000, quantity: 10 }, 800_000)).toEqual({ estUnitCost: 800_000, estCost: 8_000_000, margin: 15.79 });
    expect(costLine({ lineAmount: 1000, quantity: 3 }, 333.3333)).toEqual({ estUnitCost: 333.3333, estCost: 1000, margin: 0 });
    expect(costLine({ lineAmount: 0, quantity: 1 }, null)).toEqual({ estUnitCost: null, estCost: 0, margin: null });
  });

  it('TC-QUO-04: phí vận chuyển là dòng dịch vụ VAT 10%, vào tổng; chi phí bên bán chịu trừ vào lợi nhuận', () => {
    const priced = priceQuote({
      date: '2026-10-27',
      customerId: null,
      customerGroupId: null,
      lines: [{ materialId: CAP, quantity: 10, unit: 'Cái', override: { unitPrice: 950_000 } }],
      priceLists: [
        {
          id: 'l',
          code: 'BG',
          isStandard: true,
          validFrom: '2026-01-01',
          validTo: null,
          status: 'ACTIVE',
          customerGroupIds: [],
          items: [{ materialId: CAP, unit: 'Cái', price: 1_000_000, vatRate: 10 }],
        },
      ],
      policies: [],
      discountCapPercent: 10,
      shipping: { amount: 200_000, vatRate: 10 },
    });
    expect(priced.totals.netAmount + priced.totals.shippingAmount).toBe(9_700_000);
    expect(priced.shipping?.vatAmount).toBe(20_000);
    const costs = [costLine(priced.lines[0], 800_000)];
    // Bên bán chịu chi phí vận chuyển 200.000: lợi nhuận = 9.700.000 − 8.000.000 − 200.000.
    expect(quoteTotals(priced.totals, costs, 200_000)).toMatchObject({ estCost: 8_200_000, profit: 1_500_000, marginPercent: 15.46, discountPercent: 5 });
    // Khách trả đủ phí, bên bán không chịu thêm.
    expect(quoteTotals(priced.totals, costs, 0)).toMatchObject({ profit: 1_700_000 });
  });
});

function line(materialId: string, quantity: number, unitPrice: number, extra: Partial<QuoteLine> = {}): QuoteLine {
  const lineAmount = quantity * unitPrice;
  return {
    id: `${materialId}-${quantity}`,
    lineNo: 1,
    materialId,
    materialCode: materialId === CAP ? 'QA-KHO-CAP' : 'QA-KHO-BT',
    materialName: 'x',
    unit: 'Cái',
    materialKind: 'STOCK',
    category: null,
    quantity,
    listPrice: unitPrice,
    priceSource: 'STANDARD_LIST',
    priceReferenceCode: null,
    appliedPolicies: [],
    policyPercent: 0,
    discountPercent: 0,
    cappedAt: null,
    overridden: false,
    overrideUnitPrice: null,
    overrideDiscountPercent: null,
    unitPrice,
    grossAmount: lineAmount,
    discountAmount: 0,
    vatRate: 10,
    lineAmount,
    vatAmount: lineAmount / 10,
    lineTotal: lineAmount * 1.1,
    estUnitCost: null,
    estCost: 0,
    margin: null,
    availableStock: null,
    ...extra,
  };
}

function version(versionNo: number, lines: QuoteLine[]): QuoteVersion {
  const net = lines.reduce((sum, entry) => sum + entry.lineAmount, 0);
  return {
    totals: { grossAmount: net, discountAmount: 0, netAmount: net, shippingAmount: 0, vatAmount: net / 10, totalAmount: net * 1.1, estCost: 0, profit: net, marginPercent: 100, discountPercent: 0 },
    versionNo,
    lines,
  } as unknown as QuoteVersion;
}

describe('so sánh phiên bản (TC-QUO-07)', () => {
  it('tô đúng dòng thêm, bỏ, đổi và chênh lệch tổng; dòng giống hệt không trả', () => {
    const v1 = version(1, [line(CAP, 10, 100), line(BT, 1, 50)]);
    const v2 = version(2, [line(CAP, 12, 100), line('33333333-3333-4333-8333-333333333333', 2, 10)]);
    const result = compareQuoteVersions('q', v1, v2);
    expect(result.lines.map((entry) => [entry.materialId, entry.change])).toEqual([
      [CAP, 'CHANGED'],
      ['33333333-3333-4333-8333-333333333333', 'ADDED'],
      [BT, 'REMOVED'],
    ]);
    expect(result.lines[0].fields).toEqual(['quantity', 'lineAmount', 'lineTotal']);
    expect(result.totalsDelta.netAmount).toBe(1220 - 1050);
    expect(compareQuoteVersions('q', v1, v1).lines).toEqual([]);
  });
});
