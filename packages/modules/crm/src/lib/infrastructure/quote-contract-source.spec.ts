import { assertQuoteLinkable, contractLines, type QuoteLineRow, type QuoteSourceRow } from './quote-contract-source.js';

const CUSTOMER = '44444444-4444-4444-8444-444444444444';
const OTHER = '77777777-7777-4777-8777-777777777777';

const quote = (extra: Partial<QuoteSourceRow> = {}): QuoteSourceRow => ({
  code: 'BG-001',
  customer_id: CUSTOMER,
  customer_code: 'KH1',
  customer_name: 'Khách A',
  opportunity_id: null,
  owner_user_id: 'u1',
  status: 'ACCEPTED',
  accepted_version: 2,
  converted_at: null,
  customer_address: null,
  ...extra,
});

const line = (extra: Partial<QuoteLineRow>): QuoteLineRow => ({
  id: 'l',
  line_no: 1,
  material_id: 'm1',
  material_code: 'CAP',
  material_name: 'Cáp',
  unit: 'Cái',
  material_kind: 'STOCK',
  category: null,
  quantity: '1',
  list_price: '100',
  price_source: 'GROUP_LIST',
  price_reference_id: null,
  price_reference_code: null,
  discount_percent: '0',
  overridden: false,
  override_unit_price: null,
  override_discount_percent: null,
  override_vat_rate: null,
  unit_price: '100',
  gross_amount: '100',
  discount_amount: '0',
  vat_rate: '10',
  line_amount: '100',
  vat_amount: '10',
  line_total: '110',
  est_unit_cost: null,
  ...extra,
});

describe('assertQuoteLinkable', () => {
  it('báo giá khách chấp nhận, chưa chuyển, cùng khách: trả phiên bản chấp nhận', () => {
    expect(assertQuoteLinkable(quote(), CUSTOMER)).toBe(2);
    expect(assertQuoteLinkable(quote())).toBe(2);
  });

  it('đã chuyển hoặc gắn hợp đồng: 409 QUOTE_CONVERTED', () => {
    expect(() => assertQuoteLinkable(quote({ converted_at: new Date() }), CUSTOMER)).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'QUOTE_CONVERTED' }),
    );
  });

  it('chưa khách chấp nhận (kể cả thiếu phiên bản chấp nhận): 409 QUOTE_NOT_ACCEPTED', () => {
    for (const row of [quote({ status: 'SENT' }), quote({ status: 'PENDING' }), quote({ accepted_version: null })]) {
      expect(() => assertQuoteLinkable(row, CUSTOMER)).toThrow(expect.objectContaining({ statusCode: 409, code: 'QUOTE_NOT_ACCEPTED' }));
    }
  });

  it('khác khách của hợp đồng: 409 QUOTE_CUSTOMER_MISMATCH, câu báo nêu tên khách của báo giá', () => {
    expect(() => assertQuoteLinkable(quote(), OTHER)).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'QUOTE_CUSTOMER_MISMATCH', message: expect.stringContaining('Khách A') }),
    );
  });
});

describe('contractLines', () => {
  it('gộp dòng trùng mặt hàng và đơn vị (không phân biệt hoa thường), đánh lại số dòng', () => {
    const lines = contractLines([
      line({ id: 'a', quantity: '2', line_amount: '200' }),
      line({ id: 'b', line_no: 2, material_id: 'm2', material_code: 'BT', unit: 'Gói', quantity: '1', line_amount: '50', unit_price: '50' }),
      line({ id: 'c', line_no: 3, unit: 'cái ', quantity: '0.5', line_amount: '50' }),
    ]);
    expect(lines.map((item) => [item.lineNo, item.materialCode, item.quantity, item.lineAmount, item.unitPrice, item.vatRate])).toEqual([
      [1, 'CAP', 2.5, 250, 100, 10],
      [2, 'BT', 1, 50, 50, 10],
    ]);
  });
});
