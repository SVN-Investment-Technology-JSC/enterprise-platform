import {
  CORRECTION_DEFAULT_TIME,
  correctionPunchAt,
  correctionPunchPayload,
  suggestPunchRow,
} from './hrm-correction-sessions';

describe('giải trình công: một mốc giờ vào hoặc giờ ra', () => {
  it('chỉ giờ vào hoặc chỉ giờ ra là hợp lệ, gửi đúng loại', () => {
    expect(correctionPunchPayload([{ kind: 'IN', at: '2026-10-11T08:05' }])).toEqual([
      { kind: 'IN', at: new Date('2026-10-11T08:05').toISOString() },
    ]);
    expect(correctionPunchPayload([{ kind: 'OUT', at: '2026-10-11T17:30' }])[0].kind).toBe('OUT');
  });

  it('bắt buộc đúng một mốc, đã chọn loại và đã nhập giờ', () => {
    expect(() => correctionPunchPayload([{ kind: '', at: '2026-10-11T08:00' }])).toThrow('giờ vào hay giờ ra');
    expect(() => correctionPunchPayload([{ kind: 'IN', at: '' }])).toThrow('Giờ vào: nhập đầy đủ');
    expect(() => correctionPunchPayload([])).toThrow('chỉ khai báo một');
    expect(() =>
      correctionPunchPayload([
        { kind: 'IN', at: '2026-10-11T08:00' },
        { kind: 'OUT', at: '2026-10-11T17:00' },
      ]),
    ).toThrow('chỉ khai báo một');
  });

  it('ngày của mốc giờ luôn là ngày phát sinh điều chỉnh: ghép ngày với giờ, thiếu một trong hai thì rỗng', () => {
    expect(correctionPunchAt('2026-10-11', '08:30')).toBe('2026-10-11T08:30');
    expect(correctionPunchAt('2026-10-11', '08:30:15')).toBe('2026-10-11T08:30');
    expect(correctionPunchAt('', '08:30')).toBe('');
    expect(correctionPunchAt('2026-10-11', '')).toBe('');
    // Đổi ngày phát sinh thì mốc giờ đi theo ngày mới, giữ nguyên giờ: không thể lệch ngày.
    expect(correctionPunchAt('2026-10-12', '08:30')).toBe('2026-10-12T08:30');
  });

  it('gợi ý giờ theo loại', () => {
    expect(suggestPunchRow('2026-10-11', 'IN').at).toBe('2026-10-11T08:00');
    expect(suggestPunchRow('2026-10-11', 'OUT').at).toBe('2026-10-11T17:00');
    expect(CORRECTION_DEFAULT_TIME).toEqual({ IN: '08:00', OUT: '17:00' });
  });
});
