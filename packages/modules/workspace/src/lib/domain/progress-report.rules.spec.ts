import { WorkspaceValidationError } from './workspace.error.js';
import {
  parseReportDate,
  parseReportDescription,
  parseReportPercent,
  progressToRestore,
} from './progress-report.rules.js';

describe('parseReportPercent', () => {
  it('nhận số nguyên 0–100 và chuỗi số', () => {
    expect(parseReportPercent(0)).toBe(0);
    expect(parseReportPercent(40)).toBe(40);
    expect(parseReportPercent('100')).toBe(100);
  });

  it.each([-1, 101, 12.5, Number.NaN, '', ' ', 'abc', null, undefined, true])('từ chối %p', (value) => {
    expect(() => parseReportPercent(value)).toThrow(WorkspaceValidationError);
  });
});

describe('parseReportDescription', () => {
  it('bỏ khoảng trắng; rỗng hay vắng là không có mô tả', () => {
    expect(parseReportDescription('  đã gửi hồ sơ  ')).toBe('đã gửi hồ sơ');
    expect(parseReportDescription('   ')).toBeUndefined();
    expect(parseReportDescription(undefined)).toBeUndefined();
    expect(parseReportDescription(null)).toBeUndefined();
  });

  it('từ chối kiểu lạ và chuỗi quá dài', () => {
    expect(() => parseReportDescription(5)).toThrow(WorkspaceValidationError);
    expect(() => parseReportDescription('x'.repeat(2001))).toThrow(WorkspaceValidationError);
    expect(parseReportDescription('x'.repeat(2000))).toHaveLength(2000);
  });
});

describe('parseReportDate', () => {
  const today = '2026-11-15';

  it('bỏ trống là hôm nay', () => {
    expect(parseReportDate(undefined, today)).toBe(today);
    expect(parseReportDate('', today)).toBe(today);
  });

  it('nhận hôm nay và ngày đã qua', () => {
    expect(parseReportDate('2026-11-15', today)).toBe('2026-11-15');
    expect(parseReportDate('2026-10-01', today)).toBe('2026-10-01');
  });

  it('từ chối ngày tương lai, ngày không có thật và sai định dạng', () => {
    expect(() => parseReportDate('2026-11-16', today)).toThrow(WorkspaceValidationError);
    expect(() => parseReportDate('2026-02-30', today)).toThrow(WorkspaceValidationError);
    expect(() => parseReportDate('15/11/2026', today)).toThrow(WorkspaceValidationError);
  });
});

describe('progressToRestore', () => {
  it('lấy báo cáo gần nhất chưa tới 100%, bỏ qua các lần báo 100%', () => {
    // mới nhất trước: 100 (hoàn thành), 60, 30
    expect(progressToRestore([{ percent: 100 }, { percent: 60 }, { percent: 30 }])).toBe(60);
  });

  it('không có báo cáo nào, chỉ có 100% hoặc 0% thì để về 0%', () => {
    expect(progressToRestore([])).toBeUndefined();
    expect(progressToRestore([{ percent: 100 }])).toBeUndefined();
    expect(progressToRestore([{ percent: 0 }, { percent: 50 }])).toBeUndefined();
  });
});
