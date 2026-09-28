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
