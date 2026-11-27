import type { ProjectReportGroup, ProjectSummary } from '@enterprise-platform/contracts-workspace';
import {
  CONTRACT_COLUMN,
  FIRST_DATA_ROW,
  FIRST_GROUP_COLUMN,
  TOTAL_ROW,
  UNASSIGNED_REPORT_GROUP_LABEL,
  buildProjectReportSheet,
  columnLetter,
  projectReportFileName,
  projectReportYear,
  reportContractValue,
  reportGroupColumns,
  type ProjectReportLookups,
} from './project-report-export';

const base = {
  status: 'active',
  ownerUserId: 'u-1',
  createdBy: 'u-1',
  orgUnitId: 'o-1',
  customerId: 'k-1',
  progressPercent: 0,
  progressMethod: 'average',
  metadata: {},
  createdAt: '2025-03-02T02:00:00.000Z',
  updatedAt: '2025-03-02T02:00:00.000Z',
  totalItems: 0,
  closedItems: 0,
  overdueItems: 0,
};

const project = (patch: Partial<ProjectSummary> & Pick<ProjectSummary, 'id' | 'code'>): ProjectSummary =>
  ({ ...base, name: `Dự án ${patch.code}`, ...patch }) as unknown as ProjectSummary;

// Danh mục trả về lộn thứ tự: báo cáo phải theo `sortOrder`.
const CATALOG: ProjectReportGroup[] = [
  { id: 'g-ban', name: 'Bán hàng', sortOrder: 3 },
  { id: 'g-dv', name: 'Dịch vụ', sortOrder: 1 },
  { id: 'g-om', name: 'O&M', sortOrder: 4 },
  { id: 'g-tn', name: 'Thí nghiệm', sortOrder: 2 },
];

const lookups: ProjectReportLookups = {
  customerName: (id) => ({ 'k-1': 'Công ty Lộc Ninh 4', 'k-2': 'Điện lực Gia Lai' })[id ?? ''] ?? '',
  orgUnitName: (id) => ({ 'o-1': 'Phòng Thí nghiệm' })[id ?? ''] ?? '',
};

const NOW = new Date(2026, 10, 27, 9, 30);

describe('báo cáo doanh thu theo lĩnh vực (nhóm báo cáo)', () => {
  it('cột lĩnh vực theo thứ tự danh mục; "Chưa phân nhóm" chỉ khi có dự án chưa gán hay gán nhóm lạ', () => {
    expect(reportGroupColumns(CATALOG, [{ reportGroupId: 'g-dv' }]).map((column) => column.label)).toEqual([
      'Dịch vụ',
      'Thí nghiệm',
      'Bán hàng',
      'O&M',
    ]);
    expect(reportGroupColumns(CATALOG, [{ reportGroupId: null }]).at(-1)).toEqual({
      id: null,
      label: UNASSIGNED_REPORT_GROUP_LABEL,
    });
    expect(reportGroupColumns(CATALOG, [{ reportGroupId: 'g-da-xoa' }])).toHaveLength(5);
    expect(reportGroupColumns(CATALOG, [{}])).toHaveLength(5);
    // Danh mục trống vẫn có một cột để khối "Doanh thu theo lĩnh vực" không rỗng.
    expect(reportGroupColumns([], [])).toEqual([{ id: null, label: UNASSIGNED_REPORT_GROUP_LABEL }]);
  });

  it('năm theo ngày bắt đầu, chưa có thì theo ngày tạo', () => {
    expect(projectReportYear({ startDate: '2026-01-15', createdAt: '2025-12-01T00:00:00Z' })).toBe(2026);
    expect(projectReportYear({ startDate: undefined, createdAt: '2025-12-01T00:00:00Z' })).toBe(2025);
    expect(projectReportYear({ startDate: '', createdAt: '' })).toBeUndefined();
  });

  it('giá trị hợp đồng lấy từ danh sách, thiếu thì từ khối tài chính; không có thì vắng', () => {
    expect(reportContractValue(project({ id: 'a', code: 'A', contractValue: 100 }))).toBe(100);
    expect(
      reportContractValue(
        project({ id: 'a', code: 'A', finance: { contractValue: 250 } as ProjectSummary['finance'] }),
      ),
    ).toBe(250);
    expect(reportContractValue(project({ id: 'a', code: 'A', contractValue: null }))).toBeUndefined();
    expect(reportContractValue(project({ id: 'a', code: 'A' }))).toBeUndefined();
  });

  it('chữ cái cột Excel', () => {
    expect([0, 6, 25, 26, 27, 51, 52].map(columnLetter)).toEqual(['A', 'G', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });

  const projects = [
    project({ id: 'p1', code: '26/10', reportGroupId: 'g-ban', contractValue: 1_000 }),
    project({ id: 'p2', code: '26/2', reportGroupId: 'g-dv', contractValue: 200, startDate: '2026-02-01' }),
    project({ id: 'p3', code: '26/9', reportGroupId: null, contractValue: 30 }),
    project({ id: 'p4', code: '26/1', reportGroupId: 'g-dv', contractValue: undefined }),
    project({ id: 'p5', code: '26/3', reportGroupId: 'g-khong-con', contractValue: 5 }),
    project({ id: 'p6', code: '26/5', reportGroupId: 'g-tn', contractValue: 40, customerId: 'k-2' }),
  ];
  const sheet = buildProjectReportSheet(projects, CATALOG, lookups, NOW);
  const data = sheet.rows.slice(FIRST_DATA_ROW);
  // Dịch vụ, Thí nghiệm, Bán hàng, O&M, Chưa phân nhóm → I..M; Năm N; Nhóm dự án O.
  const groupCol = (label: string) => FIRST_GROUP_COLUMN + sheet.groupColumns.findIndex((column) => column.label === label);

  it('xếp theo thứ tự nhóm báo cáo rồi theo mã dự án (so số), STT 1..n', () => {
    expect(data.map((row) => row[3]?.value)).toEqual(['26/1', '26/2', '26/5', '26/10', '26/3', '26/9']);
    expect(data.map((row) => row[0]?.value)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sheet.projectCount).toBe(6);
  });

  it('giá trị hợp đồng ở cột tổng và đúng một cột lĩnh vực; nhóm lạ hay chưa gán vào "Chưa phân nhóm"', () => {
    const byCode = new Map(data.map((row) => [row[3]?.value, row]));
    const groupValues = (code: string) =>
      sheet.groupColumns.map((_, i) => byCode.get(code)?.[FIRST_GROUP_COLUMN + i]?.value ?? null);
    expect(byCode.get('26/2')?.[CONTRACT_COLUMN]?.value).toBe(200);
    expect(groupValues('26/2')).toEqual([200, null, null, null, null]);
    expect(groupValues('26/10')).toEqual([null, null, 1_000, null, null]);
    expect(groupValues('26/3')).toEqual([null, null, null, null, 5]);
    expect(groupValues('26/9')).toEqual([null, null, null, null, 30]);
    // Dự án không có giá trị: các ô số để trống.
    expect(byCode.get('26/1')?.[CONTRACT_COLUMN]?.value).toBeNull();
    expect(groupValues('26/1')).toEqual([null, null, null, null, null]);
  });

  it('các ô chữ của một dòng', () => {
    const row = data.find((entry) => entry[3]?.value === '26/5');
    expect(row?.map((cell) => cell.value)).toEqual([
      3,
      'Điện lực Gia Lai',
      'Dự án 26/5',
      '26/5',
      '',
      'Đang chạy',
      40,
      'Phòng Thí nghiệm',
      null,
      40,
      null,
      null,
      null,
      2025,
      '',
    ]);
    expect(data.find((entry) => entry[3]?.value === '26/2')?.[groupCol('Chưa phân nhóm') + 1]?.value).toBe(2026);
  });

  it('dòng tổng: SUBTOTAL(9, …) trên đúng vùng dữ liệu, kèm giá trị đã tính', () => {
    const totals = sheet.rows[TOTAL_ROW] ?? [];
    expect(totals[0]).toEqual({ kind: 'totalLabel', value: 'Tổng cộng' });
    expect(totals[CONTRACT_COLUMN]).toEqual({ kind: 'total', value: 1_275, formula: 'SUBTOTAL(9,G5:G10)' });
    expect(totals[groupCol('Dịch vụ')]).toEqual({ kind: 'total', value: 200, formula: 'SUBTOTAL(9,I5:I10)' });
    expect(totals[groupCol('O&M')]).toEqual({ kind: 'total', value: 0, formula: 'SUBTOTAL(9,L5:L10)' });
    expect(totals[groupCol('Chưa phân nhóm')]).toEqual({ kind: 'total', value: 35, formula: 'SUBTOTAL(9,M5:M10)' });
    // Phòng ban, Năm, Nhóm dự án không cộng.
    expect(totals[CONTRACT_COLUMN + 1]?.formula).toBeUndefined();
    expect(totals.at(-1)?.formula).toBeUndefined();
    expect(sheet.hasContractValues).toBe(true);
  });

  it('tiêu đề hai tầng, ngày xuất và các vùng gộp ô', () => {
    const [title, upper, lower] = sheet.rows;
    const width = 8 + 5 + 2;
    expect(sheet.rows.every((row) => row.length === width)).toBe(true);
    expect(sheet.columnWidths).toHaveLength(width);
    expect(title?.[0]?.value).toBe('BẢNG: CHI TIẾT DOANH THU DỰ ÁN');
    expect(title?.[width - 2]?.value).toBe('Ngày xuất 27/11/2026');
    expect(upper?.map((cell) => cell.value)).toEqual([
      'STT',
      'Tên khách hàng',
      'Tên dự án',
      'Mã dự án',
      'Ghi chú',
      'Tình trạng',
      'Giá trị hợp đồng (trước VAT)',
      'Phòng ban',
      'Doanh thu theo lĩnh vực',
      null,
      null,
      null,
      null,
      'Năm',
      'Nhóm dự án',
    ]);
    expect(lower?.slice(FIRST_GROUP_COLUMN, FIRST_GROUP_COLUMN + 5).map((cell) => cell.value)).toEqual([
      'Dịch vụ',
      'Thí nghiệm',
      'Bán hàng',
      'O&M',
      'Chưa phân nhóm',
    ]);
    expect(sheet.merges).toEqual(
      expect.arrayContaining([
        { s: { r: 0, c: 0 }, e: { r: 0, c: width - 3 } },
        { s: { r: 0, c: width - 2 }, e: { r: 0, c: width - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },
        { s: { r: 1, c: CONTRACT_COLUMN }, e: { r: 2, c: CONTRACT_COLUMN } },
        { s: { r: 1, c: 8 }, e: { r: 1, c: 12 } },
        { s: { r: 1, c: 13 }, e: { r: 2, c: 13 } },
        { s: { r: 1, c: 14 }, e: { r: 2, c: 14 } },
        { s: { r: TOTAL_ROW, c: 0 }, e: { r: TOTAL_ROW, c: CONTRACT_COLUMN - 1 } },
      ]),
    );
    // Cột lĩnh vực không gộp dọc (tầng dưới là tên nhóm).
    expect(sheet.merges.some((range) => range.s.c === 9 && range.s.r === 1)).toBe(false);
  });

  it('không có giá trị hợp đồng (không được xem tài chính): vẫn xuất, ô số trống, tổng bằng 0', () => {
    const hidden = buildProjectReportSheet(
      [project({ id: 'p1', code: 'A', reportGroupId: 'g-dv' })],
      CATALOG,
      lookups,
      NOW,
    );
    expect(hidden.hasContractValues).toBe(false);
    expect(hidden.groupColumns).toHaveLength(4);
    expect(hidden.rows[FIRST_DATA_ROW]?.[CONTRACT_COLUMN]?.value).toBeNull();
    expect(hidden.rows[TOTAL_ROW]?.[CONTRACT_COLUMN]).toEqual({ kind: 'total', value: 0, formula: 'SUBTOTAL(9,G5:G5)' });
  });

  it('không có dự án nào: dòng tổng ghi số 0, không viết công thức trên vùng rỗng', () => {
    const empty = buildProjectReportSheet([], CATALOG, lookups, NOW);
    expect(empty.rows).toHaveLength(FIRST_DATA_ROW);
    expect(empty.rows[TOTAL_ROW]?.[CONTRACT_COLUMN]).toEqual({ kind: 'total', value: 0 });
  });

  it('tên tệp', () => {
    expect(projectReportFileName(NOW)).toBe('Bao-cao-doanh-thu-theo-linh-vuc-ngay-27112026.xlsx');
  });
});
