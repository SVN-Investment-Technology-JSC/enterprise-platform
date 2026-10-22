import { DEFAULT_PALETTE } from '@enterprise-platform/shared-brand-icon';
import { colorInputValue, describePaint, parseHexInput, placePopover } from './paint-model';

describe('describePaint', () => {
  it('nhận ra không màu, theo chữ, màu thương hiệu và màu tuỳ chọn', () => {
    expect(describePaint('none', DEFAULT_PALETTE)).toMatchObject({ kind: 'none', hex: null });
    expect(describePaint('', DEFAULT_PALETTE).kind).toBe('none');
    expect(describePaint('currentColor', DEFAULT_PALETTE)).toMatchObject({ kind: 'context', hex: null });
    expect(describePaint('brand:sapphire', DEFAULT_PALETTE)).toMatchObject({
      kind: 'brand',
      label: 'Xanh Sapphire',
      hex: '#2563eb',
    });
    expect(describePaint('#ABC', DEFAULT_PALETTE)).toMatchObject({ kind: 'custom', label: '#AABBCC', hex: '#aabbcc' });
  });

  it('không vỡ khi màu thương hiệu không còn trong bảng màu', () => {
    const missing = describePaint('brand:gone', DEFAULT_PALETTE);
    expect(missing.kind).toBe('brand');
    expect(missing.label).toContain('gone');
    expect(missing.hex).toBe('#000000');
  });
});

describe('colorInputValue', () => {
  it('luôn trả mã #rrggbb hợp lệ cho ô chọn màu hệ thống', () => {
    expect(colorInputValue('brand:emerald', DEFAULT_PALETTE)).toBe('#10b981');
    expect(colorInputValue('#fff', DEFAULT_PALETTE)).toBe('#ffffff');
    expect(colorInputValue('none', DEFAULT_PALETTE)).toBe('#000000');
    expect(colorInputValue('currentColor', DEFAULT_PALETTE)).toBe('#000000');
  });
});

describe('parseHexInput', () => {
  it('nhận hex có hoặc không có dấu #, 3 hoặc 6 chữ số', () => {
    expect(parseHexInput('#2563EB')).toBe('#2563eb');
    expect(parseHexInput('2563eb')).toBe('#2563eb');
    expect(parseHexInput(' f0a ')).toBe('#ff00aa');
  });

  it('từ chối chuỗi không phải hex', () => {
    expect(parseHexInput('')).toBeNull();
    expect(parseHexInput('#12')).toBeNull();
    expect(parseHexInput('#zzzzzz')).toBeNull();
    expect(parseHexInput('#12345678')).toBeNull();
  });
});

describe('placePopover', () => {
  const viewport = { width: 1000, height: 700 };
  const size = { width: 232, height: 220 };

  it('đặt bên dưới nút khi đủ chỗ', () => {
    const place = placePopover({ left: 100, top: 100, bottom: 128 }, size, viewport);
    expect(place).toEqual({ left: 100, top: 134, placement: 'below' });
  });

  it('lật lên trên khi bên dưới không đủ chỗ mà bên trên vừa', () => {
    const place = placePopover({ left: 100, top: 600, bottom: 628 }, size, viewport);
    expect(place.placement).toBe('above');
    expect(place.top).toBe(600 - 6 - 220);
  });

  it('không tràn mép phải và mép trái cửa sổ', () => {
    expect(placePopover({ left: 900, top: 10, bottom: 38 }, size, viewport).left).toBe(1000 - 232 - 8);
    expect(placePopover({ left: -50, top: 10, bottom: 38 }, size, viewport).left).toBe(8);
  });

  it('khi cả hai phía đều thiếu chỗ thì kẹp vào trong cửa sổ', () => {
    const place = placePopover({ left: 10, top: 100, bottom: 128 }, { width: 232, height: 800 }, viewport);
    expect(place.placement).toBe('below');
    expect(place.top).toBe(8);
  });
});
