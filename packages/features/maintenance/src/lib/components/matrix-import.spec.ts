import { excelSerialToIsoDate } from './matrix-import';

describe('excelSerialToIsoDate', () => {
  it('đổi số serial của Excel sang ngày ISO', () => {
    expect(excelSerialToIsoDate(46346)).toBe('2026-11-20');
    expect(excelSerialToIsoDate(45292)).toBe('2024-01-01');
  });

  it('bỏ qua chuỗi, số quá nhỏ hoặc quá lớn để nhánh đọc chuỗi xử lý', () => {
    expect(excelSerialToIsoDate('20/11/2026')).toBeUndefined();
    expect(excelSerialToIsoDate(12)).toBeUndefined();
    expect(excelSerialToIsoDate(1_000_000)).toBeUndefined();
    expect(excelSerialToIsoDate(Number.NaN)).toBeUndefined();
  });
});
