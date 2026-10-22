import { type OverdueRow, type ReportBundle } from '@enterprise-platform/contracts-workspace';
import {
  REPORT_SECTIONS,
  buildExportHeader,
  buildExportSheets,
  countExportRows,
  exportFileName,
  signed,
  textBar,
} from './report-export';

function bundle(overrides: Partial<ReportBundle> = {}): ReportBundle {
  return {
    scope: { level: 'managed', projectCount: 2, canSeeFinance: true },
    mine: { openItems: 3, overdueItems: 1, completedInPeriod: 5 },
    kpis: {
      createdItems: 6,
      completedItems: 4,
      completedOnTime: 3,
      completedLate: 1,
      openItems: 10,
      overdueItems: 2,
      completedHours: 12,
    },
    previous: {
      createdItems: 8,
      completedItems: 2,
      completedOnTime: 2,
      completedLate: 0,
      from: '2026-09-14T00:00:00.000Z',
      to: '2026-09-20T23:59:59.000Z',
    },
    trend: {
      granularity: 'day',
      buckets: [
        { start: '2026-09-21', created: 2, completed: 1, missedDeadline: 0 },
        { start: '2026-09-22', created: 4, completed: 3, missedDeadline: 1 },
      ],
    },
    statusBreakdown: [
      { key: 'todo', count: 6 },
      { key: 'done', count: 4 },
    ],
    priorityBreakdown: [{ key: 'high', count: 3 }],
    performance: [
      {
        userId: 'u1',
        completedItems: 4,
        completedOnTime: 3,
        completedLate: 1,
        averageDaysLate: 2,
        completedHours: 12,
        openItems: 6,
        overdueItems: 1,
      },
    ],
    byGroup: [
      {
        key: '',
        label: '',
        projectCount: 2,
        totalItems: 14,
        closedItems: 4,
        openItems: 10,
        overdueItems: 2,
        completedInPeriod: 4,
        progressPercent: 30,
      },
    ],
    byTag: [],
    projectProgress: [
      {
        projectId: 'p1',
        projectCode: 'DA-1',
        projectName: 'Dự án một',
        status: 'active',
        progressPercent: 40,
        totalItems: 10,
        closedItems: 4,
        overdueItems: 1,
        startDate: '2026-09-01',
        endDate: '2026-12-31',
      },
    ],
    workload: [
      { userId: 'u1', openItems: 6, overdueItems: 1, dueThisWeek: 2, estimatedHours: 24 },
    ],
    overdue: [],
    from: '2026-09-21T00:00:00.000Z',
    to: '2026-09-27T23:59:59.000Z',
    timezone: 'Asia/Ho_Chi_Minh',
    generatedAt: '2026-09-24T03:00:00.000Z',
    ...overrides,
  };
}

const overdueRow = (index: number): OverdueRow => ({
  workItemId: `w${index}`,
  code: `CV-${index}`,
  title: `Việc ${index}`,
  projectCode: 'DA-1',
  projectName: 'Dự án một',
  plannedEnd: '2026-09-01',
  daysLate: 23,
  status: 'todo',
});

const sheetNames = (sheets: ReturnType<typeof buildExportSheets>) => sheets.map((sheet) => sheet.name);

describe('buildExportSheets', () => {
  it('mặc định đủ các phần theo thứ tự trên trang, Tổng quan đứng đầu', () => {
    expect(sheetNames(buildExportSheets(bundle()))).toEqual([
      'Tổng quan',
      'Xu hướng',
      'Hiệu suất theo người',
      'Theo nhóm dự án',
      'Theo nhãn',
      'Tiến độ dự án',
      'Tải công việc',
      'Công việc quá hạn',
    ]);
  });

  it('chỉ xuất những phần được chọn, vẫn giữ thứ tự trên trang', () => {
    const sheets = buildExportSheets(bundle(), undefined, ['overdue', 'dashboard']);
    expect(sheetNames(sheets)).toEqual(['Tổng quan', 'Công việc quá hạn']);
  });

  it('tên trang tính không quá 31 ký tự', () => {
    for (const section of REPORT_SECTIONS) {
      for (const sheet of buildExportSheets(bundle(), undefined, [section.id])) {
        expect(sheet.name.length).toBeLessThanOrEqual(31);
      }
    }
  });

  it('số cột của dòng khớp số cột tiêu đề ở mọi bảng', () => {
    for (const sheet of buildExportSheets(bundle({ overdue: [overdueRow(1)] }))) {
      for (const table of sheet.tables) {
        for (const row of table.rows) expect(row).toHaveLength(table.headers.length);
      }
    }
  });

  it('dashboard có chỉ số kỳ này, kỳ trước và chênh lệch; tỉ lệ đúng hạn tính sẵn', () => {
    const [dashboard] = buildExportSheets(bundle(), undefined, ['dashboard']);
    const kpis = dashboard?.tables[0];
    expect(kpis?.rows[0]).toEqual(['Việc tạo mới', 6, 8, '-2']);
    expect(kpis?.rows[1]).toEqual(['Việc hoàn thành', 4, 2, '+2']);
    expect(kpis?.rows.find((row) => row[0] === 'Tỉ lệ đúng hạn')).toEqual(['Tỉ lệ đúng hạn', '75%', '100%', '']);
    // Dòng giới thiệu ghi phạm vi, kỳ và bộ lọc.
    expect(dashboard?.intro?.join(' ')).toContain('Kỳ báo cáo');
  });

  it('trạng thái hiện tên tiếng Việt kèm thanh biểu đồ', () => {
    const [dashboard] = buildExportSheets(bundle(), undefined, ['dashboard']);
    const status = dashboard?.tables[1];
    expect(status?.rows[0]?.[0]).toBe('Chưa làm');
    expect(status?.rows[0]?.[3]).toBe('■'.repeat(20));
  });

  it('nhóm khoá rỗng hiện là "Chưa phân nhóm"', () => {
    const [groups] = buildExportSheets(bundle(), undefined, ['groups']);
    expect(groups?.tables[0]?.rows[0]?.[0]).toBe('Chưa phân nhóm');
  });

  it('người phụ trách rỗng thành ô trống, không phải chữ undefined', () => {
    const [overdue] = buildExportSheets(bundle({ overdue: [overdueRow(1)] }), undefined, ['overdue']);
    expect(overdue?.tables[0]?.rows[0]?.[3]).toBe('');
  });
});

describe('buildExportHeader', () => {
  it('ghi kèm phạm vi, kỳ báo cáo, bộ lọc và thời điểm xuất', () => {
    const header = buildExportHeader(bundle(), ['Nhóm Điện']);
    expect(header[0]).toContain('xuất lúc');
    expect(header[1]).toContain('Các dự án tôi phụ trách');
    expect(header[1]).toContain('2 dự án');
    expect(header[2]).toContain('Asia/Ho_Chi_Minh');
    expect(header[3]).toContain('So với kỳ trước');
    expect(header[4]).toBe('Bộ lọc: Nhóm Điện');
  });

  it('nhãn phạm vi đổi theo vai trò', () => {
    const asSelf = bundle({ scope: { level: 'self', projectCount: 1, canSeeFinance: false } });
    expect(buildExportHeader(asSelf)[1]).toContain('Số liệu của riêng tôi');

    const asAdmin = bundle({ scope: { level: 'tenant', projectCount: 9, canSeeFinance: true } });
    expect(buildExportHeader(asAdmin)[1]).toContain('Toàn bộ tenant');
  });
});

describe('countExportRows', () => {
  it('cộng dòng của mọi bảng trên mọi trang tính', () => {
    const sheets = buildExportSheets(bundle({ overdue: [overdueRow(1), overdueRow(2)] }), undefined, [
      'overdue',
      'workload',
    ]);
    expect(countExportRows(sheets)).toBe(3);
  });
});

describe('textBar và signed', () => {
  it('thanh dài theo tỉ lệ, giá trị dương nhỏ vẫn có ít nhất một ô', () => {
    expect(textBar(10, 10, 5)).toBe('■■■■■');
    expect(textBar(1, 100, 5)).toBe('■');
    expect(textBar(0, 10)).toBe('');
  });

  it('chênh lệch có dấu', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(-2)).toBe('-2');
    expect(signed(0)).toBe('0');
  });
});

describe('exportFileName', () => {
  it('kèm mốc thời gian nên nhiều lần xuất không đè nhau', () => {
    expect(exportFileName(bundle())).toBe('bao-cao-workspace-2026-09-24-03-00-00.xlsx');
  });
});

describe('xuất kèm tài chính', () => {
  const finance = {
    projectCount: 2,
    contractValue: 10_000_000_000,
    budget: 8_000_000_000,
    actualCost: 3_000_000_000,
    forecastCost: 10_500_000_000,
    profit: -500_000_000,
    profitMargin: -5,
  };

  it('không có trường finance thì không có trang tài chính, không có cảnh báo', () => {
    expect(sheetNames(buildExportSheets(bundle()))).not.toContain('Tài chính');
    expect(buildExportHeader(bundle()).join(' ')).not.toContain('CẢNH BÁO');
  });

  it('có finance thì thêm trang cuối và dòng cảnh báo ở đầu tệp', () => {
    const withFinance = bundle({ finance });
    const sheets = buildExportSheets(withFinance);
    const last = sheets[sheets.length - 1];
    expect(last?.name).toBe('Tài chính');
    expect(last?.tables[0]?.headers).toEqual(['Số dự án', 'Giá trị hợp đồng']);
    expect(buildExportHeader(withFinance).join(' ')).toContain('CẢNH BÁO');
  });

  it('bỏ chọn phần tài chính thì không xuất số tiền', () => {
    const sheets = buildExportSheets(bundle({ finance }), undefined, ['dashboard', 'progress']);
    expect(sheetNames(sheets)).not.toContain('Tài chính');
  });
});

describe('tên người trong bản xuất', () => {
  it('dùng tên từ danh bạ thay cho userId', () => {
    const nameOf = (userId: string) => (userId === 'u1' ? 'Nguyễn Văn A' : userId);
    const sheets = buildExportSheets(
      bundle({ overdue: [{ ...overdueRow(1), assigneeUserId: 'u1' }] }),
      nameOf,
      ['performance', 'workload', 'overdue'],
    );
    expect(sheets[0]?.tables[0]?.rows[0]?.[0]).toBe('Nguyễn Văn A');
    expect(sheets[1]?.tables[0]?.rows[0]?.[0]).toBe('Nguyễn Văn A');
    expect(sheets[2]?.tables[0]?.rows[0]?.[3]).toBe('Nguyễn Văn A');
  });
});
