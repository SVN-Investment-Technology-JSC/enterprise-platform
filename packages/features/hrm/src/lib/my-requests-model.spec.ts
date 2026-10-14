import {
  detailStatusMeta,
  inMonth,
  matchesStatusFilter,
  monthStats,
  pickSelectedId,
  previousMonthLabel,
  requestMonthOf,
  rowStatusMeta,
  type MyRequestRow,
} from './my-requests-model';

const row = (over: Partial<MyRequestRow> = {}): MyRequestRow => ({
  id: 'r1',
  code: 'NP-1',
  kind: 'leave',
  typeName: 'Đơn nghỉ',
  createdAt: '10/10/2026',
  rawCreatedAt: '2026-10-10T03:00:00.000Z',
  effectiveDate: '13/10/2026',
  duration: '1 ngày',
  reason: 'Việc gia đình',
  description: '—',
  approver: 'Quản lý',
  workflowStatus: 'PENDING_APPROVAL',
  requestStatus: 'PENDING',
  statusText: 'Chờ phê duyệt',
  ...over,
});

describe('my-requests-model', () => {
  it('tháng của đơn tính theo giờ Việt Nam (đơn lúc 20:00 UTC ngày cuối tháng đã sang tháng sau)', () => {
    expect(
      requestMonthOf(row({ rawCreatedAt: '2026-09-30T20:00:00.000Z' })),
    ).toBe('2026-10');
    expect(
      requestMonthOf(row({ rawCreatedAt: '2026-09-30T16:59:00.000Z' })),
    ).toBe('2026-09');
    expect(requestMonthOf(row({ rawCreatedAt: undefined }))).toBe('');
    expect(inMonth(row(), null)).toBe(true);
    expect(inMonth(row(), '2026-09')).toBe(false);
  });

  it('nhóm trạng thái: chờ duyệt, đã duyệt (gồm đã áp dụng), từ chối; đơn đã rút chỉ ở bộ lọc riêng', () => {
    const pending = row();
    const peer = row({ workflowStatus: 'PENDING_PEER' });
    const applied = row({
      workflowStatus: 'APPROVED',
      requestStatus: 'APPLIED',
    });
    const rejected = row({
      workflowStatus: 'REJECTED',
      requestStatus: 'REJECTED',
    });
    const cancelled = row({ requestStatus: 'CANCELLED' });
    expect(matchesStatusFilter(pending, 'PENDING')).toBe(true);
    expect(matchesStatusFilter(peer, 'PENDING')).toBe(true);
    expect(matchesStatusFilter(applied, 'APPROVED')).toBe(true);
    expect(matchesStatusFilter(rejected, 'REJECTED')).toBe(true);
    expect(matchesStatusFilter(cancelled, 'PENDING')).toBe(false);
    expect(matchesStatusFilter(cancelled, 'CANCELLED')).toBe(true);
    expect(matchesStatusFilter(cancelled, 'ALL')).toBe(true);
  });

  it('thẻ tổng quan đếm theo tháng và so với tháng trước', () => {
    const rows = [
      row({ id: 'a', rawCreatedAt: '2026-10-05T03:00:00.000Z' }),
      row({
        id: 'b',
        rawCreatedAt: '2026-10-06T03:00:00.000Z',
        workflowStatus: 'APPROVED',
        requestStatus: 'APPLIED',
      }),
      row({
        id: 'c',
        rawCreatedAt: '2026-10-07T03:00:00.000Z',
        requestStatus: 'CANCELLED',
      }),
      row({
        id: 'd',
        rawCreatedAt: '2026-09-07T03:00:00.000Z',
        workflowStatus: 'REJECTED',
        requestStatus: 'REJECTED',
      }),
    ];
    expect(monthStats(rows, '2026-10')).toEqual({
      total: 3,
      pending: 1,
      approved: 1,
      rejected: 0,
    });
    expect(previousMonthLabel('2026-10')).toBe('tháng 9');
    expect(previousMonthLabel('2026-01')).toBe('tháng 12');
  });

  it('nhãn trạng thái: danh sách theo đơn, chi tiết ưu tiên kết quả quy trình', () => {
    expect(rowStatusMeta(row()).label).toBe('Chờ duyệt');
    expect(rowStatusMeta(row({ workflowStatus: 'PENDING_PEER' })).label).toBe(
      'Chờ đồng nghiệp',
    );
    expect(rowStatusMeta(row({ requestStatus: 'CANCELLED' })).label).toBe(
      'Đã rút / hủy',
    );
    expect(detailStatusMeta(row(), 'completed')).toEqual({
      label: 'Đã duyệt',
      tone: 'emerald',
    });
    expect(detailStatusMeta(row(), 'rejected').tone).toBe('rose');
    expect(detailStatusMeta(row({ statusText: 'Chờ HR' })).label).toBe(
      'Chờ HR',
    );
  });

  it('giữ đơn đang chọn nếu còn trong danh sách, không thì chọn đơn đầu', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    expect(pickSelectedId(list, 'b')).toBe('b');
    expect(pickSelectedId(list, 'x')).toBe('a');
    expect(pickSelectedId(list, null)).toBe('a');
    expect(pickSelectedId([], 'a')).toBeNull();
  });
});
