import type { HrmBoardDay, HrmMonitorRow } from '@enterprise-platform/contracts-hrm';
import {
  classifyMonitorDay,
  nowMinutesIn,
  summarizeMonitor,
  type MonitorContext,
} from './hrm-attendance-monitor';

const day = (over: Partial<HrmBoardDay> = {}): HrmBoardDay => ({
  date: '2026-10-13',
  kind: 'WORK',
  status: 'PRESENT',
  shiftCode: 'HC',
  shiftName: 'Ca hành chính',
  shiftStart: '07:30',
  shiftEnd: '17:00',
  checkIn: null,
  checkOut: null,
  scheduledMinutes: 480,
  workedMinutes: 0,
  paidMinutes: 0,
  workdayUnits: 0,
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
const at = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
const today = (hm: string): MonitorContext => ({ date: '2026-10-13', today: '2026-10-13', nowMinutes: at(hm) });
const past: MonitorContext = { date: '2026-10-12', today: '2026-10-13', nowMinutes: at('09:00') };
const future: MonitorContext = { date: '2026-10-14', today: '2026-10-13', nowMinutes: at('09:00') };

describe('classifyMonitorDay: hôm nay', () => {
  it('chưa tới giờ ca thì chưa tính là vắng; quá giờ ca mà chưa chấm vào là chưa chấm công', () => {
    expect(classifyMonitorDay(day({ status: 'FUTURE' }), today('07:00'))).toBe('UPCOMING');
    expect(classifyMonitorDay(day({ status: 'FUTURE' }), today('07:30'))).toBe('NOT_CHECKED_IN');
    expect(classifyMonitorDay(day({ status: 'FUTURE' }), today('10:00'))).toBe('NOT_CHECKED_IN');
  });

  it('đã chấm vào đang làm: đúng giờ là đã vào ca, trễ là đi trễ', () => {
    expect(classifyMonitorDay(day({ checkIn: '07:25' }), today('10:00'))).toBe('CHECKED_IN');
    expect(classifyMonitorDay(day({ checkIn: '07:48', lateMinutes: 18 }), today('10:00'))).toBe('LATE');
  });

  it('chỉ có lượt vào mà đã quá giờ kết thúc ca thì thiếu lượt chấm', () => {
    expect(classifyMonitorDay(day({ checkIn: '07:25' }), today('16:59'))).toBe('CHECKED_IN');
    expect(classifyMonitorDay(day({ checkIn: '07:25' }), today('17:30'))).toBe('MISSING_PUNCH');
  });

  it('chỉ có lượt ra (không có lượt vào) là thiếu lượt chấm', () => {
    expect(classifyMonitorDay(day({ checkOut: '17:00' }), today('18:00'))).toBe('MISSING_PUNCH');
  });

  it('đủ hai lượt: về sớm, đi trễ, cả hai, hoặc hoàn thành', () => {
    expect(classifyMonitorDay(day({ checkIn: '07:25', checkOut: '16:20', earlyLeaveMinutes: 40 }), today('17:30'))).toBe('EARLY_LEAVE');
    expect(classifyMonitorDay(day({ checkIn: '07:50', checkOut: '17:05', lateMinutes: 20 }), today('17:30'))).toBe('LATE');
    expect(classifyMonitorDay(day({ checkIn: '07:50', checkOut: '16:20', lateMinutes: 20, earlyLeaveMinutes: 40 }), today('17:30'))).toBe('LATE_EARLY');
    expect(classifyMonitorDay(day({ checkIn: '07:25', checkOut: '17:05' }), today('17:30'))).toBe('COMPLETED');
  });

  it('ca qua đêm: lượt vào không bị coi là thiếu lượt chấm trong ngày', () => {
    expect(classifyMonitorDay(day({ shiftStart: '22:00', shiftEnd: '06:00', checkIn: '21:55' }), today('23:30'))).toBe('CHECKED_IN');
  });
});

describe('classifyMonitorDay: ngày khác và đơn từ', () => {
  it('ngày đã qua không chấm công là vắng; ngày chưa tới là chưa tới giờ', () => {
    expect(classifyMonitorDay(day({ status: 'ABSENT' }), past)).toBe('ABSENT');
    expect(classifyMonitorDay(day({ status: 'FUTURE' }), future)).toBe('UPCOMING');
  });

  it('ngày đã qua chỉ có lượt vào là thiếu lượt chấm', () => {
    expect(classifyMonitorDay(day({ checkIn: '07:30', status: 'ABNORMAL', anomalies: ['MISSING_CHECK_OUT'] }), past)).toBe('MISSING_PUNCH');
  });

  it('nghỉ phép hoặc công tác cả ngày không bị tính là chưa chấm công', () => {
    const leave = { requestId: 'r', reasonName: 'Nghỉ phép năm', paid: true, annual: true, days: 1 };
    expect(classifyMonitorDay(day({ status: 'ANNUAL_LEAVE', leave }), today('10:00'))).toBe('ON_LEAVE');
    expect(classifyMonitorDay(day({ status: 'TRIP', tripId: 't' }), today('10:00'))).toBe('ON_TRIP');
  });

  it('ngày nghỉ, ngày lễ và chưa có lịch', () => {
    expect(classifyMonitorDay(day({ status: 'OFF', kind: 'OFF', shiftStart: null }), today('10:00'))).toBe('DAY_OFF');
    expect(classifyMonitorDay(day({ status: 'HOLIDAY', kind: 'HOLIDAY', shiftStart: null }), today('10:00'))).toBe('DAY_OFF');
    expect(classifyMonitorDay(day({ status: 'NO_SCHEDULE', kind: 'NO_SCHEDULE', shiftStart: null }), today('10:00'))).toBe('NO_SCHEDULE');
  });
});

describe('summarizeMonitor và giờ hiện tại', () => {
  const row = (over: Partial<HrmMonitorRow>): HrmMonitorRow => ({
    employeeId: 'e',
    employeeCode: 'NV',
    employeeName: 'Tên',
    departmentName: null,
    positionName: null,
    status: 'COMPLETED',
    shiftCode: null,
    shiftName: null,
    shiftStart: null,
    shiftEnd: null,
    checkIn: null,
    checkOut: null,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    leaveName: null,
    leaveDays: 0,
    requests: [],
    ...over,
  });

  it('đếm đúng từng thẻ; nhân viên ngày nghỉ/chưa có lịch không nằm trong số đi ca', () => {
    const rows = [
      row({ status: 'COMPLETED', checkIn: '07:30' }),
      row({ status: 'LATE', checkIn: '07:50' }),
      row({ status: 'LATE_EARLY', checkIn: '07:50' }),
      row({ status: 'EARLY_LEAVE', checkIn: '07:30' }),
      row({ status: 'NOT_CHECKED_IN' }),
      row({ status: 'ABSENT' }),
      row({ status: 'ON_LEAVE' }),
      row({ status: 'ON_TRIP' }),
      row({ status: 'MISSING_PUNCH', checkIn: '07:30' }),
      row({ status: 'DAY_OFF' }),
      row({ status: 'NO_SCHEDULE' }),
    ];
    expect(summarizeMonitor(rows)).toEqual({
      totalPeople: 11,
      scheduled: 9,
      checkedIn: 5,
      notCheckedIn: 2,
      late: 2,
      earlyLeave: 2,
      onLeave: 1,
      onTrip: 1,
      missingPunch: 1,
    });
  });

  it('giờ hiện tại tính theo múi giờ công ty', () => {
    expect(nowMinutesIn('Asia/Ho_Chi_Minh', new Date('2026-10-13T02:30:00Z'))).toBe(9 * 60 + 30);
    expect(nowMinutesIn('Asia/Ho_Chi_Minh', new Date('2026-10-12T17:05:00Z'))).toBe(5);
  });
});
