import {
  DEFAULT_OVERTIME_COMP_POLICY,
  monthlyCapConfigOf,
  overtimeCompLegalWarnings,
  parseOvertimeCompPolicy,
  validateOvertimeCompPolicy,
} from './overtime-comp-policy.js';

describe('parseOvertimeCompPolicy', () => {
  it('thiếu cấu hình thì dùng mặc định: tắt quy tắc, 40 và 200 giờ, hệ số 1,5', () => {
    expect(parseOvertimeCompPolicy(null)).toEqual(DEFAULT_OVERTIME_COMP_POLICY);
    expect(parseOvertimeCompPolicy({})).toEqual(DEFAULT_OVERTIME_COMP_POLICY);
    expect(DEFAULT_OVERTIME_COMP_POLICY).toMatchObject({ enabled: false, monthlyCapHours: 40, yearlyCapHours: 200, compFactor: 1.5, usageStepDays: 0.5 });
  });

  it('đọc nhóm overtimeComp', () => {
    const p = parseOvertimeCompPolicy({
      overtimeComp: { enabled: true, compFactor: 2, yearlyCapHours: null, rounding: 'DOWN', accrualMonthOffset: 0 },
    });
    expect(p).toMatchObject({ enabled: true, compFactor: 2, yearlyCapHours: null, rounding: 'DOWN', accrualMonthOffset: 0 });
  });

  it('bỏ qua các khóa cũ về chế độ phân loại và khung giờ đêm', () => {
    const p = parseOvertimeCompPolicy({
      nightStartMinute: 1260,
      overtimeComp: { ruleSet: 'NIGHT_REST', nightStartMinute: 1200, allowHalfDay: false, declaredNightWindow: true, nightCapped: true },
    });
    for (const key of ['ruleSet', 'nightStartMinute', 'nightEndMinute', 'nightRestHoursPerDay', 'allowHalfDay', 'declaredNightWindow', 'nightCapped'])
      expect(p).not.toHaveProperty(key);
    expect(monthlyCapConfigOf(p).nightCapped).toBe(false);
  });

  it('giá trị sai kiểu quay về mặc định', () => {
    const p = parseOvertimeCompPolicy({ overtimeComp: { monthlyCapHours: 'abc', enabled: 'yes', rounding: 'X' } });
    expect(p).toMatchObject({ monthlyCapHours: 40, enabled: false, rounding: 'HALF_UP' });
  });

  it('số giờ quy đổi một ngày mặc định bằng giờ chuẩn một ngày', () => {
    expect(monthlyCapConfigOf(parseOvertimeCompPolicy({ overtimeComp: { normalHoursPerDay: 7.5 } })).dayBasisHours).toBe(7.5);
    expect(monthlyCapConfigOf(parseOvertimeCompPolicy({ overtimeComp: { normalHoursPerDay: 7.5, dayBasisHours: 8 } })).dayBasisHours).toBe(8);
  });
});

describe('validateOvertimeCompPolicy', () => {
  const ok = { enabled: true, monthlyCapHours: 40, yearlyCapHours: 200, compFactor: 1.5, usageStepDays: 0.5 };

  it('cấu hình hợp lệ', () => {
    expect(validateOvertimeCompPolicy(ok)).toBeNull();
    expect(validateOvertimeCompPolicy({})).toBeNull();
    expect(validateOvertimeCompPolicy({ yearlyCapHours: null })).toBeNull();
  });

  it.each([
    [null, /không hợp lệ/],
    [{ enabled: 'true' }, /đúng hoặc sai/],
    [{ rounding: 'X' }, /làm tròn/],
    [{ monthlyCapHours: 0 }, /tháng/],
    [{ monthlyCapHours: '40' }, /tháng/],
    [{ compFactor: 0 }, /Hệ số/],
    [{ decimals: 1.5 }, /chữ số thập phân/],
    [{ usageStepDays: 0.3 }, /ước của 1 ngày/],
    [{ accrualMonthOffset: 2 }, /Tháng cộng quỹ/],
  ])('từ chối %j', (input, message) => {
    expect(validateOvertimeCompPolicy(input)).toMatch(message);
  });
});

describe('overtimeCompLegalWarnings', () => {
  it('cấu hình mặc định bật quy tắc không có cảnh báo vượt luật', () => {
    expect(overtimeCompLegalWarnings(parseOvertimeCompPolicy({ overtimeComp: { enabled: true } }))).toEqual([]);
  });

  it('cảnh báo khi vượt 40 giờ một tháng, 200 và 300 giờ một năm, thiếu trần năm hoặc tắt quy tắc', () => {
    const w = (o: Record<string, unknown>) => overtimeCompLegalWarnings(parseOvertimeCompPolicy({ overtimeComp: { enabled: true, ...o } }));
    expect(w({ monthlyCapHours: 50 }).join()).toMatch(/40 giờ/);
    expect(w({ yearlyCapHours: 250 }).join()).toMatch(/200 giờ/);
    expect(w({ yearlyCapHours: 400 }).join()).toMatch(/300 giờ/);
    expect(w({ yearlyCapHours: null }).join()).toMatch(/Chưa đặt trần/);
    expect(overtimeCompLegalWarnings(DEFAULT_OVERTIME_COMP_POLICY).join()).toMatch(/đang tắt/);
  });

  it('cho phép bật quản lý quỹ (fundEnabled) mà vẫn tắt tính toán OT tự động (enabled)', () => {
    const manualOnly = parseOvertimeCompPolicy({ overtimeComp: { enabled: false, fundEnabled: true } });
    expect(manualOnly.enabled).toBe(false);
    expect(manualOnly.fundEnabled).toBe(true);
    const legacy = parseOvertimeCompPolicy({ overtimeComp: { enabled: true } });
    expect(legacy.fundEnabled).toBe(true);
  });

  it('cộng quỹ tự động mặc định tắt (HR xác nhận), chỉ bật khi cấu hình đặt rõ', () => {
    expect(parseOvertimeCompPolicy({ overtimeComp: { enabled: true } }).autoAccrue).toBe(false);
    expect(parseOvertimeCompPolicy(null).autoAccrue).toBe(false);
    expect(parseOvertimeCompPolicy({ overtimeComp: { enabled: true, autoAccrue: true } }).autoAccrue).toBe(true);
    expect(validateOvertimeCompPolicy({ autoAccrue: 'yes' })).toMatch(/tự cộng/);
    expect(validateOvertimeCompPolicy({ autoAccrue: true })).toBeNull();
  });
});
