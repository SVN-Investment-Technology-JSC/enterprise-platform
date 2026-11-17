import { breakdownFromTimePreview } from './request-form-model';

describe('breakdownFromTimePreview', () => {
  it('quy đổi từng ngày của khoản nghỉ bổ sung: ngày làm theo số ngày, ngày nghỉ và ngày lễ tính 0, ngày chưa phân ca báo thiếu', () => {
    const result = breakdownFromTimePreview({
      days: [
        { date: '2026-11-20', kind: 'WORK', quantity: 1 },
        { date: '2026-11-21', kind: 'WORK', quantity: 0.5 },
        { date: '2026-11-22', kind: 'OFF', quantity: 0 },
        { date: '2026-11-23', kind: 'HOLIDAY', quantity: 0 },
        { date: '2026-11-24', kind: 'WORK', quantity: 0.25 },
        { date: '2026-11-25', kind: 'NO_SHIFT', quantity: 0 },
      ],
    });
    expect(result.breakdown.map((b) => [b.value, b.note])).toEqual([
      [1, ''],
      [0.5, 'Nửa ngày'],
      [0, 'Nghỉ hằng tuần, không tính'],
      [0, 'Ngày lễ, không tính'],
      [0.25, 'Một phần ca'],
      [0, 'Chưa phân ca'],
    ]);
    expect(result.missingShift).toBe(true);
    expect(breakdownFromTimePreview({ days: [{ date: '2026-11-20', kind: 'WORK', quantity: 1 }] }).missingShift).toBe(false);
  });
});
