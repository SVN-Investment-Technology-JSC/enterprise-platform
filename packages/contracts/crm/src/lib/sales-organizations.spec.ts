import { QUOTE_LAYOUT_VARIABLES, defaultQuoteLayout, isQuoteLayoutVariable, validateQuoteLayout } from './quote-layout.js';
import {
  companyVariableValues,
  hasQuoteSeller,
  normalizeQuoteSeller,
  validateQuoteSeller,
  validateSalesOrganization,
} from './sales-organizations.js';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const valid = {
  name: ' Công ty TNHH Thiết bị Miền Bắc ',
  address: 'Số 1 Láng Hạ, Hà Nội',
  taxCode: '0101234567',
  phone: '024 1234 5678',
  email: 'kinhdoanh@mienbac.vn',
};

describe('validateSalesOrganization (TC-ORG-01)', () => {
  it('thiếu từng trường bắt buộc: lỗi tiếng Việt nêu tên trường', () => {
    for (const field of ['name', 'address', 'taxCode', 'phone', 'email'] as const) {
      const result = validateSalesOrganization({ ...valid, [field]: '  ' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({ field, message: expect.stringMatching(/^Vui lòng nhập /) }));
    }
  });

  it('MST 10 số hoặc 10-3 số; 9 số là lỗi', () => {
    expect(validateSalesOrganization({ ...valid, taxCode: '0101234567' }).ok).toBe(true);
    expect(validateSalesOrganization({ ...valid, taxCode: '0101234567-001' }).ok).toBe(true);
    const short = validateSalesOrganization({ ...valid, taxCode: '010123456' });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors[0]).toMatchObject({ field: 'taxCode' });
  });

  it('email sai dạng, chữ quá dài, thứ tự sai', () => {
    const result = validateSalesOrganization({ ...valid, email: 'abc@', bankName: 'x'.repeat(201), sortOrder: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.field).sort()).toEqual(['bankName', 'email', 'sortOrder']);
      expect(result.errors.find((error) => error.field === 'bankName')?.message).toBe('Ngân hàng tối đa 200 ký tự.');
    }
  });

  it('logo: PNG nhận; SVG, chữ lạ, quá 300 KB bị từ chối; null hoặc rỗng là không có logo', () => {
    const ok = validateSalesOrganization({ ...valid, logo: PNG_1PX });
    expect(ok.ok && ok.organization.logo).toBe(PNG_1PX);
    const svg = validateSalesOrganization({ ...valid, logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
    expect(!svg.ok && svg.errors[0]).toMatchObject({ field: 'logo', message: 'Logo phải là ảnh PNG hoặc JPEG.' });
    const big = validateSalesOrganization({ ...valid, logo: `data:image/png;base64,${'A'.repeat(420_000)}` });
    expect(!big.ok && big.errors[0]).toMatchObject({ field: 'logo', message: 'Logo vượt 300 KB. Hãy giảm kích thước ảnh.' });
    for (const logo of [null, '', undefined]) {
      const none = validateSalesOrganization({ ...valid, logo });
      expect(none.ok && none.organization.logo).toBeNull();
    }
  });

  it('chuẩn hoá: cắt khoảng trắng, tuỳ chọn rỗng là null, mặc định bật, thứ tự 0', () => {
    const result = validateSalesOrganization({ ...valid, website: '  ', code: ' MB ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.organization).toMatchObject({
        name: 'Công ty TNHH Thiết bị Miền Bắc',
        code: 'MB',
        website: null,
        isDefault: false,
        active: true,
        sortOrder: 0,
      });
    }
  });
});

describe('thông tin tổ chức trên báo giá', () => {
  it('validateQuoteSeller không ép bắt buộc, chỉ kiểm độ dài; rỗng hết là null', () => {
    expect(validateQuoteSeller({ phone: ' 0909 ' })).toEqual({ ok: true, seller: expect.objectContaining({ phone: '0909', name: '' }) });
    expect(validateQuoteSeller({ name: '  ' })).toEqual({ ok: true, seller: null });
    expect(validateQuoteSeller(null)).toEqual({ ok: true, seller: null });
    const long = validateQuoteSeller({ address: 'x'.repeat(501) });
    expect(long.ok).toBe(false);
  });

  it('hasQuoteSeller và biến company.*', () => {
    expect(hasQuoteSeller(normalizeQuoteSeller({}))).toBe(false);
    const seller = normalizeQuoteSeller(valid);
    expect(hasQuoteSeller(seller)).toBe(true);
    const values = companyVariableValues(seller);
    expect(values['company.name']).toBe('Công ty TNHH Thiết bị Miền Bắc');
    expect(values['company.website']).toBe('');
    expect(companyVariableValues(null)['company.taxCode']).toBe('');
    // Mọi biến company.* trong danh sách đều có giá trị (không sót trường).
    const keys = QUOTE_LAYOUT_VARIABLES.filter((variable) => variable.group === 'company').map((variable) => variable.key);
    expect(Object.keys(values).sort()).toEqual([...keys].sort());
  });
});

describe('biến company.* và logo theo tổ chức (TC-ORG-02)', () => {
  it('biến company.* hợp lệ; bố cục mặc định dùng biến và bật logo theo tổ chức', () => {
    expect(isQuoteLayoutVariable('company.taxCode')).toBe(true);
    const header = defaultQuoteLayout().blocks[0];
    expect(header).toMatchObject({ type: 'companyHeader', name: '{{company.name}}', logoFromOrganization: true });
    expect(validateQuoteLayout(defaultQuoteLayout()).ok).toBe(true);
  });

  it('logoFromOrganization không phải boolean là LAYOUT_INVALID; bỏ trống vẫn hợp lệ', () => {
    const layout = defaultQuoteLayout();
    const withFlag = (value: unknown) => ({ ...layout, blocks: [{ ...layout.blocks[0], logoFromOrganization: value }, ...layout.blocks.slice(1)] });
    const bad = validateQuoteLayout(withFlag('x'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toMatchObject({ code: 'LAYOUT_INVALID', path: 'blocks[0].logoFromOrganization' });
    const plain = { ...(layout.blocks[0] as unknown as Record<string, unknown>) };
    delete plain['logoFromOrganization'];
    const without = validateQuoteLayout({ ...layout, blocks: [plain, ...layout.blocks.slice(1)] });
    expect(without.ok).toBe(true);
    if (without.ok) expect(without.layout.blocks[0]).not.toHaveProperty('logoFromOrganization');
  });
});
