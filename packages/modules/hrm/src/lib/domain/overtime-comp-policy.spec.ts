import {
  classificationConfigOf,
  DEFAULT_OVERTIME_COMP_POLICY,
  monthlyCapConfigOf,
  overtimeCompLegalWarnings,
  parseOvertimeCompPolicy,
  validateOvertimeCompPolicy,
} from './overtime-comp-policy.js';

describe('parseOvertimeCompPolicy', () => {
  it('thiếu cấu hình thì dùng mặc định: tắt quy tắc, CLOCK_WINDOW, 40 và 200 giờ, hệ số 1,5', () => {
    expect(parseOvertimeCompPolicy(null)).toEqual(DEFAULT_OVERTIME_COMP_POLICY);
    expect(parseOvertimeCompPolicy({})).toEqual(DEFAULT_OVERTIME_COMP_POLICY);
    expect(DEFAULT_OVERTIME_COMP_POLICY).toMatchObject({ enabled: false, ruleSet: 'CLOCK_WINDOW', monthlyCapHours: 40, yearlyCapHours: 200, compFactor: 1.5, usageStepDays: 0.5 });
  });

  it('đọc nhóm overtimeComp và khung giờ đêm phẳng sẵn có', () => {
    const p = parseOvertimeCompPolicy({
      nightStartMinute: 1260,
      nightEndMinute: 300,
      overtimeComp: { enabled: true, ruleSet: 'NIGHT_REST', compFactor: 2, yearlyCapHours: null, rounding: 'DOWN', accrualMonthOffset: 0 },
    });
    expect(p).toMatchObject({ enabled: true, ruleSet: 'NIGHT_REST', compFactor: 2, yearlyCapHours: null, rounding: 'DOWN', accrualMonthOffset: 0, nightStartMinute: 1260, nightEndMinute: 300 });
  });

  it('khung giờ đêm trong nhóm overtimeComp ưu tiên hơn khóa phẳng', () => {
    const p = parseOvertimeCompPolicy({ nightStartMinute: 1260, overtimeComp: { nightStartMinute: 1200 } });
    expect(p.nightStartMinute).toBe(1200);
  });

  it('giá trị sai kiểu hay bộ quy tắc lạ quay về mặc định', () => {
    const p = parseOvertimeCompPolicy({ overtimeComp: { ruleSet: 'KHAC', monthlyCapHours: 'abc', enabled: 'yes', rounding: 'X' } });
    expect(p).toMatchObject({ ruleSet: 'CLOCK_WINDOW', monthlyCapHours: 40, enabled: false, rounding: 'HALF_UP' });
  });

  it('số giờ quy đổi một ngày mặc định bằng giờ chuẩn một ngày', () => {
    expect(monthlyCapConfigOf(parseOvertimeCompPolicy({ overtimeComp: { normalHoursPerDay: 7.5 } })).dayBasisHours).toBe(7.5);
    expect(monthlyCapConfigOf(parseOvertimeCompPolicy({ overtimeComp: { normalHoursPerDay: 7.5, dayBasisHours: 8 } })).dayBasisHours).toBe(8);
    expect(classificationConfigOf(DEFAULT_OVERTIME_COMP_POLICY).nightRest).toEqual({ nightRestHoursPerDay: 8, allowHalfDay: true });
  });
});

describe('validateOvertimeCompPolicy', () => {
  const ok = { enabled: true, ruleSet: 'NIGHT_REST', monthlyCapHours: 40, yearlyCapHours: 200, compFactor: 1.5, usageStepDays: 0.5, nightStartMinute: 1320, nightEndMinute: 360 };

  it('cấu hình hợp lệ', () => {
    expect(validateOvertimeCompPolicy(ok)).toBeNull();
    expect(validateOvertimeCompPolicy({})).toBeNull();
    expect(validateOvertimeCompPolicy({ yearlyCapHours: null })).toBeNull();
  });

  it.each([
    [null, /không hợp lệ/],
    [{ ruleSet: 'KHAC' }, /NIGHT_REST hoặc CLOCK_WINDOW/],
    [{ enabled: 'true' }, /đúng hoặc sai/],
    [{ rounding: 'X' }, /làm tròn/],
    [{ monthlyCapHours: 0 }, /tháng/],
    [{ monthlyCapHours: '40' }, /tháng/],
    [{ compFactor: 0 }, /Hệ số/],
    [{ decimals: 1.5 }, /chữ số thập phân/],
    [{ usageStepDays: 0.3 }, /ước của 1 ngày/],
    [{ accrualMonthOffset: 2 }, /Tháng cộng quỹ/],
    [{ nightStartMinute: 600 }, /sau 12:00/],
    [{ nightStartMinute: 1320, nightEndMinute: 900 }, /trước 12:00/],
    [{ nightStartMinute: 700, nightEndMinute: 700 }, /sau 12:00|trước 12:00/],
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
});
