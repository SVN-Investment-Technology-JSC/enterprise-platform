/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import { downloadCsv } from '../hrm-employee-view';
import EmployeesScreen from './employees-screen';
import { toast } from '../ui/toast';

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
  return { ...actual, hrmFetch: jest.fn(), hrmEmployeeOptions: jest.fn() };
});

jest.mock('../ui/toast', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('../hrm-employee-view', () => {
  const actual = jest.requireActual('../hrm-employee-view');
  return { ...actual, downloadCsv: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const downloadMock = downloadCsv as jest.MockedFunction<typeof downloadCsv>;
const toastSuccess = toast.success as jest.Mock;

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

const employee = {
  employeeId: 'e1',
  tenantId: 't1',
  employeeCode: 'NV001',
  fullName: 'Nguyễn Văn An',
  email: 'an@example.com',
  department: 'Sản xuất',
  position: 'Kỹ sư',
  phone: '0900000000',
  joinDate: '2024-03-01',
  employmentStatus: 'OFFICIAL',
  // Người xem thiếu hrm.employee.sensitive: API trả null cho các trường nhạy cảm
  identityCardNumber: null,
  identityCardIssuedPlace: null,
  taxCode: null,
  socialInsuranceNumber: null,
  bankAccountNumber: null,
  bankName: null,
  bankBranch: null,
  dependents: [],
  contracts: [],
  createdAt: '2024-03-01T00:00:00Z',
  updatedAt: '2024-03-01T00:00:00Z',
};

const position = {
  positionId: 'p1',
  positionCode: 'KS',
  positionName: 'Kỹ sư',
  unit: { id: 'u1', name: 'Sản xuất' },
  salaryGrade: null,
  jdStatus: 'NOT_CONFIGURED',
  responsibilities: [],
  requirements: [],
  active: true,
  activeEmployeeCount: 1,
};

function grant(...keys: string[]) {
  mockActions.clear();
  for (const key of keys) mockActions.add(key);
}

beforeEach(() => {
  fetchMock.mockReset();
  downloadMock.mockReset();
  toastSuccess.mockReset();
  grant('hrm.employee.read');
  fetchMock.mockImplementation((async (path: string) => {
    if (path.startsWith('/employees?')) return { data: [employee], meta: { total: 1 } };
    if (path === '/positions') return { data: [position] };
    return { data: [], meta: { total: 0 } };
  }) as never);
});

describe('EmployeesScreen', () => {
  it('shows exactly two tabs and no salary tabs', async () => {
    render(<EmployeesScreen />);
    expect(await screen.findByText('NV001')).toBeTruthy();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent ?? '');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toContain('Nhân viên');
    expect(tabs[1]).toContain('Chức danh');
    expect(screen.queryByRole('tab', { name: /Ngạch|Thang bảng lương|Cấu hình lương/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([p]) => String(p).startsWith('/salary-grades'))).toBe(false);
  });

  it('switches to the job titles tab', async () => {
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('tab', { name: /Chức danh/ }));
    expect(await screen.findByText('KS')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Chức danh/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('tolerates null sensitive fields and shows a hidden marker in the drawer', async () => {
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ' }));
    const hidden = await screen.findAllByTitle('Bạn không có quyền xem thông tin nhạy cảm');
    // CCCD, MST, BHXH, tài khoản, ngân hàng
    expect(hidden.length).toBeGreaterThanOrEqual(5);
    expect(hidden.every((el) => el.textContent === 'Ẩn')).toBe(true);
  });

  it('shows empty labels instead of the hidden marker for users allowed to see sensitive data', async () => {
    grant('hrm.employee.read', 'hrm.employee.sensitive');
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem hồ sơ' }));
    expect((await screen.findAllByText('Chưa liên kết')).length).toBeGreaterThan(0);
    expect(screen.queryByTitle('Bạn không có quyền xem thông tin nhạy cảm')).toBeNull();
  });

  it('shows the Core-owned note with links and no add-person wording', async () => {
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    const note = screen.getByTestId('core-owned-note');
    expect(note.textContent).toContain('được quản lý tại Core');
    expect(screen.getByRole('link', { name: 'Người dùng' }).getAttribute('href')).toBe('/users');
    expect(screen.getByRole('link', { name: 'Sơ đồ tổ chức' }).getAttribute('href')).toBe('/organization');
    expect(screen.queryByRole('button', { name: /Thêm hồ sơ mới/ })).toBeNull();
  });

  const corePerson = (id: string) => ({
    employeeId: id,
    userId: null,
    fullName: id,
    email: null,
    source: 'employee',
  });
  const withApi = (opts: { pending: number; employees?: unknown[]; refreshed?: number }) =>
    fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path.startsWith('/employees?')) {
        const list = opts.employees ?? [employee];
        return { data: list, meta: { total: list.length } };
      }
      if (path === '/positions') return { data: [position] };
      if (path === '/employees/core-people')
        return { data: Array.from({ length: opts.pending }, (_, i) => corePerson(`c${i}`)) };
      if (path === '/employees/refresh-from-core' && init?.method === 'POST')
        return { data: { updated: opts.refreshed ?? 0 } };
      return { data: [], meta: { total: 0 } };
    }) as never);

  it('shows the primary Core load button with a pending count and no single-create button', async () => {
    grant('hrm.employee.read', 'hrm.employee.manage');
    withApi({ pending: 2 });
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    expect(await screen.findByRole('button', { name: /Nạp nhân sự từ Core/ })).toBeTruthy();
    expect(await screen.findByText('2 chờ')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Khởi tạo hồ sơ HRM/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Khởi tạo hàng loạt/ })).toBeNull();
  });

  it('shows the Core load button even with exactly one pending person', async () => {
    grant('hrm.employee.read', 'hrm.employee.manage');
    withApi({ pending: 1 });
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    expect(await screen.findByRole('button', { name: /Nạp nhân sự từ Core/ })).toBeTruthy();
    expect(await screen.findByText('1 chờ')).toBeTruthy();
  });

  it('hides the Core load button with zero pending people or without manage permission', async () => {
    grant('hrm.employee.read', 'hrm.employee.manage');
    withApi({ pending: 0 });
    const first = render(<EmployeesScreen />);
    await screen.findByText('NV001');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([p]) => String(p) === '/employees/core-people')).toBe(true),
    );
    expect(screen.queryByRole('button', { name: /Nạp nhân sự từ Core/ })).toBeNull();
    first.unmount();

    grant('hrm.employee.read');
    withApi({ pending: 5 });
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    expect(screen.queryByRole('button', { name: /Nạp nhân sự từ Core/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cập nhật từ Core' })).toBeNull();
  });

  it('shows a prominent empty state with the load button when there are no profiles but people are pending', async () => {
    grant('hrm.employee.read', 'hrm.employee.manage');
    withApi({ pending: 3, employees: [] });
    render(<EmployeesScreen />);
    expect(
      await screen.findByText(/Chưa có hồ sơ HRM\. 3 người đã khai báo ở Core đang chờ nạp\./),
    ).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: /Nạp nhân sự từ Core/ });
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText('Nạp nhân sự từ Core', { selector: 'h2' })).toBeTruthy();
  });

  it('refreshes names and emails from Core via the secondary button', async () => {
    grant('hrm.employee.read', 'hrm.employee.manage');
    withApi({ pending: 0, refreshed: 4 });
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật từ Core' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([p, init]) => p === '/employees/refresh-from-core' && init?.method === 'POST',
        ),
      ).toBe(true),
    );
    expect(toastSuccess).toHaveBeenCalledWith('Đã cập nhật 4 nhân sự theo Core');
  });

  it('reports when Core data already matches', async () => {
    grant('hrm.employee.read', 'hrm.employee.manage');
    withApi({ pending: 0, refreshed: 0 });
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật từ Core' }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Họ tên và email đã khớp với Core'),
    );
  });

  it('does not call core-people without manage permission', async () => {
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    expect(fetchMock.mock.calls.some(([p]) => String(p) === '/employees/core-people')).toBe(false);
  });

  it('ignores core-people errors silently', async () => {
    grant('hrm.employee.read', 'hrm.employee.manage');
    fetchMock.mockImplementation((async (path: string) => {
      if (path.startsWith('/employees?')) return { data: [employee], meta: { total: 1 } };
      if (path === '/positions') return { data: [position] };
      if (path === '/employees/core-people') throw new Error('boom');
      return { data: [], meta: { total: 0 } };
    }) as never);
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    expect(screen.queryByText(/chờ$/)).toBeNull();
    expect(screen.queryByText('boom')).toBeNull();
  });

  it('exports the filtered list as CSV without sensitive columns', async () => {
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const [fileName, csv] = downloadMock.mock.calls[0];
    expect(fileName).toMatch(/^danh-sach-nhan-vien-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv).toContain('NV001,Nguyễn Văn An,an@example.com,Kỹ sư,Sản xuất,2024-03-01,Chính thức');
    expect(csv).not.toMatch(/CCCD|Mã số thuế|BHXH|ngân hàng/i);
  });
});
