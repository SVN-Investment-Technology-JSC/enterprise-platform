import type { HrmBoardEmployee } from '@enterprise-platform/contracts-hrm';
import { boardFlagsOf, emptyFlagCounts, parseBoardFlag } from './hrm-timesheet-board-flags.js';

const day = (over: Record<string, unknown> = {}) => ({ lateMinutes: 0, earlyLeaveMinutes: 0, requests: [], ...over });
const employee = (days: Record<string, unknown>, totals: Record<string, number> = {}) =>
  ({ days, totals: { abnormalDays: 0, absentDays: 0, ...totals } }) as unknown as HrmBoardEmployee;

describe('boardFlagsOf', () => {
  it('nhân viên bình thường không có cờ nào', () => {
    expect([...boardFlagsOf(employee({ '2026-10-01': day() }))]).toEqual([]);
  });

  it('trễ hoặc sớm ở bất kỳ ngày nào bật LATE_EARLY', () => {
    expect(boardFlagsOf(employee({ a: day({ lateMinutes: 5 }) })).has('LATE_EARLY')).toBe(true);
    expect(boardFlagsOf(employee({ a: day({ earlyLeaveMinutes: 5 }) })).has('LATE_EARLY')).toBe(true);
  });

  it('bất thường và vắng lấy theo tổng tháng', () => {
    const flags = boardFlagsOf(employee({ a: day() }, { abnormalDays: 1, absentDays: 2 }));
    expect(flags.has('ABNORMAL')).toBe(true);
    expect(flags.has('ABSENT')).toBe(true);
  });

  it('chỉ đơn PENDING mới bật PENDING', () => {
    const request = (status: string) => ({ requests: [{ kind: 'LEAVE', id: 'r', status }] });
    expect(boardFlagsOf(employee({ a: day(request('PENDING')) })).has('PENDING')).toBe(true);
    expect(boardFlagsOf(employee({ a: day(request('APPROVED')) })).has('PENDING')).toBe(false);
  });
});

describe('parseBoardFlag', () => {
  it('rỗng và ALL là không lọc; không phân biệt hoa thường', () => {
    expect(parseBoardFlag(undefined)).toBeNull();
    expect(parseBoardFlag('')).toBeNull();
    expect(parseBoardFlag('all')).toBeNull();
    expect(parseBoardFlag('pending')).toBe('PENDING');
  });

  it('giá trị lạ báo lỗi, không bỏ qua âm thầm', () => {
    expect(() => parseBoardFlag('FOO')).toThrow(RangeError);
  });
});

describe('emptyFlagCounts', () => {
  it('ALL là tổng, các cờ bắt đầu từ 0', () => {
    expect(emptyFlagCounts(7)).toEqual({ ALL: 7, LATE_EARLY: 0, ABNORMAL: 0, ABSENT: 0, PENDING: 0 });
  });
});
