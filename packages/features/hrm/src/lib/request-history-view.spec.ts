import {
  REQUEST_HISTORY_PAGE_SIZE,
  approverFallbackLabel,
  buildRequestHistoryCsv,
  paginate,
  type RequestHistoryRow,
} from './request-history-view';

const row = (over: Partial<RequestHistoryRow> = {}): RequestHistoryRow => ({
  code: 'LEAVE-AAAA1111',
  typeName: 'Đơn xin nghỉ phép',
  category: 'Nghỉ phép',
  createdAt: '01/10/2026',
  effectiveDate: '02/10/2026 - 03/10/2026',
  duration: '2 ngày',
  reason: 'Nghỉ việc riêng',
  description: 'Việc gia đình',
  approver: 'Nguyễn Văn A',
  workflowStatus: 'APPROVED',
  requestStatus: 'APPLIED',
  ...over,
});

describe('buildRequestHistoryCsv', () => {
  it('bắt đầu bằng BOM, có dòng tiêu đề tiếng Việt, tách cột Lý do và Mô tả, dùng CRLF', () => {
    const csv = buildRequestHistoryCsv([row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      '"Mã đơn","Loại yêu cầu","Nhóm","Ngày tạo","Thời gian hiệu lực","Thời lượng / Giá trị","Lý do","Mô tả","Người duyệt","Trạng thái quy trình","Kết quả hậu xử lý"',
    );
    expect(lines[1]).toBe(
      '"LEAVE-AAAA1111","Đơn xin nghỉ phép","Nghỉ phép","01/10/2026","02/10/2026 - 03/10/2026","2 ngày","Nghỉ việc riêng","Việc gia đình","Nguyễn Văn A","Đã duyệt","Đã cập nhật công"',
    );
  });

  it('escape dấu nháy kép, dấu phẩy, xuống dòng và vô hiệu hóa công thức', () => {
    const csv = buildRequestHistoryCsv([
      row({ description: 'Lý do "A", B\nC' }),
      row({ description: '=HYPERLINK("x")' }),
      row({ description: '+1', approver: '-2' }),
      row({ description: '@cmd' }),
    ]);
    const body = csv.slice(1);
    expect(body).toContain('"Lý do ""A"", B\nC"');
    expect(body).toContain('"\'=HYPERLINK(""x"")"');
    expect(body).toContain('"\'+1","\'-2"');
    expect(body).toContain('"\'@cmd"');
  });

  it('chỉ có dòng tiêu đề khi không có đơn', () => {
    expect(buildRequestHistoryCsv([]).slice(1).split('\r\n')).toHaveLength(1);
  });

  it('dùng nhãn người duyệt do màn hình cung cấp', () => {
    const csv = buildRequestHistoryCsv([row()], () => 'Đang chờ Trần B duyệt');
    expect(csv).toContain('"Đang chờ Trần B duyệt"');
  });
});

describe('paginate', () => {
  const rows = Array.from({ length: 45 }, (_, i) => i + 1);

  it('mặc định 20 dòng mỗi trang', () => {
    expect(REQUEST_HISTORY_PAGE_SIZE).toBe(20);
    const first = paginate(rows, 1);
    expect(first.items).toHaveLength(20);
    expect([first.from, first.to, first.total, first.pageCount]).toEqual([
      1, 20, 45, 3,
    ]);
    const last = paginate(rows, 3);
    expect(last.items).toEqual([41, 42, 43, 44, 45]);
    expect([last.from, last.to]).toEqual([41, 45]);
  });

  it('kẹp trang vượt biên và xử lý danh sách rỗng', () => {
    expect(paginate(rows, 99).page).toBe(3);
    expect(paginate(rows, 0).page).toBe(1);
    const empty = paginate([], 1);
    expect([empty.from, empty.to, empty.total, empty.pageCount]).toEqual([
      0, 0, 0, 1,
    ]);
  });
});

describe('approverFallbackLabel', () => {
  it('giữ tên, ẩn UUID và không dùng chức danh cố định', () => {
    expect(approverFallbackLabel('Lê C', false)).toBe('Lê C');
    expect(
      approverFallbackLabel('3f2b8a52-6c1d-4e35-9b0a-0d6f1a2b3c4d', false),
    ).toBe('Đã có người xử lý');
    expect(approverFallbackLabel(null, true)).toBe('Theo luồng phê duyệt');
    expect(approverFallbackLabel(null, false)).toBe('----');
  });
});
