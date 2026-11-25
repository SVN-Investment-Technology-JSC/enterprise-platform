import type { HrmReportColumn } from '@enterprise-platform/contracts-hrm';
import {
  buildReportRows,
  defaultColumnKeys,
  monthBounds,
  reportFileName,
  reportQuery,
  reportRangeProblem,
  selectedColumns,
  toggleColumn,
} from './report-model';

const columns: HrmReportColumn[] = [
  { key: 'name', label: 'Họ và tên', defaultOn: true, type: 'text' },
  { key: 'code', label: 'Mã NV', defaultOn: false, type: 'text' },
  { key: 'hours', label: 'Tổng số giờ', defaultOn: true, type: 'number' },
];
const rows = [
  { name: 'An', code: 'NV1', hours: 6 },
  { name: 'Bình', code: 'NV2', hours: null },
];

describe('report-model', () => {
  it('tính ngày đầu và cuối tháng kể cả năm nhuận', () => {
    expect(monthBounds('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthBounds('2026-02').to).toBe('2026-02-28');
    expect(monthBounds('2028-02').to).toBe('2028-02-29');
  });

  it('chọn cột mặc định, giữ thứ tự báo cáo và không cho bỏ cột cuối cùng', () => {
    expect(defaultColumnKeys(columns)).toEqual(['name', 'hours']);
    expect(selectedColumns(columns, ['hours', 'name']).map((c) => c.key)).toEqual(['name', 'hours']);
    expect(toggleColumn(['name', 'hours'], 'code')).toEqual(['name', 'hours', 'code']);
    expect(toggleColumn(['name', 'hours'], 'hours')).toEqual(['name']);
    expect(toggleColumn(['name'], 'name')).toEqual(['name']);
  });

  it('dựng dòng Excel: chỉ cột đã chọn, số giữ dạng số, ô trống là chuỗi rỗng, có STT khi cần', () => {
    expect(buildReportRows({ columns, rows }, ['name', 'hours'])).toEqual([
      ['Họ và tên', 'Tổng số giờ'],
      ['An', 6],
      ['Bình', ''],
    ]);
    expect(buildReportRows({ columns, rows }, ['code'], { withIndex: true })).toEqual([
      ['STT', 'Mã NV'],
      [1, 'NV1'],
      [2, 'NV2'],
    ]);
    expect(buildReportRows({ columns, rows }, ['name'], { maxRows: 1 })).toHaveLength(2);
  });

  it('đặt tên file không dấu kèm khoảng ngày', () => {
    expect(reportFileName('Tong hop don tu', '2026-10-01', '2026-10-31')).toBe('Tong-hop-don-tu_20261001_20261031');
    expect(reportFileName('Công tác', '2026-10-01', '2026-10-31')).toBe('Cong-tac_20261001_20261031');
  });

  it('kiểm khoảng ngày và dựng query bỏ danh sách rỗng', () => {
    expect(reportRangeProblem('2026-10-01', '2026-10-31')).toBe('');
    expect(reportRangeProblem('', '2026-10-31')).toMatch(/Cần chọn/);
    expect(reportRangeProblem('2026-11-01', '2026-10-31')).toMatch(/sau hoặc bằng/);
    expect(reportRangeProblem('2025-01-01', '2026-10-31')).toMatch(/400/);
    const q = reportQuery({ from: '2026-10-01', to: '2026-10-31', departmentIds: ['d1', 'd2'], employeeIds: [], statuses: ['APPROVED'] });
    expect(q).toBe('from=2026-10-01&to=2026-10-31&departmentIds=d1%2Cd2&statuses=APPROVED');
  });
});
