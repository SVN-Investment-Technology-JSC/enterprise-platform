import { compareByColumn, nextColumnSort, parseColumnSort, type ProjectColumnSort } from './project-column-sort';

interface P {
  name: string;
  status: string;
  customer?: string;
  tags?: string[];
  startDate?: string | null;
  endDate?: string | null;
  progressPercent?: number | null;
}
const RANK = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
const lookups = {
  customerName: (p: P) => p.customer ?? '',
  tagNames: (p: P) => p.tags ?? [],
  statusRank: (s: string) => RANK.indexOf(s),
};
const sortBy = (rows: P[], sort: ProjectColumnSort) => [...rows].sort((a, b) => compareByColumn(sort, lookups, a, b)).map((p) => p.name);

describe('nextColumnSort', () => {
  it('bấm lần lượt: tăng dần, giảm dần, bỏ; đổi cột thì bắt đầu lại từ tăng dần', () => {
    const asc = nextColumnSort(undefined, 'endDate');
    expect(asc).toEqual({ column: 'endDate', direction: 'asc' });
    const desc = nextColumnSort(asc, 'endDate');
    expect(desc).toEqual({ column: 'endDate', direction: 'desc' });
    expect(nextColumnSort(desc, 'endDate')).toBeUndefined();
    expect(nextColumnSort(desc, 'status')).toEqual({ column: 'status', direction: 'asc' });
  });
});

describe('parseColumnSort', () => {
  it('chỉ nhận cột và chiều hợp lệ', () => {
    expect(parseColumnSort({ column: 'status', direction: 'desc' })).toEqual({ column: 'status', direction: 'desc' });
    expect(parseColumnSort({ column: 'actions', direction: 'asc' })).toBeUndefined();
    expect(parseColumnSort({ column: 'status', direction: 'up' })).toBeUndefined();
    expect(parseColumnSort('x')).toBeUndefined();
    expect(parseColumnSort(null)).toBeUndefined();
  });
});

describe('compareByColumn', () => {
  const rows: P[] = [
    { name: 'B', status: 'completed', endDate: '2026-12-01', progressPercent: 50, customer: 'Zeta', tags: ['x'] },
    { name: 'A', status: 'active', endDate: null, progressPercent: 10, customer: 'Đông', tags: [] },
    { name: 'C', status: 'planning', endDate: '2026-11-01', progressPercent: 90, customer: '', tags: ['b', 'a'] },
  ];

  it('ngày: ô trống luôn xuống cuối ở cả hai chiều', () => {
    expect(sortBy(rows, { column: 'endDate', direction: 'asc' })).toEqual(['C', 'B', 'A']);
    expect(sortBy(rows, { column: 'endDate', direction: 'desc' })).toEqual(['B', 'C', 'A']);
  });

  it('trạng thái theo vòng đời, tiến độ theo số', () => {
    expect(sortBy(rows, { column: 'status', direction: 'asc' })).toEqual(['C', 'A', 'B']);
    expect(sortBy(rows, { column: 'progress', direction: 'desc' })).toEqual(['C', 'B', 'A']);
  });

  it('khách hàng theo chữ cái tiếng Việt, chưa có khách xuống cuối; nhãn theo nhãn đứng đầu', () => {
    expect(sortBy(rows, { column: 'customer', direction: 'asc' })).toEqual(['A', 'B', 'C']);
    expect(sortBy(rows, { column: 'tags', direction: 'asc' })).toEqual(['C', 'B', 'A']);
  });

  it('hai dự án bằng nhau trả 0 để dùng tiêu chí phụ', () => {
    expect(compareByColumn({ column: 'status', direction: 'asc' }, lookups, rows[0], { ...rows[0], name: 'Z' })).toBe(0);
  });
});
