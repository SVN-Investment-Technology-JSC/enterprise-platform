import {
  RETURN_MARK_TTL_MS,
  clearReturnedProject,
  markProjectOpened,
  peekReturnedProject,
  readProjectListMemory,
  resetProjectListMemoryForTests,
  writeProjectListMemory,
} from '@enterprise-platform/feature-workspace';

beforeEach(() => resetProjectListMemoryForTests());

describe('project-list-memory', () => {
  it('mặc định: tab Đang làm, không nhóm nào mở, không bộ lọc', () => {
    expect(readProjectListMemory()).toMatchObject({ scope: 'active', expanded: [], statusFilter: '', sortKey: 'name' });
  });

  it('giữ nhóm đang mở, tab và bộ lọc qua lần đọc lại (kể cả sau khi bộ nhớ mô-đun bị xoá, nhờ sessionStorage)', () => {
    writeProjectListMemory({
      ...readProjectListMemory(),
      scope: 'archived',
      expanded: ['Cá basa', 'Chưa phân loại'],
      statusFilter: 'active',
      sortKey: 'updated',
    });
    // Mô phỏng F5: bộ nhớ mô-đun mất, chỉ còn sessionStorage.
    const saved = window.sessionStorage.getItem('workspace.projects-list.v1');
    resetProjectListMemoryForTests();
    window.sessionStorage.setItem('workspace.projects-list.v1', saved as string);
    expect(readProjectListMemory()).toMatchObject({
      scope: 'archived',
      expanded: ['Cá basa', 'Chưa phân loại'],
      statusFilter: 'active',
      sortKey: 'updated',
    });
  });

  it('dữ liệu hỏng hay thiếu trường thì về mặc định, không ném lỗi', () => {
    window.sessionStorage.setItem('workspace.projects-list.v1', '{"list":{"scope":"x","expanded":[1,"A"]}}');
    expect(readProjectListMemory()).toMatchObject({ scope: 'active', expanded: ['A'], sortKey: 'name' });
    resetProjectListMemoryForTests();
    window.sessionStorage.setItem('workspace.projects-list.v1', 'không phải JSON');
    expect(readProjectListMemory().scope).toBe('active');
  });

  it('dấu "vừa xem": nhớ dự án vừa mở, hết hạn sau một lúc, xoá được', () => {
    expect(peekReturnedProject()).toBeUndefined();
    markProjectOpened('p1');
    expect(peekReturnedProject()).toBe('p1');
    // Đọc không làm mất dấu (an toàn khi React gọi hàm khởi tạo hai lần).
    expect(peekReturnedProject()).toBe('p1');
    expect(peekReturnedProject(Date.now() + RETURN_MARK_TTL_MS + 1000)).toBeUndefined();
    clearReturnedProject();
    expect(peekReturnedProject()).toBeUndefined();
  });
});
