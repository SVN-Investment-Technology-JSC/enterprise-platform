import { DEFAULT_OVERTIME_COMP_POLICY } from '../domain/overtime-comp-policy.js';
import {
  calendarMonthOfPeriod,
  overtimeMonthFigures,
  payrollOvertimeInputs,
  readOvertimeCompSnapshot,
  type OvertimeCompSnapshot,
} from './hrm-overtime-month.js';

describe('calendarMonthOfPeriod', () => {
  it('kỳ công đúng một tháng dương lịch', () => {
    expect(calendarMonthOfPeriod({ from_date: '2026-10-01', to_date: '2026-10-31' })).toBe('2026-10');
    expect(calendarMonthOfPeriod({ from_date: '2028-02-01', to_date: '2028-02-29' })).toBe('2028-02');
  });

  it('kỳ tùy chỉnh không trùng tháng thì không có tháng', () => {
    expect(calendarMonthOfPeriod({ from_date: '2026-10-05', to_date: '2026-11-04' })).toBeNull();
    expect(calendarMonthOfPeriod({ from_date: '2026-10-01', to_date: '2026-10-30' })).toBeNull();
  });
});

const policy = { ...DEFAULT_OVERTIME_COMP_POLICY, enabled: true, ruleSet: 'NIGHT_REST' as const };
const snapshot = (enabled: boolean): OvertimeCompSnapshot => ({
  version: 1,
  month: '2026-10',
  capturedAt: '2026-11-01T00:00:00.000Z',
  policyVersionId: null,
  policy: { ...policy, enabled },
  employees: {
    'emp-a': {
      employeeId: 'emp-a',
      actualOtHours: 63,
      countedOtHours: 40,
      nightHours: 60,
      excessOtHours: 23,
      compDays: 4.3,
      payrollHours: 100,
      nightRestDays: 4,
      blockCount: 12,
    },
  },
});

describe('payrollOvertimeInputs', () => {
  it('bật quy tắc: lương lấy giờ tính lương và ca đêm theo ảnh chụp (số của nhân viên A tháng 10)', () => {
    expect(payrollOvertimeInputs(snapshot(true), 'emp-a', 99999)).toEqual({
      OT_COUNTED_MINUTES: 2400,
      NIGHT_MINUTES: 3600,
      OT_EXCESS_MINUTES: 1380,
      NIGHT_REST_DAYS: 4,
    });
  });

  it('bật quy tắc nhưng nhân viên không có ca nào: tất cả bằng 0, không rơi về số cũ', () => {
    expect(payrollOvertimeInputs(snapshot(true), 'emp-khac', 99999)).toEqual({
      OT_COUNTED_MINUTES: 0,
      NIGHT_MINUTES: 0,
      OT_EXCESS_MINUTES: 0,
      NIGHT_REST_DAYS: 0,
    });
  });

  it('chưa bật quy tắc hoặc chưa có ảnh chụp: giữ cách tính cũ', () => {
    const legacy = { OT_COUNTED_MINUTES: 120, NIGHT_MINUTES: 0, OT_EXCESS_MINUTES: 0, NIGHT_REST_DAYS: 0 };
    expect(payrollOvertimeInputs(snapshot(false), 'emp-a', 120)).toEqual(legacy);
    expect(payrollOvertimeInputs(null, 'emp-a', 120)).toEqual(legacy);
  });
});

describe('readOvertimeCompSnapshot', () => {
  it('đọc lại ảnh chụp đã lưu, thiếu khóa cấu hình thì dùng mặc định', () => {
    const stored = JSON.parse(JSON.stringify(snapshot(true)));
    delete stored.policy.expiryMonths;
    const read = readOvertimeCompSnapshot(stored);
    expect(read?.policy).toMatchObject({ enabled: true, ruleSet: 'NIGHT_REST', expiryMonths: 0, monthlyCapHours: 40 });
    expect(read?.employees['emp-a']?.compDays).toBe(4.3);
  });

  it('dữ liệu sai định dạng hoặc rỗng thì không có ảnh chụp', () => {
    expect(readOvertimeCompSnapshot(null)).toBeNull();
    expect(readOvertimeCompSnapshot({ version: 2, month: '2026-10', employees: {} })).toBeNull();
    expect(readOvertimeCompSnapshot('x')).toBeNull();
  });
});

describe('overtimeMonthFigures: trần năm theo giờ đã tính lương của các tháng trước', () => {
  const rows = (blocks: unknown[], rests: unknown[] = []) => ({
    query: jest.fn(async (sql: string) => ({
      rows: sql.includes('overtime_blocks') ? blocks : rests,
    })),
  });

  it('tháng sau chỉ còn phần trần năm chưa dùng', async () => {
    const db = rows([
      { employee_id: 'emp-a', period_month: '2026-09', ot: 40, night: 0, n: 3 },
      { employee_id: 'emp-a', period_month: '2026-10', ot: 40, night: 10, n: 4 },
    ]);
    const figures = await overtimeMonthFigures(db as never, 't', '2026-10', { ...policy, yearlyCapHours: 60 });
    expect(figures).toHaveLength(1);
    // Tháng 9 đã tính 40; trần năm 60 nên tháng 10 chỉ còn 20 giờ tính lương, 20 giờ dư.
    expect(figures[0]).toMatchObject({ actualOtHours: 40, countedOtHours: 20, excessOtHours: 20, nightHours: 10, compDays: 3.8 });
  });

  it('chỉ có ngày nghỉ sau ca đêm vẫn được liệt kê', async () => {
    const db = rows([], [{ employee_id: 'emp-b', days: 1.5 }]);
    const figures = await overtimeMonthFigures(db as never, 't', '2026-10', policy);
    expect(figures).toEqual([
      expect.objectContaining({ employeeId: 'emp-b', nightRestDays: 1.5, blockCount: 0, actualOtHours: 0, payrollHours: 0 }),
    ]);
  });
});
