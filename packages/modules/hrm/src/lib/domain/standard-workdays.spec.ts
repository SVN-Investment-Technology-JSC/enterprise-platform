import {
  boardStandardWorkdays,
  dayCapacityUnits,
  dayWorkUnits,
  monthStandardSetting,
  policyForMonth,
  validateEffectiveMonth,
  monthStandardWorkdays,
  validateMonthStandard,
  resolveStandardWork,
  standardWorkSetting,
  validateStandardWork,
} from './standard-workdays';

const ctx = (over: Partial<Parameters<typeof resolveStandardWork>[1]> = {}) => ({
  scheduledMinutes: 22 * 480,
  scheduledDays: 22,
  scheduledUnits: 22,
  partialPeriod: false,
  periodStandardMinutes: 22 * 480,
  ...over,
});

describe('standardWorkSetting', () => {
  it('thiếu cấu hình là công chuẩn động; phút cũ vẫn nhận; cố định cần số ngày hợp lệ', () => {
    expect(standardWorkSetting(null)).toEqual({ mode: 'DYNAMIC', workdays: null, minutes: null });
    expect(standardWorkSetting({})).toMatchObject({ mode: 'DYNAMIC' });
    expect(standardWorkSetting({ standardMinutes: 12480 })).toEqual({ mode: 'MINUTES', workdays: null, minutes: 12480 });
    expect(standardWorkSetting({ standardWorkMode: 'FIXED', standardWorkdays: 26 })).toEqual({ mode: 'FIXED', workdays: 26, minutes: null });
    expect(standardWorkSetting({ standardWorkMode: 'FIXED' })).toMatchObject({ mode: 'DYNAMIC' });
    // đã chọn chế độ động thì bỏ qua phút cũ còn sót
    expect(standardWorkSetting({ standardWorkMode: 'DYNAMIC', standardMinutes: 100 })).toMatchObject({ mode: 'DYNAMIC' });
  });
});

describe('validateStandardWork', () => {
  it('chấp nhận cấu hình hợp lệ, từ chối cấu hình mâu thuẫn', () => {
    expect(validateStandardWork({})).toBeNull();
    expect(validateStandardWork({ standardWorkMode: 'DYNAMIC' })).toBeNull();
    expect(validateStandardWork({ standardWorkMode: 'FIXED', standardWorkdays: 26 })).toBeNull();
    expect(validateStandardWork({ standardWorkMode: 'FIXED', standardWorkdays: 26.5 })).toBeNull();
    expect(validateStandardWork({ standardWorkMode: 'MINUTES', standardMinutes: 12480 })).toBeNull();
    expect(validateStandardWork({ standardMinutes: 12480 })).toBeNull();
    expect(validateStandardWork({ standardWorkMode: 'FIXED' })).toMatch(/Công chuẩn cố định/);
    expect(validateStandardWork({ standardWorkMode: 'FIXED', standardWorkdays: 0 })).toMatch(/từ 1 đến 31/);
    expect(validateStandardWork({ standardWorkMode: 'FIXED', standardWorkdays: 32 })).toMatch(/từ 1 đến 31/);
    expect(validateStandardWork({ standardWorkMode: 'FIXED', standardWorkdays: 26.3 })).toMatch(/bước 0,5/);
    expect(validateStandardWork({ standardWorkMode: 'DYNAMIC', standardWorkdays: 26 })).toMatch(/chỉ chế độ công chuẩn cố định/i);
    expect(validateStandardWork({ standardWorkMode: 'DYNAMIC', standardMinutes: 100 })).toMatch(/phút chỉ dùng/);
    expect(validateStandardWork({ standardWorkMode: 'MINUTES', standardMinutes: 0 })).toMatch(/1 đến 90720/);
    expect(validateStandardWork({ standardWorkMode: 'LẠ' })).toMatch(/không hợp lệ/);
  });
});

describe('resolveStandardWork', () => {
  it('động: theo ngày công thực tế của chính nhân viên; tháng ít ngày nghỉ thì công chuẩn lớn hơn', () => {
    const dyn = standardWorkSetting({});
    expect(resolveStandardWork(dyn, ctx())).toEqual({ mode: 'DYNAMIC', minutes: 22 * 480, workdays: 22 });
    expect(resolveStandardWork(dyn, ctx({ scheduledMinutes: 26 * 480, scheduledDays: 26, scheduledUnits: 26 }))).toMatchObject({ workdays: 26 });
    // tháng 22 ngày HC + 5 sáng T7 (4 giờ): công chuẩn 24,5, không phải 27
    expect(
      resolveStandardWork(dyn, ctx({ scheduledMinutes: 22 * 480 + 5 * 240, scheduledDays: 27, scheduledUnits: 24.5 })),
    ).toMatchObject({ minutes: 22 * 480 + 5 * 240, workdays: 24.5 });
  });
  it('động: người vào hoặc nghỉ việc giữa kỳ lấy công chuẩn của kỳ, không lấy công của chính họ', () => {
    const dyn = standardWorkSetting({});
    const r = resolveStandardWork(dyn, ctx({ partialPeriod: true, scheduledMinutes: 10 * 480, scheduledDays: 10, periodStandardMinutes: 22 * 480 }));
    expect(r).toMatchObject({ minutes: 22 * 480, workdays: 22 });
  });
  it('cố định: bất kể tháng có bao nhiêu ngày nghỉ, mẫu số là số ngày cấu hình nhân số phút một ngày', () => {
    const fixed = standardWorkSetting({ standardWorkMode: 'FIXED', standardWorkdays: 26 });
    expect(resolveStandardWork(fixed, ctx())).toEqual({ mode: 'FIXED', minutes: 26 * 480, workdays: 26 });
    expect(resolveStandardWork(fixed, ctx({ scheduledMinutes: 20 * 480, scheduledDays: 20 }))).toMatchObject({ minutes: 26 * 480, workdays: 26 });
    // ca 4 giờ: 26 công = 26 * 240 phút
    expect(resolveStandardWork(fixed, ctx({ scheduledMinutes: 22 * 240, scheduledDays: 22 }))).toMatchObject({ minutes: 26 * 240, workdays: 26 });
    // người vào giữa kỳ vẫn chia cho công chuẩn cố định
    expect(resolveStandardWork(fixed, ctx({ partialPeriod: true, scheduledMinutes: 10 * 480, scheduledDays: 10 }))).toMatchObject({ minutes: 26 * 480 });
  });
  it('phút cũ: giữ nguyên số phút đã cấu hình', () => {
    expect(resolveStandardWork(standardWorkSetting({ standardMinutes: 12000 }), ctx())).toMatchObject({ mode: 'MINUTES', minutes: 12000, workdays: 25 });
  });
});

describe('sức chứa công của ngày theo ca', () => {
  it('ca đủ ngày là 1, ca sáng 4 giờ là 0,5, không có ca là 0', () => {
    expect(dayCapacityUnits(480)).toBe(1);
    expect(dayCapacityUnits(450)).toBe(1); // ca 8 giờ trừ nghỉ 30 phút vẫn là một công
    expect(dayCapacityUnits(240)).toBe(0.5);
    expect(dayCapacityUnits(0)).toBe(0);
  });
  it('công chuẩn tháng = tổng sức chứa các ngày có ca: 4 ngày T7 và 22 ngày thường là 24; 5 ngày T7 và 21 ngày thường là 23,5', () => {
    const month = (weekdays: number, saturdays: number) =>
      weekdays * dayCapacityUnits(480) + saturdays * dayCapacityUnits(240);
    expect(boardStandardWorkdays(standardWorkSetting({ standardWorkMode: 'DYNAMIC' }), month(22, 4))).toBe(24);
    expect(boardStandardWorkdays(standardWorkSetting({ standardWorkMode: 'DYNAMIC' }), month(21, 5))).toBe(23.5);
    expect(monthStandardWorkdays({ mode: 'DYNAMIC', workdays: null }, month(21, 5))).toBe(23.5);
  });
  it('số công của ngày: làm đủ ca sáng T7 được 0,5; trễ hoặc thiếu giờ thì theo tỷ lệ', () => {
    expect(dayWorkUnits(480, 480)).toBe(1);
    expect(dayWorkUnits(240, 240)).toBe(0.5);
    expect(dayWorkUnits(210, 240)).toBe(0.44);
    expect(dayWorkUnits(450, 480)).toBe(0.94);
    expect(dayWorkUnits(100, 0)).toBe(0);
  });
});

describe('boardStandardWorkdays', () => {
  it('hiển thị công chuẩn của tháng theo chế độ', () => {
    expect(boardStandardWorkdays(standardWorkSetting({}), 22)).toBe(22);
    expect(boardStandardWorkdays(standardWorkSetting({}), 24.5)).toBe(24.5);
    expect(boardStandardWorkdays(standardWorkSetting({ standardWorkMode: 'FIXED', standardWorkdays: 26 }), 22)).toBe(26);
    expect(boardStandardWorkdays(standardWorkSetting({ standardMinutes: 12480 }), 22)).toBe(26);
  });
});

describe('công chuẩn của bảng công theo tháng', () => {
  it('tháng chưa cấu hình hoặc dòng hỏng dùng công chuẩn động', () => {
    expect(monthStandardSetting(undefined)).toEqual({ mode: 'DYNAMIC', workdays: null });
    expect(monthStandardSetting({ mode: 'FIXED', workdays: null })).toEqual({ mode: 'DYNAMIC', workdays: null });
    expect(monthStandardSetting({ mode: 'FIXED', workdays: '24.50' })).toEqual({ mode: 'FIXED', workdays: 24.5 });
  });
  it('động lấy tổng sức chứa công theo lịch; cố định lấy số ngày đã cấu hình', () => {
    expect(monthStandardWorkdays({ mode: 'DYNAMIC', workdays: null }, 24.5)).toBe(24.5);
    expect(monthStandardWorkdays({ mode: 'FIXED', workdays: 26 }, 24.5)).toBe(26);
  });
  it('kiểm tra dữ liệu gửi lên', () => {
    expect(validateMonthStandard({ mode: 'DYNAMIC' })).toBeNull();
    expect(validateMonthStandard({ mode: 'DYNAMIC', workdays: 24 })).toMatch(/không có số ngày/);
    expect(validateMonthStandard({ mode: 'FIXED', workdays: 24.5 })).toBeNull();
    expect(validateMonthStandard({ mode: 'FIXED', workdays: 24.3 })).toMatch(/bước 0,5/);
    expect(validateMonthStandard({ mode: 'FIXED', workdays: 0 })).toMatch(/từ 1 đến 31/);
    expect(validateMonthStandard({ mode: 'FIXED' })).toMatch(/từ 1 đến 31/);
    expect(validateMonthStandard({ mode: 'MINUTES' })).toMatch(/động hoặc cố định/);
  });
});

describe('chính sách công chuẩn có hiệu lực từ một tháng đến khi thay đổi', () => {
  const policies = [
    { effectiveMonth: '2026-01', id: 'a' },
    { effectiveMonth: '2026-09', id: 'b' },
    { effectiveMonth: '2027-01', id: 'c' },
  ];
  it('tháng dùng chính sách mới nhất có tháng bắt đầu không sau tháng đó, cho tới khi có chính sách mới', () => {
    expect(policyForMonth(policies, '2025-12')).toBeNull(); // trước chính sách đầu: mặc định động
    expect(policyForMonth(policies, '2026-01')?.id).toBe('a');
    expect(policyForMonth(policies, '2026-08')?.id).toBe('a');
    expect(policyForMonth(policies, '2026-09')?.id).toBe('b'); // đúng tháng ban hành
    expect(policyForMonth(policies, '2026-12')?.id).toBe('b'); // kéo dài đến khi thay đổi
    expect(policyForMonth(policies, '2027-06')?.id).toBe('c');
    expect(policyForMonth([], '2026-10')).toBeNull();
  });
  it('tháng áp dụng đúng dạng và không ở quá khứ', () => {
    expect(validateEffectiveMonth('2026-10', '2026-10')).toBeNull();
    expect(validateEffectiveMonth('2027-01', '2026-10')).toBeNull();
    expect(validateEffectiveMonth('2026-09', '2026-10')).toMatch(/quá khứ/);
    expect(validateEffectiveMonth('2026-13', '2026-10')).toMatch(/YYYY-MM/);
    expect(validateEffectiveMonth(undefined, '2026-10')).toMatch(/YYYY-MM/);
  });
});
