import { BadRequestException } from '@nestjs/common';
import { REPORT_COLUMNS, loadReport, parseReportFilters, statusLabel } from './hrm-reports.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('parseReportFilters', () => {
  it('đọc khoảng ngày và các danh sách lọc', () => {
    const f = parseReportFilters({
      from: '2026-10-01',
      to: '2026-10-31',
      departmentIds: ID,
      employeeIds: `${ID}, 22222222-2222-4222-8222-222222222222`,
      statuses: 'approved,pending',
      requestKinds: 'leave,ot',
    });
    expect(f.departmentIds).toEqual([ID]);
    expect(f.employeeIds).toHaveLength(2);
    expect(f.statuses).toEqual(['APPROVED', 'PENDING']);
    expect(f.requestKinds).toEqual(['leave', 'ot']);
  });

  it('từ chối ngày sai, khoảng ngược, khoảng quá dài và giá trị lạ', () => {
    expect(() => parseReportFilters({ from: '2026-10-01' })).toThrow(BadRequestException);
    expect(() => parseReportFilters({ from: '2026-10-31', to: '2026-10-01' })).toThrow(/sau hoặc bằng/);
    expect(() => parseReportFilters({ from: '2024-01-01', to: '2026-10-01' })).toThrow(/tối đa/);
    expect(() => parseReportFilters({ from: '2026-10-01', to: '2026-10-31', employeeIds: "x'; DROP TABLE a;--" })).toThrow(/Nhân viên/);
    expect(() => parseReportFilters({ from: '2026-10-01', to: '2026-10-31', statuses: 'A;B' })).toThrow(/Trạng thái/);
    expect(() => parseReportFilters({ from: '2026-10-01', to: '2026-10-31', requestKinds: 'payroll' })).toThrow(/Loại đơn/);
  });
});

describe('cột báo cáo', () => {
  it('mỗi báo cáo có cột họ tên chọn sẵn và khóa cột không trùng', () => {
    for (const [kind, columns] of Object.entries(REPORT_COLUMNS)) {
      const keys = columns.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(columns.find((c) => c.key === 'employeeName')?.defaultOn).toBe(true);
      expect(columns.some((c) => c.defaultOn)).toBe(true);
      expect(kind).toBeTruthy();
    }
  });

  it('đổi trạng thái sang nhãn tiếng Việt, giữ nguyên trạng thái lạ', () => {
    expect(statusLabel('APPROVED')).toBe('Đã duyệt');
    expect(statusLabel('PENDING')).toBe('Chờ duyệt');
    expect(statusLabel('KHAC')).toBe('KHAC');
  });
});

describe('loadReport: tham số hóa', () => {
  it('đưa mọi giá trị lọc qua tham số, không ghép vào câu SQL', async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const db = { query: jest.fn(async (sql: string, values: unknown[]) => (calls.push({ sql, values }), { rows: [] })) };
    const filters = parseReportFilters({ from: '2026-10-01', to: '2026-10-31', employeeIds: ID, statuses: 'APPROVED', departmentIds: ID });
    for (const kind of ['requests', 'leave-usage', 'leave', 'overtime', 'business-trips'] as const) {
      const result = await loadReport(db as never, 'tenant-1', kind, filters);
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.columns).toBe(REPORT_COLUMNS[kind]);
    }
    for (const call of calls) {
      expect(call.sql).not.toContain(ID);
      expect(call.sql).not.toContain('2026-10-01');
      expect(call.values[0]).toBe('tenant-1');
    }
  });
});
