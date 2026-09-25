import {
  formatPercent,
  formatVnd,
  formatVndCompact,
  parseVndInput,
  toVndInput,
} from './money';

/**
 * `Intl` chèn khoảng trắng không ngắt (U+00A0) trước ký hiệu tiền tệ; đổi về
 * khoảng trắng thường để so sánh không phụ thuộc chi tiết đó.
 */
const plain = (text: string) => text.replace(/\u00a0/g, ' ');

describe('formatVndCompact', () => {
  it('đúng ví dụ của đặc tả: 25,5 tỷ', () => {
    expect(formatVndCompact(25_500_000_000)).toBe('25,5 tỷ');
  });

  it('bỏ ,0 thừa', () => {
    expect(formatVndCompact(25_000_000_000)).toBe('25 tỷ');
  });

  it('dưới một tỷ thì đổi sang triệu', () => {
    expect(formatVndCompact(850_000_000)).toBe('850 triệu');
  });

  it('dưới một triệu thì đổi sang nghìn', () => {
    expect(formatVndCompact(12_500)).toBe('12,5 nghìn');
  });

  it('số âm giữ dấu — lợi nhuận âm là thông tin', () => {
    expect(formatVndCompact(-2_100_000_000)).toBe('-2,1 tỷ');
  });

  it('rỗng thì gạch ngang, không phải 0', () => {
    expect(formatVndCompact(null)).toBe('—');
    expect(formatVndCompact(undefined)).toBe('—');
  });
});

describe('formatVnd', () => {
  it('đủ tới đồng, ngăn nghìn bằng dấu chấm', () => {
    expect(plain(formatVnd(25_500_000_000))).toBe('25.500.000.000 ₫');
  });

  it('rỗng thì gạch ngang', () => {
    expect(formatVnd(null)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('một chữ số thập phân, dấu phẩy kiểu Việt', () => {
    expect(formatPercent(21.2)).toBe('21,2%');
  });

  it('rỗng thì gạch ngang', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('parseVndInput', () => {
  it('đọc được kiểu gõ có dấu chấm ngăn nghìn', () => {
    expect(parseVndInput('25.500.000.000')).toBe(25_500_000_000);
  });

  it('đọc được kiểu gõ liền', () => {
    expect(parseVndInput('25500000000')).toBe(25_500_000_000);
  });

  it('dấu phẩy là phần thập phân', () => {
    expect(parseVndInput('1.000,5')).toBe(1000.5);
  });

  it('bỏ ký hiệu tiền và khoảng trắng', () => {
    expect(parseVndInput(' 1.000 ₫ ')).toBe(1000);
  });

  it('ô trống là null — xoá giá trị, khác với 0', () => {
    expect(parseVndInput('   ')).toBeNull();
    expect(parseVndInput('0')).toBe(0);
  });

  it('chuỗi không đọc được thì undefined, để form báo lỗi', () => {
    expect(parseVndInput('abc')).toBeUndefined();
    expect(parseVndInput('1,2,3')).toBeUndefined();
  });
});

describe('toVndInput', () => {
  it('điền sẵn đúng kiểu người dùng sẽ gõ, và đọc ngược lại ra cùng số', () => {
    const text = toVndInput(25_500_000_000);
    expect(text).toBe('25.500.000.000');
    expect(parseVndInput(text)).toBe(25_500_000_000);
  });

  it('rỗng thì ô trống', () => {
    expect(toVndInput(null)).toBe('');
  });
});
