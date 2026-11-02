import {
  customFieldError,
  parseFieldOptions,
  previewQuoteCode,
  quoteCodePatternError,
  quoteFormNameError,
  sortQuoteForms,
} from './quote-form.model';

describe('mẫu mã báo giá', () => {
  const day = new Date(2026, 10, 2);
  it('xem trước', () => {
    expect(previewQuoteCode('{yyyymmdd}/BG//{seq}', day)).toBe(
      '20261102/BG//383',
    );
    expect(previewQuoteCode('BG{yy}{mm}-{seq:5}', day)).toBe('BG2611-00383');
    expect(previewQuoteCode('', day)).toBeUndefined();
  });
  it('kiểm tra mẫu', () => {
    expect(quoteCodePatternError('')).toBeUndefined();
    expect(quoteCodePatternError('BG-{yyyy}')).toMatch(/một \{seq\}/);
    expect(quoteCodePatternError('{seq}{seq}')).toMatch(/một \{seq\}/);
    expect(quoteCodePatternError('{abc}{seq}')).toMatch(/không hợp lệ/);
    expect(quoteCodePatternError('Báo{seq}')).toMatch(/chữ không dấu/);
    expect(quoteCodePatternError('{seq:20}')).toMatch(/1 đến 12/);
    expect(quoteCodePatternError('{yy}/BG/{seq:4}')).toBeUndefined();
  });
  it('kiểm tra tên và sắp xếp', () => {
    expect(quoteFormNameError(' ', '', 'mẫu')).toMatch(/tên mẫu/);
    expect(quoteFormNameError('a', 'x', 'loại')).toMatch(/Thứ tự/);
    const rows = [
      { name: 'B', isDefault: false, active: true, sortOrder: 1 },
      { name: 'C', isDefault: false, active: false, sortOrder: 0 },
      { name: 'A', isDefault: true, active: true, sortOrder: 5 },
    ];
    expect(sortQuoteForms(rows).map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });
});

describe('trường tuỳ biến của báo giá', () => {
  it('tách lựa chọn theo dòng, bỏ trống và trùng', () => {
    expect(parseFieldOptions(' A \n\nB\r\nA')).toEqual(['A', 'B']);
  });
  it('kiểm nhập', () => {
    const base = { name: 'Nguồn', fieldType: 'TEXT', optionsText: '', sortOrder: '' };
    expect(customFieldError(base)).toBeUndefined();
    expect(customFieldError({ ...base, name: ' ' })).toMatch(/tên trường/);
    expect(customFieldError({ ...base, sortOrder: 'x' })).toMatch(/Thứ tự/);
    expect(customFieldError({ ...base, fieldType: 'SELECT' })).toMatch(/lựa chọn/);
    expect(customFieldError({ ...base, fieldType: 'SELECT', optionsText: 'A' })).toBeUndefined();
  });
});
