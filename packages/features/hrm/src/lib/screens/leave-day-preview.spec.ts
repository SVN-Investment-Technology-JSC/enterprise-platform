import {
  computeLeaveFromPreview,
  selectableLeaveTypesOf,
  type LeaveDayPreviewItem,
} from './requests-screen';

const work = (date: string, over: Partial<LeaveDayPreviewItem> = {}): LeaveDayPreviewItem => ({
  date,
  kind: 'WORK',
  weight: 1,
  shiftMinutes: 480,
  startMinutes: 450,
  endMinutes: 1020,
  breakStartMinutes: 690,
  breakEndMinutes: 780,
  ...over,
});
const off = (date: string): LeaveDayPreviewItem => ({
  date,
  kind: 'OFF',
  weight: 0,
  shiftMinutes: 0,
  startMinutes: null,
  endMinutes: null,
  breakStartMinutes: null,
  breakEndMinutes: null,
});

describe('computeLeaveFromPreview', () => {
  it('thứ Sáu đến thứ Hai: thứ Bảy nửa ngày, Chủ nhật không tính', () => {
    const days = [
      work('2026-10-09'),
      work('2026-10-10', { weight: 0.5, shiftMinutes: 240, endMinutes: 690, breakStartMinutes: null, breakEndMinutes: null }),
      off('2026-10-11'),
      work('2026-10-12'),
    ];
    expect(computeLeaveFromPreview(days, '07:30', '17:00').total).toBe(2.5);
  });
  it('ngày cuối nghỉ nửa buổi sáng', () => {
    const days = [work('2026-10-09'), work('2026-10-12')];
    expect(computeLeaveFromPreview(days, '07:30', '11:30').total).toBe(1.5);
  });
  it('ca 06:00-14:00: giờ mặc định 07:30-17:00 chỉ phủ một phần, nhập đúng giờ ca thì đủ 1 ngày', () => {
    const c1 = work('2026-10-09', { shiftMinutes: 450, startMinutes: 360, endMinutes: 840, breakStartMinutes: null, breakEndMinutes: null });
    expect(computeLeaveFromPreview([c1], '07:30', '17:00').total).toBeCloseTo(0.867, 2);
    expect(computeLeaveFromPreview([c1], '06:00', '14:00').total).toBe(1);
  });
  it('báo thiếu ca', () => {
    const none = { ...off('2026-10-09'), kind: 'NO_SHIFT' as const };
    expect(computeLeaveFromPreview([none], '07:30', '17:00').missingShift).toBe(true);
  });
});

describe('selectableLeaveTypesOf', () => {
  const t = (id: string, code: string, name: string, paid: boolean) => ({ id, code, name, paid, unit: 'DAYS' });
  it('ẩn thâm niên và gộp các loại không lương', () => {
    const out = selectableLeaveTypesOf([
      t('1', 'ANNUAL', 'Nghỉ phép năm', true),
      t('2', 'SENIORITY', 'Phép thâm niên', true),
      t('3', 'SICK', 'Nghỉ ốm', false),
      t('4', 'UNPAID', 'Nghỉ không lương', false),
    ]);
    expect(out.map((x: { id: string }) => x.id)).toEqual(['1', '4']);
  });
});
