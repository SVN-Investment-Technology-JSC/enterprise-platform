import type { HrmBoardDay, HrmBoardEmployee, HrmDayRequest } from '@enterprise-platform/contracts-hrm';
import {
  BOARD_FILTERS,
  calendarWeeks,
  compactTotals,
  gridCellClass,
  gridCellText,
  matchesBoardFilter,
  shortShiftCode,
  dayLetters,
  dayStatusPill,
  dayTone,
  hoursDecimal,
  isFutureDay,
  isLateOrEarly,
  monthRequests,
  myCellContent,
  myCellText,
  myMonthStats,
  requestDetailRows,
  requestTimeRange,
} from './my-timesheet-format';

const day = (over: Partial<HrmBoardDay> = {}): HrmBoardDay => ({
  date: '2026-09-03',
  kind: 'WORK',
  status: 'PRESENT',
  shiftCode: 'HC',
  shiftName: 'Hành chính',
  shiftStart: '08:00',
  shiftEnd: '17:00',
  checkIn: '08:00',
  checkOut: '17:00',
  scheduledMinutes: 480,
  workedMinutes: 480,
  paidMinutes: 480,
  workdayUnits: 1,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  otMinutes: 0,
  anomalies: [],
  leave: null,
  tripId: null,
  holidayName: null,
  adjusted: false,
  ...over,
});
const req = (over: Partial<HrmDayRequest>): HrmDayRequest => ({
  kind: 'LEAVE',
  id: 'r1',
  status: 'APPROVED',
  label: null,
  minutes: null,
  ...over,
});

describe('myCellText', () => {
  const today = '2026-09-15';
  it('ngày chưa tới hiện mã ca, ngày đã qua hiện số công và không hiện mã ca', () => {
    expect(myCellText(day({ date: '2026-09-20', status: 'FUTURE', workdayUnits: 0 }), today)).toBe('HC');
    expect(myCellText(day({ date: '2026-09-10', workdayUnits: 1 }), today)).toBe('1');
    expect(myCellText(day({ date: '2026-09-10', workdayUnits: 0.5 }), today)).toBe('0.5');
    expect(myCellText(day({ date: '2026-09-10', status: 'ABSENT', workdayUnits: 0 }), today)).toBe('0');
  });
  it('hôm nay chưa có chấm công vẫn là ngày chưa tới: hiện mã ca', () => {
    expect(myCellText(day({ date: today, status: 'FUTURE', workdayUnits: 0 }), today)).toBe('HC');
  });
  it('ngày nghỉ hằng tuần, lễ và chưa có lịch', () => {
    expect(myCellText(day({ date: '2026-09-20', status: 'FUTURE', shiftCode: null, kind: 'OFF' }), today)).toBe('OFF');
    expect(myCellText(day({ date: '2026-09-10', kind: 'OFF', status: 'OFF', workdayUnits: 0 }), today)).toBe('OFF');
    expect(myCellText(day({ date: '2026-09-02', kind: 'HOLIDAY', status: 'HOLIDAY', workdayUnits: 0 }), today)).toBe('L');
    expect(myCellText(day({ date: '2026-09-02', kind: 'HOLIDAY', status: 'HOLIDAY', workdayUnits: 1 }), today)).toBe('1');
    expect(myCellText(day({ date: '2026-09-10', status: 'NO_SCHEDULE', kind: 'NO_SCHEDULE' }), today)).toBe('-');
    expect(myCellText(undefined, today)).toBe('');
  });
  it('isFutureDay theo trạng thái hoặc theo ngày', () => {
    expect(isFutureDay(day({ date: '2026-09-20', status: 'PRESENT' }), today)).toBe(true);
    expect(isFutureDay(day({ date: '2026-09-10', status: 'PRESENT' }), today)).toBe(false);
  });
});

describe('isLateOrEarly', () => {
  it('trễ hoặc sớm thì tô đỏ', () => {
    expect(isLateOrEarly(day({ lateMinutes: 5 }))).toBe(true);
    expect(isLateOrEarly(day({ earlyLeaveMinutes: 5 }))).toBe(true);
    expect(isLateOrEarly(day())).toBe(false);
  });
});

describe('dayLetters', () => {
  it('mỗi loại đơn một ký tự, theo thứ tự cố định, lấy trạng thái tốt nhất', () => {
    const letters = dayLetters(
      day({
        requests: [
          req({ kind: 'OT', id: 'o', status: 'REJECTED' }),
          req({ kind: 'OT', id: 'o2', status: 'PENDING' }),
          req({ kind: 'LEAVE', id: 'l', status: 'APPROVED' }),
          req({ kind: 'LEAVE', id: 'l2', status: 'PENDING' }),
          req({ kind: 'CORRECTION', id: 'c' }),
          req({ kind: 'CUSTOM', id: 'x', label: 'Xin đi muộn' }),
          req({ kind: 'TRIP', id: 't' }),
        ],
      }),
    );
    expect(letters.map((l) => `${l.letter}:${l.status}`)).toEqual([
      'P:APPROVED',
      'CT:APPROVED',
      'TC:PENDING',
      'GT:APPROVED',
      'KH:APPROVED',
    ]);
    expect(dayLetters(day())).toEqual([]);
    // ngày vắng không phép hiện KP trước các đơn
    expect(dayLetters(day({ status: 'ABSENT', requests: [req({ kind: 'CORRECTION', status: 'PENDING' })] })).map((l) => l.letter)).toEqual(['KP', 'GT']);
  });
});

describe('calendarWeeks', () => {
  it('xếp theo tuần thứ Hai đến Chủ nhật, ô ngoài tháng là null', () => {
    // 1/9/2026 là thứ Ba
    const calendar = Array.from({ length: 30 }, (_, i) => {
      const date = `2026-09-${String(i + 1).padStart(2, '0')}`;
      return { date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() };
    });
    const weeks = calendarWeeks(calendar);
    expect(weeks[0]).toEqual([null, '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks[weeks.length - 1].slice(-3)).toEqual([null, null, null]);
  });
});

describe('requestTimeRange', () => {
  it('cùng ngày thì chỉ ghi ngày một lần, khác ngày thì ghi cả hai', () => {
    expect(requestTimeRange({ fromAt: '2026-09-20T01:00:00.000Z', toAt: '2026-09-20T05:00:00.000Z' })).toBe('20/09/2026 08:00 - 12:00');
    expect(requestTimeRange({ fromAt: '2026-09-04T15:00:00.000Z', toAt: '2026-09-04T19:00:00.000Z' })).toBe(
      '04/09/2026 22:00 - 05/09/2026 02:00',
    );
    expect(requestTimeRange({ fromAt: null, toAt: null })).toBe('');
  });
});

describe('requestDetailRows', () => {
  it('đơn tăng ca có số giờ và hệ số; đơn công tác có nơi và hình thức; giải trình có giờ theo đơn', () => {
    const ot = requestDetailRows(
      req({ kind: 'OT', minutes: 240, otRate: 2.5, reasonName: 'Khẩn', description: 'Khẩn', fromAt: '2026-09-04T15:00:00.000Z', toAt: '2026-09-04T19:00:00.000Z' }),
    );
    expect(ot).toEqual(expect.arrayContaining([['Số giờ tăng ca', '4:00'], ['Hệ số tăng ca', 'x2,5'], ['Lý do', 'Khẩn']]));
    // mô tả trùng lý do thì không lặp
    expect(ot.some(([k]) => k === 'Ghi chú')).toBe(false);
    const trip = requestDetailRows(req({ kind: 'TRIP', label: 'Hà Nội', tripType: 'DOMESTIC' }));
    expect(trip).toEqual(expect.arrayContaining([['Nơi công tác', 'Hà Nội'], ['Hình thức', 'Trong nước']]));
    const fix = requestDetailRows(req({ kind: 'CORRECTION', punchIn: '2026-09-03T01:05:00.000Z', punchOut: null }));
    expect(fix).toEqual(expect.arrayContaining([['Giờ vào theo đơn', '03/09/2026 08:05']]));
    expect(fix.some(([k]) => k === 'Giờ ra theo đơn')).toBe(false);
  });
});

describe('monthRequests và myMonthStats', () => {
  const employee: HrmBoardEmployee = {
    employeeId: 'e',
    employeeCode: 'NV1',
    employeeName: 'A',
    departmentName: null,
    positionName: null,
    days: {
      '2026-09-04': day({ date: '2026-09-04', requests: [req({ kind: 'OT', id: 'o', status: 'APPROVED' })] }),
      '2026-09-05': day({
        date: '2026-09-05',
        requests: [req({ kind: 'OT', id: 'o', status: 'APPROVED' }), req({ kind: 'LEAVE', id: 'l', status: 'PENDING' })],
      }),
      '2026-09-06': day({ date: '2026-09-06', kind: 'OFF', scheduledMinutes: 0 }),
    },
    totals: {
      workdayUnits: 12.5, workedMinutes: 6000, paidMinutes: 0, lateMinutes: 25, earlyLeaveMinutes: 0, otMinutes: 90,
      lateDays: 2, earlyLeaveDays: 0, abnormalDays: 0, absentDays: 0, annualLeaveDays: 1, paidLeaveDays: 0,
      unpaidLeaveDays: 0, tripDays: 0.5, offDays: 8, holidayDays: 1, unscheduledDays: 0,
    },
  };
  it('mỗi đơn một dòng dù nhiều ngày, kèm ngày đầu tiên', () => {
    const list = monthRequests(employee);
    expect(list.map((m) => `${m.request.kind}@${m.firstDate}`)).toEqual(['OT@2026-09-04', 'LEAVE@2026-09-05']);
  });
  it('công chuẩn cố định hiển thị đúng số công đã cấu hình', () => {
    const fixed = myMonthStats({ ...employee, standard: { mode: 'FIXED', workdays: 26 } }).find((s) => s.key === 'standard');
    expect(fixed).toMatchObject({ value: '26', hint: 'Cố định theo cấu hình' });
    const dynamic = myMonthStats({ ...employee, standard: { mode: 'DYNAMIC', workdays: 22 } }).find((s) => s.key === 'standard');
    expect(dynamic).toMatchObject({ value: '22' });
  });
  it('thống kê đủ thông số, cảnh báo khi có đi trễ hoặc đơn chờ', () => {
    const stats = Object.fromEntries(myMonthStats(employee).map((s) => [s.key, s]));
    expect(stats.units.value).toBe('12.5');
    expect(stats.units.hint).toContain('2 ngày có ca');
    // chưa có cấu hình công chuẩn: lấy số ngày có ca (động)
    expect(stats.standard).toMatchObject({ value: '2', hint: 'Động theo ngày công của tháng' });
    expect(stats.late).toMatchObject({ value: '2 ngày', hint: '25 phút', alert: true });
    expect(stats.early.alert).toBe(false);
    expect(stats.ot.value).toBe('1:30');
    // chỉ số phụ bằng 0 được đánh dấu để ẩn khỏi thanh thống kê
    expect(stats.abnormal).toMatchObject({ optional: true, zero: true });
    expect(stats.annual).toMatchObject({ optional: true, zero: false });
    expect(stats.pending).toMatchObject({ value: '1', alert: true });
  });
});

describe('lưới bảng công gọn', () => {
  const today = '2026-09-15';
  it('shortShiftCode giữ mã ngắn, rút gọn mã dài', () => {
    expect(shortShiftCode('HC')).toBe('HC');
    expect(shortShiftCode('HC-T7')).toBe('T7');
    expect(shortShiftCode('CA-NEW-1')).toBe('1');
    expect(shortShiftCode('SANGSOM')).toBe('SAN');
    expect(shortShiftCode(null)).toBe('');
  });
  it('ô ngày: chưa tới hiện mã ca, đã qua hiện số công, vắng hiện KP, nghỉ hằng tuần để trống, lễ hiện L', () => {
    expect(gridCellText(day({ date: '2026-09-20', status: 'FUTURE', workdayUnits: 0 }), today)).toBe('HC');
    expect(gridCellText(day({ date: '2026-09-10' }), today)).toBe('1');
    expect(gridCellText(day({ date: '2026-09-10', status: 'ABSENT', workdayUnits: 0 }), today)).toBe('KP');
    expect(gridCellText(day({ date: '2026-09-10', status: 'ABNORMAL', workdayUnits: 0 }), today)).toBe('!');
    expect(gridCellText(day({ date: '2026-09-10', kind: 'OFF', status: 'OFF', workdayUnits: 0 }), today)).toBe('');
    expect(gridCellText(day({ date: '2026-09-02', kind: 'HOLIDAY', status: 'HOLIDAY', workdayUnits: 0 }), today)).toBe('L');
  });
  it('màu ô: trễ hoặc sớm tô đỏ nhạt, vắng không phép đỏ đậm, bất thường tím', () => {
    expect(gridCellClass(day({ lateMinutes: 5 }), false)).toContain('bg-red-100');
    expect(gridCellClass(day({ earlyLeaveMinutes: 5 }), false)).toContain('bg-red-100');
    expect(gridCellClass(day({ status: 'ABSENT' }), false)).toContain('bg-red-600');
    expect(gridCellClass(day({ status: 'ABNORMAL' }), false)).toContain('fuchsia');
    expect(gridCellClass(day(), true)).toContain('bg-white');
  });
  const emp = (days: Record<string, HrmBoardDay>, over: Partial<HrmBoardEmployee['totals']> = {}): HrmBoardEmployee => ({
    employeeId: 'e',
    employeeCode: 'NV1',
    employeeName: 'A',
    departmentName: null,
    positionName: null,
    days,
    totals: {
      workdayUnits: 10, workedMinutes: 0, paidMinutes: 0, lateMinutes: 30, earlyLeaveMinutes: 10, otMinutes: 120,
      lateDays: 2, earlyLeaveDays: 1, abnormalDays: 0, absentDays: 0, annualLeaveDays: 1, paidLeaveDays: 0.5,
      unpaidLeaveDays: 0, tripDays: 0, offDays: 4, holidayDays: 0, ...over,
    },
  });
  it('compactTotals đếm ngày trễ hoặc sớm một lần mỗi ngày và gộp ngày nghỉ có đơn', () => {
    const e = emp({
      a: day({ date: '2026-09-01', lateMinutes: 5, earlyLeaveMinutes: 5 }),
      b: day({ date: '2026-09-02', lateMinutes: 5 }),
      c: day({ date: '2026-09-03' }),
    });
    expect(compactTotals(e)).toMatchObject({ units: 10, lateEarlyDays: 2, leaveDays: 1.5, otMinutes: 120, absentDays: 0 });
  });
  it('bộ lọc nhanh khớp đúng nhân viên', () => {
    const list = [
      emp({ a: day({ lateMinutes: 3 }) }),
      emp({ a: day() }),
      emp({ a: day() }, { absentDays: 1 }),
      emp({ a: day() }, { abnormalDays: 2 }),
      emp({ a: day({ requests: [req({ status: 'PENDING' })] }) }),
    ];
    expect(BOARD_FILTERS.map((f) => f.id)).toEqual(['ALL', 'LATE_EARLY', 'ABNORMAL', 'ABSENT', 'PENDING']);
    expect(list.map((e) => matchesBoardFilter(e, 'LATE_EARLY'))).toEqual([true, false, false, false, false]);
    expect(list.map((e) => matchesBoardFilter(e, 'ABSENT'))).toEqual([false, false, true, false, false]);
    expect(list.map((e) => matchesBoardFilter(e, 'ABNORMAL'))).toEqual([false, false, false, true, false]);
    expect(list.map((e) => matchesBoardFilter(e, 'PENDING'))).toEqual([false, false, false, false, true]);
    expect(matchesBoardFilter(list[1], 'ALL')).toBe(true);
  });
});

describe('Lịch công của tôi: chấm màu, giờ làm trong ô, nhãn trạng thái', () => {
  const TODAY = '2026-09-15';

  it('giờ làm dạng một số lẻ', () => {
    expect(hoursDecimal(480)).toBe('8.0');
    expect(hoursDecimal(450)).toBe('7.5');
    expect(hoursDecimal(0)).toBe('0.0');
    expect(hoursDecimal(null)).toBe('0.0');
  });

  it('màu chấm: đủ công, trễ, sớm, nghỉ phép, vắng, ngày nghỉ; ngày chưa tới không chấm', () => {
    expect(dayTone(day(), TODAY)).toBe('full');
    expect(dayTone(day({ status: 'LATE', lateMinutes: 10 }), TODAY)).toBe('late');
    expect(dayTone(day({ status: 'EARLY_LEAVE', earlyLeaveMinutes: 10 }), TODAY)).toBe('early');
    expect(dayTone(day({ status: 'ANNUAL_LEAVE' }), TODAY)).toBe('leave');
    expect(dayTone(day({ status: 'ABSENT' }), TODAY)).toBe('absent');
    expect(dayTone(day({ status: 'OFF', kind: 'OFF' }), TODAY)).toBe('off');
    expect(dayTone(day({ date: '2026-09-20', status: 'FUTURE' }), TODAY)).toBe('none');
  });

  it('nội dung ô: ngày đã qua hiện số công (hệ số), không hiện mã ca; ngày chưa tới hiện mã ca; vắng và nghỉ hiện gạch dài', () => {
    expect(myCellContent(day({ workedMinutes: 450, workdayUnits: 1 }), TODAY)).toEqual({ text: '', units: '1' });
    expect(myCellContent(day({ workedMinutes: 240, workdayUnits: 0.5 }), TODAY)).toEqual({ text: '', units: '0.5' });
    expect(myCellContent(day({ date: '2026-09-20', status: 'FUTURE', workedMinutes: 0 }), TODAY)).toEqual({
      text: 'HC',
      units: '',
    });
    expect(myCellContent(day({ status: 'ABSENT', workedMinutes: 480 }), TODAY)).toEqual({ text: '—', units: '' });
    expect(myCellContent(day({ status: 'ANNUAL_LEAVE', workedMinutes: 0 }), TODAY)).toEqual({ text: '—', units: '' });
    expect(myCellContent(day({ status: 'OFF', kind: 'OFF', workedMinutes: 0 }), TODAY)).toEqual({ text: 'OFF', units: '' });
    expect(myCellContent(day({ status: 'HOLIDAY', kind: 'HOLIDAY', workedMinutes: 0 }), TODAY).text).toBe('L');
  });

  it('nhãn trạng thái của ngày', () => {
    expect(dayStatusPill(day(), TODAY).label).toBe('Đủ công');
    expect(dayStatusPill(day({ workdayUnits: 0.5 }), TODAY).label).toBe('Chưa đủ công');
    expect(dayStatusPill(day({ status: 'LATE', lateMinutes: 5 }), TODAY).label).toBe('Đi trễ');
    expect(dayStatusPill(day({ status: 'LATE', lateMinutes: 5, earlyLeaveMinutes: 5 }), TODAY).label).toBe('Đi trễ, về sớm');
    expect(dayStatusPill(day({ status: 'ABSENT' }), TODAY).label).toBe('Nghỉ không phép');
    expect(dayStatusPill(day({ date: '2026-09-20', status: 'FUTURE' }), TODAY).label).toBe('Chưa tới ngày');
  });
});

import { gridCellView } from './my-timesheet-format';

describe('gridCellView: ô ngày của bảng công nhiều nhân viên', () => {
  const TODAY = '2026-09-15';
  it('ngày đã qua có công: hệ số công, 1 xanh; trễ hoặc sớm 0.xx đỏ; nửa ngày có đơn 0.5 xanh; quên chấm công 0 đỏ', () => {
    expect(gridCellView(day(), TODAY)).toEqual({ type: 'units', text: '1', tone: 'ok' });
    // Ca sáng T7 (240 phút) làm đủ là 0.5 công và vẫn xanh; trễ trong ca đó thì đỏ.
    expect(gridCellView(day({ scheduledMinutes: 240, paidMinutes: 240, workdayUnits: 0.5 }), TODAY)).toEqual({ type: 'units', text: '0.5', tone: 'ok' });
    expect(gridCellView(day({ status: 'LATE', lateMinutes: 20, scheduledMinutes: 240, paidMinutes: 220, workdayUnits: 0.46 }), TODAY)).toEqual({ type: 'units', text: '0.46', tone: 'bad' });
    expect(gridCellView(day({ status: 'LATE', lateMinutes: 10, workdayUnits: 0.9333 }), TODAY)).toEqual({ type: 'units', text: '0.93', tone: 'bad' });
    expect(gridCellView(day({ status: 'EARLY_LEAVE', earlyLeaveMinutes: 5, workdayUnits: 0.9 }), TODAY)).toEqual({ type: 'units', text: '0.9', tone: 'bad' });
    expect(gridCellView(day({ status: 'ANNUAL_LEAVE', leave: { requestId: 'l1', reasonName: null, paid: true, annual: true, days: 0.5 }, workdayUnits: 1 }), TODAY)).toEqual({ type: 'units', text: '0.5', tone: 'ok' });
    expect(gridCellView(day({ status: 'ABNORMAL', anomalies: ['MISSING_CHECK_OUT'], workedMinutes: 0, workdayUnits: 0 }), TODAY)).toEqual({ type: 'units', text: '0', tone: 'bad' });
  });

  it('nghỉ phép P, công tác CT, vắng KP, bất thường ! là ô ký hiệu', () => {
    expect(gridCellView(day({ status: 'ANNUAL_LEAVE' }), TODAY)).toEqual({ type: 'box', text: 'P', tone: 'leave' });
    expect(gridCellView(day({ status: 'UNPAID_LEAVE' }), TODAY)).toMatchObject({ text: 'P' });
    expect(gridCellView(day({ status: 'TRIP' }), TODAY)).toEqual({ type: 'box', text: 'CT', tone: 'trip' });
    expect(gridCellView(day({ status: 'ABSENT' }), TODAY)).toEqual({ type: 'box', text: 'KP', tone: 'absent' });
    expect(gridCellView(day({ status: 'ABNORMAL' }), TODAY)).toEqual({ type: 'box', text: '!', tone: 'abnormal' });
  });

  it('ngày nghỉ OFF, lễ L, chưa có lịch "-"', () => {
    expect(gridCellView(day({ status: 'OFF', kind: 'OFF', workedMinutes: 0 }), TODAY)).toEqual({ type: 'text', text: 'OFF', muted: true });
    expect(gridCellView(day({ status: 'HOLIDAY', kind: 'HOLIDAY', workedMinutes: 0 }), TODAY)).toMatchObject({ text: 'L' });
    expect(gridCellView(day({ status: 'NO_SCHEDULE', kind: 'NO_SCHEDULE' }), TODAY)).toMatchObject({ text: '-' });
  });

  it('ngày chưa tới chỉ hiện mã ca (rút gọn), không chấm công; ngày đã qua không hiện mã ca', () => {
    const future = day({ date: '2026-09-20', status: 'FUTURE', shiftCode: 'HC-T7', workedMinutes: 0 });
    expect(gridCellView(future, TODAY)).toEqual({ type: 'text', text: 'T7', muted: true });
    expect(gridCellView(day(), TODAY).type).toBe('units');
    expect(gridCellView(day({ date: '2026-09-20', status: 'FUTURE', shiftCode: null, kind: 'OFF' }), TODAY)).toMatchObject({ text: 'OFF' });
  });
});
