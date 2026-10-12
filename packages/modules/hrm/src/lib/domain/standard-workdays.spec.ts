import {
  boardStandardWorkdays,
  resolveStandardWork,
  standardWorkSetting,
  validateStandardWork,
} from './standard-workdays';

const ctx = (over: Partial<Parameters<typeof resolveStandardWork>[1]> = {}) => ({
  scheduledMinutes: 22 * 480,
  scheduledDays: 22,
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
    expect(resolveStandardWork(dyn, ctx({ scheduledMinutes: 26 * 480, scheduledDays: 26 }))).toMatchObject({ workdays: 26 });
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

describe('boardStandardWorkdays', () => {
  it('hiển thị công chuẩn của tháng theo chế độ', () => {
    expect(boardStandardWorkdays(standardWorkSetting({}), 22)).toBe(22);
    expect(boardStandardWorkdays(standardWorkSetting({ standardWorkMode: 'FIXED', standardWorkdays: 26 }), 22)).toBe(26);
    expect(boardStandardWorkdays(standardWorkSetting({ standardMinutes: 12480 }), 22)).toBe(26);
  });
});
