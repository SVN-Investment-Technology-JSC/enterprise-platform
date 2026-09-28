import { MAX_EXPORT_ROWS, type OverdueRow, type ReportBundle } from '@enterprise-platform/contracts-workspace';
import {
  ExportTooLargeError,
  buildCsv,
  buildExportHeader,
  buildExportSheets,
  countExportRows,
  escapeCsvCell,
  exportFileName,
} from './report-export';

function bundle(overrides: Partial<ReportBundle> = {}): ReportBundle {
  return {
    scope: { level: 'managed', projectCount: 2, canSeeFinance: true },
    mine: { openItems: 3, overdueItems: 1, completedInPeriod: 5 },
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

describe('buildExportSheets', () => {
  it('dựng đúng ba bảng theo thứ tự', () => {
    expect(buildExportSheets(bundle()).map((sheet) => sheet.title)).toEqual([
      'Tiến độ dự án',
      'Tải công việc',
      'Công việc quá hạn',
    ]);
  });

  it('số cột của dòng khớp số cột tiêu đề', () => {
    for (const sheet of buildExportSheets(bundle())) {
      for (const row of sheet.rows) {
        expect(row).toHaveLength(sheet.headers.length);
      }
    }
  });

  it('người phụ trách rỗng thành ô trống, không phải chữ undefined', () => {
    const sheets = buildExportSheets(bundle({ overdue: [overdueRow(1)] }));
    const row = sheets[2]?.rows[0];
    expect(row?.[3]).toBe('');
  });
});

describe('buildExportHeader', () => {
  it('ghi kèm phạm vi, kỳ báo cáo và thời điểm xuất', () => {
    const header = buildExportHeader(bundle());
    expect(header[0]).toContain('xuất lúc');
    expect(header[1]).toContain('Các dự án tôi phụ trách');
    expect(header[1]).toContain('2 dự án');
    expect(header[2]).toContain('Asia/Ho_Chi_Minh');
  });

  it('nhãn phạm vi đổi theo vai trò', () => {
    const asSelf = bundle({ scope: { level: 'self', projectCount: 1, canSeeFinance: false } });
    expect(buildExportHeader(asSelf)[1]).toContain('Số liệu của riêng tôi');

    const asAdmin = bundle({ scope: { level: 'tenant', projectCount: 9, canSeeFinance: true } });
    expect(buildExportHeader(asAdmin)[1]).toContain('Toàn bộ tenant');
  });
});

describe('escapeCsvCell', () => {
  it('bọc ngoặc kép và nhân đôi dấu nháy bên trong', () => {
    expect(escapeCsvCell('Dự án "A"')).toBe('"Dự án ""A"""');
  });

  it('chặn chèn công thức bằng cách thêm dấu nháy đơn ở đầu', () => {
    // Không có bước này, Excel sẽ chạy ô đó như một công thức.
    expect(escapeCsvCell('=1+1')).toBe(`"'=1+1"`);
    expect(escapeCsvCell('+84901234567')).toBe(`"'+84901234567"`);
    expect(escapeCsvCell('-5')).toBe(`"'-5"`);
    expect(escapeCsvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
  });

  it('chuỗi bình thường không bị thêm gì', () => {
    expect(escapeCsvCell('DA-1')).toBe('"DA-1"');
  });

  it('dấu phẩy và xuống dòng nằm gọn trong ngoặc kép', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });
});

describe('buildCsv', () => {
  it('có đủ ba tiêu đề bảng và dòng dữ liệu', () => {
    const csv = buildCsv(bundle());
    expect(csv).toContain('"Tiến độ dự án"');
    expect(csv).toContain('"Tải công việc"');
    expect(csv).toContain('"DA-1"');
  });

  it('dùng CRLF để Excel xuống dòng đúng', () => {
    expect(buildCsv(bundle())).toContain('\r\n');
  });

  it('vượt trần số dòng thì chặn và nói rõ phải thu hẹp bộ lọc', () => {
    const rows = Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_entry, index) =>
      overdueRow(index),
    );
    expect(() => buildCsv(bundle({ overdue: rows }))).toThrow(ExportTooLargeError);
    try {
      buildCsv(bundle({ overdue: rows }));
    } catch (error) {
      expect((error as Error).message).toContain('thu hẹp');
    }
  });

  it('đúng bằng trần thì vẫn xuất được', () => {
    // Trần là giới hạn trên bao gồm, không phải loại trừ.
    const rows = Array.from({ length: MAX_EXPORT_ROWS - 2 }, (_entry, index) =>
      overdueRow(index),
    );
    expect(countExportRows(buildExportSheets(bundle({ overdue: rows })))).toBe(MAX_EXPORT_ROWS);
    expect(() => buildCsv(bundle({ overdue: rows }))).not.toThrow();
  });
});

describe('exportFileName', () => {
  it('kèm mốc thời gian nên nhiều lần xuất không đè nhau', () => {
    expect(exportFileName(bundle())).toBe('bao-cao-workspace-2026-09-24-03-00-00.csv');
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

  it('không có trường finance thì không có bảng, không có cảnh báo', () => {
    const sheets = buildExportSheets(bundle());
    expect(sheets.map((sheet) => sheet.title)).not.toContain('Tài chính tổng hợp (VND)');
    expect(buildExportHeader(bundle()).join(' ')).not.toContain('CẢNH BÁO');
  });

  it('có finance thì thêm bảng cuối và dòng cảnh báo ở đầu tệp', () => {
    const withFinance = bundle({ finance });
    const sheets = buildExportSheets(withFinance);
    const last = sheets[sheets.length - 1];
    expect(last?.title).toBe('Tài chính tổng hợp (VND)');
    expect(last?.rows[0]).toHaveLength(last?.headers.length ?? 0);
    expect(buildExportHeader(withFinance).join(' ')).toContain('CẢNH BÁO');
  });

  it('số âm thật giữ là số, không bị thêm nháy đơn', () => {
    const csv = buildCsv(bundle({ finance }));
    expect(csv).toContain('"-500000000"');
    expect(csv).not.toContain(`"'-500000000"`);
  });
});

describe('tên người trong bản xuất', () => {
  it('dùng tên từ danh bạ thay cho userId', () => {
    const sheets = buildExportSheets(
      bundle({ overdue: [{ ...overdueRow(1), assigneeUserId: 'u1' }] }),
      (userId) => (userId === 'u1' ? 'Nguyễn Văn A' : userId),
    );
    expect(sheets[1]?.rows[0]?.[0]).toBe('Nguyễn Văn A');
    expect(sheets[2]?.rows[0]?.[3]).toBe('Nguyễn Văn A');
  });
});
