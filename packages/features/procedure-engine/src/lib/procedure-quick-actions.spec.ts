import { procedureNeedsMyAction, procedureQuickActions } from './procedure-quick-actions';

describe('procedureQuickActions - thao tác bấm nhanh ngoài dòng danh sách', () => {
  it('bước C và A chỉ duyệt, không có từ chối nhanh vì từ chối cần ý kiến', () => {
    expect(
      procedureQuickActions({ currentRoleStage: 'C', myRoles: ['C'], availableActions: ['comment', 'approve', 'return'] }),
    ).toEqual(['approve']);
    expect(
      procedureQuickActions({
        currentRoleStage: 'A',
        myRoles: ['A'],
        availableActions: ['comment', 'approve', 'reject', 'return'],
      }),
    ).toEqual(['approve']);
  });

  it('bước R và E chỉ hoàn thành', () => {
    expect(procedureQuickActions({ currentRoleStage: 'R', myRoles: ['R'], availableActions: ['comment', 'complete'] })).toEqual([
      'complete',
    ]);
    expect(procedureQuickActions({ currentRoleStage: 'E', myRoles: ['E'], availableActions: ['comment', 'complete'] })).toEqual([
      'complete',
    ]);
  });

  it('không có thao tác nhanh khi bước còn thuộc tính phải nhập: phải mở drawer để điền trước', () => {
    expect(
      procedureQuickActions({
        currentRoleStage: 'A',
        myRoles: ['A'],
        availableActions: ['approve', 'reject'],
        editableAttributeKeys: ['amount'],
      }),
    ).toEqual([]);
  });

  it('chỉ trả thao tác server đã cho phép, không tự suy ra từ pha', () => {
    // Bước Tài chính chờ ghi sổ bị bỏ complete/approve: chỉ còn mở drawer.
    expect(procedureQuickActions({ currentRoleStage: 'R', myRoles: ['R'], availableActions: ['comment', 'return'] })).toEqual([]);
    expect(procedureQuickActions({ currentRoleStage: 'A', myRoles: ['A'], availableActions: [] })).toEqual([]);
  });

  it('quản trị override không giữ vai của pha hiện tại thì không có thao tác nhanh trên hồ sơ của người khác', () => {
    expect(
      procedureQuickActions({
        currentRoleStage: 'A',
        myRoles: [],
        availableActions: ['comment', 'cancel', 'reject', 'return'],
      }),
    ).toEqual([]);
    expect(
      procedureQuickActions({ currentRoleStage: 'R', myRoles: [], availableActions: ['comment', 'cancel', 'complete'] }),
    ).toEqual([]);
    expect(
      procedureQuickActions({ currentRoleStage: 'A', myRoles: ['C'], availableActions: ['comment', 'approve'] }),
    ).toEqual([]);
  });

  it('bước S (nộp lại), pha I hoặc không xác định thì không có thao tác nhanh', () => {
    for (const stage of ['S', 'I', null, undefined]) {
      expect(
        procedureQuickActions({
          currentRoleStage: stage,
          myRoles: ['S', 'I'],
          availableActions: ['comment', 'complete', 'approve', 'reject'],
        }),
      ).toEqual([]);
    }
  });
});

describe('procedureNeedsMyAction - hồ sơ tới lượt người này', () => {
  it('người giữ vai của pha hiện tại và có thao tác ngoài trao đổi', () => {
    expect(procedureNeedsMyAction({ currentRoleStage: 'A', myRoles: ['A'], availableActions: ['comment', 'approve'] })).toBe(true);
    // Bước S của chính người lập cũng là việc của họ (nộp lại).
    expect(procedureNeedsMyAction({ currentRoleStage: 'S', myRoles: ['S'], availableActions: ['comment', 'complete'] })).toBe(true);
  });

  it('quản trị override không giữ vai của pha thì chưa tới lượt, dù server cho thao tác mọi hồ sơ', () => {
    expect(
      procedureNeedsMyAction({
        currentRoleStage: 'A',
        myRoles: [],
        availableActions: ['comment', 'cancel', 'reject', 'return', 'approve'],
      }),
    ).toBe(false);
  });

  it('chỉ còn trao đổi, hoặc không có pha, thì không phải việc cần xử lý', () => {
    expect(procedureNeedsMyAction({ currentRoleStage: 'A', myRoles: ['A'], availableActions: ['comment'] })).toBe(false);
    expect(procedureNeedsMyAction({ currentRoleStage: null, myRoles: ['A'], availableActions: ['approve'] })).toBe(false);
    expect(procedureNeedsMyAction({})).toBe(false);
  });
});
