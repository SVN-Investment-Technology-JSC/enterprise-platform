import { cleanup, render, screen } from '@testing-library/react';
import {
  CustomersView,
  MyWorkView,
  WorkspacePermissionsProvider,
  WorkspaceScreen,
  resetMyWork,
  workspacePermissionsFrom,
} from '@enterprise-platform/feature-workspace';

/**
 * ISS-UI-022: giao diện Workspace ẩn nút ghi theo `capabilities` của `GET /v1/status`, và người không có quyền phân
 * hệ thấy thông báo tiếng Việt thay cho lỗi kỹ thuật. Server vẫn kiểm quyền; đây chỉ là trải nghiệm.
 */
const mockApi = {
  loadWorkspaceStatus: jest.fn(),
  listCustomers: jest.fn(async () => []),
};

jest.mock('../../../packages/features/workspace/src/lib/workspace-api', () => ({
  ...jest.requireActual('../../../packages/features/workspace/src/lib/workspace-api'),
  loadWorkspaceStatus: () => mockApi.loadWorkspaceStatus(),
  listCustomers: () => mockApi.listCustomers(),
  listProjects: jest.fn(async () => ({ items: [], total: 0 })),
  loadMyWorkOverview: jest.fn(async () => {
    throw { statusCode: 500, message: 'Lỗi' };
  }),
  loadMyWorkGroupItems: jest.fn(async () => ({ items: [], total: 0 })),
  loadMyWorkStandalonePage: jest.fn(async () => ({ items: [], total: 0 })),
  loadIsTenantAdmin: jest.fn(async () => false),
  loadCurrentUserId: jest.fn(async () => 'me'),
  loadTenantHomePath: jest.fn(async () => '/'),
  loadLabelSettings: jest.fn(async () => {
    throw new Error('không cần');
  }),
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

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  Element.prototype.scrollIntoView = jest.fn();
  // Các lời gọi phụ (phiên, thông báo) của khung module: trả lỗi máy chủ để chúng tự bỏ qua.
  globalThis.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  resetMyWork();
});

const capabilities = (overrides: Record<string, boolean>) => ({
  tenantId: 't1',
  schemaExists: true,
  tablesReady: true,
  capabilities: {
    isTenantAdmin: false,
    canManage: false,
    canWriteTasks: true,
    canWriteDocuments: false,
    canDeleteDocuments: false,
    canCreateProject: true,
    ...overrides,
  },
});

describe('workspacePermissionsFrom', () => {
  it('đọc cờ từ capabilities; server cũ chưa trả cờ thì coi là có', () => {
    expect(workspacePermissionsFrom(capabilities({ canWriteTasks: false, canCreateProject: false }))).toEqual({
      canWriteTasks: false,
      canCreateProject: false,
    });
    expect(workspacePermissionsFrom(undefined)).toEqual({ canWriteTasks: true, canCreateProject: true });
  });
});

describe('MyWorkView: nút "Tạo mới" theo quyền (SEC-UI022-01, 02)', () => {
  it('có quyền ghi công việc thì thấy nút', async () => {
    render(
      <WorkspacePermissionsProvider value={{ canWriteTasks: true, canCreateProject: false }}>
        <MyWorkView />
      </WorkspacePermissionsProvider>,
    );
    expect(await screen.findByRole('button', { name: /Tạo mới/ })).toBeTruthy();
  });

  it('chỉ có quyền đọc thì không thấy nút', async () => {
    render(
      <WorkspacePermissionsProvider value={{ canWriteTasks: false, canCreateProject: false }}>
        <MyWorkView />
      </WorkspacePermissionsProvider>,
    );
    await screen.findByRole('button', { name: 'Tải lại' });
    expect(screen.queryByRole('button', { name: /Tạo mới/ })).toBeNull();
  });
});

describe('CustomersView: nút ghi theo quyền (SEC-UI022-02)', () => {
  it('có quyền ghi thì thấy "Thêm khách hàng", không có thì ẩn', async () => {
    const { unmount } = render(<CustomersView canWrite />);
    expect(await screen.findByRole('button', { name: /Thêm khách hàng/ })).toBeTruthy();
    unmount();

    render(<CustomersView canWrite={false} />);
    await screen.findByText('Chưa có khách hàng nào.');
    expect(screen.queryByRole('button', { name: /Thêm khách hàng/ })).toBeNull();
  });
});

describe('WorkspaceScreen: người không có quyền phân hệ (SEC-UI022-03)', () => {
  it('status trả 403 thì hiện thông báo tiếng Việt, không hiện lỗi kỹ thuật', async () => {
    mockApi.loadWorkspaceStatus.mockRejectedValueOnce({
      statusCode: 403,
      code: 'ACCESS_DENIED',
      message: 'Không được phép truy cập Workspace.',
    });
    render(<WorkspaceScreen />);
    const notice = await screen.findByText(/Bạn chưa được cấp quyền dùng phân hệ Không gian làm việc/);
    expect(notice).toBeTruthy();
    expect(screen.queryByText('Không được phép truy cập Workspace.')).toBeNull();
  });

  it('chỉ có quyền đọc thì có chú thích và không có nút "Giao việc"', async () => {
    mockApi.loadWorkspaceStatus.mockResolvedValueOnce(capabilities({ canWriteTasks: false }));
    window.location.hash = '#tasks';
    render(<WorkspaceScreen />);
    expect(await screen.findByText(/Bạn chỉ có quyền xem trong Workspace/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Giao việc/ })).toBeNull();
    window.location.hash = '';
  });
});
