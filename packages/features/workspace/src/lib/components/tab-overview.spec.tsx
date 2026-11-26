import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectSummary, WorkItem } from '@enterprise-platform/contracts-workspace';
import { TabOverview } from './tab-overview';

// Các khối phụ của tab (danh bạ, vai trò, phương tiện, lịch sử tiến độ) chỉ cần API trả rỗng.
jest.mock('../workspace-api', () => ({
  loadDirectory: jest.fn().mockResolvedValue({ people: [], degraded: false }),
  listProjectRoles: jest.fn().mockResolvedValue({ items: [], canEdit: false }),
  getSourceTransport: jest.fn().mockResolvedValue({ data: null }),
  listWorkItemProgressReports: jest.fn().mockResolvedValue({ items: [] }),
}));

const PROJECT = { id: 'p1', code: 'DA-001', name: 'Dự án A' } as unknown as ProjectSummary;
const ITEM = {
  id: 'w1',
  code: 'CV-001',
  title: 'Khảo sát',
  projectId: 'p1',
  status: 'todo',
  priority: 'normal',
  itemType: 'task',
  progressMethod: 'manual',
  progressPercent: 0,
  depth: 0,
  updatedAt: '2026-11-20T03:00:00.000Z',
} as unknown as WorkItem;

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => cleanup());

const renderOverview = (props: Partial<Parameters<typeof TabOverview>[0]> = {}) => {
  const chat = jest.fn(() => <p>Khung trao đổi</p>);
  render(
    <TabOverview project={PROJECT} items={[ITEM]} members={[]} selected={ITEM} renderChat={chat} {...props} />,
  );
  return chat;
};

describe('TabOverview: tab Trao đổi', () => {
  it('đứng ngay sau Chi tiết, có số tin chưa đọc, chỉ dựng khung trao đổi khi mở tab', () => {
    renderOverview({ chatUnread: 3 });
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs[0]).toBe('Chi tiết');
    expect(tabs[1]).toBe('Trao đổi 3');
    // Chưa mở tab thì khung trao đổi chưa có trên trang (chưa tải luồng, chưa đánh dấu đã đọc).
    expect(screen.queryByText('Khung trao đổi')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Trao đổi/ }));
    expect(screen.getByText('Khung trao đổi')).toBeTruthy();
  });

  it('nơi gọi yêu cầu mở thẳng tab Trao đổi rồi được báo đã xong', async () => {
    const handled = jest.fn();
    renderOverview({ tabRequest: 'chat', onTabRequestHandled: handled });
    await screen.findByText('Khung trao đổi');
    await waitFor(() => expect(handled).toHaveBeenCalled());
  });

  it('không có trao đổi (nơi gọi không truyền) thì không có tab đó', () => {
    renderOverview({ renderChat: undefined });
    expect(screen.queryByRole('tab', { name: /Trao đổi/ })).toBeNull();
  });
});
