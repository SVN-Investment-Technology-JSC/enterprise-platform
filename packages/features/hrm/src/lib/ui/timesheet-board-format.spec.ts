import type { HrmBoardDay, HrmBoardEmployee } from '@enterprise-platform/contracts-hrm';
import {
  anomalyLabel,
  BOARD_LEGEND_ORDER,
  BOARD_STATUS_META,
  boardCellMarkers,
  boardCellText,
  boardDayTooltip,
  boardStatusLabel,
  buildBoardCsv,
  buildBoardSheet,
  formatDateTimeVn,
  formatUnits,
  leaveDescription,
  monthStateLabel,
  monthStateTimestamp,
} from './timesheet-board-format';

const day = (over: Partial<HrmBoardDay> = {}): HrmBoardDay => ({
  date: '2026-09-02',
  kind: 'WORK',
  status: 'PRESENT',
  shiftCode: 'HC',
  shiftName: 'Hành chính',
  shiftStart: '08:00',
  shiftEnd: '17:00',
  checkIn: '08:00',
  checkOut: '17:05',
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

describe('timesheet-board-format', () => {
  it('có chú thích đủ mọi trạng thái', () => {
    expect(BOARD_LEGEND_ORDER).toHaveLength(14);
    expect(new Set(BOARD_LEGEND_ORDER).size).toBe(14);
    expect(Object.keys(BOARD_STATUS_META).sort()).toEqual([...BOARD_LEGEND_ORDER].sort());
  });

  it('ký hiệu và nhãn từng trạng thái', () => {
    const cases: [HrmBoardDay['status'], string, string][] = [
      ['PRESENT', '1', 'Đi làm'],
      ['LATE', '1', 'Đi trễ'],
      ['EARLY_LEAVE', '1', 'Về sớm'],
      ['LATE_EARLY', '1', 'Trễ và sớm'],
      ['ABNORMAL', '!', 'Bất thường (quên chấm công)'],
      ['ABSENT', 'KP', 'Nghỉ không phép'],
      ['ANNUAL_LEAVE', 'PN', 'Phép năm'],
      ['PAID_LEAVE', 'CP', 'Nghỉ có phép'],
      ['UNPAID_LEAVE', 'KL', 'Nghỉ không lương'],
      ['TRIP', 'CT', 'Công tác'],
      ['OFF', 'OFF', 'Ngày nghỉ'],
      ['HOLIDAY', 'L', 'Lễ'],
      ['NO_SCHEDULE', '-', 'Chưa có lịch'],
      ['FUTURE', '', 'Chưa tới ngày'],
    ];
    for (const [status, text, label] of cases) {
      expect(boardCellText(day({ status }))).toBe(text);
      expect(boardStatusLabel(status)).toBe(label);
    }
    expect(boardStatusLabel('LA')).toBe('Chưa xác định');
  });

  it('số công và dấu nhỏ', () => {
    expect(boardCellText(day({ workdayUnits: 0.5 }))).toBe('0.5');
    expect(formatUnits(0.3333)).toBe('0.33');
    expect(boardCellMarkers(day())).toBe('');
    expect(boardCellMarkers(day({ lateMinutes: 5, earlyLeaveMinutes: 3 }))).toBe('TS');
    expect(boardCellMarkers(day({ anomalies: ['MISSING_CHECK_OUT'] }))).toBe('!');
  });

  it('dịch mã bất thường và trạng thái tháng', () => {
    expect(anomalyLabel('MISSING_CHECK_IN')).toBe('Thiếu chấm vào');
    expect(anomalyLabel('MISSING_CHECK_OUT')).toBe('Thiếu chấm ra');
    expect(anomalyLabel('NO_SHIFT')).toBe('Chưa có ca');
    expect(anomalyLabel('LEAVE_TRIP_OVERLAP')).toBe('Nghỉ phép trùng công tác');
    expect(anomalyLabel('LEGACY_LEAVE_REQUIRES_REVIEW')).toBe('Đơn nghỉ cũ cần rà soát');
    expect(anomalyLabel('LA_LA')).toContain('LA_LA');
    expect(monthStateLabel('OPEN')).toBe('Đang mở');
    expect(monthStateLabel('REQUESTS_CLOSED')).toBe('Đã chốt đơn từ');
    expect(monthStateLabel('LOCKED')).toBe('Đã chốt công');
  });

  it('thời điểm và tooltip', () => {
    expect(formatDateTimeVn('2026-10-01T03:30:00Z')).toBe('01/10/2026 10:30');
    expect(formatDateTimeVn(null)).toBe('');
    expect(
      monthStateTimestamp({ state: 'LOCKED', requestsClosedAt: null, lockedAt: '2026-10-01T03:30:00Z' }),
    ).toBe('01/10/2026 10:30');
    expect(monthStateTimestamp({ state: 'OPEN', requestsClosedAt: null, lockedAt: null })).toBe('');
    const tip = boardDayTooltip(day({ status: 'LATE', lateMinutes: 12, checkIn: '08:12' }));
    expect(tip).toContain('Ca: HC Hành chính (08:00-17:00)');
    expect(tip).toContain('Chấm: 08:12 - 17:05');
    expect(tip).toContain('Đi trễ: 12 phút');
    expect(leaveDescription(day({ leave: { requestId: 'r', reasonName: 'Phép năm', paid: true, annual: true, days: 1 } }))).toBe(
      'Phép năm (Có lương, trừ phép năm)',
    );
  });

  it('dựng CSV theo nhân viên và ngày', () => {
    const emp: HrmBoardEmployee = {
      employeeId: 'e1',
      employeeCode: 'NV001',
      employeeName: 'An',
      departmentName: 'Sản xuất',
      positionName: null,
      days: { '2026-09-01': day({ date: '2026-09-01', status: 'OFF' }), '2026-09-02': day() },
      totals: {
        workdayUnits: 1, workedMinutes: 480, paidMinutes: 480, lateMinutes: 0, earlyLeaveMinutes: 0, otMinutes: 90,
        lateDays: 0, earlyLeaveDays: 0, abnormalDays: 0, absentDays: 0, annualLeaveDays: 0, paidLeaveDays: 0,
        unpaidLeaveDays: 0, tripDays: 0, offDays: 1, holidayDays: 0,
      },
    };
    const csv = buildBoardCsv(
      {
        calendar: [
          { date: '2026-09-01', weekday: 2, kind: 'OFF', holidayName: null },
          { date: '2026-09-02', weekday: 3, kind: 'WORK', holidayName: null },
        ],
      },
      [emp],
    );
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"01/09/2026","02/09/2026"');
    expect(lines[1].startsWith('"NV001","An","Sản xuất","OFF","1",')).toBe(true);
    expect(lines[1]).toContain('"1:30"');
  });

  it('buildBoardSheet: tiêu đề tháng, tiêu đề hai tầng (thứ trên, ngày dưới), nhóm cột tổng gộp ô, giá trị số để dạng số', () => {
    const day = (date: string, status: HrmBoardDay['status'], units: number) =>
      ({ date, status, workdayUnits: units, lateMinutes: 0, earlyLeaveMinutes: 0, otMinutes: 0, anomalies: [] }) as unknown as HrmBoardDay;
    const emp = {
      employeeId: 'e1', employeeCode: 'NV001', employeeName: 'An', departmentName: 'Sản xuất', positionName: 'Kỹ sư',
      days: { '2026-09-02': day('2026-09-02', 'PRESENT', 1) },
      totals: {
        workdayUnits: 1, workedMinutes: 480, paidMinutes: 480, lateMinutes: 12, earlyLeaveMinutes: 0, otMinutes: 90,
        lateDays: 1, earlyLeaveDays: 0, abnormalDays: 0, absentDays: 0, annualLeaveDays: 0, paidLeaveDays: 0,
        unpaidLeaveDays: 0, tripDays: 0, offDays: 1, holidayDays: 0,
      },
    } as unknown as HrmBoardEmployee;
    const sheet = buildBoardSheet(
      {
        calendar: [
          { date: '2026-09-01', weekday: 1, kind: 'OFF', holidayName: null },
          { date: '2026-09-02', weekday: 2, kind: 'WORK', holidayName: null },
        ],
      },
      [emp],
      '2026-09',
    );
    expect(sheet.rows[0][0]).toBe('BẢNG CHẤM CÔNG THÁNG 09-2026');
    expect(sheet.rows[1].slice(0, 6)).toEqual(['Mã NV', 'Họ và tên', 'Phòng ban', 'Chức danh', 'T2', 'T3']);
    expect(sheet.rows[2].slice(4, 6)).toEqual(['01/09', '02/09']);
    expect(sheet.rows[3].slice(0, 5)).toEqual(['NV001', 'An', 'Sản xuất', 'Kỹ sư', expect.anything()]);
    expect(sheet.rows[3][5]).toBe(1);
    expect(sheet.offColumns).toEqual([4]);
    // Nhóm "Đi trễ" có hai cột con (Số ngày, Số phút) nên gộp ngang ở tầng trên.
    const lateCol = sheet.rows[1].indexOf('Đi trễ');
    expect(sheet.merges).toContainEqual({ s: { r: 1, c: lateCol }, e: { r: 1, c: lateCol + 1 } });
    expect(sheet.rows[3].slice(lateCol, lateCol + 2)).toEqual([1, 12]);
    expect(sheet.rows.every((row) => row.length === sheet.rows[0].length)).toBe(true);
  });
});
