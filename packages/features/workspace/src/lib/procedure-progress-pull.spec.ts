import { procedureProgressToWrite, type ProgressPullSettings } from './procedure-progress-pull';

const base: ProgressPullSettings = {
  progressPull: 'on_open',
  progressPullClosedItems: 'skip',
  progressPullDirection: 'two_way',
};
const item = { status: 'in_progress' as const, progressPercent: 40 };

describe('procedureProgressToWrite', () => {
  it('ghi số của hồ sơ khi khác số hiện tại', () => {
    expect(procedureProgressToWrite(item, 60, base)).toBe(60);
    expect(procedureProgressToWrite(item, 20, base)).toBe(20);
  });

  it('không ghi khi bằng nhau', () => {
    expect(procedureProgressToWrite(item, 40, base)).toBeUndefined();
  });

  it('không ghi khi tắt kéo tiến độ', () => {
    expect(procedureProgressToWrite(item, 60, { ...base, progressPull: 'off' })).toBeUndefined();
  });

  it('bỏ qua việc đã đóng hoặc bị đảo ngược khi chọn skip', () => {
    for (const status of ['done', 'review', 'cancelled'] as const) {
      expect(procedureProgressToWrite({ status, progressPercent: 100 }, 0, base)).toBeUndefined();
    }
    expect(procedureProgressToWrite({ ...item, reversal: {} }, 0, base)).toBeUndefined();
  });

  it('ghi đè việc đã đóng khi chọn overwrite', () => {
    const settings = { ...base, progressPullClosedItems: 'overwrite' as const };
    expect(procedureProgressToWrite({ status: 'done', progressPercent: 100 }, 0, settings)).toBe(0);
  });

  it('increase_only không bao giờ hạ tiến độ', () => {
    const settings = { ...base, progressPullDirection: 'increase_only' as const };
    expect(procedureProgressToWrite(item, 20, settings)).toBeUndefined();
    expect(procedureProgressToWrite(item, 80, settings)).toBe(80);
  });
});
