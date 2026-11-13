import {
  classifyTripDay,
  nightMinutesOf,
  restsNextMorning,
  spanOfWindow,
  validateWindows,
  type DayWindow,
} from './trip-day-hours';

const w = (from: string, to: string): DayWindow => ({ from, to });
const night = { startMinute: 1320, endMinute: 360 };

describe('khung giờ khai báo', () => {
  it('giờ kết thúc không sau giờ bắt đầu là sang ngày hôm sau', () => {
    expect(spanOfWindow(w('18:00', '05:00'))).toEqual({ start: 1080, end: 1740 });
    expect(spanOfWindow(w('18:00', '00:00'))).toEqual({ start: 1080, end: 1440 });
    expect(spanOfWindow(w('07:30', '11:30'))).toEqual({ start: 450, end: 690 });
    expect(spanOfWindow(w('7h', '11:30'))).toBeNull();
  });

  it('kiểm tra chồng nhau, quá dài và sai định dạng', () => {
    expect(validateWindows([w('07:30', '11:30'), w('13:00', '23:00')])).toBeNull();
    expect(validateWindows([w('07:30', '12:00'), w('11:00', '13:00')])).toContain('chồng nhau');
    expect(validateWindows([w('08:00', '08:00')])).toBeNull();
    expect(validateWindows([w('18:00', '25:00')])).toContain('HH:mm');
    expect(validateWindows([w('18:00', '14:00')])).toContain('12:00 của ngày hôm sau');
    expect(validateWindows(Array.from({ length: 7 }, (_, i) => w(`0${i}:00`, `0${i}:30`)))).toContain('tối đa 6');
  });
});

describe('classifyTripDay: ví dụ ca đêm khai 18h đến 5h hôm sau', () => {
  it('11 giờ: 8 giờ thuộc ca, 3 giờ làm thêm (tenant không tách đêm)', () => {
    const r = classifyTripDay({ windows: [w('18:00', '05:00')], scheduledMinutes: 480 });
    expect(r).toMatchObject({ totalMinutes: 660, normalMinutes: 480, otMinutes: 180, nightMinutes: 0 });
    expect(r.otSegments).toEqual([{ start: 1560, end: 1740, minutes: 180, nightMinutes: 0 }]);
  });

  it('tenant bật khung đêm 22h đến 6h: 3 giờ làm thêm từ 02:00 đến 05:00 đều nằm trong khung đêm', () => {
    const r = classifyTripDay({ windows: [w('18:00', '05:00')], scheduledMinutes: 480, night });
    expect(r.otMinutes).toBe(180);
    expect(r.nightMinutes).toBe(180);
  });

  it('đủ 8 giờ hoặc ít hơn thì không có làm thêm', () => {
    expect(classifyTripDay({ windows: [w('18:00', '02:00')], scheduledMinutes: 480 })).toMatchObject({ otMinutes: 0, normalMinutes: 480 });
    expect(classifyTripDay({ windows: [w('18:00', '00:00')], scheduledMinutes: 480 })).toMatchObject({ otMinutes: 0, normalMinutes: 360 });
  });
});

describe('classifyTripDay: thứ 7 và chủ nhật', () => {
  it('thứ 7 ca sáng 4 giờ: 07:30 đến 11:30 là ca, 13:00 đến 23:00 là làm thêm', () => {
    const r = classifyTripDay({ windows: [w('07:30', '11:30'), w('13:00', '23:00')], scheduledMinutes: 240 });
    expect(r).toMatchObject({ normalMinutes: 240, otMinutes: 600 });
    expect(r.otSegments).toEqual([{ start: 780, end: 1380, minutes: 600, nightMinutes: 0 }]);
  });

  it('thứ 7 có bật khung đêm: 22:00 đến 23:00 trong làm thêm là giờ đêm', () => {
    const r = classifyTripDay({ windows: [w('07:30', '11:30'), w('13:00', '23:00')], scheduledMinutes: 240, night });
    expect(r.nightMinutes).toBe(60);
  });

  it('chủ nhật không có ca: toàn bộ giờ khai là làm thêm', () => {
    const r = classifyTripDay({ windows: [w('13:30', '17:30')], scheduledMinutes: 0 });
    expect(r).toMatchObject({ normalMinutes: 0, otMinutes: 240, totalMinutes: 240 });
  });

  it('ngày không khai khung giờ nào thì không có giờ nào', () => {
    expect(classifyTripDay({ windows: [], scheduledMinutes: 480 })).toMatchObject({ totalMinutes: 0, otMinutes: 0, normalMinutes: 0 });
  });
});

describe('giờ đêm và sáng hôm sau', () => {
  it('đếm giờ đêm của đoạn qua nửa đêm', () => {
    expect(nightMinutesOf({ start: 1380, end: 1560 }, night)).toBe(180);
    expect(nightMinutesOf({ start: 540, end: 1020 }, night)).toBe(0);
  });

  it('ngày kế tiếp bắt đầu từ chiều thì sáng hôm đó nghỉ; không khai thì coi là có làm', () => {
    expect(restsNextMorning([w('18:00', '03:00')])).toBe(true);
    expect(restsNextMorning([w('07:30', '11:30')])).toBe(false);
    expect(restsNextMorning(null)).toBe(false);
  });
});
