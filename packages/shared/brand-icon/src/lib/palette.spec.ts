import {
  DEFAULT_PALETTE,
  HEX_PATTERN,
  brandKeyOf,
  brandPaint,
  displayPaint,
  isBrandPaint,
  normalizeHex,
  normalizePalette,
  resolveBrandHex,
  resolvePaint,
  type BrandPalette,
} from './palette';

const custom: BrandPalette = { tokens: [{ key: 'primary', label: 'Chính', hex: '#112233' }] };

describe('bảng màu mặc định', () => {
  it('có khoá duy nhất và mã hex hợp lệ', () => {
    expect(DEFAULT_PALETTE.tokens.length).toBeGreaterThanOrEqual(5);
    expect(new Set(DEFAULT_PALETTE.tokens.map((token) => token.key)).size).toBe(DEFAULT_PALETTE.tokens.length);
    for (const token of DEFAULT_PALETTE.tokens) {
      expect(HEX_PATTERN.test(token.hex)).toBe(true);
      expect(token.key).toMatch(/^[a-z0-9][a-z0-9-]{0,31}$/);
      expect(token.label.length).toBeGreaterThan(0);
    }
  });
});

describe('paint thương hiệu', () => {
  it('brandPaint, isBrandPaint, brandKeyOf', () => {
    expect(brandPaint('sapphire')).toBe('brand:sapphire');
    expect(isBrandPaint('brand:sapphire')).toBe(true);
    expect(isBrandPaint('#fff')).toBe(false);
    expect(isBrandPaint('none')).toBe(false);
    expect(brandKeyOf('brand:sapphire')).toBe('sapphire');
    expect(brandKeyOf('currentColor')).toBeNull();
    expect(brandKeyOf(brandPaint('a-b'))).toBe('a-b');
  });

  it('normalizeHex: mở rộng mã ngắn, chuyển chữ thường, cắt khoảng trắng, từ chối mã sai', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('  #FF8800  ')).toBe('#ff8800');
    expect(normalizeHex('#2563eb')).toBe('#2563eb');
    for (const bad of ['', 'ff8800', '#ff88', '#ff88000', '#gggggg', 'red', '#12', '#1234567']) expect(normalizeHex(bad)).toBeNull();
  });

  it('resolveBrandHex: khoá có trong bảng, khoá lạ, hex, và các giá trị không có màu', () => {
    expect(resolveBrandHex('brand:primary', custom)).toBe('#112233');
    expect(resolveBrandHex('brand:khong-co', custom)).toBe('#000000');
    expect(resolveBrandHex('#ABC', custom)).toBe('#aabbcc');
    expect(resolveBrandHex('none', custom)).toBeNull();
    expect(resolveBrandHex('currentColor', custom)).toBeNull();
  });

  it('resolvePaint ở chế độ currentColor: mọi màu thành currentColor, trừ none', () => {
    for (const paint of ['brand:sapphire', '#ff0000', 'currentColor', 'rác']) expect(resolvePaint(paint, 'currentColor', DEFAULT_PALETTE)).toBe('currentColor');
    expect(resolvePaint('none', 'currentColor', DEFAULT_PALETTE)).toBe('none');
    expect(resolvePaint('', 'currentColor', DEFAULT_PALETTE)).toBe('none');
  });

  it('resolvePaint ở chế độ brand: ra hex; currentColor, none giữ nguyên; rác thành currentColor', () => {
    expect(resolvePaint('brand:sapphire', 'brand', DEFAULT_PALETTE)).toBe('#2563eb');
    expect(resolvePaint('#ABC', 'brand', DEFAULT_PALETTE)).toBe('#aabbcc');
    expect(resolvePaint('currentColor', 'brand', DEFAULT_PALETTE)).toBe('currentColor');
    expect(resolvePaint('none', 'brand', DEFAULT_PALETTE)).toBe('none');
    expect(resolvePaint('', 'brand', DEFAULT_PALETTE)).toBe('none');
    expect(resolvePaint('rác', 'brand', DEFAULT_PALETTE)).toBe('currentColor');
  });

  it('displayPaint thay currentColor bằng màu mực trên canvas', () => {
    expect(displayPaint('currentColor', 'currentColor', DEFAULT_PALETTE, '#111111')).toBe('#111111');
    expect(displayPaint('brand:sapphire', 'currentColor', DEFAULT_PALETTE, '#111111')).toBe('#111111');
    expect(displayPaint('brand:sapphire', 'brand', DEFAULT_PALETTE, '#111111')).toBe('#2563eb');
    expect(displayPaint('currentColor', 'brand', DEFAULT_PALETTE, '#111111')).toBe('#111111');
    expect(displayPaint('none', 'brand', DEFAULT_PALETTE, '#111111')).toBe('none');
  });
});

describe('normalizePalette', () => {
  it('đầu vào lạ trả về bảng mặc định', () => {
    for (const value of [null, undefined, 5, 'x', [], {}, { tokens: 'x' }, { tokens: [] }]) expect(normalizePalette(value)).toBe(DEFAULT_PALETTE);
  });

  it('giữ màu hợp lệ, chuẩn hoá hex, tự đặt nhãn bằng khoá nếu thiếu', () => {
    const result = normalizePalette({ tokens: [{ key: 'main', label: '  Chính  ', hex: '#ABC' }, { key: 'sub', hex: '#123456' }] });
    expect(result.tokens).toEqual([
      { key: 'main', label: 'Chính', hex: '#aabbcc' },
      { key: 'sub', label: 'sub', hex: '#123456' },
    ]);
  });

  it('bỏ màu có khoá sai định dạng, hex sai, hoặc khoá trùng (giữ màu đầu)', () => {
    const result = normalizePalette({
      tokens: [
        { key: 'ok', hex: '#111111' },
        { key: 'ok', hex: '#222222' },
        { key: 'Bad Key', hex: '#333333' },
        { key: 'bad"key', hex: '#333333' },
        { key: '', hex: '#333333' },
        { key: 'nohex', hex: 'red' },
        { key: 'nohex2' },
        null,
        5,
        { key: 'x'.repeat(40), hex: '#444444' },
        { key: 'good-2', hex: '#555555' },
      ],
    });
    expect(result.tokens.map((token) => token.key)).toEqual(['ok', 'good-2']);
    expect(result.tokens[0].hex).toBe('#111111');
  });

  it('nhãn cắt 40 ký tự; tối đa 64 màu', () => {
    const long = normalizePalette({ tokens: [{ key: 'a', label: 'n'.repeat(100), hex: '#111111' }] });
    expect(long.tokens[0].label).toHaveLength(40);
    const many = normalizePalette({ tokens: Array.from({ length: 100 }, (_, index) => ({ key: `k${index}`, hex: '#111111' })) });
    expect(many.tokens).toHaveLength(64);
  });

  it('toàn bộ màu bị loại thì quay về bảng mặc định', () => {
    expect(normalizePalette({ tokens: [{ key: '!!', hex: 'x' }] })).toBe(DEFAULT_PALETTE);
  });

  it('chuẩn hoá lần hai không đổi', () => {
    const once = normalizePalette({ tokens: [{ key: 'a', hex: '#ABC' }] });
    expect(normalizePalette(once)).toEqual(once);
  });
});
