import { BadRequestException } from '@nestjs/common';
import { isPunchList, parseCorrectionPunches } from './correction-punches';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const at = (time: string) => `2026-10-11T${time}:00.000Z`;

describe('parseCorrectionPunches', () => {
  it('không gửi gì thì trả mảng rỗng (đơn mới sẽ bị từ chối ở bộ điều khiển)', () => {
    expect(parseCorrectionPunches(undefined, NOW)).toEqual([]);
    expect(parseCorrectionPunches(null, NOW)).toEqual([]);
  });

  it('chỉ giờ vào hoặc chỉ giờ ra đều hợp lệ (quên chấm một chiều)', () => {
    expect(parseCorrectionPunches([{ kind: 'IN', at: at('01:00') }], NOW)).toEqual([{ kind: 'IN', at: at('01:00') }]);
    expect(parseCorrectionPunches([{ kind: 'OUT', at: at('10:00') }], NOW)).toEqual([{ kind: 'OUT', at: at('10:00') }]);
  });

  it('mỗi đơn chỉ đúng một mốc: nhiều hơn một (kể cả một vào + một ra) hoặc rỗng đều bị từ chối', () => {
    expect(() =>
      parseCorrectionPunches([{ kind: 'IN', at: at('01:00') }, { kind: 'OUT', at: at('10:00') }], NOW),
    ).toThrow('chỉ khai báo một');
    expect(() =>
      parseCorrectionPunches([{ kind: 'IN', at: at('01:00') }, { kind: 'IN', at: at('02:00') }], NOW),
    ).toThrow(BadRequestException);
    expect(() => parseCorrectionPunches([], NOW)).toThrow('chỉ khai báo một');
    expect(() => parseCorrectionPunches('x', NOW)).toThrow('chỉ khai báo một');
  });

  it('bắt buộc chọn loại, giờ hợp lệ và không ở tương lai', () => {
    expect(() => parseCorrectionPunches([{ kind: '', at: at('01:00') }], NOW)).toThrow(BadRequestException);
    expect(() => parseCorrectionPunches([{ kind: 'OUT', at: '2026-10-11T13:00:00Z' }], NOW)).toThrow('tương lai');
    expect(() => parseCorrectionPunches([{ kind: 'IN', at: 'không phải ngày' }], NOW)).toThrow('không hợp lệ');
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
