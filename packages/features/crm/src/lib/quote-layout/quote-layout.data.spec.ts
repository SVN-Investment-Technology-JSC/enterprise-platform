import { QUOTE_LAYOUT_VARIABLES, checkQuoteLayoutImage, type CustomFieldDefinition } from '@enterprise-platform/contracts-crm';
import { fixtureCustomer, fixtureDetail, fixtureLine, fixtureSeller, fixtureSellerVersion, fixtureVersion } from './quote-layout.fixtures';
import {
  SAMPLE_COMPANY_LOGO,
  buildQuoteLayoutData,
  companyHeaderLogo,
  quoteExportFileName,
  sampleQuoteLayoutData,
} from './quote-layout.data';

const people = [{ userId: 'u1', displayName: 'Nguyễn Văn An', email: 'an@example.com', phone: '0912' }];
const now = new Date(2026, 10, 6, 0, 30);

const definition = (patch: Partial<CustomFieldDefinition>): CustomFieldDefinition => ({
  id: '11111111-1111-4111-8111-111111111111',
  entityType: 'quote',
  name: 'Điều khoản thanh toán',
  fieldType: 'TEXT',
  options: [],
  required: false,
  sortOrder: 1,
  active: true,
  ...patch,
});

describe('buildQuoteLayoutData', () => {
  it('TC-RD-01: mẫu tính theo dòng: biến báo giá, khách, người phụ trách, tiền và dòng hàng', () => {
    const data = buildQuoteLayoutData({ detail: fixtureDetail(), customer: fixtureCustomer(), people, now, opportunityCode: 'DA01' });
    expect(data.values).toMatchObject({
      'quote.code': 'BG2600001',
      'quote.name': 'Báo giá bơm',
      'quote.date': '01/11/2026',
      'quote.validUntil': '01/12/2026',
      'quote.priceDate': '01/11/2026',
      'quote.versionNo': '1',
      'quote.typeName': 'Thiết bị',
      'quote.templateName': 'Mẫu thiết bị',
      'quote.note': 'Giao trong 7 ngày',
      'quote.status': 'Nháp',
      'customer.code': 'KH01',
      'customer.name': 'Công ty A',
      'customer.taxCode': '0101234567',
      'customer.address': '12 Láng, Hà Nội',
      'customer.phone': '0241234567',
      'customer.email': 'a@example.com',
      'opportunity.code': 'DA01',
      'opportunity.name': 'Dự án trạm bơm',
      'owner.name': 'Nguyễn Văn An',
      'owner.email': 'an@example.com',
      'owner.phone': '0912',
      'totals.subtotal': '1.800.000',
      'totals.discount': '200.000',
      'totals.fees': '0',
      'totals.vat': '180.000',
      'totals.grandTotal': '1.980.000',
      'totals.amountInWords': 'Một triệu chín trăm tám mươi nghìn đồng',
      today: '06/11/2026',
    });
    // Mọi biến cố định đều có khoá.
    for (const variable of QUOTE_LAYOUT_VARIABLES) expect(data.values).toHaveProperty([variable.key]);
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0].cells).toEqual({
      index: '1',
      materialCode: 'VT-01',
      materialName: 'Máy bơm',
      unit: 'Cái',
      quantity: '2',
      listPrice: '1.000.000',
      discountPercent: '10%',
      unitPrice: '900.000',
      lineAmount: '1.800.000',
      vatRate: '10%',
      vatAmount: '180.000',
      lineTotal: '1.980.000',
      category: 'Thiết bị',
    });
    expect(data.totals).toMatchObject({ subtotal: '1.800.000', lineDiscount: '200.000', orderDiscount: '0', vat: '180.000', grandTotal: '1.980.000' });
  });

  it('TC-RD-01: ngày dạng yyyy-mm-dd không lệch múi giờ', () => {
    const version = fixtureVersion({ form: { ...fixtureVersion().form, quoteDate: '2026-11-01' } });
    expect(buildQuoteLayoutData({ detail: fixtureDetail(version), now }).values['quote.date']).toBe('01/11/2026');
  });

  it('không lộ giá vốn, lợi nhuận', () => {
    const data = buildQuoteLayoutData({ detail: fixtureDetail(), customer: fixtureCustomer(), people, now });
    const text = JSON.stringify(data);
    expect(text).not.toContain('1.400.000');
    expect(text).not.toContain('400.000"');
    expect(text).not.toContain('700.000');
  });

  it('TC-RD-02: mẫu tính theo tổng đơn: chiết khấu, thuế tổng đơn, phí; tổng khớp server', () => {
    const base = fixtureVersion();
    const version = fixtureVersion({
      totals: { ...base.totals, discountAmount: 380_000, netAmount: 1_620_000, vatAmount: 129_600, totalAmount: 1_949_600 },
      form: {
        ...base.form,
        discountMode: 'ORDER',
        taxMode: 'ORDER',
        orderDiscount: { percent: 10, amount: 180_000, inputKind: 'PERCENT' },
        orderTax: { percent: 8, amount: 129_600, inputKind: 'PERCENT' },
        fees: [{ feeType: 'Lắp đặt', amount: 200_000 }],
        feesAmount: 200_000,
      },
    });
    const data = buildQuoteLayoutData({ detail: fixtureDetail(version), now });
    expect(data.totals).toEqual({
      subtotal: '1.800.000',
      lineDiscount: '200.000',
      orderDiscount: '180.000',
      fees: '200.000',
      shipping: '0',
      vat: '129.600',
      orderTax: '129.600',
      grandTotal: '1.949.600',
    });
    expect(data.values['totals.grandTotal']).toBe('1.949.600');
    expect(data.amountInWords).toBe('Một triệu chín trăm bốn mươi chín nghìn sáu trăm đồng');
    expect(data.values['totals.amountInWords']).toBe(data.amountInWords);
    // Thuế theo tổng đơn: cột VAT của dòng để trống, tổng dòng bằng thành tiền.
    expect(data.lines[0].cells).toMatchObject({ vatRate: '', vatAmount: '', lineTotal: '1.800.000' });
  });

  it('TC-RD-03: thiếu dữ liệu thì rỗng, không ném lỗi; trường tắt vẫn in, trường đã xoá rỗng', () => {
    const off = definition({ id: '22222222-2222-4222-8222-222222222222', active: false, fieldType: 'DATE', name: 'Ngày giao' });
    const number = definition({ id: '33333333-3333-4333-8333-333333333333', fieldType: 'NUMBER', name: 'Bảo hành' });
    const deletedId = '44444444-4444-4444-8444-444444444444';
    const version = fixtureVersion({
      validUntil: null,
      note: null,
      form: { ...fixtureVersion().form, quoteTypeName: null, customFields: { [off.id]: '2026-12-24', [number.id]: 1234.5, [deletedId]: 'cũ' } },
    });
    const detail = fixtureDetail(version, { opportunityId: null, opportunityName: null, ownerUserId: 'gone' });
    const data = buildQuoteLayoutData({
      detail,
      customer: fixtureCustomer({ taxCode: null, address: null }),
      people,
      customFields: [off, number],
      now,
    });
    expect(data.values).toMatchObject({
      'quote.validUntil': '',
      'quote.note': '',
      'quote.typeName': '',
      'customer.taxCode': '',
      'customer.address': '',
      'opportunity.code': '',
      'opportunity.name': '',
      'owner.name': '',
      'owner.email': '',
      [`custom.${off.id}`]: '24/12/2026',
      [`custom.${number.id}`]: '1.234,5',
    });
    expect(data.values[`custom.${deletedId}`]).toBeUndefined();
  });

  it('không có chi tiết khách: dùng mã, tên khách trên báo giá', () => {
    const data = buildQuoteLayoutData({ detail: fixtureDetail(), customer: null, now });
    expect(data.values['customer.name']).toBe('Công ty A');
    expect(data.values['customer.phone']).toBe('');
  });

  it('TC-RD-10: tiếng Việt tổ hợp (NFD) được chuẩn hoá NFC', () => {
    const nfd = 'Công ty Hoà Bình'.normalize('NFD');
    const data = buildQuoteLayoutData({ detail: fixtureDetail(), customer: fixtureCustomer({ name: nfd }), now });
    expect(data.values['customer.name']).toBe('Công ty Hoà Bình'.normalize('NFC'));
  });

  it('TC-RD-09: 200 dòng đánh số liên tục theo thứ tự', () => {
    const lines = Array.from({ length: 200 }, (_, index) => fixtureLine({ id: `l${index}`, lineNo: index + 5, materialName: `Hàng ${index + 1}` }));
    const data = buildQuoteLayoutData({ detail: fixtureDetail(fixtureVersion({ lines })), now });
    expect(data.lines).toHaveLength(200);
    expect(data.lines.map((line) => line.cells.index)).toEqual(lines.map((_, index) => String(index + 1)));
    expect(data.lines[199].cells.materialName).toBe('Hàng 200');
  });
});

describe('sampleQuoteLayoutData', () => {
  it('có đủ biến, dòng hàng và điền trường tuỳ biến', () => {
    const custom = definition({ fieldType: 'SELECT', options: ['30 ngày', '60 ngày'] });
    const data = sampleQuoteLayoutData([custom], now);
    for (const variable of QUOTE_LAYOUT_VARIABLES) expect(data.values[variable.key]).not.toBe('');
    expect(data.values[`custom.${custom.id}`]).toBe('30 ngày');
    expect(data.lines.length).toBeGreaterThan(0);
    expect(data.values['totals.grandTotal']).toBe(data.totals.grandTotal);
  });
});

describe('quoteExportFileName', () => {
  it('ghép mã và phiên bản, thay ký tự không hợp lệ', () => {
    expect(quoteExportFileName('BG2600001', 2)).toBe('BG2600001_v2');
    expect(quoteExportFileName('20261102/BG//383', 1)).toBe('20261102-BG-383_v1');
  });
});

describe('biến company.* và logo tổ chức (P3C6-06)', () => {
  it('lấy từ thông tin tổ chức trên phiên bản; logo theo sellerLogo', () => {
    const data = buildQuoteLayoutData({ detail: fixtureDetail(fixtureSellerVersion(fixtureSeller({ website: 'anphat.vn' }), 'data:image/png;base64,AAAA')), now });
    expect(data.values).toMatchObject({
      'company.name': 'Công ty TNHH Thiết bị An Phát',
      'company.shortName': 'An Phát',
      'company.address': '25 Trần Duy Hưng, Cầu Giấy, Hà Nội',
      'company.taxCode': '0101111111',
      'company.phone': '024 3333 1111',
      'company.email': 'baogia@anphat.vn',
      'company.website': 'anphat.vn',
      'company.bankAccount': '',
    });
    expect(data.companyLogo).toBe('data:image/png;base64,AAAA');
  });

  it('báo giá không chọn tổ chức: biến rỗng, không logo', () => {
    const data = buildQuoteLayoutData({ detail: fixtureDetail(), now });
    expect(data.values['company.name']).toBe('');
    expect(data.companyLogo).toBeNull();
  });

  it('companyHeaderLogo: bật cờ và có logo tổ chức thì dùng logo tổ chức, ngược lại logo của khối', () => {
    const block = { id: 'c', type: 'companyHeader', name: '', lines: [], logo: 'khối', logoPosition: 'left', align: 'left' } as const;
    expect(companyHeaderLogo({ ...block, logoFromOrganization: true }, { companyLogo: 'tổ chức' })).toBe('tổ chức');
    expect(companyHeaderLogo({ ...block, logoFromOrganization: true }, { companyLogo: null })).toBe('khối');
    expect(companyHeaderLogo(block, { companyLogo: 'tổ chức' })).toBe('khối');
  });

  it('dữ liệu mẫu có công ty mẫu và logo mẫu là PNG hợp lệ', () => {
    const data = sampleQuoteLayoutData([], now);
    expect(data.values['company.name']).toBe('Công ty Cổ phần Thiết bị Mẫu');
    expect(checkQuoteLayoutImage(SAMPLE_COMPANY_LOGO)).toBe('ok');
    expect(data.companyLogo).toBe(SAMPLE_COMPANY_LOGO);
  });
});
