import { directApproverIndex, withDirectApprover } from './direct-approver-view';

describe('direct-approver-view', () => {
  const index = directApproverIndex([
    { requestKind: 'leave', requestId: 'r1', assigneeName: 'Trần Quang Bình' },
    { requestKind: 'ot', requestId: 'r2', assigneeName: '' },
  ]);

  it('chỉ giữ mục có tên', () => {
    expect([...index.keys()]).toEqual(['r1']);
    expect(directApproverIndex(undefined).size).toBe(0);
  });

  it('gắn tên người duyệt vào đơn đang chờ chưa có người xử lý', () => {
    expect(withDirectApprover({ id: 'r1' }, true, index)).toEqual({ id: 'r1', currentAssigneeName: 'Trần Quang Bình' });
  });

  it('không ghi đè người xử lý của quy trình, không gắn cho đơn đã xử lý', () => {
    const raw = { id: 'r1', currentAssigneeName: 'Người của quy trình' };
    expect(withDirectApprover(raw, true, index)).toBe(raw);
    const done = { id: 'r1' };
    expect(withDirectApprover(done, false, index)).toBe(done);
  });

  it('đơn không có trong danh sách giữ nguyên', () => {
    const raw = { id: 'zzz' };
    expect(withDirectApprover(raw, true, index)).toBe(raw);
  });
});
