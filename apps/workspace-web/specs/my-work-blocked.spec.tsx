import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MyWorkItemsPage, MyWorkOverview } from '@enterprise-platform/contracts-workspace';
import { MyWorkView } from '@enterprise-platform/feature-workspace';
import { resetMyWork } from '../../../packages/features/workspace/src/lib/my-work-store';

const mockApi = {
  loadMyWorkOverview: jest.fn(),
  loadMyWorkGroupItems: jest.fn(),
  loadMyWorkStandalonePage: jest.fn(),
  loadIsTenantAdmin: jest.fn(async () => false),
  loadCurrentUserId: jest.fn(async () => 'me'),
  changeWorkItemStatus: jest.fn(),
  changeStandaloneTaskStatus: jest.fn(),
};

jest.mock('../../../packages/features/workspace/src/lib/workspace-api', () => ({
  loadMyWorkOverview: (...args: unknown[]) => mockApi.loadMyWorkOverview(...args),
  loadMyWorkGroupItems: (...args: unknown[]) => mockApi.loadMyWorkGroupItems(...args),
  loadMyWorkStandalonePage: (...args: unknown[]) => mockApi.loadMyWorkStandalonePage(...args),
  loadIsTenantAdmin: () => mockApi.loadIsTenantAdmin(),
  loadCurrentUserId: () => mockApi.loadCurrentUserId(),
  changeWorkItemStatus: (...args: unknown[]) => mockApi.changeWorkItemStatus(...args),
  changeStandaloneTaskStatus: (...args: unknown[]) => mockApi.changeStandaloneTaskStatus(...args),
  listSavedFilters: jest.fn(async () => ({ items: [] })),
  listProjectRoles: jest.fn(async () => ({ items: [] })),
}));
jest.mock('../../../packages/features/workspace/src/lib/components/use-directory', () => ({
  useDirectory: () => ({ nameOf: (userId: string) => userId, orgNodes: [], people: [], users: [], userOptions: [] }),
}));
jest.mock('../../../packages/features/workspace/src/lib/components/use-tags', () => ({
  useTags: () => ({ tags: [], find: () => undefined }),
  tagColor: () => '#64748b',
}));

// `SearchableSelect` đo bằng ResizeObserver; jsdom chưa có.
beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  Element.prototype.scrollIntoView = jest.fn();
});
afterEach(cleanup);

const overview = (): MyWorkOverview =>
  ({
    counters: { openItems: 1, overdueItems: 0, dueToday: 0, completedThisWeek: 0 },
    groups: [
      {
        projectId: 'p1',
        projectCode: 'DA-1',
        projectName: 'Dự án một',
        total: 1,
        counts: { overdue: 0, notStarted: 0, active: 1, finished: 0 },
        topPriority: 'normal',
        topPriorityCount: 1,
        progress: 0,
      },
    ],
    standalone: { total: 0, counts: { overdue: 0, notStarted: 0, active: 0, finished: 0 } },
    filterOptions: { statuses: ['in_progress'], priorities: ['normal'], projects: [] },
    todayEvents: [],
    pendingInvitations: [],
    mentions: [],
    externalCards: [],
    timezone: 'Asia/Ho_Chi_Minh',
    today: '2026-11-05',
  }) as unknown as MyWorkOverview;

const groupItems = (): MyWorkItemsPage =>
  ({
    items: [
      {
        bucket: 'later',
        projectCode: 'DA-1',
        projectName: 'Dự án một',
        item: {
          id: 'w1',
          projectId: 'p1',
          code: 'CV-1',
          title: 'Việc cần làm',
          status: 'in_progress',
          priority: 'normal',
          progressPercent: 0,
          sortOrder: 1,
          depth: 0,
        },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  }) as unknown as MyWorkItemsPage;

describe('Công việc của tôi: chuyển sang Vướng mắc', () => {
  beforeEach(() => {
    resetMyWork();
    mockApi.loadMyWorkOverview.mockReset().mockResolvedValue(overview());
    mockApi.loadMyWorkGroupItems.mockReset().mockResolvedValue(groupItems());
    mockApi.loadMyWorkStandalonePage.mockReset();
    mockApi.changeWorkItemStatus.mockReset().mockResolvedValue({});
  });

  it('mở hộp ghi lý do, không gọi API khi chưa xác nhận, rồi gửi note = lý do đã trim', async () => {
    render(<MyWorkView />);
    fireEvent.click(await screen.findByRole('button', { name: /Dự án một/ }));
    const chip = await screen.findByRole('group', { name: 'Trạng thái của CV-1' });
    fireEvent.click(chip.querySelector('input') as HTMLElement);
    fireEvent.click(await screen.findByText('Vướng mắc', { selector: 'span' }));

    expect(await screen.findByRole('heading', { name: 'Báo vướng mắc' })).toBeTruthy();
    expect(mockApi.changeWorkItemStatus).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Lý do vướng mắc' }), {
      target: { value: '  Chờ khách hàng duyệt bản vẽ ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));

    await waitFor(() =>
      expect(mockApi.changeWorkItemStatus).toHaveBeenCalledWith('w1', {
        status: 'blocked',
        note: 'Chờ khách hàng duyệt bản vẽ',
      }),
    );
    // Thành công thì hộp tự đóng.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Báo vướng mắc' })).toBeNull());
  });
});
