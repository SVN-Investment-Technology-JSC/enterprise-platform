/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HrmApiError, hrmEmployeeOptions, hrmFetch } from '../hrm-api';
import ApprovalsScreen from './approvals-screen';

let mockActions: string[] = [];
let mockType: string | null = null;
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'type' ? mockType : null),
  }),
}));
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: mockActions,
    loading: false,
    error: '',
    displayName: '',
    can: (p: string) => mockActions.includes(p),
    any: (list: readonly string[]) => list.some((p) => mockActions.includes(p)),
  }),
}));
jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn(), hrmEmployeeOptions: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const employeesMock = hrmEmployeeOptions as jest.MockedFunction<typeof hrmEmployeeOptions>;
const paths = () => fetchMock.mock.calls.map((call) => call[0] as string);
const NOISE = ['/approval-scope', '/request-workflows', '/request-reversals'];
const listPaths = () => paths().filter((p) => !NOISE.includes(p) && !p.startsWith('/request-comments'));
const posts = (prefix: string) =>
  fetchMock.mock.calls.filter((c) => (c[0] as string).startsWith(prefix) && (c[1] as RequestInit | undefined)?.method === 'POST');

// Lý do (reasonName, chọn từ danh mục) và Mô tả (description, tự do) là hai trường riêng của đơn.
const leave = {
  id: 'l1',
  employeeId: 'e1',
  status: 'PENDING',
  reasonId: 'lt1',
  reasonName: 'Nghỉ việc riêng',
  description: 'Có việc gia đình đột xuất',
  reason: 'Có việc gia đình đột xuất',
  fromDate: '2026-03-02',
  toDate: '2026-03-03',
  createdAt: '2026-03-01T01:00:00.000Z',
};
const ot = {
  id: 'o1',
  employeeId: 'e1',
  status: 'PENDING',
  reasonId: 'r1',
  reasonName: 'Tăng ca cuối tháng',
  description: 'Hoàn thiện báo cáo quý',
  reason: 'Hoàn thiện báo cáo quý',
  paid: true,
  workDate: '2026-03-05',
  plannedMinutes: 120,
  createdAt: '2026-03-02T01:00:00.000Z',
};

interface Setup {
  lists?: Record<string, unknown[] | Error>;
  workflows?: unknown[];
  comments?: unknown[];
  candidates?: unknown[];
  reversals?: { requestId: string; reason: string }[];
}
function setup({ lists = {}, workflows = [], comments = [], candidates = [], reversals = [] }: Setup) {
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (path === '/approval-scope') return { data: { noReportingLine: false, message: null } };
    if (path === '/request-workflows') return { data: workflows };
    if (path === '/request-reversals') return { data: reversals };
    if (path.startsWith('/request-comments/mention-candidates')) return { data: candidates };
    if (path.startsWith('/request-comments')) return init?.method === 'POST' ? { data: { id: 'cm-new' } } : { data: comments };
    if (init?.method === 'POST') return { data: {} };
    const key = Object.keys(lists).find((k) => path.startsWith(`/${k}?`));
    if (!key) throw new Error(`Unexpected request ${path}`);
    const value = lists[key];
    if (value instanceof Error) throw value;
    return { data: value };
  }) as never);
  employeesMock.mockResolvedValue([
    { value: 'e1', label: 'NV001 · Nguyễn Văn An', department: 'Kỹ thuật' },
    { value: 'e2', label: 'NV002 · Trần Thị Bình', department: 'Hành chính' },
  ]);
}

const openRow = async (id: string) => {
  fireEvent.click(await screen.findByTestId(`approval-row-${id}`));
  return screen.findByLabelText('Chi tiết đơn');
};

beforeEach(() => {
  fetchMock.mockReset();
  employeesMock.mockReset();
  mockType = null;
});

describe('ApprovalsScreen: tải dữ liệu', () => {
  it('mỗi danh sách kèm forApproval=1, chỉ gọi loại được duyệt; tải đơn chờ trước rồi tải nốt lịch sử', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve.all', 'hrm.advance.approve'];
    setup({ lists: { 'leave-requests': [leave], 'ot-requests': [ot], 'salary-advance-requests': [] } });
    render(<ApprovalsScreen />);
    await waitFor(() => expect(listPaths().length).toBe(6));
    for (const p of listPaths()) expect(p).toContain('forApproval=1');
    expect(listPaths().some((p) => p.startsWith('/business-trip-requests'))).toBe(false);
    const first = listPaths().slice(0, 3);
    const second = listPaths().slice(3);
    expect(first.every((p) => p.includes('status=PENDING'))).toBe(true);
    expect(second.every((p) => !p.includes('status='))).toBe(true);
  });

  it('đơn đã duyệt rồi bị huỷ hiệu lực hiện nhãn "Đã hủy hiệu lực" kèm lý do, tách khỏi "Đã rút / hủy"', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({
      lists: { 'leave-requests': [{ ...leave, status: 'CANCELLED' }] },
      reversals: [{ requestId: 'l1', reason: 'Nhập nhầm ngày' }],
    });
    render(<ApprovalsScreen />);
    const badge = await screen.findByText('Đã hủy hiệu lực');
    expect(badge.getAttribute('title')).toBe('Lý do: Nhập nhầm ngày');
    expect(screen.queryByText('Đã rút / hủy')).toBeNull();
  });

  it('?type= chọn sẵn bộ lọc loại đơn; không có thì hiện mọi loại', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve'];
    mockType = 'ot';
    setup({ lists: { 'leave-requests': [leave], 'ot-requests': [ot] } });
    const view = render(<ApprovalsScreen />);
    expect(await screen.findByText('Tăng ca cuối tháng')).toBeTruthy();
    expect(screen.queryByText('Nghỉ việc riêng')).toBeNull();
    view.unmount();
    mockType = null;
    setup({ lists: { 'leave-requests': [leave], 'ot-requests': [ot] } });
    render(<ApprovalsScreen />);
    expect(await screen.findByText('Tăng ca cuối tháng')).toBeTruthy();
    expect(screen.getByText('Nghỉ việc riêng')).toBeTruthy();
  });

  it('loại đơn bị 403 được bỏ qua, không báo lỗi', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve'];
    setup({ lists: { 'leave-requests': [leave], 'ot-requests': new HrmApiError('Forbidden', 403) } });
    render(<ApprovalsScreen />);
    expect(await screen.findByText('Nghỉ việc riêng')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ApprovalsScreen: danh sách', () => {
  it('hiện tên, mã và phòng ban của người gửi; loại đơn, thời gian, lý do, trạng thái', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ lists: { 'leave-requests': [leave] } });
    render(<ApprovalsScreen />);
    const row = await screen.findByTestId('approval-row-l1');
    expect(within(row).getByText('Nguyễn Văn An')).toBeTruthy();
    expect(within(row).getByText('NV001 · Kỹ thuật')).toBeTruthy();
    expect(within(row).getByText('Nghỉ phép')).toBeTruthy();
    expect(within(row).getByText('Nghỉ việc riêng')).toBeTruthy();
    expect(within(row).getByText('Chờ duyệt')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Nhân viên', 'Loại đơn', 'Thời gian', 'Lý do', 'Trạng thái']);
  });

  it('đơn làm thêm giờ không lương có thẻ Không lương cạnh lý do', async () => {
    mockActions = ['hrm.ot.approve'];
    setup({ lists: { 'ot-requests': [ot, { ...ot, id: 'o2', reasonName: 'Làm bù tự nguyện', description: 'Tự nguyện', paid: false }] } });
    render(<ApprovalsScreen />);
    expect(within(await screen.findByTestId('approval-row-o2')).getByText('Không lương')).toBeTruthy();
    expect(within(screen.getByTestId('approval-row-o1')).queryByText('Không lương')).toBeNull();
  });

  it('các tab đếm và lọc đúng theo nhóm đơn; không còn các thẻ chỉ số cũ', async () => {
    mockActions = ['hrm.leave.approve'];
    const thisMonth = new Date().toISOString();
    setup({
      lists: {
        'leave-requests': [
          leave,
          { ...leave, id: 'l2', status: 'APPROVED', approvedAt: thisMonth, createdAt: thisMonth },
          { ...leave, id: 'l3', status: 'REJECTED', approvedAt: '2020-01-01T00:00:00Z', createdAt: '2020-01-01T00:00:00Z' },
        ],
      },
      workflows: [{ id: 'w9', request_kind: 'LEAVE', request_id: 'l4', instance_code: 'PE-9', status: 'RUNNING', last_error: '' }],
    });
    // đơn l4 đang chạy quy trình ở bước của người khác: tính là "Đang xử lý", không phải "Chờ tôi duyệt".
    fetchMock.mockImplementation((async (path: string) => {
      if (path === '/approval-scope') return { data: { noReportingLine: false, message: null } };
      if (path === '/request-workflows')
        return { data: [{ id: 'w9', request_kind: 'LEAVE', request_id: 'l4', instance_code: 'PE-9', status: 'WAITING', last_error: '' }] };
      return { data: [leave, { ...leave, id: 'l2', status: 'APPROVED', approvedAt: thisMonth, createdAt: thisMonth }, { ...leave, id: 'l3', status: 'REJECTED', approvedAt: '2020-01-01T00:00:00Z', createdAt: '2020-01-01T00:00:00Z' }, { ...leave, id: 'l4' }] };
    }) as never);
    render(<ApprovalsScreen />);
    await screen.findByTestId('approval-row-l1');
    expect(screen.queryByTestId('kpi-mine')).toBeNull();
    expect(screen.queryByTestId('kpi-processing')).toBeNull();
    expect(screen.queryByTestId('kpi-overdue')).toBeNull();
    expect(screen.queryByTestId('kpi-done')).toBeNull();
    expect(screen.getByTestId('tab-ALL').textContent).toBe('Tất cả (4)');
    expect(screen.getByTestId('tab-MINE').textContent).toBe('Chờ tôi duyệt (1)');
    expect(screen.getByTestId('tab-PROCESSING').textContent).toBe('Đang xử lý (1)');
    expect(screen.getByTestId('tab-DONE').textContent).toBe('Đã xử lý (2)');
    fireEvent.click(screen.getByTestId('tab-DONE'));
    expect(screen.queryByTestId('approval-row-l1')).toBeNull();
    expect(screen.getByTestId('approval-row-l2')).toBeTruthy();
    expect(screen.getByTestId('approval-row-l3')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tab-MINE'));
    expect(screen.getByTestId('approval-row-l1')).toBeTruthy();
    expect(screen.queryByTestId('approval-row-l4')).toBeNull();
  });

  it('tìm theo cả lý do lẫn mô tả, không phân biệt dấu', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve'];
    setup({ lists: { 'leave-requests': [leave], 'ot-requests': [ot] } });
    render(<ApprovalsScreen />);
    await screen.findByTestId('approval-row-o1');
    fireEvent.change(screen.getByLabelText('Tìm đơn'), { target: { value: 'gia dinh' } });
    await waitFor(() => expect(screen.queryByTestId('approval-row-o1')).toBeNull());
    expect(screen.getByTestId('approval-row-l1')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Tìm đơn'), { target: { value: 'cuoi thang' } });
    await waitFor(() => expect(screen.queryByTestId('approval-row-l1')).toBeNull());
    expect(screen.getByTestId('approval-row-o1')).toBeTruthy();
  });

  it('lọc theo khoảng ngày gửi', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve'];
    setup({ lists: { 'leave-requests': [leave], 'ot-requests': [ot] } });
    render(<ApprovalsScreen />);
    await screen.findByTestId('approval-row-o1');
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '02/03/2026' } });
    await waitFor(() => expect(screen.queryByTestId('approval-row-l1')).toBeNull());
    expect(screen.getByTestId('approval-row-o1')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '01/03/2026' } });
    await waitFor(() => expect(screen.queryByTestId('approval-row-o1')).toBeNull());
  });

  it('phân trang 20 đơn mỗi trang', async () => {
    mockActions = ['hrm.leave.approve'];
    const many = Array.from({ length: 25 }, (_, i) => ({ ...leave, id: `m${i}`, createdAt: `2026-03-${String(i + 1).padStart(2, '0')}T01:00:00.000Z` }));
    setup({ lists: { 'leave-requests': many } });
    render(<ApprovalsScreen />);
    await screen.findByText(/Hiển thị 1–20 trên 25 đơn/);
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(screen.getByText(/Hiển thị 21–25 trên 25 đơn/)).toBeTruthy();
  });
});

describe('ApprovalsScreen: chi tiết đơn', () => {
  it('có khối Lý do và Mô tả riêng, thông tin nhân viên, loại đơn', async () => {
    mockActions = ['hrm.ot.approve'];
    setup({ lists: { 'ot-requests': [{ ...ot, reasonName: 'Làm bù tự nguyện', description: 'Tự nguyện', paid: false }] } });
    render(<ApprovalsScreen />);
    const panel = await openRow('o1');
    expect(within(panel).getByTestId('detail-title').textContent).toBe('Tăng ca');
    const reason = within(panel).getByTestId('approval-detail-reason');
    expect(reason.textContent).toContain('Làm bù tự nguyện');
    expect(reason.textContent).toContain('Không lương');
    expect(within(panel).getByTestId('approval-detail-description').textContent).toBe('Tự nguyện');
    expect(within(panel).getByText('NV001 · Kỹ thuật')).toBeTruthy();
  });

  it('chưa chọn đơn thì panel hướng dẫn chọn một đơn', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ lists: { 'leave-requests': [leave] } });
    render(<ApprovalsScreen />);
    await screen.findByTestId('approval-row-l1');
    expect(screen.getByText(/Chọn một đơn trong danh sách/)).toBeTruthy();
  });

  it('đơn đi theo quy trình: có liên kết Xem quy trình đúng đường dẫn và các bước thật; không hiện nút duyệt trực tiếp', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({
      lists: { 'leave-requests': [leave] },
      workflows: [{ id: 'w1', request_kind: 'LEAVE', request_id: 'l1', instance_id: 'inst-001', instance_code: 'PE-001', status: 'COMPLETED', last_error: '' }],
    });
    render(<ApprovalsScreen />);
    const panel = await openRow('l1');
    expect(within(panel).getByRole('link', { name: /Xem quy trình/ }).getAttribute('href')).toBe('/modules/procedure#workspace/inst-001');
    expect(within(panel).queryByRole('button', { name: /Phê duyệt/ })).toBeNull();
  });

  it('đơn duyệt trực tiếp có quy trình hai bước: người gửi rồi người duyệt đang chờ', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ lists: { 'leave-requests': [leave] } });
    render(<ApprovalsScreen />);
    const panel = await openRow('l1');
    const steps = within(within(panel).getByTestId('flow-stepper')).getAllByRole('listitem');
    expect(steps.map((s) => s.getAttribute('data-state'))).toEqual(['done', 'current']);
    expect(steps[0].textContent).toContain('Người gửi');
    expect(steps[1].textContent).toContain('Đang chờ duyệt');
  });
});

describe('ApprovalsScreen: ý kiến khi duyệt và từ chối', () => {
  it('phê duyệt kèm ý kiến: gọi duyệt rồi ghi ý kiến vào luồng trao đổi với quyết định APPROVE', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ lists: { 'leave-requests': [leave] } });
    render(<ApprovalsScreen />);
    const panel = await openRow('l1');
    fireEvent.change(within(panel).getByLabelText('Ý kiến xử lý'), { target: { value: 'Đồng ý, nhớ bàn giao việc' } });
    fireEvent.click(within(panel).getByRole('button', { name: /Phê duyệt/ }));
    const confirm = (await screen.findAllByRole('button', { name: 'Phê duyệt' })).pop() as HTMLElement;
    fireEvent.click(confirm);
    await waitFor(() => expect(posts('/leave-requests/l1/approve')).toHaveLength(1));
    await waitFor(() => expect(posts('/request-comments')).toHaveLength(1));
    expect(JSON.parse(String((posts('/request-comments')[0][1] as RequestInit).body))).toEqual({
      kind: 'LEAVE',
      requestId: 'l1',
      body: 'Đồng ý, nhớ bàn giao việc',
      commentKind: 'DECISION',
      decision: 'APPROVE',
    });
  });

  it('phê duyệt không ý kiến thì không ghi thêm bình luận', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ lists: { 'leave-requests': [leave] } });
    render(<ApprovalsScreen />);
    const panel = await openRow('l1');
    fireEvent.click(within(panel).getByRole('button', { name: /Phê duyệt/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Phê duyệt' })).pop() as HTMLElement);
    await waitFor(() => expect(posts('/leave-requests/l1/approve')).toHaveLength(1));
    expect(posts('/request-comments')).toHaveLength(0);
  });

  it('từ chối bắt buộc có ý kiến; ý kiến là lý do từ chối và cũng được ghi vào luồng trao đổi', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ lists: { 'leave-requests': [leave] } });
    render(<ApprovalsScreen />);
    const panel = await openRow('l1');
    const reject = within(panel).getByRole('button', { name: /Từ chối/ }) as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
    fireEvent.change(within(panel).getByLabelText('Ý kiến xử lý'), { target: { value: 'Trùng đợt cao điểm' } });
    expect(reject.disabled).toBe(false);
    fireEvent.click(reject);
    await waitFor(() => expect(posts('/leave-requests/l1/reject')).toHaveLength(1));
    expect(JSON.parse(String((posts('/leave-requests/l1/reject')[0][1] as RequestInit).body))).toEqual({ reason: 'Trùng đợt cao điểm' });
    await waitFor(() => expect(posts('/request-comments')).toHaveLength(1));
    expect(JSON.parse(String((posts('/request-comments')[0][1] as RequestInit).body))).toMatchObject({ commentKind: 'DECISION', decision: 'REJECT', body: 'Trùng đợt cao điểm' });
  });

  it('người không có quyền duyệt đơn này không thấy nút duyệt và từ chối', async () => {
    mockActions = ['hrm.request.read'];
    setup({ lists: {} });
    render(<ApprovalsScreen />);
    await screen.findByText(/Không có đơn nào khớp bộ lọc/);
    expect(screen.queryByRole('button', { name: /Từ chối/ })).toBeNull();
  });
});

describe('ApprovalsScreen: trao đổi trên đơn', () => {
  const comments = [
    { id: 'c1', requestKind: 'leave', requestId: 'l1', authorUserId: 'u2', authorName: 'Trần Quản Lý', kind: 'COMMENT', decision: null, body: 'Anh Bình @Lê Văn Bình xem giúp', mentions: [{ userId: 'u3', name: 'Lê Văn Bình' }], createdAt: '2026-10-11T03:00:00.000Z', mine: false },
    { id: 'c2', requestKind: 'leave', requestId: 'l1', authorUserId: 'u9', authorName: 'Tôi', kind: 'DECISION', decision: 'REJECT', body: 'Từ chối vì trùng lịch', mentions: [], createdAt: '2026-10-11T04:00:00.000Z', mine: true },
  ];

  it('hiện luồng trao đổi, tô đậm @tên và nhãn quyết định', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ lists: { 'leave-requests': [leave] }, comments });
    render(<ApprovalsScreen />);
    const panel = await openRow('l1');
    const thread = await within(panel).findByTestId('thread-list');
    expect(within(thread).getByTestId('mention').textContent).toBe('@Lê Văn Bình');
    expect(within(thread).getByText('Đã từ chối')).toBeTruthy();
    expect(within(thread).getByText('Từ chối vì trùng lịch')).toBeTruthy();
    expect(paths().some((p) => p === '/request-comments?kind=LEAVE&requestId=l1')).toBe(true);
  });

  it('gõ @ gợi ý người, chọn thì chèn @Tên và gửi kèm mentionUserIds', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({
      lists: { 'leave-requests': [leave] },
      comments: [],
      candidates: [{ userId: 'u3', name: 'Lê Văn Bình', employeeCode: 'NV010', department: 'Kho' }],
    });
    render(<ApprovalsScreen />);
    const panel = await openRow('l1');
    const box = (await within(panel).findByLabelText('Nội dung trao đổi')) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Nhờ @bi', selectionStart: 7 } });
    box.setSelectionRange(7, 7);
    fireEvent.change(box, { target: { value: 'Nhờ @bi' } });
    const option = await screen.findByRole('option', { name: /Lê Văn Bình/ });
    fireEvent.mouseDown(within(option).getByRole('button'));
    expect(box.value).toBe('Nhờ @Lê Văn Bình ');
    expect(within(panel).getByText(/Sẽ thông báo cho: Lê Văn Bình/)).toBeTruthy();
    fireEvent.change(box, { target: { value: 'Nhờ @Lê Văn Bình xem giúp' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Gửi trao đổi' }));
    await waitFor(() => expect(posts('/request-comments')).toHaveLength(1));
    expect(JSON.parse(String((posts('/request-comments')[0][1] as RequestInit).body))).toEqual({
      kind: 'LEAVE',
      requestId: 'l1',
      body: 'Nhờ @Lê Văn Bình xem giúp',
      mentionUserIds: ['u3'],
    });
    await waitFor(() => expect(box.value).toBe(''));
  });

  it('xoá @Tên khỏi nội dung thì không nhắc người đó nữa', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ lists: { 'leave-requests': [leave] }, comments: [], candidates: [{ userId: 'u3', name: 'Lê Văn Bình', employeeCode: null, department: null }] });
    render(<ApprovalsScreen />);
    const panel = await openRow('l1');
    const box = (await within(panel).findByLabelText('Nội dung trao đổi')) as HTMLTextAreaElement;
    box.setSelectionRange(3, 3);
    fireEvent.change(box, { target: { value: '@bi' } });
    fireEvent.mouseDown(within(await screen.findByRole('option')).getByRole('button'));
    fireEvent.change(box, { target: { value: 'Chỉ nhờ thôi' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Gửi trao đổi' }));
    await waitFor(() => expect(posts('/request-comments')).toHaveLength(1));
    expect(JSON.parse(String((posts('/request-comments')[0][1] as RequestInit).body)).mentionUserIds).toEqual([]);
  });

  it('không có quyền xem luồng trao đổi thì báo rõ, không vỡ màn hình', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ lists: { 'leave-requests': [leave] } });
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path.startsWith('/request-comments?')) throw new HrmApiError('Forbidden', 403);
      return original(path, init as never);
    }) as never);
    render(<ApprovalsScreen />);
    const panel = await openRow('l1');
    expect(await within(panel).findByText('Bạn không có quyền xem trao đổi của đơn này.')).toBeTruthy();
  });
});
