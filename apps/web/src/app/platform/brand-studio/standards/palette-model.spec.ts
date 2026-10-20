import {
  DEFAULT_PALETTE,
  brandPaint,
  createDocument,
  createShape,
  normalizePalette,
  type BrandPalette,
  type IconDocument,
} from '@enterprise-platform/shared-brand-icon';
import {
  MAX_TOKENS,
  addToken,
  keyFromLabel,
  moveToken,
  removeToken,
  renameToken,
  reorderTokens,
  tokenUsage,
  uniqueKey,
  updateHex,
  type PaletteEdit,
} from './palette-model';

const palette: BrandPalette = {
  tokens: [
    { key: 'xanh', label: 'Xanh', hex: '#2563eb' },
    { key: 'do', label: 'Đỏ', hex: '#ef4444' },
    { key: 'vang', label: 'Vàng', hex: '#f59e0b' },
  ],
};

const doc = (id: string, ...paints: Array<[fill: string, stroke: string]>): IconDocument =>
  createDocument({
    id,
    name: id,
    shapes: paints.map(([fill, stroke]) => createShape({ type: 'rect', x: 4, y: 4, width: 8, height: 8, rx: 0 }, { fill, stroke })),
  });

const keys = (value: BrandPalette) => value.tokens.map((token) => token.key);

function ok(edit: PaletteEdit): BrandPalette {
  if (!edit.ok) throw new Error(`mong đợi thành công, nhận lỗi: ${edit.error}`);
  return edit.palette;
}

describe('keyFromLabel', () => {
  it('chuyển tên tiếng Việt thành slug ASCII', () => {
    expect(keyFromLabel('Xanh Sapphire')).toBe('xanh-sapphire');
    expect(keyFromLabel('  Đỏ thẫm (chính) ')).toBe('do-tham-chinh');
  });

  it('tên không có chữ hay số thì dùng "mau"', () => {
    expect(keyFromLabel('')).toBe('mau');
    expect(keyFromLabel('!!!')).toBe('mau');
    expect(keyFromLabel('色')).toBe('mau');
  });

  it('cắt tối đa 32 ký tự và không kết thúc bằng gạch nối', () => {
    const key = keyFromLabel('một hai ba bốn năm sáu bảy tám chín mười mười một');
    expect(key.length).toBeLessThanOrEqual(32);
    expect(key.endsWith('-')).toBe(false);
    expect(key).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });
});

describe('uniqueKey', () => {
  it('giữ nguyên khi chưa trùng, thêm hậu tố khi trùng', () => {
    expect(uniqueKey('xanh', new Set(['do']))).toBe('xanh');
    expect(uniqueKey('xanh', new Set(['xanh']))).toBe('xanh-2');
    expect(uniqueKey('xanh', new Set(['xanh', 'xanh-2', 'xanh-3']))).toBe('xanh-4');
  });

  it('hậu tố không làm khoá vượt 32 ký tự', () => {
    const base = 'a'.repeat(32);
    const key = uniqueKey(base, new Set([base]));
    expect(key).toHaveLength(32);
    expect(key.endsWith('-2')).toBe(true);
  });
});

describe('tokenUsage', () => {
  it('đếm số icon dùng mỗi màu, một icon dùng nhiều lần chỉ tính một', () => {
    const usage = tokenUsage([
      doc('a', [brandPaint('xanh'), brandPaint('xanh')], ['none', brandPaint('do')]),
      doc('b', ['none', brandPaint('xanh')]),
      doc('c', ['#ff0000', 'currentColor']),
    ]);
    expect(usage.get('xanh')).toBe(2);
    expect(usage.get('do')).toBe(1);
    expect(usage.get('vang')).toBeUndefined();
  });
});

describe('addToken', () => {
  it('thêm màu với khoá sinh từ tên, mã hex được chuẩn hoá', () => {
    const next = ok(addToken(palette, { label: 'Xanh Lá', hex: '#0F0' }));
    expect(next.tokens).toHaveLength(4);
    expect(next.tokens[3]).toEqual({ key: 'xanh-la', label: 'Xanh Lá', hex: '#00ff00' });
  });

  it('khoá trùng thì thêm hậu tố; tên trống thì dùng mã hex làm tên', () => {
    const next = ok(addToken(palette, { label: 'Xanh', hex: '#111111' }));
    expect(next.tokens[3].key).toBe('xanh-2');
    const unnamed = ok(addToken(palette, { label: '  ', hex: '#222222' }));
    expect(unnamed.tokens[3].label).toBe('#222222');
    expect(unnamed.tokens[3].key).toBe('mau');
  });

  it('từ chối mã màu sai và khi đã đủ số màu', () => {
    expect(addToken(palette, { label: 'X', hex: 'xanh' })).toEqual({ ok: false, error: expect.stringContaining('Mã màu') });
    const full: BrandPalette = { tokens: Array.from({ length: MAX_TOKENS }, (_, index) => ({ key: `c${index}`, label: `C${index}`, hex: '#000000' })) };
    expect(addToken(full, { label: 'Thừa', hex: '#123456' })).toEqual({ ok: false, error: expect.stringContaining('Tối đa') });
  });

  it('kết quả luôn qua được normalizePalette mà không mất màu nào', () => {
    const next = ok(addToken(palette, { label: 'Tím than', hex: '#312e81' }));
    expect(normalizePalette(next).tokens).toEqual(next.tokens);
  });
});

describe('updateHex', () => {
  it('đổi mã hex, giữ khoá và tên', () => {
    const next = ok(updateHex(palette, 'do', '#AA0000'));
    expect(next.tokens[1]).toEqual({ key: 'do', label: 'Đỏ', hex: '#aa0000' });
  });

  it('từ chối mã sai', () => {
    expect(updateHex(palette, 'do', '#12')).toEqual({ ok: false, error: expect.stringContaining('Mã màu') });
  });
});

describe('renameToken', () => {
  it('màu chưa dùng thì khoá đổi theo tên mới', () => {
    const next = ok(renameToken(palette, 'vang', 'Vàng hổ phách', []));
    expect(next.tokens[2]).toEqual({ key: 'vang-ho-phach', label: 'Vàng hổ phách', hex: '#f59e0b' });
  });

  it('màu đang được icon dùng thì giữ nguyên khoá', () => {
    const next = ok(renameToken(palette, 'xanh', 'Xanh chủ đạo', [doc('a', ['none', brandPaint('xanh')])]));
    expect(next.tokens[0]).toEqual({ key: 'xanh', label: 'Xanh chủ đạo', hex: '#2563eb' });
  });

  it('khoá mới không trùng khoá của màu khác', () => {
    const next = ok(renameToken(palette, 'vang', 'Đỏ', []));
    expect(next.tokens[2].key).toBe('do-2');
    expect(new Set(keys(next)).size).toBe(3);
  });

  it('tên trống bị từ chối; tên dài bị cắt 40 ký tự', () => {
    expect(renameToken(palette, 'xanh', '   ', [])).toEqual({ ok: false, error: expect.stringContaining('Tên màu') });
    expect(ok(renameToken(palette, 'xanh', 'x'.repeat(60), [doc('a', ['none', brandPaint('xanh')])])).tokens[0].label).toHaveLength(40);
  });
});

describe('removeToken', () => {
  it('xoá màu theo khoá', () => {
    expect(keys(ok(removeToken(palette, 'do')))).toEqual(['xanh', 'vang']);
  });

  it('không cho xoá màu cuối cùng', () => {
    const single: BrandPalette = { tokens: [palette.tokens[0]] };
    expect(removeToken(single, 'xanh')).toEqual({ ok: false, error: expect.stringContaining('ít nhất') });
  });

  it('bảng màu mặc định xoá được nhiều màu mà vẫn hợp lệ', () => {
    const next = ok(removeToken(DEFAULT_PALETTE, 'navy'));
    expect(next.tokens).toHaveLength(DEFAULT_PALETTE.tokens.length - 1);
  });
});

describe('reorderTokens và moveToken', () => {
  it('kéo màu từ vị trí này sang vị trí khác', () => {
    expect(keys(reorderTokens(palette, 0, 2))).toEqual(['do', 'vang', 'xanh']);
    expect(keys(reorderTokens(palette, 2, 0))).toEqual(['vang', 'xanh', 'do']);
  });

  it('vị trí không hợp lệ hoặc không đổi thì giữ nguyên đối tượng', () => {
    expect(reorderTokens(palette, 1, 1)).toBe(palette);
    expect(reorderTokens(palette, -1, 1)).toBe(palette);
    expect(reorderTokens(palette, 0, 3)).toBe(palette);
  });

  it('đưa lên/xuống một bậc; ở mép thì không đổi', () => {
    expect(keys(moveToken(palette, 'do', -1))).toEqual(['do', 'xanh', 'vang']);
    expect(keys(moveToken(palette, 'do', 1))).toEqual(['xanh', 'vang', 'do']);
    expect(moveToken(palette, 'xanh', -1)).toBe(palette);
    expect(moveToken(palette, 'vang', 1)).toBe(palette);
    expect(moveToken(palette, 'khong-co', 1)).toBe(palette);
  });

  it('không làm mất hay nhân đôi màu', () => {
    const next = reorderTokens(palette, 0, 1);
    expect(new Set(keys(next))).toEqual(new Set(keys(palette)));
  });
});
