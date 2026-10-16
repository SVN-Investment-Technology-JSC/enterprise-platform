/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import { downloadEmployeesXlsx } from '../hrm-employee-view';
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
  return { ...actual, downloadEmployeesXlsx: jest.fn() };
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const downloadMock = downloadEmployeesXlsx as jest.MockedFunction<typeof downloadEmployeesXlsx>;
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
  it('không còn tab Chức danh: chức danh của mỗi người do Core quản lý, trang không gọi danh mục chức danh và ngạch lương', async () => {
    render(<EmployeesScreen />);
    expect(await screen.findByText('NV001')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('tab', { name: /Chức danh|Ngạch|Thang bảng lương|Cấu hình lương/ })).toBeNull();
    expect(
      fetchMock.mock.calls.some(([p]) => String(p).startsWith('/positions') || String(p).startsWith('/salary-grades')),
    ).toBe(false);
    // Chức danh của từng người vẫn hiện trong bảng
    expect(screen.getByText('Kỹ sư')).toBeTruthy();
  });

  it('tolerates null sensitive fields and shows a hidden marker in the drawer', async () => {
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết' }));
    const hidden = await screen.findAllByTitle('Bạn không có quyền xem thông tin nhạy cảm');
    // CCCD, MST, BHXH, tài khoản, ngân hàng
    expect(hidden.length).toBeGreaterThanOrEqual(5);
    expect(hidden.every((el) => el.textContent === 'Ẩn')).toBe(true);
  });

  it('shows empty labels instead of the hidden marker for users allowed to see sensitive data', async () => {
    grant('hrm.employee.read', 'hrm.employee.sensitive');
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết' }));
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
    const [rows, labels, fileName] = downloadMock.mock.calls[0];
    expect(fileName).toMatch(/^danh-sach-nhan-vien-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(rows.map((r) => r.employeeCode)).toEqual(['NV001']);
    expect(labels[rows[0].employmentStatus]).toBe('Chính thức');
  });

  const person = (n: number, over: Record<string, unknown> = {}) => ({
    ...employee,
    employeeId: `p${n}`,
    employeeCode: `NV${String(n).padStart(3, '0')}`,
    fullName: `Nhân viên ${n}`,
    email: `nv${n}@example.com`,
    department: n % 2 ? 'Phòng Kinh doanh' : 'Phòng Kỹ thuật',
    position: n % 2 ? 'Chuyên viên' : 'Kỹ sư',
    joinDate: '2022-01-01',
    ...over,
  });
  const withEmployees = (list: unknown[]) =>
    fetchMock.mockImplementation((async (path: string) => {
      if (path.startsWith('/employees?')) return { data: list, meta: { total: list.length } };
      if (path === '/positions') return { data: [position] };
      return { data: [], meta: { total: 0 } };
    }) as never);
  const bodyText = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

  it('bốn thẻ tổng quan: tổng, đang làm việc, nghỉ việc, chờ hoàn thiện hồ sơ', async () => {
    withEmployees([
      person(1),
      person(2),
      person(3, { employmentStatus: 'RESIGNED' }),
      person(4, { employmentStatus: 'TERMINATED' }),
    ]);
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    const stat = (key: string) => screen.getByTestId(`employee-stat-${key}`).textContent ?? '';
    expect(stat('total')).toContain('4');
    expect(stat('active')).toContain('2');
    expect(stat('active')).not.toContain('%');
    expect(stat('inactive')).toContain('2');
    expect(stat('incomplete')).toContain('Chờ hoàn thiện hồ sơ');
  });

  it('bấm thẻ tổng quan lọc danh sách nhân sự theo nhóm của thẻ; bấm lại để bỏ lọc', async () => {
    withEmployees([person(1), person(2), person(3, { employmentStatus: 'RESIGNED' }), person(4, { employmentStatus: 'TERMINATED' })]);
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('button', { name: 'Lọc danh sách: Nghỉ việc' }));
    expect(screen.getAllByRole('button', { name: 'Xem chi tiết' })).toHaveLength(2);
    expect(screen.getByText('NV003')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lọc danh sách: Nghỉ việc' }));
    expect(screen.getAllByRole('button', { name: 'Xem chi tiết' })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Lọc danh sách: Đang làm việc' }));
    expect(screen.getAllByRole('button', { name: 'Xem chi tiết' })).toHaveLength(2);
  });

  it('lọc theo phòng ban và trạng thái; thẻ tổng quan không đổi theo bộ lọc', async () => {
    withEmployees([person(1), person(2), person(3), person(4, { employmentStatus: 'RESIGNED' })]);
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    expect(screen.getAllByRole('button', { name: 'Xem chi tiết' })).toHaveLength(4);
    fireEvent.click(screen.getByDisplayValue('Phòng ban: Tất cả'));
    fireEvent.click(await screen.findByRole('option', { name: 'Phòng Kỹ thuật', hidden: true }));
    expect(screen.getAllByRole('button', { name: 'Xem chi tiết' })).toHaveLength(2);
    expect(screen.getByTestId('employee-stat-total').textContent).toContain('4');
    fireEvent.click(screen.getByDisplayValue('Trạng thái: Tất cả'));
    fireEvent.click(await screen.findByRole('option', { name: 'Đã nghỉ việc', hidden: true }));
    expect(screen.getAllByRole('button', { name: 'Xem chi tiết' })).toHaveLength(1);
    expect(screen.getByText('NV004')).toBeTruthy();
  });

  it('phân trang 12 nhân viên mỗi trang và hiển thị khoảng đang xem', async () => {
    withEmployees(Array.from({ length: 30 }, (_, i) => person(i + 1)));
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    expect(screen.getAllByRole('button', { name: 'Xem chi tiết' })).toHaveLength(12);
    expect(bodyText()).toContain('Hiển thị 1 - 12 trong 30 nhân sự');
    fireEvent.click(screen.getByRole('button', { name: 'Trang 3' }));
    expect(screen.getAllByRole('button', { name: 'Xem chi tiết' })).toHaveLength(6);
    expect(bodyText()).toContain('Hiển thị 25 - 30 trong 30 nhân sự');
    expect(screen.getByText('NV030')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
    expect(screen.getByText('NV013')).toBeTruthy();
  });

  it('tick chọn nhân viên thì Xuất Excel chỉ xuất người đã chọn; chọn cả trang bằng ô đầu bảng', async () => {
    withEmployees([person(1), person(2), person(3)]);
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Nhân viên 2' }));
    fireEvent.click(screen.getByRole('button', { name: /Xuất Excel \(1\)/ }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    const exported = downloadMock.mock.calls[0][0].map((r) => r.employeeCode);
    expect(exported).toContain('NV002');
    expect(exported).not.toContain('NV001');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn tất cả nhân viên trong trang' }));
    expect(screen.getByRole('button', { name: /Xuất Excel \(3\)/ })).toBeTruthy();
  });

  it('bảng chỉ để nút Xem chi tiết, không còn menu thao tác ngoài dòng; click vào Mã NV hoặc Họ tên cũng mở Drawer', async () => {
    grant('hrm.employee.read', 'hrm.employee.manage', 'hrm.appointment.manage');
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    // Không còn nút menu thao tác khác bên ngoài bảng
    expect(screen.queryByRole('button', { name: 'Thao tác khác' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Xem chi tiết' })).toBeTruthy();

    // Click vào Mã NV mở Drawer
    fireEvent.click(screen.getByRole('button', { name: 'NV001' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Click vào Họ và tên cũng mở Drawer
    fireEvent.click(screen.getByRole('button', { name: /Nguyễn Văn An/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('nút Sửa trên Drawer kích hoạt chế độ chỉnh sửa trực tiếp với highlight nổi bật', async () => {
    grant('hrm.employee.read', 'hrm.employee.manage');
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết' }));
    const dialog = await screen.findByRole('dialog');

    // Bấm Sửa hồ sơ ở footer bật chế độ chỉnh sửa
    const editBtn = within(dialog).getByRole('button', { name: 'Sửa hồ sơ' });
    fireEvent.click(editBtn);

    // Xuất hiện chỉ báo và banner highlight chế độ chỉnh sửa đang bật
    expect(within(dialog).getByText('Đang ở chế độ chỉnh sửa')).toBeTruthy();
    expect(within(dialog).getByText('Chế độ chỉnh sửa trực tiếp đang bật')).toBeTruthy();
    expect(within(dialog).getAllByRole('button', { name: 'Lưu thay đổi' }).length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByRole('button', { name: 'Hủy' }).length).toBeGreaterThanOrEqual(1);

    // Bấm Hủy quay lại chế độ xem bình thường
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Hủy' })[0]);
    expect(within(dialog).queryByText('Chế độ chỉnh sửa trực tiếp đang bật')).toBeNull();
  });

  it('hồ sơ nhân sự là drawer: ba khối gọn, mức hoàn thiện và ba tab giấy tờ, người phụ thuộc, hợp đồng', async () => {
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Nguyễn Văn An')).toBeTruthy();
    for (const title of ['Thông tin cá nhân', 'Quan hệ lao động', 'Liên hệ khẩn cấp', 'Tài chính nhân sự & thuế'])
      expect(within(dialog).getByRole('region', { name: title })).toBeTruthy();
    expect(within(dialog).getByRole('progressbar', { name: 'Mức hoàn thiện hồ sơ' })).toBeTruthy();
    const tabs = within(dialog).getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Ảnh và giấy tờ', 'Người phụ thuộc (0)', 'Hợp đồng (0)']);
    expect(within(dialog).getByTestId('employee-tab-documents')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('tab', { name: /Hợp đồng/ }));
    expect(within(dialog).getByTestId('employee-tab-contracts')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('số người phụ thuộc và hợp đồng trên tab hiện ngay khi mở hồ sơ, không cần bấm vào tab', async () => {
    // Danh sách /employees không kèm người phụ thuộc và hợp đồng; hồ sơ chi tiết mới có.
    fetchMock.mockImplementation((async (path: string) => {
      if (path.startsWith('/employees?')) return { data: [{ ...employee, dependents: undefined, contracts: undefined }], meta: { total: 1 } };
      if (path === '/employees/e1/profile')
        return {
          data: {
            ...employee,
            dependents: [{ id: 'd1', fullName: 'Con A' }, { id: 'd2', fullName: 'Con B' }],
            contracts: [{ id: 'c1' }],
          },
        };
      return { data: [], meta: { total: 0 } };
    }) as never);
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getAllByRole('tab').map((t) => t.textContent)).toEqual([
        'Ảnh và giấy tờ',
        'Người phụ thuộc (2)',
        'Hợp đồng (1)',
      ]),
    );
    expect(within(dialog).getByTestId('employee-tab-documents')).toBeTruthy();
  });

  it('trong chế độ xem không hiện các nút thêm dữ liệu/tệp ở các tab; chỉ khi sang chế độ sửa mới hiển thị', async () => {
    grant('hrm.employee.read', 'hrm.employee.manage');
    fetchMock.mockImplementation((async (path: string) => {
      if (path.startsWith('/employees?')) return { data: [employee], meta: { total: 1 } };
      if (path === '/employees/e1/profile')
        return { data: { ...employee, dependents: [], contracts: [] } };
      if (path === '/employees/e1/profile-documents')
        return { data: { missingRequired: [], qualifications: [] } };
      return { data: [], meta: { total: 0 } };
    }) as never);
    render(<EmployeesScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('button', { name: 'Xem chi tiết' }));
    const dialog = await screen.findByRole('dialog');

    // Tab 1: Ảnh và giấy tờ - ở chế độ xem không có nút Thay tệp / Tải lên / Thêm bằng cấp
    expect(within(dialog).queryByRole('button', { name: 'Thay tệp' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Tải lên' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /Thêm/ })).toBeNull();

    // Tab 2: Người phụ thuộc - ở chế độ xem không có nút Thêm người thân
    fireEvent.click(within(dialog).getByRole('tab', { name: /Người phụ thuộc/ }));
    expect(within(dialog).queryByRole('button', { name: 'Thêm người thân' })).toBeNull();

    // Tab 3: Hợp đồng - ở chế độ xem không có nút Thêm hợp đồng
    fireEvent.click(within(dialog).getByRole('tab', { name: /Hợp đồng/ }));
    expect(within(dialog).queryByRole('button', { name: 'Thêm hợp đồng' })).toBeNull();

    // Bật chế độ sửa
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sửa hồ sơ' }));

    // Lúc này các nút thêm đã hiển thị
    expect(within(dialog).getByRole('button', { name: 'Thêm hợp đồng' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('tab', { name: /Người phụ thuộc/ }));
    expect(within(dialog).getByRole('button', { name: 'Thêm người thân' })).toBeTruthy();
  });
});
