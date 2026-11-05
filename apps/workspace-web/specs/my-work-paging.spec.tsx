import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  MyWorkGroupSummary,
  MyWorkItemsPage,
  MyWorkMention,
  MyWorkOverview,
} from '@enterprise-platform/contracts-workspace';
import { MyWorkView } from '@enterprise-platform/feature-workspace';
import { resetMyWork } from '../../../packages/features/workspace/src/lib/my-work-store';

const mockApi = {
  loadMyWorkOverview: jest.fn(),
  loadMyWorkGroupItems: jest.fn(),
  loadMyWorkStandalonePage: jest.fn(),
  changeWorkItemStatus: jest.fn(),
};

jest.mock('../../../packages/features/workspace/src/lib/workspace-api', () => ({
  loadMyWorkOverview: (...args: unknown[]) => mockApi.loadMyWorkOverview(...args),
  loadMyWorkGroupItems: (...args: unknown[]) => mockApi.loadMyWorkGroupItems(...args),
  loadMyWorkStandalonePage: (...args: unknown[]) => mockApi.loadMyWorkStandalonePage(...args),
  loadIsTenantAdmin: jest.fn(async () => false),
  loadCurrentUserId: jest.fn(async () => 'me'),
  changeWorkItemStatus: (...args: unknown[]) => mockApi.changeWorkItemStatus(...args),
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

const TOTAL = 120;

const group = (total: number): MyWorkGroupSummary => ({
  projectId: 'p1',
  projectCode: 'DA-1',
  projectName: 'Dự án lớn',
  total,
  counts: { overdue: 0, notStarted: total, active: 0, finished: 0 },
  topPriority: 'normal',
  topPriorityCount: total,
  progress: 0,
});

const overview = (mentions: readonly MyWorkMention[] = []): MyWorkOverview => ({
  counters: { openItems: TOTAL, overdueItems: 0, dueToday: 0, completedThisWeek: 0 },
  groups: [group(TOTAL)],
  standalone: { total: 0, counts: { overdue: 0, notStarted: 0, active: 0, finished: 0 } },
  filterOptions: {
    statuses: ['todo', 'blocked'],
    priorities: ['normal'],
    projects: [{ id: 'p1', code: 'DA-1', name: 'Dự án lớn' }],
  },
  todayEvents: [],
  pendingInvitations: [],
  mentions,
  externalCards: [],
  timezone: 'Asia/Ho_Chi_Minh',
  today: '2026-11-05',
});

/** Giả lập server: trang `page` gồm `pageSize` việc đánh số liên tục. */
const pageOf = (_projectId: string, _filter: unknown, _sort: string, page: number, pageSize: number) =>
  Promise.resolve({
    items: Array.from({ length: pageSize }, (_, index) => {
      const n = (page - 1) * pageSize + index + 1;
      return {
        bucket: 'later',
        projectCode: 'DA-1',
        projectName: 'Dự án lớn',
        item: {
          id: `w${n}`,
          projectId: 'p1',
          code: `CV-${n}`,
          title: `Việc số ${n}`,
          status: 'todo',
          priority: 'normal',
          progressPercent: 0,
          sortOrder: n,
          depth: 0,
        },
      };
    }),
    total: TOTAL,
    page,
    pageSize,
  } as unknown as MyWorkItemsPage);

const codes = () => screen.queryAllByText(/^CV-\d+$/);

beforeEach(() => {
  resetMyWork();
  mockApi.loadMyWorkOverview.mockReset().mockResolvedValue(overview());
  mockApi.loadMyWorkGroupItems.mockReset().mockImplementation(pageOf);
  mockApi.loadMyWorkStandalonePage.mockReset();
  mockApi.changeWorkItemStatus.mockReset().mockResolvedValue({});
});

const openGroup = async () => fireEvent.click(await screen.findByRole('button', { name: /Dự án lớn/ }));

describe('Công việc của tôi: phân trang theo nhóm', () => {
  it('chỉ vẽ một trang dòng của nhóm; đổi trang gọi API trang 2, về trang 1 lấy từ bộ nhớ', async () => {
    render(<MyWorkView />);
    // Chưa mở nhóm thì chưa nạp dòng nào.
    await screen.findByRole('button', { name: /Dự án lớn/ });
    expect(mockApi.loadMyWorkGroupItems).not.toHaveBeenCalled();

    await openGroup();
    await waitFor(() => expect(codes()).toHaveLength(20));
    expect(mockApi.loadMyWorkGroupItems).toHaveBeenCalledTimes(1);
    expect(mockApi.loadMyWorkGroupItems).toHaveBeenLastCalledWith('p1', {}, 'due', 1, 20);

    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(screen.queryByText('CV-21')).not.toBeNull());
    expect(mockApi.loadMyWorkGroupItems).toHaveBeenCalledTimes(2);
    expect(mockApi.loadMyWorkGroupItems).toHaveBeenLastCalledWith('p1', {}, 'due', 2, 20);
    await waitFor(() => expect(codes()).toHaveLength(20));

    fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
    await waitFor(() => expect(screen.queryByText('CV-1')).not.toBeNull());
    expect(codes()).toHaveLength(20);
    // Trang 1 đã nằm trong bộ nhớ đệm: không gọi lại.
    expect(mockApi.loadMyWorkGroupItems).toHaveBeenCalledTimes(2);
  });

  it('đổi bộ lọc thì gọi lại tổng quan với tham số lọc', async () => {
    render(<MyWorkView />);
    await screen.findByRole('button', { name: /Dự án lớn/ });
    expect(mockApi.loadMyWorkOverview).toHaveBeenCalledTimes(1);
    expect(mockApi.loadMyWorkOverview).toHaveBeenLastCalledWith({}, 'due');

    fireEvent.click(screen.getByRole('button', { name: /Bộ lọc/ }));
    const chip = await screen.findByRole('group', { name: 'Trạng thái' });
    fireEvent.click(chip.querySelector('input') as HTMLElement);
    fireEvent.click(await screen.findByText('Vướng mắc'));

    await waitFor(() => expect(mockApi.loadMyWorkOverview).toHaveBeenCalledTimes(2));
    expect(mockApi.loadMyWorkOverview).toHaveBeenLastCalledWith({ status: 'blocked' }, 'due');
  });

  it('đổi trạng thái xong thì huỷ bộ nhớ và nạp lại tổng quan lẫn trang dòng', async () => {
    render(<MyWorkView />);
    await openGroup();
    await waitFor(() => expect(codes()).toHaveLength(20));
    expect(mockApi.loadMyWorkOverview).toHaveBeenCalledTimes(1);
    expect(mockApi.loadMyWorkGroupItems).toHaveBeenCalledTimes(1);

    const chip = screen.getByRole('group', { name: 'Trạng thái của CV-1' });
    fireEvent.click(chip.querySelector('input') as HTMLElement);
    await act(async () => {
      fireEvent.click(await screen.findByText('Đang làm', { selector: 'span' }));
    });

    await waitFor(() =>
      expect(mockApi.changeWorkItemStatus).toHaveBeenCalledWith('w1', { status: 'in_progress' }),
    );
    await waitFor(() => expect(mockApi.loadMyWorkOverview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockApi.loadMyWorkGroupItems).toHaveBeenCalledTimes(2));
  });
});

describe('Công việc của tôi: khối nhắc tên', () => {
  it('nội dung nhắc rất dài nằm trong phần tử bị cắt 2 dòng, không có khoảng trắng vẫn không tràn', async () => {
    const long = 'x'.repeat(400);
    mockApi.loadMyWorkOverview.mockResolvedValue(
      overview([
        {
          messageId: 'm1',
          channelId: 'c1',
          entityType: 'work_item',
          entityId: 'w1',
          projectId: 'p1',
          excerpt: long,
          createdBy: 'an',
          createdAt: '2026-11-05T03:00:00.000Z',
        } as MyWorkMention,
      ]),
    );
    render(<MyWorkView />);
    const excerpt = await screen.findByText(long);
    expect(excerpt.className).toContain('mentionExcerpt');
    // Là một nút bấm được, nằm trong khối phụ chung với "Từ module khác".
    expect(excerpt.closest('button')?.className).toContain('mentionItem');
    expect(screen.getByRole('complementary').contains(excerpt)).toBe(true);
    expect(screen.getByText('Không có hồ sơ nào từ module khác.')).toBeTruthy();
  });

  it('không có việc nào thì báo gọn một dòng', async () => {
    mockApi.loadMyWorkOverview.mockResolvedValue({
      ...overview(),
      groups: [],
      counters: { ...overview().counters, openItems: 0 },
    });
    render(<MyWorkView />);
    expect(await screen.findByText('Bạn không có việc nào đang mở.')).toBeTruthy();
    expect(screen.getByText('Chưa ai nhắc tên bạn.')).toBeTruthy();
  });
});
