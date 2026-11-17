import { isLeaveGroupFollower, leaveGroupSummary } from './leave-group-view';

const range = (id: string, fromDate: string, toDate: string, duration: number) => ({
  id,
  fromDate,
  toDate,
  fromAt: null,
  toAt: null,
  duration,
  status: 'PENDING' as const,
});

describe('đơn nghỉ nhiều khoản trên danh sách', () => {
  it('khoản bổ sung là dòng có groupId khác id của chính nó', () => {
    expect(isLeaveGroupFollower({ id: 'a', groupId: 'b' })).toBe(true);
    expect(isLeaveGroupFollower({ id: 'a', groupId: 'a' })).toBe(false);
    expect(isLeaveGroupFollower({ id: 'a', groupId: null })).toBe(false);
    expect(isLeaveGroupFollower({ id: 'a' })).toBe(false);
  });

  it('tóm tắt khoản chính: số khoản, thời gian từng khoản, tổng số ngày; đơn một khoản không có tóm tắt', () => {
    const summary = leaveGroupSummary({
      groupRanges: [range('a', '2026-11-13', '2026-11-20', 6.5), range('b', '2026-11-21', '2026-11-27', 5.5)],
    });
    expect(summary?.count).toBe(2);
    expect(summary?.totalDays).toBe(12);
    expect(summary?.periods).toEqual(['13/11/2026 - 20/11/2026', '21/11/2026 - 27/11/2026']);
    expect(leaveGroupSummary({ groupRanges: [range('a', '2026-11-13', '2026-11-13', 1)] })).toBeNull();
    expect(leaveGroupSummary({})).toBeNull();
  });
});
