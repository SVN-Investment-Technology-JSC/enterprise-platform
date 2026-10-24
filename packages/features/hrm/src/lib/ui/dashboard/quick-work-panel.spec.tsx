/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hrmEmployeeOptions, hrmFetch } from '../../hrm-api';
import { HrmQuickWork } from './quick-work-panel';

let mockActions: string[] = [];
jest.mock('../../hrm-permissions', () => ({
  HrmPermissionsProvider: ({ children }: { children: React.ReactNode }) => children,
  useHrmPermissions: () => ({
    actions: mockActions,
    loading: false,
    error: '',
    displayName: '',
    can: (p: string) => mockActions.includes(p),
    any: (list: readonly string[]) => list.some((p) => mockActions.includes(p)),
  }),
}));
jest.mock('../../hrm-api', () => {
  const actual = jest.requireActual('../../hrm-api');
  return { ...actual, hrmFetch: jest.fn(), hrmEmployeeOptions: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const employeesMock = hrmEmployeeOptions as jest.MockedFunction<typeof hrmEmployeeOptions>;
const posts = (prefix: string) =>
  fetchMock.mock.calls.filter((c) => (c[0] as string).startsWith(prefix) && (c[1] as RequestInit | undefined)?.method === 'POST');

const leave = {
  id: 'l1',
  employeeId: 'e1',
  status: 'PENDING',
  reasonName: 'Nghỉ việc riêng',
  description: 'Có việc gia đình',
  reason: 'Có việc gia đình',
  fromDate: '2026-03-02',
  toDate: '2026-03-03',
  createdAt: '2026-03-01T01:00:00.000Z',
};

function setup(leaves: unknown[] = [leave], links: unknown[] = []) {
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (path === '/my-attendance-context')
      return {
        data: {
          timezone: 'Asia/Ho_Chi_Minh',
          requireGps: false,
          shift: { window: { start: '2026-03-02T00:30:00Z', end: '2026-03-02T10:00:00Z' } },
        },
      };
    if (path === '/request-workflows') return { data: links };
    if (path === '/request-reversals') return { data: [] };
    if (path.startsWith('/request-comments')) return init?.method === 'POST' ? { data: { id: 'c1' } } : { data: [] };
    if (init?.method === 'POST') return { data: {} };
    if (path.startsWith('/leave-requests?')) return { data: leaves };
    // Một quyền duyệt chung nên thẻ gọi mọi loại đơn đang dùng; loại khác trả danh sách rỗng.
    if (path.includes('forApproval=1')) return { data: [] };
    throw new Error(`Unexpected request ${path}`);
  }) as never);
  employeesMock.mockResolvedValue([{ value: 'e1', label: 'NV001 · Nguyễn Văn An', department: 'Kỹ thuật' }]);
}

beforeEach(() => {
  fetchMock.mockReset();
  employeesMock.mockReset();
});

describe('HrmQuickWork', () => {
  it('không hiện gì khi không có quyền duyệt đơn', () => {
    mockActions = ['hrm.read'];
    setup();
    const { container } = render(<HrmQuickWork />);
    expect(container.textContent).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('không có thẻ chấm công nhanh ở dashboard dù có quyền chấm công', () => {
    mockActions = ['hrm.self.read', 'hrm.self.attendance'];
    setup();
    const { container } = render(<HrmQuickWork />);
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'Vào ca' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('duyệt nhanh tại thẻ: gọi duyệt đúng đơn rồi tải lại danh sách', async () => {
    mockActions = ['hrm.request.approve'];
    setup();
    render(<HrmQuickWork />);
    const list = await screen.findByRole('list', { name: 'Đơn chờ bạn duyệt' });
    expect(within(list).getByText('Nguyễn Văn An')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(posts('/leave-requests/l1/approve')).toHaveLength(1));
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => (c[0] as string).startsWith('/leave-requests?')).length).toBeGreaterThanOrEqual(2));
  });

  it('đơn qua quy trình: duyệt xong ẩn ngay dù HRM chưa đồng bộ trạng thái, không bắt duyệt lần hai', async () => {
    mockActions = ['hrm.request.approve'];
    // Máy chủ vẫn trả đơn ở trạng thái chờ (hộp thư bền chưa áp dụng kết quả của Procedure).
    setup([leave], [{ id: 'k1', request_kind: 'LEAVE', request_id: 'l1', instance_code: 'PROC-1', status: 'RUNNING', last_error: '' }]);
    render(<HrmQuickWork />);
    const list = await screen.findByRole('list', { name: 'Đơn chờ bạn duyệt' });
    fireEvent.click(within(list).getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(posts('/requests/LEAVE/l1/actions')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Đơn chờ bạn duyệt' })).toBeNull());
    expect(screen.getByText('Không có đơn nào chờ bạn duyệt.')).toBeTruthy();
    expect(posts('/requests/LEAVE/l1/actions')).toHaveLength(1);
  });

  it('đơn duyệt trực tiếp: xử lý xong theo đúng dữ liệu máy chủ, không ẩn thêm', async () => {
    mockActions = ['hrm.request.approve'];
    setup();
    render(<HrmQuickWork />);
    const list = await screen.findByRole('list', { name: 'Đơn chờ bạn duyệt' });
    fireEvent.click(within(list).getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(posts('/leave-requests/l1/approve')).toHaveLength(1));
    // Máy chủ còn trả đơn (giả lập) thì thẻ vẫn hiện, vì trạng thái trực tiếp được ghi đồng bộ và danh sách là nguồn đúng.
    expect(await screen.findByRole('list', { name: 'Đơn chờ bạn duyệt' })).toBeTruthy();
  });

  it('từ chối tại thẻ: hỏi xác nhận rồi từ chối ngay, không cần lý do (cờ quick)', async () => {
    mockActions = ['hrm.request.approve'];
    setup();
    render(<HrmQuickWork />);
    const list = await screen.findByRole('list', { name: 'Đơn chờ bạn duyệt' });
    fireEvent.click(within(list).getByRole('button', { name: 'Từ chối' }));
    expect(posts('/leave-requests/l1/reject')).toHaveLength(0);
    const confirms = await screen.findAllByRole('button', { name: 'Từ chối' });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => expect(posts('/leave-requests/l1/reject')).toHaveLength(1));
    expect(JSON.parse(String((posts('/leave-requests/l1/reject')[0][1] as RequestInit).body))).toEqual({ reason: '', quick: true });
  });

  it('từ chối trong ngăn chi tiết: có popup xác nhận và gửi kèm ý kiến nếu có', async () => {
    mockActions = ['hrm.request.approve'];
    setup();
    render(<HrmQuickWork />);
    const list = await screen.findByRole('list', { name: 'Đơn chờ bạn duyệt' });
    fireEvent.click(within(list).getByRole('button', { name: /Xem chi tiết đơn/ }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Duyệt đơn')).toBeTruthy();
    // Trong ngăn chi tiết, từ chối bắt buộc nhập lý do: chưa nhập thì nút bị khóa.
    expect((within(drawer).getByRole('button', { name: /Từ chối/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(drawer).getByPlaceholderText(/Ý kiến xử lý/), { target: { value: 'Trùng lịch dự án' } });
    fireEvent.click(within(drawer).getByRole('button', { name: /Từ chối/ }));
    const confirms = await screen.findAllByRole('button', { name: 'Từ chối' });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => expect(posts('/leave-requests/l1/reject')).toHaveLength(1));
    expect(JSON.parse(String((posts('/leave-requests/l1/reject')[0][1] as RequestInit).body))).toEqual({ reason: 'Trùng lịch dự án' });
  });
});
