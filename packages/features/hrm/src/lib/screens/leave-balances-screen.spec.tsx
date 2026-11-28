/** @jest-environment jsdom */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import { downloadStyledXlsx } from '../hrm-xlsx';
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

jest.mock('../hrm-xlsx', () => {
  const actual = jest.requireActual('../hrm-xlsx');
  return { ...actual, downloadStyledXlsx: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const downloadMock = downloadStyledXlsx as jest.MockedFunction<typeof downloadStyledXlsx>;

// Bảng lịch sử trong Drawer dùng antd Table, cần matchMedia, ResizeObserver và getComputedStyle(elt, pseudoElt), jsdom chưa hỗ trợ.
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

function route(rows: unknown[] = balances, carryover?: { allowed: boolean; expiryMonth: number }) {
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (path === '/annual-leave-policy')
      return { policy: carryover ? { carryover: { maxDays: 5, ...carryover } } : null };
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

/** Bấm vào dòng của một nhân viên để mở Drawer quỹ phép. */
function openRow(employeeName: string) {
  fireEvent.click(screen.getByRole('row', { name: `Xem quỹ phép ${employeeName}` }));
}

beforeEach(() => {
  mockActions.clear();
  fetchMock.mockReset();
  downloadMock.mockReset();
  route();
});

describe('LeaveBalancesScreen', () => {
  it('chính sách tắt lũy kế: không có cột Lũy kế', async () => {
    mockActions.add('hrm.leave.read');
    route(balances, { allowed: false, expiryMonth: 3 });
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).not.toContain('Lũy kế');
  });

  it('chính sách bật lũy kế: có cột Lũy kế, hiện phép dư năm cũ và gắn giải thích hết hạn sau X tháng', async () => {
    mockActions.add('hrm.leave.read');
    route(
      [balance({ carryover: 2, carryoverRemaining: 1, carryoverExpiryDate: '2026-06-30' })],
      { allowed: true, expiryMonth: 6 },
    );
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Lũy kế');
    expect(screen.getByRole('button', { name: 'Giải thích Lũy kế' })).toBeTruthy();
    expect(within(screen.getByTestId('leave-row-e1')).getByText('còn 1')).toBeTruthy();
  });

  it('giữ ngày ký HĐLĐ làm căn cứ tính phép; ngày ký HĐLĐ hiện dưới tên nhân viên', async () => {
    mockActions.add('hrm.leave.read');
    route([
      balance({ seniorityDays: 2, seniorityTierYears: 10, signDate: '2016-07-10', eligibleFrom: '2016-07-10' }),
      balance({
        id: 'b2',
        employeeId: 'e2',
        employeeCode: 'NV002',
        employeeName: 'Trần Thị Bình',
        seniorityDays: 0,
        signDate: null,
      }),
    ]);
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Còn tồn');
    expect(
      screen.getByRole('button', { name: 'Giải thích Còn tồn' }),
    ).toBeTruthy();
    const first = screen.getByTestId('leave-row-e1');
    expect(within(first).getByText('Ký HĐLĐ 10/07/2016')).toBeTruthy();
    // Chưa có HĐLĐ chính thức: nói rõ vì sao chưa có phép.
    expect(
      within(screen.getByTestId('leave-row-e2')).getAllByText('Chưa có HĐLĐ'),
    ).toHaveLength(2);
  });

  it('hiển thị tiêu đề và bảng quỹ phép năm đủ các cột, không còn phân trang', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    expect(screen.getByRole('heading', { name: 'Phép năm' })).toBeTruthy();
    expect(await screen.findByText('Nguyễn Văn An')).toBeTruthy();
    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    for (const title of [
      'Tên nhân viên',
      'Phòng ban',
      'Còn tồn',
      'Đã dùng',
      'Có thể ứng',
      'Tổng',
      'Đã điều chỉnh',
      'Trạng thái quỹ',
    ])
      expect(headers).toContain(title);
    for (const gone of ['Thao tác', 'Chờ duyệt', 'Tổng quỹ năm', 'Có thể dùng', 'Thâm niên'])
      expect(headers).not.toContain(gone);
    for (const name of [
      'Còn tồn',
      'Đã dùng',
      'Có thể ứng',
      'Tổng',
      'Đã điều chỉnh',
      'Trạng thái quỹ',
    ])
      expect(
        screen.getByRole('button', { name: `Giải thích ${name}` }),
      ).toBeTruthy();
    expect(screen.queryByText('NV001')).toBeNull();
    expect(screen.getByText('Trần Thị Bình')).toBeTruthy();
    expect(screen.getByText('Lê Văn Cường')).toBeTruthy();
    // Dòng đầu: còn tồn 10, đã dùng 4 + chờ 1 = 5, không cho ứng 0, tổng 10, điều chỉnh 0.
    const firstRow = screen.getByTestId('leave-row-e1');
    expect(
      within(firstRow)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(expect.arrayContaining(['10', '5', '0']));
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

  it('chỉ mở chú thích cột khi bấm dấu hỏi màu vàng, hiển thị nổi trên bảng', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');

    const help = screen.getByRole('button', {
      name: 'Giải thích Có thể ứng',
    });
    expect(help.className).toContain('cursor-pointer');
    expect(help.className).toContain('text-amber-500');
    expect(
      screen.queryByText(/Số ngày còn được ứng trước/),
    ).toBeNull();

    fireEvent.click(help);
    const popup = await screen.findByText(/Số ngày còn được ứng trước/);
    expect(popup.className).toContain('z-[100]');
  });

  it('hiện phòng ban thành cột, xếp theo phòng ban (chưa có phòng ban đứng cuối) rồi theo tên, không còn dòng nhóm', async () => {
    mockActions.add('hrm.leave.read');
    route([
      balance({ adjusted: 2, remaining: 10 }),
      balance({
        id: 'b5',
        employeeId: 'e5',
        employeeCode: 'NV005',
        employeeName: 'Hoàng Minh Em',
        remaining: 5,
      }),
      balance({
        id: 'b3',
        employeeId: 'e3',
        employeeCode: 'NV003',
        employeeName: 'Lê Văn Cường',
        department: '  ',
        remaining: 9,
      }),
      balance({
        id: 'b2',
        employeeId: 'e2',
        employeeCode: 'NV002',
        employeeName: 'Trần Thị Bình',
        department: 'Phòng Kế toán',
        remaining: 11,
      }),
    ]);
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');

    expect(screen.queryAllByTestId('leave-group-row')).toHaveLength(0);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Phòng ban');
    const order = [...document.querySelectorAll('[data-testid^="leave-row-"]')].map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(order).toEqual(['leave-row-e2', 'leave-row-e5', 'leave-row-e1', 'leave-row-e3']);
    expect(within(screen.getByTestId('leave-row-e3')).getByText('Chưa có phòng ban')).toBeTruthy();
    expect(within(screen.getByTestId('leave-row-e2')).getByText('Phòng Kế toán')).toBeTruthy();
  });

  it('lọc theo phòng ban bằng ô chọn phòng ban', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');

    fireEvent.click(screen.getByDisplayValue('Phòng ban: Tất cả'));
    fireEvent.click(await screen.findByRole('option', { name: 'Phòng Kế toán' }));
    expect(await screen.findByText('Trần Thị Bình')).toBeTruthy();
    expect(screen.queryByText('Nguyễn Văn An')).toBeNull();
  });

  it('không còn bốn thẻ số liệu tổng quan (tổng nhân viên, tổng quỹ phép, đã sử dụng, chờ duyệt)', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    for (const name of ['Tổng nhân viên', 'Tổng quỹ phép', 'Đã sử dụng', 'Chờ duyệt'])
      expect(screen.queryByRole('group', { name })).toBeNull();
  });

  it('tô màu Còn tồn: xanh khi còn phép, cam khi hết, đỏ khi âm; trạng thái quỹ diễn giải tình trạng', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');

    const chip = (row: HTMLElement, text: string, tone: string) =>
      within(row)
        .getAllByText(text)
        .find((el) => el.className.includes(tone));
    const firstRow = screen.getByTestId('leave-row-e1');
    expect(chip(firstRow, '10', 'text-emerald-700')).toBeTruthy();
    expect(chip(screen.getByTestId('leave-row-e2'), '0', 'text-amber-700')).toBeTruthy();
    expect(chip(screen.getByTestId('leave-row-e3'), '-1,5', 'text-red-700')).toBeTruthy();
    expect(within(firstRow).getByText('Còn phép')).toBeTruthy();
    expect(
      within(screen.getByTestId('leave-row-e2')).getByText('Đã hết phép'),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('leave-row-e3')).getByText('Vượt quỹ'),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('leave-row-e4')).getAllByText('Chưa có quỹ'),
    ).toHaveLength(1);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('phân biệt chính xác giữa Còn phép và Đang ứng phép theo Phương án A', async () => {
    mockActions.add('hrm.leave.read');
    route([
      // Nhân viên 1: advanceAllowed = true, nhưng đã dùng (2) <= tích luỹ (3) -> Còn phép
      balance({
        id: 'b1',
        employeeId: 'e1',
        employeeCode: 'NV001',
        employeeName: 'Nguyễn Văn An',
        entitledToDate: 3,
        accrued: 3,
        entitlement: 12,
        used: 2,
        pending: 0,
        remaining: 10,
        advanceAllowed: true,
      }),
      // Nhân viên 2: advanceAllowed = true, đã dùng (5) > tích luỹ (3) -> Đang ứng phép
      balance({
        id: 'b2',
        employeeId: 'e2',
        employeeCode: 'NV002',
        employeeName: 'Trần Thị Bình',
        entitledToDate: 3,
        accrued: 3,
        entitlement: 12,
        used: 4,
        pending: 1,
        remaining: 7,
        advanceAllowed: true,
      }),
    ]);

    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');

    const row1 = screen.getByTestId('leave-row-e1');
    expect(within(row1).getByText('Còn phép')).toBeTruthy();

    const row2 = screen.getByTestId('leave-row-e2');
    expect(within(row2).getByText('Đang ứng phép')).toBeTruthy();
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

  it('tìm theo mã hoặc tên không dấu, không gọi lại API, chỉ còn nhân viên khớp', async () => {
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
      await screen.findByText(
        'Không có nhân viên nào khớp với bộ lọc hiện tại.',
      ),
    ).toBeTruthy();
    expect(callsTo('/leave-balances')).toHaveLength(1);
  });

  it('lọc theo trạng thái: còn phép, đã hết phép, vượt quỹ, chưa có quỹ', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');

    const choose = async (from: string, label: string) => {
      fireEvent.click(screen.getByDisplayValue(from));
      fireEvent.click(await screen.findByRole('option', { name: label }));
    };

    await choose('Tất cả trạng thái', 'Đã hết phép');
    expect(await screen.findByDisplayValue('Đã hết phép')).toBeTruthy();
    expect(screen.getByText('Trần Thị Bình')).toBeTruthy();
    expect(screen.queryByText('Nguyễn Văn An')).toBeNull();
    expect(screen.queryByText('Lê Văn Cường')).toBeNull();
    expect(screen.queryByText('Phạm Thị Dung')).toBeNull();

    await choose('Đã hết phép', 'Vượt quỹ phép');
    expect(await screen.findByText('Lê Văn Cường')).toBeTruthy();
    expect(screen.queryByText('Trần Thị Bình')).toBeNull();

    await choose('Vượt quỹ phép', 'Chưa có quỹ');
    expect(await screen.findByText('Phạm Thị Dung')).toBeTruthy();
    expect(screen.queryByText('Lê Văn Cường')).toBeNull();

    await choose('Chưa có quỹ', 'Còn phép');
    expect(await screen.findByText('Nguyễn Văn An')).toBeTruthy();
    expect(screen.queryByText('Phạm Thị Dung')).toBeNull();
    expect(screen.queryByText('Trần Thị Bình')).toBeNull();
    expect(callsTo('/leave-balances')).toHaveLength(1);
  });

  it('Làm mới tải lại quỹ phép', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    fireEvent.click(screen.getByRole('button', { name: /Làm mới/ }));
    await waitFor(() => expect(callsTo('/leave-balances')).toHaveLength(2));
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
      (screen.getByRole('button', { name: /Xuất Excel/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('báo lỗi khi không đọc được quỹ phép', async () => {
    mockActions.add('hrm.leave.read');
    fetchMock.mockRejectedValue(new Error('Máy chủ lỗi'));
    render(<LeaveBalancesScreen />);
    expect(await screen.findByText('Máy chủ lỗi')).toBeTruthy();
  });

  it('Xuất Excel tải Excel của danh sách đang lọc, gom theo phòng ban', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));

    expect(downloadMock).toHaveBeenCalledTimes(1);
    const [fileName, sheet] = downloadMock.mock.calls[0];
    expect(fileName).toBe(`phep-nam-${year}`);
    expect(sheet.rows[0][0]).toBe(`QUỸ PHÉP NĂM ${year}`);
    expect(sheet.rows[1]).toEqual([
      'STT', 'Mã NV', 'Họ và tên', 'Phòng ban', 'Năm', 'Còn tồn', 'Đã dùng', 'Có thể ứng', 'Tổng', 'Đã điều chỉnh', 'Trạng thái quỹ',
    ]);
    const body = sheet.rows.slice(2);
    expect(body).toHaveLength(4);
    // Thứ tự theo nhóm: Kế toán, Kinh doanh, Nhân sự, Chưa có phòng ban.
    expect(body[0]).toEqual([1, 'NV002', 'Trần Thị Bình', 'Phòng Kế toán', year, 0, 12, 0, 0, 0, 'Đã hết phép']);
    expect(body[1]).toEqual([2, 'NV001', 'Nguyễn Văn An', 'Phòng Kinh doanh', year, 10, 5, 0, 10, 0, 'Còn phép']);
    expect(body[2]).toEqual([3, 'NV004', 'Phạm Thị Dung', 'Phòng Nhân sự', year, '', '', '', '', '', 'Chưa có quỹ']);
    expect(body[3]).toEqual([4, 'NV003', 'Lê Văn Cường', 'Chưa có phòng ban', year, -1.5, 13.5, 0, -1.5, 0, 'Vượt quỹ']);
  });

  it('Xuất Excel chỉ gồm kết quả đang lọc và những nhân viên đã tick chọn', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');

    fireEvent.change(screen.getByLabelText('Tìm theo mã hoặc tên nhân viên'), {
      target: { value: 'van' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));
    const codes = (call: number) => downloadMock.mock.calls[call][1].rows.slice(2).map((r: readonly unknown[]) => r[1]);
    let csv = codes(0);
    expect(csv).toContain('NV001');
    expect(csv).toContain('NV003');
    expect(csv).not.toContain('NV002');
    expect(csv).not.toContain('NV004');

    fireEvent.click(screen.getByLabelText('Chọn Lê Văn Cường'));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel (1)' }));
    csv = codes(1);
    expect(csv).toContain('NV003');
    expect(csv).not.toContain('NV001');
  });

  it('Bấm vào dòng mở Drawer và gọi giao dịch của đúng nhân viên trong năm đang xem', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    openRow('Nguyễn Văn An');

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Lịch sử quỹ phép')).toBeTruthy();
    expect(await within(drawer).findByText('Nghỉ phép 2 ngày')).toBeTruthy();
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
    openRow('Nguyễn Văn An');
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
    fireEvent.change(within(drawer).getByLabelText(/Lý do đảo điều chỉnh/), {
      target: { value: 'Nhập nhầm' },
    });
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

  it('Drawer nhận diện giao dịch điều chỉnh đã đảo và hiển thị nhãn Đã đảo điều chỉnh thay vì nút bấm', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    route();
    fetchMock.mockImplementation((async (path: string) => {
      if (path.startsWith('/leave-balances')) return { data: balances };
      if (path.startsWith('/leave-transactions')) {
        return {
          data: [
            {
              id: 'rev1',
              tenantId: 't',
              employeeId: 'e1',
              leaveTypeId: 'lt1',
              transactionType: 'REVERSAL',
              daysChanged: -1,
              balanceAfter: 11,
              note: 'Đảo tx1: Nhập nhầm',
              operationKey: 'reverse-adjustment:tx1',
              balanceYear: year,
              createdAt: '2026-02-15T05:00:00.000Z',
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
          ],
        };
      }
      throw new Error(`unexpected ${path}`);
    }) as never);

    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    openRow('Nguyễn Văn An');
    const drawer = await screen.findByRole('dialog');
    await within(drawer).findByText('Bù phép');

    // Không còn nút Đảo điều chỉnh vì tx1 đã có bút toán đảo rev1
    expect(within(drawer).queryByRole('button', { name: 'Đảo điều chỉnh' })).toBeNull();
    expect(within(drawer).getByText('Đã đảo điều chỉnh')).toBeTruthy();
  });

  it('có hrm.leave.manage: điều chỉnh ngay trong Drawer, gọi POST /leave-adjustments đúng payload rồi tải lại bảng', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    openRow('Nguyễn Văn An');
    const drawer = await screen.findByRole('dialog');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Điều chỉnh' }));

    fireEvent.change(within(drawer).getByLabelText(/Số ngày/), {
      target: { value: '2' },
    });
    fireEvent.change(within(drawer).getByLabelText('Ghi chú'), {
      target: { value: 'Bù phép cuối tuần' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Lưu điều chỉnh' }));

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
    // Không mở form riêng: Drawer vẫn mở, biểu mẫu đóng lại.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await waitFor(() =>
      expect(within(drawer).queryByRole('button', { name: 'Lưu điều chỉnh' })).toBeNull(),
    );
  });

  it('Điều chỉnh không gửi khi số ngày bằng 0 hoặc thiếu ghi chú', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    openRow('Nguyễn Văn An');
    const drawer = await screen.findByRole('dialog');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Điều chỉnh' }));
    fireEvent.change(within(drawer).getByLabelText(/Số ngày/), {
      target: { value: '0' },
    });
    fireEvent.change(within(drawer).getByLabelText('Ghi chú'), {
      target: { value: 'Thử' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Lưu điều chỉnh' }));
    expect(
      await within(drawer).findByText('Số ngày điều chỉnh phải khác 0'),
    ).toBeTruthy();

    fireEvent.change(within(drawer).getByLabelText(/Số ngày/), {
      target: { value: '1' },
    });
    fireEvent.change(within(drawer).getByLabelText('Ghi chú'), {
      target: { value: '  ' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Lưu điều chỉnh' }));
    expect(await within(drawer).findByText('Cần nhập ghi chú')).toBeTruthy();
    expect(callsTo('/leave-adjustments')).toHaveLength(0);
  });

  it('nhân viên chưa có quỹ: hiện thẻ Chưa có quỹ, số liệu gạch ngang, không còn cột thao tác', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Phạm Thị Dung');
    const row = screen.getByTestId('leave-row-e4');
    expect(within(row).getAllByText('Chưa có quỹ')).toHaveLength(1);
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(5);
    // Không cảnh báo "hết phép" cho dòng chưa có quỹ.
    expect(within(row).queryByTitle('Đã hết phép')).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^Thao tác / })).toHaveLength(0);
  });

  it('Điều chỉnh cho nhân viên chưa có quỹ gửi đúng nhân viên, loại nghỉ và năm', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Phạm Thị Dung');
    openRow('Phạm Thị Dung');
    const drawer = await screen.findByRole('dialog');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Điều chỉnh' }));
    expect(await within(drawer).findByText(/chưa có quỹ phép của năm này/)).toBeTruthy();
    fireEvent.change(within(drawer).getByLabelText(/Số ngày/), {
      target: { value: '5' },
    });
    fireEvent.change(within(drawer).getByLabelText('Ghi chú'), {
      target: { value: 'Khởi tạo quỹ' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Lưu điều chỉnh' }));
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

  it('không có hrm.leave.manage: Drawer không có nút Điều chỉnh, ẩn Cấu hình phép', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    expect(screen.queryByRole('link', { name: /Cấu hình phép/ })).toBeNull();
    openRow('Nguyễn Văn An');
    const drawer = await screen.findByRole('dialog');
    await within(drawer).findByText('Bù phép');
    expect(within(drawer).queryByRole('button', { name: 'Điều chỉnh' })).toBeNull();
  });

  it('có hrm.leave.manage: có liên kết Cấu hình phép tới /settings?view=leave', async () => {
    mockActions.add('hrm.leave.read');
    mockActions.add('hrm.leave.manage');
    render(<LeaveBalancesScreen />);
    await screen.findByText('Nguyễn Văn An');
    const link = screen.getByRole('link', { name: /Cấu hình phép/ });
    expect(link.getAttribute('href')).toBe('/settings?view=leave');
  });

  it('không có hrm.leave.read thì báo thiếu quyền và không gọi API', async () => {
    render(<LeaveBalancesScreen />);
    expect(
      await screen.findByText('Bạn không có quyền xem quỹ phép.'),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Xuất Excel/ })).toBeNull();
  });
});
