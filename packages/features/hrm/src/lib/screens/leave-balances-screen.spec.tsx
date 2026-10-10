/** @jest-environment jsdom */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import LeaveBalancesScreen from './leave-balances-screen';

const mockActions = new Set<string>();
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: [...mockActions],
    loading: false,
    error: '',
    displayName: '',
    can: (p: string) => mockActions.has(p),
    any: (list: readonly string[]) => list.some((p) => mockActions.has(p)),
  }),
}));

jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

// antd Table cần matchMedia, ResizeObserver và getComputedStyle(elt, pseudoElt), jsdom chưa hỗ trợ.
const nativeGetComputedStyle = window.getComputedStyle.bind(window);
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  window.getComputedStyle = ((elt: Element) =>
    nativeGetComputedStyle(elt)) as typeof window.getComputedStyle;
});
afterAll(() => {
  window.getComputedStyle = nativeGetComputedStyle;
});

const year = new Date().getFullYear();

function balance(over: Record<string, unknown>) {
  return {
    id: 'b1',
    hasBalance: true,
    tenantId: 't',
    employeeId: 'e1',
    employeeCode: 'NV001',
    employeeName: 'Nguyễn Văn An',
    department: 'Phòng Kinh doanh',
    leaveTypeId: 'lt1',
    leaveTypeCode: 'AL',
    leaveTypeName: 'Phép năm',
    year,
    openingBalance: 2,
    accrued: 12,
    adjusted: 0,
    entitlement: 14,
    carryover: 2,
    used: 4,
    pending: 1,
    remaining: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}
const balances = [
  balance({}),
  balance({
    id: 'b2',
    employeeId: 'e2',
    employeeCode: 'NV002',
    employeeName: 'Trần Thị Bình',
    department: 'Phòng Kế toán',
    entitlement: 12,
    carryover: 0,
    used: 12,
    pending: 0,
    remaining: 0,
  }),
  balance({
    id: 'b3',
    employeeId: 'e3',
    employeeCode: 'NV003',
    employeeName: 'Lê Văn Cường',
    department: null,
    entitlement: 12,
    carryover: 0,
    used: 13.5,
    pending: 0,
    remaining: -1.5,
  }),
  // Nhân viên chưa có quỹ năm đó: server trả dòng mặc định (id rỗng, mọi số bằng 0, hasBalance=false).
  balance({
    id: '',
    hasBalance: false,
    employeeId: 'e4',
    employeeCode: 'NV004',
    employeeName: 'Phạm Thị Dung',
    department: 'Phòng Nhân sự',
    openingBalance: 0,
    accrued: 0,
    entitlement: 0,
    carryover: 0,
    used: 0,
    pending: 0,
    remaining: 0,
  }),
];
const transactions = [
  {
    id: 'tx2',
    tenantId: 't',
    employeeId: 'e1',
    leaveTypeId: 'lt1',
    transactionType: 'USAGE',
    daysChanged: -2,
    balanceAfter: 10,
    note: 'Nghỉ phép 2 ngày',
    balanceYear: year,
    createdAt: '2026-03-10T05:00:00.000Z',
  },
  {
    id: 'tx1',
    tenantId: 't',
    employeeId: 'e1',
    leaveTypeId: 'lt1',
    transactionType: 'ADJUSTMENT',
    daysChanged: 1,
    balanceAfter: 12,
    note: 'Bù phép',
    balanceYear: year,
    createdAt: '2026-02-10T05:00:00.000Z',
  },
];

function route(rows: unknown[] = balances) {
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (path.startsWith('/leave-balances')) return { data: rows };
    if (path.startsWith('/leave-transactions/') && init?.method === 'POST')
      return { data: {} };
    if (path.startsWith('/leave-transactions')) return { data: transactions };
    if (path === '/leave-adjustments') return { data: {} };
    throw new Error(`unexpected ${path}`);
  }) as never);
}

const callsTo = (prefix: string) =>
  fetchMock.mock.calls.filter(([p]) => String(p).startsWith(prefix));

beforeEach(() => {
  mockActions.clear();
  fetchMock.mockReset();
  route();
});

describe('LeaveBalancesScreen', () => {
  it('hiển thị một danh sách quỹ phép năm hiện tại với đủ các cột', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    expect(screen.getByRole('heading', { name: 'Quỹ phép' })).toBeTruthy();
    expect(
      screen.getByText(
        /Quỹ phép năm hiện tại của từng nhân viên\. Cách tính phép năm cấu hình tại Cấu hình, Phép năm và lý do nghỉ\./,
      ),
    ).toBeTruthy();
    expect(await screen.findByText('Nguyễn Văn An')).toBeTruthy();
    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    for (const title of [
      'Mã NV',
      'Họ tên',
      'Đơn vị',
      'Được hưởng năm nay',
      'Chuyển từ năm trước',
      'Đã dùng',
      'Chờ duyệt',
      'Còn lại',
    ])
      expect(headers).toContain(title);
    expect(screen.getByText('NV001')).toBeTruthy();
    expect(screen.getByText('Phòng Kinh doanh')).toBeTruthy();
    expect(screen.getByText('Trần Thị Bình')).toBeTruthy();
    expect(screen.getByText('Lê Văn Cường')).toBeTruthy();
    // Dữ liệu của dòng đầu: được hưởng 14, chuyển 2, đã dùng 4, chờ 1, còn lại 10.
    const firstRow = screen.getByText('NV001').closest('tr') as HTMLElement;
    expect(
      within(firstRow)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(
      expect.arrayContaining(['14', '2', '4', '1', '10']),
    );
    // Một lần tải duy nhất, chỉ quỹ phép năm, không có sổ giao dịch toàn tenant hay quyết toán.
    expect(callsTo('/leave-balances')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/leave-balances?year=${year}&annual_only=1`,
    );
    expect(callsTo('/leave-transactions')).toHaveLength(0);
    expect(callsTo('/leave-settlements')).toHaveLength(0);
    expect(callsTo('/leave-types')).toHaveLength(0);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('Quyết toán nghỉ việc')).toBeNull();
    expect(screen.queryByText(/Giao dịch \(mọi năm\)/)).toBeNull();
  });

  it('có dòng tổng hợp và tô màu cảnh báo khi còn lại <= 0 hoặc âm', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    expect(
      screen.getByRole('group', { name: 'Số nhân viên' }).textContent,
    ).toBe('Số nhân viên4');
    expect(
      screen.getByRole('group', { name: 'Tổng đã dùng (ngày)' }).textContent,
    ).toBe('Tổng đã dùng (ngày)29,5');
    expect(
      screen.getByRole('group', { name: 'Người còn lại ≤ 0' }).textContent,
    ).toBe('Người còn lại ≤ 02');
    expect(screen.getByRole('group', { name: 'Chưa có quỹ' }).textContent).toBe(
      'Chưa có quỹ1',
    );

    const zero = screen.getByTitle('Đã hết phép');
    expect(zero.textContent).toBe('0');
    expect(zero.className).toContain('text-amber-700');
    const negative = screen.getByTitle('Đã dùng vượt quỹ phép');
    expect(negative.textContent).toBe('-1,5');
    expect(negative.className).toContain('text-red-700');
    // Dòng còn phép không bị tô cảnh báo.
    const firstRow = screen.getByText('NV001').closest('tr') as HTMLElement;
    const ok = within(firstRow).getByText('10');
    expect(ok.className).not.toContain('text-red-700');
    expect(ok.className).not.toContain('text-amber-700');
  });

  it('đổi năm tải lại đúng tham số year và annual_only=1', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    fireEvent.click(screen.getByDisplayValue(`Năm ${year}`));
    fireEvent.click(
      await screen.findByRole('option', { name: `Năm ${year - 1}` }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/leave-balances?year=${year - 1}&annual_only=1`,
      ),
    );
    expect(await screen.findByDisplayValue(`Năm ${year - 1}`)).toBeTruthy();
  });

  it('tìm theo mã hoặc tên không dấu, không gọi lại API', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    const box = screen.getByLabelText('Tìm theo mã hoặc tên nhân viên');

    fireEvent.change(box, { target: { value: 'tran thi' } });
    expect(await screen.findByText('Trần Thị Bình')).toBeTruthy();
    expect(screen.queryByText('Nguyễn Văn An')).toBeNull();
    expect(screen.queryByText('Lê Văn Cường')).toBeNull();

    fireEvent.change(box, { target: { value: 'nv003' } });
    expect(await screen.findByText('Lê Văn Cường')).toBeTruthy();
    expect(screen.queryByText('Trần Thị Bình')).toBeNull();

    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(
      await screen.findByText('Không có nhân viên nào khớp với từ khóa tìm kiếm.'),
    ).toBeTruthy();
    expect(callsTo('/leave-balances')).toHaveLength(1);
  });

  it('chưa có dòng quỹ nào trong năm thì báo trống thân thiện', async () => {
    mockActions.add('hrm.leave.read');
    route([]);
    render(<LeaveBalancesScreen />);
    expect(
      await screen.findByText(
        new RegExp(`Chưa có dữ liệu quỹ phép năm ${year}`),
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('group', { name: 'Người còn lại ≤ 0' }).textContent,
    ).toBe('Người còn lại ≤ 00');
  });

  it('báo lỗi khi không đọc được quỹ phép', async () => {
    mockActions.add('hrm.leave.read');
    fetchMock.mockRejectedValue(new Error('Máy chủ lỗi'));
    render(<LeaveBalancesScreen />);
    expect(await screen.findByText('Máy chủ lỗi')).toBeTruthy();
  });

  it('Lịch sử mở Drawer và gọi giao dịch của đúng nhân viên trong năm đang xem', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    fireEvent.click(screen.getAllByRole('button', { name: /Lịch sử/ })[0]);

    const drawer = await screen.findByRole('dialog');
    expect(
      within(drawer).getByText('Lịch sử quỹ phép'),
    ).toBeTruthy();
    expect(
      await within(drawer).findByText('Nghỉ phép 2 ngày'),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/leave-transactions?employee_id=e1&year=${year}&leave_type_id=lt1`,
    );
    for (const title of ['Ngày', 'Loại giao dịch', 'Số ngày', 'Ghi chú'])
      expect(within(drawer).getByText(title)).toBeTruthy();
    expect(within(drawer).getByText('10/03/2026')).toBeTruthy();
    expect(within(drawer).getByText('Sử dụng')).toBeTruthy();
    expect(within(drawer).getByText('-2')).toBeTruthy();
    expect(within(drawer).getByText('Điều chỉnh')).toBeTruthy();
    expect(within(drawer).getByText('+1')).toBeTruthy();
    expect(within(drawer).getByText('Bù phép')).toBeTruthy();
    // Không có quyền quản lý thì không có nút đảo điều chỉnh.
    expect(
      within(drawer).queryByRole('button', { name: 'Đảo điều chỉnh' }),
    ).toBeNull();
  });

  it('có hrm.leave.manage: đảo điều chỉnh trong Drawer qua Popconfirm có lý do', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    fireEvent.click(screen.getAllByRole('button', { name: /Lịch sử/ })[0]);
    const drawer = await screen.findByRole('dialog');
    await within(drawer).findByText('Bù phép');
    // Chỉ giao dịch ADJUSTMENT có nút đảo.
    const reverseButtons = within(drawer).getAllByRole('button', {
      name: 'Đảo điều chỉnh',
    });
    expect(reverseButtons).toHaveLength(1);
    fireEvent.click(reverseButtons[0]);

    const confirm = (await within(drawer).findByRole('button', {
      name: 'Xác nhận',
    })) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(
      within(drawer).getByLabelText(/Lý do đảo điều chỉnh/),
      { target: { value: 'Nhập nhầm' } },
    );
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(callsTo('/leave-transactions/tx1/reverse')).toHaveLength(1),
    );
    const [, init] = callsTo('/leave-transactions/tx1/reverse')[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'Nhập nhầm' });
    // Sau khi đảo: tải lại bảng quỹ và lịch sử.
    await waitFor(() => expect(callsTo('/leave-balances')).toHaveLength(2));
  });

  it('có hrm.leave.manage: Điều chỉnh gọi POST /leave-adjustments đúng payload rồi tải lại bảng', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    fireEvent.click(screen.getAllByRole('button', { name: /Điều chỉnh/ })[0]);

    expect(await screen.findByText('Điều chỉnh quỹ phép')).toBeTruthy();
    expect(screen.getByText(/NV001 - Nguyễn Văn An, quỹ phép năm/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Số ngày/), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText(/Ghi chú/), {
      target: { value: 'Bù phép cuối tuần' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));

    await waitFor(() => expect(callsTo('/leave-adjustments')).toHaveLength(1));
    const [path, init] = callsTo('/leave-adjustments')[0];
    expect(path).toBe('/leave-adjustments');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      employeeId: 'e1',
      leaveTypeId: 'lt1',
      year,
      daysAdjusted: 2,
      reason: 'Bù phép cuối tuần',
    });
    expect(body.operationId).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(callsTo('/leave-balances')).toHaveLength(2));
    await waitFor(() =>
      expect(screen.queryByText('Điều chỉnh quỹ phép')).toBeNull(),
    );
  });

  it('Điều chỉnh không gửi khi số ngày bằng 0', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    fireEvent.click(screen.getAllByRole('button', { name: /Điều chỉnh/ })[0]);
    await screen.findByText('Điều chỉnh quỹ phép');
    fireEvent.change(screen.getByLabelText(/Số ngày/), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText(/Ghi chú/), {
      target: { value: 'Thử' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(
      await screen.findByText('Số ngày điều chỉnh phải khác 0'),
    ).toBeTruthy();
    expect(callsTo('/leave-adjustments')).toHaveLength(0);
  });

  it('nhân viên chưa có quỹ: hiện thẻ Chưa có quỹ, số liệu gạch ngang, không có Lịch sử', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Phạm Thị Dung');
    const row = screen.getByText('NV004').closest('tr') as HTMLElement;
    expect(within(row).getByText('Chưa có quỹ')).toBeTruthy();
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(4);
    // Không cảnh báo "hết phép" cho dòng chưa có quỹ.
    expect(within(row).queryByTitle('Đã hết phép')).toBeNull();
    expect(within(row).queryByRole('button', { name: /Lịch sử/ })).toBeNull();
    // Vẫn điều chỉnh được để tạo quỹ.
    expect(
      within(row).getByRole('button', { name: /Điều chỉnh/ }),
    ).toBeTruthy();
    // Ba nhân viên có quỹ có Lịch sử, bốn dòng đều có Điều chỉnh.
    expect(screen.getAllByRole('button', { name: /Lịch sử/ })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /Điều chỉnh/ })).toHaveLength(
      4,
    );
  });

  it('Điều chỉnh cho nhân viên chưa có quỹ gửi đúng nhân viên, loại nghỉ và năm', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Phạm Thị Dung');
    const row = screen.getByText('NV004').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Điều chỉnh/ }));
    expect(await screen.findByText(/chưa có quỹ phép của năm này/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Số ngày/), {
      target: { value: '5' },
    });
    fireEvent.change(screen.getByLabelText(/Ghi chú/), {
      target: { value: 'Khởi tạo quỹ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(callsTo('/leave-adjustments')).toHaveLength(1));
    const body = JSON.parse(String(callsTo('/leave-adjustments')[0][1]?.body));
    expect(body).toMatchObject({
      employeeId: 'e4',
      leaveTypeId: 'lt1',
      year,
      daysAdjusted: 5,
      reason: 'Khởi tạo quỹ',
    });
  });

  it('ẩn Điều chỉnh và liên kết cấu hình khi không có hrm.leave.manage', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    expect(screen.queryByRole('button', { name: /Điều chỉnh/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Cấu hình phép/ })).toBeNull();
    // Vẫn xem được lịch sử.
    expect(screen.getAllByRole('button', { name: /Lịch sử/ })).toHaveLength(3);
  });

  it('có hrm.leave.manage: có liên kết Cấu hình phép tới /settings?view=leave', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    const link = screen.getByRole('link', { name: /Cấu hình phép/ });
    expect(link.getAttribute('href')).toBe('/settings?view=leave');
    expect(screen.getAllByRole('button', { name: /Điều chỉnh/ })).toHaveLength(
      4,
    );
  });

  it('không có hrm.leave.read thì báo thiếu quyền và không gọi API', async () => {
    render(<LeaveBalancesScreen />);
    expect(
      await screen.findByText('Bạn không có quyền xem quỹ phép.'),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
