import {
  canonicalToDisplay,
  formatCurrencyVn,
  formatQuantityVn,
  formatVnWhileTyping,
  parseVnNumber,
} from './currency-format';

describe('formatCurrencyVn', () => {
  it('giữ số lẻ và ngăn nghìn bằng dấu chấm', () => {
    expect(formatCurrencyVn(500000000.01)).toBe('500.000.000,01');
    expect(formatCurrencyVn('500000000.01')).toBe('500.000.000,01');
  });

  it('số nguyên không thừa ,00 trừ khi bật fixedDecimals', () => {
    expect(formatCurrencyVn(500000000)).toBe('500.000.000');
    expect(formatCurrencyVn(500000000, { fixedDecimals: true })).toBe('500.000.000,00');
  });

  it('cắt theo maxDecimals', () => {
    expect(formatCurrencyVn(1234.5678)).toBe('1.234,57');
    expect(formatCurrencyVn(1234.5678, { maxDecimals: 0 })).toBe('1.235');
  });

  it('thêm đơn vị khi showUnit', () => {
    expect(formatCurrencyVn(1500, { showUnit: true })).toBe('1.500 đ');
    expect(formatCurrencyVn(1500, { showUnit: true, unitSymbol: 'VND' })).toBe('1.500 VND');
  });

  it('số 0 khác với chưa khai báo', () => {
    expect(formatCurrencyVn(0)).toBe('0');
    expect(formatCurrencyVn(null)).toBe('—');
    expect(formatCurrencyVn(undefined)).toBe('—');
    expect(formatCurrencyVn('')).toBe('—');
    expect(formatCurrencyVn(Number.NaN)).toBe('—');
    expect(formatCurrencyVn(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatCurrencyVn('abc', { fallback: 'n/a' })).toBe('n/a');
  });

  it('số âm', () => {
    expect(formatCurrencyVn(-1250.5)).toBe('-1.250,5');
  });

  it('chuỗi số chuẩn từ API không bị hiểu nhầm là hàng nghìn', () => {
    expect(formatCurrencyVn('250.500')).toBe('250,5');
  });

  it('chuỗi kiểu Việt Nam', () => {
    expect(formatCurrencyVn('500.000.000,01')).toBe('500.000.000,01');
  });
});

describe('formatQuantityVn', () => {
  it('tối đa 3 chữ số thập phân, rỗng là 0', () => {
    expect(formatQuantityVn(1234.56789)).toBe('1.234,568');
    expect(formatQuantityVn(12)).toBe('12');
    expect(formatQuantityVn(null)).toBe('0');
    expect(formatQuantityVn(undefined, 3, '—')).toBe('—');
  });
});

describe('parseVnNumber', () => {
  it.each([
    ['500.000.000,01', 500000000.01],
    ['500000000,01', 500000000.01],
    ['500000000.01', 500000000.01],
    ['1.500', 1500],
    ['1.234.567', 1234567],
    ['1.5', 1.5],
    ['1,5', 1.5],
    ['1,234.5', 1234.5],
    ['-1.250,5', -1250.5],
    ['(1.250)', -1250],
    ['500.000 đ', 500000],
    ['500 000 VND', 500000],
    ['500.000 ₫', 500000],
    ['0', 0],
    ['-0', 0],
    ['  42 ', 42],
  ])('%s', (input, expected) => {
    expect(parseVnNumber(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '1,2,3', '1.2.3', '12a', ',', '.', '-', '1,000,000.5,2'])(
    'không hợp lệ: "%s"',
    (input) => {
      expect(parseVnNumber(input)).toBeNull();
    },
  );

  it('null, undefined và số', () => {
    expect(parseVnNumber(null)).toBeNull();
    expect(parseVnNumber(undefined)).toBeNull();
    expect(parseVnNumber(1.5)).toBe(1.5);
    expect(parseVnNumber(Number.NaN)).toBeNull();
  });

  it('khứ hồi với format', () => {
    for (const value of [0, 1, 99.5, 1000, 1234.56, 500000000.01, -42.25]) {
      expect(parseVnNumber(formatCurrencyVn(value))).toBe(value);
    }
  });
});

describe('formatVnWhileTyping', () => {
  it('tự chèn dấu chấm ngăn nghìn', () => {
    expect(formatVnWhileTyping('500000000')).toEqual({ display: '500.000.000', canonical: '500000000' });
  });

  it('dấu phẩy là thập phân và giữ dấu phẩy gõ dở', () => {
    expect(formatVnWhileTyping('500,')).toEqual({ display: '500,', canonical: '500' });
    expect(formatVnWhileTyping('500.000.000,01')).toEqual({
      display: '500.000.000,01',
      canonical: '500000000.01',
    });
  });

  it('cắt phần thập phân theo maxDecimals', () => {
    expect(formatVnWhileTyping('1,23456').canonical).toBe('1.23');
    expect(formatVnWhileTyping('1,23456', { maxDecimals: 3 }).canonical).toBe('1.234');
    expect(formatVnWhileTyping('12,5', { maxDecimals: 0 })).toEqual({ display: '125', canonical: '125' });
  });

  it('bỏ ký tự lạ và số 0 đầu', () => {
    expect(formatVnWhileTyping('abc').canonical).toBe('');
    expect(formatVnWhileTyping('007').canonical).toBe('7');
    expect(formatVnWhileTyping(',5')).toEqual({ display: '0,5', canonical: '0.5' });
    expect(formatVnWhileTyping('0')).toEqual({ display: '0', canonical: '0' });
  });

  it('chỉ nhận dấu trừ khi cho phép', () => {
    expect(formatVnWhileTyping('-12').canonical).toBe('12');
    expect(formatVnWhileTyping('-12', { allowNegative: true })).toEqual({ display: '-12', canonical: '-12' });
    expect(formatVnWhileTyping('-', { allowNegative: true })).toEqual({ display: '-', canonical: '' });
  });

  it('rỗng', () => {
    expect(formatVnWhileTyping('')).toEqual({ display: '', canonical: '' });
  });
});

describe('canonicalToDisplay', () => {
  it('đổi chuỗi chuẩn sang hiển thị', () => {
    expect(canonicalToDisplay('500000000.01')).toBe('500.000.000,01');
    expect(canonicalToDisplay('-1234')).toBe('-1.234');
    expect(canonicalToDisplay('')).toBe('');
  });
});
