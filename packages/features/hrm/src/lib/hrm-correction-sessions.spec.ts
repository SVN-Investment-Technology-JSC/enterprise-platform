import {
  correctionDraftRows,
  correctionPayload,
} from './hrm-correction-sessions';

describe('correction sessions form round trip', () => {
  it('retains both sessions and the next-day end when reopening a saved overnight draft', () => {
    const sessions = [
      { start: '2026-09-27T15:00:00.000Z', end: '2026-09-27T17:00:00.000Z' },
      { start: '2026-09-27T18:00:00.000Z', end: '2026-09-28T00:00:00.000Z' },
    ];
    expect(correctionPayload(correctionDraftRows({ sessions }))).toEqual(
      sessions,
    );
  });
  it('reads the old single-pair format and rejects overlapping or incomplete proposals', () => {
    const rows = correctionDraftRows({
      newCheckInAt: '2026-09-27T01:00:00Z',
      newCheckOutAt: '2026-09-27T05:00:00Z',
    });
    expect(correctionPayload(rows)).toHaveLength(1);
    expect(() => correctionPayload([...rows, ...rows])).toThrow('chồng lấn');
    expect(() => correctionPayload([{ start: '', end: '' }])).toThrow('đầy đủ');
  });
});

import {
  correctionDraftPunches,
  correctionPunchPayload,
  nextPunchKind,
  suggestPunchRow,
} from './hrm-correction-sessions';

describe('giải trình theo từng mốc giờ vào / ra', () => {
  it('chỉ giờ vào hoặc chỉ giờ ra là hợp lệ, gửi đúng loại', () => {
    expect(correctionPunchPayload([{ kind: 'IN', at: '2026-10-11T08:05' }])).toEqual([
      { kind: 'IN', at: new Date('2026-10-11T08:05').toISOString() },
    ]);
    expect(correctionPunchPayload([{ kind: 'OUT', at: '2026-10-11T17:30' }])[0].kind).toBe('OUT');
  });

  it('bắt chọn loại, nhập giờ, không trùng loại và giờ ra phải sau giờ vào', () => {
    expect(() => correctionPunchPayload([{ kind: '', at: '2026-10-11T08:00' }])).toThrow('giờ vào hay giờ ra');
    expect(() => correctionPunchPayload([{ kind: 'IN', at: '' }])).toThrow('Giờ vào: nhập đầy đủ');
    expect(() =>
      correctionPunchPayload([
        { kind: 'IN', at: '2026-10-11T08:00' },
        { kind: 'IN', at: '2026-10-11T09:00' },
      ]),
    ).toThrow('một giờ vào');
    expect(() =>
      correctionPunchPayload([
        { kind: 'IN', at: '2026-10-11T17:00' },
        { kind: 'OUT', at: '2026-10-11T08:00' },
      ]),
    ).toThrow('Giờ ra phải sau giờ vào');
    expect(() => correctionPunchPayload([])).toThrow('Cần khai báo');
  });

  it('gợi ý giờ theo loại và loại kế tiếp còn thiếu', () => {
    expect(suggestPunchRow('2026-10-11', 'IN').at).toBe('2026-10-11T08:00');
    expect(suggestPunchRow('2026-10-11', 'OUT').at).toBe('2026-10-11T17:00');
    expect(nextPunchKind([])).toBe('IN');
    expect(nextPunchKind([{ kind: 'IN', at: 'x' }])).toBe('OUT');
    expect(nextPunchKind([{ kind: 'OUT', at: 'x' }])).toBe('IN');
    expect(nextPunchKind([{ kind: 'IN', at: 'x' }, { kind: 'OUT', at: 'y' }])).toBeNull();
  });

  it('mở lại bản nháp theo mốc giờ giữ đúng loại', () => {
    const rows = correctionDraftPunches({ punches: [{ kind: 'OUT', at: new Date('2026-10-11T17:00').toISOString() }] });
    expect(rows).toEqual([{ kind: 'OUT', at: '2026-10-11T17:00' }]);
    expect(correctionDraftPunches({ sessions: [] })).toEqual([]);
  });
});
