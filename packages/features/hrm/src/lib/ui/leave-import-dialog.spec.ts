/** @jest-environment jsdom */
import { parseLeaveImportRows } from './leave-import-dialog';

describe('parseLeaveImportRows', () => {
  it('đọc cột của file mẫu, lấy năm mặc định khi bỏ trống và báo lỗi từng dòng', () => {
    const rows = parseLeaveImportRows(
      [
        { 'Mã nhân viên': 'NV001', Năm: 2026, 'Số ngày điều chỉnh (+/-)': '1,5', 'Lý do': 'Đối soát' },
        { 'Mã nhân viên': 'NV002', 'Số ngày điều chỉnh (+/-)': -0.5, 'Lý do': 'Giảm' },
        { 'Mã nhân viên': '', 'Số ngày điều chỉnh (+/-)': 1, 'Lý do': 'x' },
        { 'Mã nhân viên': 'NV003', 'Số ngày điều chỉnh (+/-)': 0, 'Lý do': 'x' },
        { 'Mã nhân viên': 'NV004', 'Số ngày điều chỉnh (+/-)': 1, 'Lý do': '' },
        { 'Mã nhân viên': 'NV005', Năm: 1900, 'Số ngày điều chỉnh (+/-)': 1, 'Lý do': 'x' },
      ],
      2026,
    );
    expect(rows[0]).toMatchObject({ lineNo: 2, employeeCode: 'NV001', year: 2026, days: 1.5, reason: 'Đối soát', error: undefined });
    expect(rows[1]).toMatchObject({ employeeCode: 'NV002', year: 2026, days: -0.5, error: undefined });
    expect(rows.slice(2).map((r) => r.error)).toEqual([
      'Thiếu mã nhân viên',
      'Số ngày phải khác 0 và không quá 366',
      'Thiếu lý do',
      'Năm không hợp lệ',
    ]);
  });
});
