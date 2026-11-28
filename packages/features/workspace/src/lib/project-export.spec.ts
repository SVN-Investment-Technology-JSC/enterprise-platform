import type { ProjectMember, ProjectSummary } from '@enterprise-platform/contracts-workspace';
import {
  DEFAULT_PROJECT_EXPORT_KEYS,
  PROJECT_EXPORT_COLUMNS,
  buildProjectExportRows,
  exportDate,
  needsMembers,
  projectDays,
  projectExportFileName,
  selectedExportColumns,
  type ProjectExportLookups,
} from './project-export';

const project = {
  id: 'p-1',
  code: '26/703/',
  name: 'Thí nghiệm định kỳ thiết bị điện',
  status: 'active',
  ownerUserId: 'u-1',
  createdBy: 'u-2',
  orgUnitId: 'o-1',
  customerId: 'k-1',
  projectType: 'Dịch vụ Thí nghiệm',
  tagIds: ['t-1', 't-2'],
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  progressPercent: 19.6,
  progressMethod: 'average',
  metadata: {},
  createdAt: '2026-10-23T02:17:00.000Z',
  updatedAt: '2026-10-23T02:17:00.000Z',
  totalItems: 12,
  closedItems: 3,
  overdueItems: 0,
  contractValue: 594_101_579,
} as unknown as ProjectSummary;

const lookups: ProjectExportLookups = {
  personName: (id) => ({ 'u-1': 'Hà Nguyên Hoàng', 'u-2': 'Nguyễn Thị Diễm My', 'u-3': 'Trần Văn Thìn' })[id ?? ''] ?? '—',
  orgUnitName: () => 'Văn phòng đại diện Tây Nguyên',
  customerName: () => 'Công ty Cổ phần Năng lượng Lộc Ninh 4',
  tagName: (id) => ({ 't-1': 'THÍ NGHIỆM', 't-2': 'Miền Nam' })[id] ?? '',
  membersOf: (id) =>
    id === 'p-1'
      ? ([{ userId: 'u-1' }, { userId: 'u-3' }, { userId: 'u-3' }] as unknown as ProjectMember[])
      : undefined,
};

const cell = (key: string, source: ProjectSummary = project) =>
  PROJECT_EXPORT_COLUMNS.find((column) => column.key === key)?.value(source, lookups);

describe('xuất danh sách dự án ra Excel', () => {
  it('tên cột theo mẫu 1office và mặc định xuất hết', () => {
    expect(PROJECT_EXPORT_COLUMNS.slice(0, 4).map((column) => column.label)).toEqual([
      'Tên dự án',
      'Mã dự án',
      'Bắt đầu',
      'Kết thúc',
    ]);
    expect(DEFAULT_PROJECT_EXPORT_KEYS).toHaveLength(PROJECT_EXPORT_COLUMNS.length);
    expect(new Set(DEFAULT_PROJECT_EXPORT_KEYS).size).toBe(PROJECT_EXPORT_COLUMNS.length);
  });

  it('ngày dạng dd/mm/yyyy, số ngày tính cả ngày đầu lẫn cuối như mẫu (365 ngày cho cả năm)', () => {
    expect(exportDate('2026-07-01')).toBe('01/07/2026');
    expect(exportDate('2026-07-01T10:00:00.000Z')).toBe('01/07/2026');
    expect(exportDate(undefined)).toBe('');
    expect(projectDays({ startDate: '2026-01-01', endDate: '2026-12-31' })).toBe(365);
    expect(projectDays({ startDate: '2024-07-01', endDate: '2025-01-01' })).toBe(185);
    expect(projectDays({ startDate: '2026-02-01', endDate: '2026-01-01' })).toBeUndefined();
    expect(projectDays({ startDate: undefined, endDate: '2026-01-01' })).toBeUndefined();
    expect(cell('days')).toBe('365 ngày');
  });

  it('các ô chữ và số của một dự án', () => {
    expect(cell('name')).toBe('Thí nghiệm định kỳ thiết bị điện');
    expect(cell('startDate')).toBe('01/01/2026');
    expect(cell('status')).toBe('Đang chạy');
    expect(cell('items')).toBe(12);
    expect(cell('progress')).toBe('20%');
    expect(cell('group')).toBe('Dịch vụ Thí nghiệm');
    expect(cell('tags')).toBe('THÍ NGHIỆM, Miền Nam');
    expect(cell('owner')).toBe('Hà Nguyên Hoàng');
    expect(cell('creator')).toBe('Nguyễn Thị Diễm My');
    expect(cell('orgUnit')).toBe('Văn phòng đại diện Tây Nguyên');
    expect(cell('customer')).toBe('Công ty Cổ phần Năng lượng Lộc Ninh 4');
    expect(cell('contractValue')).toBe(594_101_579);
  });

  it('giá trị dự án để trống khi người xuất không được xem tài chính (server không gửi số)', () => {
    expect(cell('contractValue', { ...project, contractValue: undefined })).toBe('');
    expect(cell('contractValue', { ...project, contractValue: null })).toBe('');
  });

  it('thành viên: đếm và nối tên không trùng; chưa nạp được thì để trống', () => {
    expect(cell('memberCount')).toBe(3);
    expect(cell('members')).toBe('Hà Nguyên Hoàng, Trần Văn Thìn');
    const other = { ...project, id: 'p-2' };
    expect(cell('memberCount', other)).toBe('');
    expect(cell('members', other)).toBe('');
  });

  it('chọn trường: theo thứ tự của mẫu, bỏ khoá lạ, biết khi nào cần nạp thành viên', () => {
    const columns = selectedExportColumns(['customer', 'name', 'khong-co', 'code']);
    expect(columns.map((column) => column.key)).toEqual(['name', 'code', 'customer']);
    expect(needsMembers(columns)).toBe(false);
    expect(needsMembers(selectedExportColumns(['name', 'members']))).toBe(true);
  });

  it('dựng bảng: hàng tiêu đề và đúng một dòng mỗi dự án', () => {
    const columns = selectedExportColumns(['name', 'code']);
    expect(buildProjectExportRows([project, { ...project, id: 'p-2', name: 'B', code: 'C' }], columns, lookups)).toEqual({
      headers: ['Tên dự án', 'Mã dự án'],
      rows: [
        ['Thí nghiệm định kỳ thiết bị điện', '26/703/'],
        ['B', 'C'],
      ],
    });
  });

  it('tên tệp theo kiểu 1office', () => {
    expect(projectExportFileName(124, new Date(2026, 10, 27))).toBe('124-ban-ghi-Du-an-ngay-27112026.xlsx');
  });
});
