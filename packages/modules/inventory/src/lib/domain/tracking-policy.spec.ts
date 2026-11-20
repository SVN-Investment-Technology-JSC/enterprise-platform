import { InventoryError } from './inventory.error.js';
import {
  requireTrackingMode,
  resolveCreateTracking,
  resolveUpdateTracking,
  trackingChangeBlockedMessage,
  trackingSwitchBlockedMessage,
  trackingSwitchOffMessage,
} from './tracking-policy.js';

describe('requireTrackingMode', () => {
  it('bỏ trống là không đổi', () => {
    expect(requireTrackingMode(undefined)).toBeUndefined();
    expect(requireTrackingMode(null)).toBeUndefined();
  });

  it.each(['NONE', 'LOT', 'SERIAL'])('nhận %s', (mode) => {
    expect(requireTrackingMode(mode)).toBe(mode);
  });

  it.each(['LOT_AND_SERIAL', 'lot', '', 3])('từ chối %p bằng thông báo tiếng Việt', (value) => {
    expect(() => requireTrackingMode(value)).toThrow(InventoryError);
    expect(() => requireTrackingMode(value)).toThrow('Cách theo dõi phải là một trong: NONE, LOT, SERIAL.');
  });
});

describe('resolveCreateTracking', () => {
  it('không gửi gì: NONE, không phải chọn rõ ràng', () => {
    expect(resolveCreateTracking({}, 'STOCK')).toEqual({ mode: 'NONE', explicit: false });
  });

  it('đường cũ chỉ có isSerialized: SERIAL nhưng không phải chọn rõ ràng (không bị công tắc chặn)', () => {
    expect(resolveCreateTracking({ isSerialized: true }, 'STOCK')).toEqual({ mode: 'SERIAL', explicit: false });
  });

  it('chọn trackingMode rõ ràng', () => {
    expect(resolveCreateTracking({ trackingMode: 'LOT' }, 'STOCK')).toEqual({ mode: 'LOT', explicit: true });
    expect(resolveCreateTracking({ trackingMode: 'SERIAL', isSerialized: true }, 'STOCK')).toEqual({
      mode: 'SERIAL',
      explicit: true,
    });
  });

  it('trackingMode và isSerialized lệch nhau thì từ chối', () => {
    expect(() => resolveCreateTracking({ trackingMode: 'LOT', isSerialized: true }, 'STOCK')).toThrow(
      'Cách theo dõi và cờ serial không khớp nhau.',
    );
    expect(() => resolveCreateTracking({ trackingMode: 'SERIAL', isSerialized: false }, 'STOCK')).toThrow(
      'không khớp',
    );
  });

  it('dịch vụ chỉ NONE; chọn LOT hay SERIAL thì từ chối', () => {
    expect(resolveCreateTracking({}, 'SERVICE')).toEqual({ mode: 'NONE', explicit: false });
    expect(resolveCreateTracking({ trackingMode: 'NONE' }, 'SERVICE')).toEqual({ mode: 'NONE', explicit: false });
    expect(() => resolveCreateTracking({ trackingMode: 'LOT' }, 'SERVICE')).toThrow(
      'Mặt hàng dịch vụ không theo dõi lô hoặc serial.',
    );
  });
});

describe('resolveUpdateTracking', () => {
  const lot = { trackingMode: 'LOT' as const, isSerialized: false };
  const serial = { trackingMode: 'SERIAL' as const, isSerialized: true };
  const none = { trackingMode: 'NONE' as const, isSerialized: false };

  it('không gửi gì thì giữ nguyên', () => {
    expect(resolveUpdateTracking(lot, 'STOCK', {})).toEqual({ current: 'LOT', mode: 'LOT', explicit: false });
  });

  it('đổi bằng trackingMode là chọn rõ ràng', () => {
    expect(resolveUpdateTracking(none, 'STOCK', { trackingMode: 'LOT' })).toEqual({
      current: 'NONE',
      mode: 'LOT',
      explicit: true,
    });
  });

  it('đường cũ: isSerialized bật thành SERIAL, tắt chỉ đưa SERIAL về NONE, không đụng LOT', () => {
    expect(resolveUpdateTracking(none, 'STOCK', { isSerialized: true }).mode).toBe('SERIAL');
    expect(resolveUpdateTracking(serial, 'STOCK', { isSerialized: false }).mode).toBe('NONE');
    expect(resolveUpdateTracking(lot, 'STOCK', { isSerialized: false }).mode).toBe('LOT');
    expect(resolveUpdateTracking(none, 'STOCK', { isSerialized: true }).explicit).toBe(false);
  });

  it('dữ liệu cũ chỉ có isSerialized vẫn đọc đúng cách theo dõi hiện tại', () => {
    expect(resolveUpdateTracking({ isSerialized: true }, 'STOCK', {}).current).toBe('SERIAL');
  });

  it('trackingMode và isSerialized lệch nhau thì từ chối', () => {
    expect(() => resolveUpdateTracking(none, 'STOCK', { trackingMode: 'LOT', isSerialized: true })).toThrow(
      'không khớp',
    );
  });

  it('đổi sang dịch vụ đưa về NONE; chọn LOT cho dịch vụ thì từ chối', () => {
    expect(resolveUpdateTracking(lot, 'SERVICE', {})).toEqual({ current: 'LOT', mode: 'NONE', explicit: false });
    expect(() => resolveUpdateTracking(none, 'SERVICE', { trackingMode: 'SERIAL' })).toThrow(
      'Mặt hàng dịch vụ không theo dõi lô hoặc serial.',
    );
  });
});

describe('thông báo', () => {
  it('nêu đúng mã, cách theo dõi và số mặt hàng', () => {
    expect(trackingChangeBlockedMessage('VT-1')).toBe(
      'Mã VT-1 đã có tồn, bút toán, chứng từ, giữ hàng, lô hoặc serial; không đổi được cách theo dõi.',
    );
    expect(trackingSwitchOffMessage('LOT')).toContain('quản lý theo lô');
    expect(trackingSwitchOffMessage('SERIAL')).toContain('quản lý theo serial');
    expect(trackingSwitchBlockedMessage('SERIAL', 3)).toBe(
      'Còn 3 mặt hàng đang theo dõi theo serial và có tồn; chưa tắt được. Hãy xuất hết hoặc điều chỉnh về 0 trước.',
    );
  });
});
