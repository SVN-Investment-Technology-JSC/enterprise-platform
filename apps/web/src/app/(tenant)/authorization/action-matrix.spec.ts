import { buildActionMatrix, classifyAction } from './action-matrix';

const item = (key: string) => ({ key, label: key });

describe('action matrix', () => {
  it('đọc đối tượng và mức quyền từ khóa thao tác', () => {
    expect(classifyAction('hrm.leave.approve.all')).toEqual({ object: 'leave', level: 'approveAll' });
    expect(classifyAction('hrm.ot.approve')).toEqual({ object: 'ot', level: 'approve' });
    expect(classifyAction('hrm.leave.read')).toEqual({ object: 'leave', level: 'read' });
    expect(classifyAction('hrm.read')).toEqual({ object: '', level: 'read' });
    expect(classifyAction('hrm.manage')).toEqual({ object: '', level: 'manage' });
    expect(classifyAction('hrm.timesheet.lock')).toEqual({ object: 'timesheet', level: 'other' });
    expect(classifyAction('hrm.self.profile.write')).toEqual({ object: 'self', level: 'other' });
    expect(classifyAction('inventory.transaction.write')).toEqual({ object: 'transaction', level: 'other' });
  });

  it('gom cùng đối tượng vào một hàng và chỉ giữ cột có dữ liệu', () => {
    const m = buildActionMatrix(
      ['hrm.leave.read', 'hrm.leave.approve', 'hrm.leave.approve.all', 'hrm.ot.approve', 'hrm.ot.approve.all'].map(item),
    );
    expect(m.rows.map((r) => r.title)).toEqual(['Nghỉ phép', 'Tăng ca']);
    expect(m.columns.map((c) => c.level)).toEqual(['read', 'approve', 'approveAll']);
    expect(m.rows[1].cells.read).toEqual([]);
    expect(m.rows[0].cells.approveAll.map((i) => i.key)).toEqual(['hrm.leave.approve.all']);
  });

  it('thao tác lệch mẫu vào cột Khác và đối tượng chưa có tên hiện đúng khóa; không mất thao tác nào', () => {
    const keys = ['hrm.contract.read', 'hrm.contract.renew', 'hrm.advance.disburse'];
    const m = buildActionMatrix(keys.map(item));
    expect(m.rows.map((r) => r.title)).toEqual(['contract', 'Tạm ứng']);
    expect(m.columns.map((c) => c.level)).toEqual(['read', 'other']);
    const all = m.rows.flatMap((r) => Object.values(r.cells).flat()).map((i) => i.key);
    expect(all.sort()).toEqual([...keys].sort());
  });
});
