import { BadRequestException } from '@nestjs/common';
import { isPunchList, parseCorrectionPunches } from './correction-punches';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const at = (time: string) => `2026-10-11T${time}:00.000Z`;

describe('parseCorrectionPunches', () => {
  it('không gửi gì thì không phải đơn theo mốc giờ', () => {
    expect(parseCorrectionPunches(undefined, NOW)).toEqual([]);
    expect(parseCorrectionPunches(null, NOW)).toEqual([]);
  });

  it('chỉ giờ vào hoặc chỉ giờ ra đều hợp lệ (quên chấm một chiều)', () => {
    expect(parseCorrectionPunches([{ kind: 'IN', at: at('01:00') }], NOW)).toEqual([{ kind: 'IN', at: at('01:00') }]);
    expect(parseCorrectionPunches([{ kind: 'OUT', at: at('10:00') }], NOW)).toEqual([{ kind: 'OUT', at: at('10:00') }]);
  });

  it('cả hai loại: giờ ra phải sau giờ vào và trong 24 giờ', () => {
    const ok = parseCorrectionPunches(
      [
        { kind: 'OUT', at: at('10:00') },
        { kind: 'IN', at: at('01:00') },
      ],
      NOW,
    );
    expect(ok.map((p) => p.kind)).toEqual(['OUT', 'IN']);
    expect(() =>
      parseCorrectionPunches([{ kind: 'IN', at: at('10:00') }, { kind: 'OUT', at: at('09:00') }], NOW),
    ).toThrow('Giờ ra phải sau giờ vào');
    expect(() =>
      parseCorrectionPunches(
        [{ kind: 'IN', at: '2026-10-09T01:00:00Z' }, { kind: 'OUT', at: '2026-10-11T01:00:00Z' }],
        NOW,
      ),
    ).toThrow('tối đa 24 giờ');
  });

  it('bắt buộc chọn loại, một giờ vào và một giờ ra tối đa, không ở tương lai', () => {
    expect(() => parseCorrectionPunches([{ kind: '', at: at('01:00') }], NOW)).toThrow(BadRequestException);
    expect(() => parseCorrectionPunches([], NOW)).toThrow('Cần khai báo');
    expect(() =>
      parseCorrectionPunches([{ kind: 'IN', at: at('01:00') }, { kind: 'IN', at: at('02:00') }], NOW),
    ).toThrow('một giờ vào');
    expect(() =>
      parseCorrectionPunches([{ kind: 'OUT', at: at('01:00') }, { kind: 'OUT', at: at('02:00') }], NOW),
    ).toThrow('một giờ ra');
    expect(() => parseCorrectionPunches([{ kind: 'OUT', at: '2026-10-11T13:00:00Z' }], NOW)).toThrow('tương lai');
    expect(() => parseCorrectionPunches([{ kind: 'IN', at: 'không phải ngày' }], NOW)).toThrow('không hợp lệ');
    expect(() => parseCorrectionPunches('x', NOW)).toThrow('Cần khai báo');
  });
});

describe('isPunchList', () => {
  it('nhận ra đơn theo mốc giờ, khác đơn theo cặp phiên cũ', () => {
    expect(isPunchList([{ kind: 'IN', at: at('01:00') }])).toBe(true);
    expect(isPunchList([{ start: at('01:00'), end: at('09:00') }])).toBe(false);
    expect(isPunchList(null)).toBe(false);
    expect(isPunchList([])).toBe(false);
  });
});
