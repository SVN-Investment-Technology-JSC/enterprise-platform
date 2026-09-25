import { dayWindow, timezoneOf, todayKey, weekWindow } from './tenant-time.js';

const VN = 'Asia/Ho_Chi_Minh';

describe('dayWindow', () => {
  it('cắt ngày theo giờ địa phương, không theo UTC', () => {
    // 18:00Z ngày 20 đã là 01:00 sáng ngày 21 ở Việt Nam. Cửa sổ "hôm nay"
    // phải là ngày 21, và bắt đầu lúc 17:00Z ngày 20.
    const window = dayWindow(new Date('2026-09-20T18:00:00Z'), VN);
    expect(window.dateKey).toBe('2026-09-21');
    expect(window.from.toISOString()).toBe('2026-09-20T17:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-09-21T16:59:59.000Z');
  });

  it('cùng mốc đó ở UTC lại là ngày hôm trước', () => {
    expect(dayWindow(new Date('2026-09-20T18:00:00Z'), 'UTC').dateKey).toBe('2026-09-20');
  });

  it('dịch ngày vượt qua cuối tháng vẫn đúng', () => {
    expect(dayWindow(new Date('2026-09-30T10:00:00Z'), VN, 1).dateKey).toBe('2026-10-01');
    expect(dayWindow(new Date('2026-10-01T10:00:00Z'), VN, -1).dateKey).toBe('2026-09-30');
  });

  it('giữ đúng 00:00 giờ địa phương qua mốc đổi giờ mùa', () => {
    // Berlin lùi giờ Chủ nhật 25/10/2026; ngày 26 vẫn phải bắt đầu lúc 00:00
    // giờ địa phương, tức 23:00Z ngày 25.
    const window = dayWindow(new Date('2026-10-26T12:00:00Z'), 'Europe/Berlin');
    expect(window.from.toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });
});

describe('weekWindow', () => {
  it('tuần bắt đầu thứ Hai', () => {
    // 2026-09-24 là thứ Năm; tuần chứa nó bắt đầu 2026-09-21.
    expect(weekWindow(VN, new Date('2026-09-24T03:00:00Z')).dateKey).toBe('2026-09-21');
  });

  it('Chủ nhật thuộc về tuần bắt đầu thứ Hai trước đó', () => {
    expect(weekWindow(VN, new Date('2026-09-27T03:00:00Z')).dateKey).toBe('2026-09-21');
  });

  it('trải đúng bảy ngày', () => {
    const window = weekWindow(VN, new Date('2026-09-24T03:00:00Z'));
    const days = (window.to.getTime() - window.from.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(7);
  });
});

describe('todayKey', () => {
  it('lấy theo giờ tenant', () => {
    expect(todayKey(VN, new Date('2026-09-20T18:00:00Z'))).toBe('2026-09-21');
  });
});

describe('timezoneOf', () => {
  it('mọi tenant tạm dùng chung một múi giờ', () => {
    // Nền tảng chưa lưu múi giờ cho từng tenant; đây là ghi nhận hiện trạng
    // chứ không phải hành vi mong muốn lâu dài.
    expect(timezoneOf('tenant-a')).toBe(timezoneOf('tenant-b'));
  });
});
