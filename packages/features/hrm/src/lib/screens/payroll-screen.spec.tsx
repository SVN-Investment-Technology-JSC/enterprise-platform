/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import PayrollScreen from './payroll-screen';

let mockAllowed = new Set<string>();
jest.mock('../hrm-permissions', () => ({
  useHrmPermissions: () => ({
    actions: [...mockAllowed],
    loading: false,
    error: '',
    displayName: '',
    can: (a: string) => mockAllowed.has(a),
    any: (list: readonly string[]) => list.some((a) => mockAllowed.has(a)),
  }),
}));
jest.mock('../hrm-api', () => {
  const actual = jest.requireActual('../hrm-api');
  return { ...actual, hrmFetch: jest.fn(), downloadHrmExport: jest.fn() };
});
jest.mock('../ui/payroll-trace-drawer', () => ({ PayrollTraceDrawer: () => null }));
jest.mock('xlsx', () => ({ utils: {}, writeFile: jest.fn() }));

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
  window.getComputedStyle = ((elt: Element) => nativeGetComputedStyle(elt)) as typeof window.getComputedStyle;
});
afterAll(() => {
  window.getComputedStyle = nativeGetComputedStyle;
});

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

const period = (id: string, status: string, toDate: string) => ({
  id,
  tenantId: 't1',
  periodCode: `KL-${id}`,
  fromDate: `${toDate.slice(0, 8)}01`,
  toDate,
  timesheetPeriodId: null,
  paymentDate: '',
  status,
  lockedAt: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

const run = (id: string, run_no: number, status: string) => ({
  id,
  run_no,
  status,
  updated_at: '2026-09-02T00:00:00Z',
});

const total = (id: string, code: string, name: string) => ({
  id,
  employee_id: `emp-${id}`,
  full_name: name,
  employee_code: code,
  gross_salary: '10000000',
  net_salary: '9000000',
  total_statutory_deductions: '500000',
  personal_income_tax: '300000',
  advance_deductions: '0',
  other_deductions: '200000',
  payment_status: 'UNPAID',
});

function setup(opts: {
  periods?: unknown[];
  runs?: Record<string, unknown[]>;
  totals?: Record<string, unknown[]>;
}) {
  fetchMock.mockImplementation((async (path: string) => {
    if (path === '/payroll-periods') return { data: opts.periods ?? [] };
    if (path === '/timesheet-periods') return { data: [] };
    const runsOf = path.match(/^\/payroll-periods\/([^/]+)\/runs$/);
    if (runsOf) return { data: opts.runs?.[runsOf[1]] ?? [] };
    const totalsOf = path.match(/^\/payroll-runs\/([^/]+)\/totals$/);
    if (totalsOf) return { data: opts.totals?.[totalsOf[1]] ?? [] };
    if (/^\/payroll-runs\/[^/]+\/items$/.test(path)) return { data: [] };
    return { data: [] };
  }) as never);
}

const stat = (id: string) => screen.getByTestId(id).textContent ?? '';

beforeEach(() => {
  fetchMock.mockReset();
  mockAllowed = new Set(['hrm.payroll.read', 'hrm.payroll.calculate', 'hrm.payroll.configure']);
});

describe('PayrollScreen: đầu trang và trạng thái rỗng', () => {
  it('có tiêu đề, mô tả và 4 thẻ số liệu bằng 0 khi chưa có kỳ lương', async () => {
    setup({});
    render(<PayrollScreen />);
    expect(screen.getByRole('heading', { name: 'Lương và chi trả' })).toBeTruthy();
    expect(
      screen.getByText('Quản lý kỳ lương, tính lương, phát hành phiếu lương và theo dõi lịch sử chi trả.'),
    ).toBeTruthy();
    await screen.findByText('Chưa có kỳ lương');
    expect(stat('payroll-stat-open')).toContain('Kỳ lương đang mở');
    expect(stat('payroll-stat-waiting-calculation')).toContain('Chờ tính lương');
    expect(stat('payroll-stat-waiting-finalize')).toContain('Chờ chốt lương');
    expect(stat('payroll-stat-released')).toContain('Đã phát hành');
    for (const id of [
      'payroll-stat-open',
      'payroll-stat-waiting-calculation',
      'payroll-stat-waiting-finalize',
      'payroll-stat-released',
    ]) {
      expect(within(screen.getByTestId(id)).getByText('0')).toBeTruthy();
    }
  });

  it('hiện trạng thái rỗng, nút tạo đầu tiên và dải quy trình 3 bước', async () => {
    setup({});
    render(<PayrollScreen />);
    await screen.findByText('Chưa có kỳ lương');
    expect(
      screen.getByText('Tạo kỳ lương để tổng hợp dữ liệu từ bảng công đã khóa, tính lương và phát hành phiếu lương.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tạo kỳ lương đầu tiên' })).toBeTruthy();
    const steps = screen.getByRole('region', { name: 'Quy trình tạo kỳ lương' });
    expect(within(steps).getByTestId('payroll-step-1').textContent).toContain('Chọn kỳ công đã khóa');
    expect(within(steps).getByTestId('payroll-step-2').textContent).toContain('Tính và kiểm tra lương');
    expect(within(steps).getByTestId('payroll-step-3').textContent).toContain('Chốt và phát hành phiếu lương');
  });

  it('nút Tạo kỳ lương ở đầu trang và nút tạo đầu tiên cùng mở hộp thoại tạo kỳ lương', async () => {
    setup({});
    render(<PayrollScreen />);
    await screen.findByText('Chưa có kỳ lương');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo kỳ lương' }));
    expect(await screen.findByText('Tạo kỳ lương mới')).toBeTruthy();
  });

  it('nút Tạo kỳ lương đầu tiên cũng mở hộp thoại tạo kỳ lương', async () => {
    setup({});
    render(<PayrollScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tạo kỳ lương đầu tiên' }));
    expect(await screen.findByText('Tạo kỳ lương mới')).toBeTruthy();
  });

  it('nút Cấu hình lương/OT đi tới /settings?view=payroll khi có quyền cấu hình lương', async () => {
    setup({});
    render(<PayrollScreen />);
    await screen.findByText('Chưa có kỳ lương');
    const link = screen.getByRole('link', { name: 'Cấu hình lương/OT' });
    expect(link.getAttribute('href')).toBe('/settings?view=payroll');
  });

  it('không có quyền thì ẩn nút Cấu hình lương/OT, Tạo kỳ lương và Tạo kỳ lương đầu tiên', async () => {
    mockAllowed = new Set(['hrm.payroll.read']);
    setup({});
    render(<PayrollScreen />);
    await screen.findByText('Chưa có kỳ lương');
    expect(screen.queryByRole('link', { name: 'Cấu hình lương/OT' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tạo kỳ lương' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tạo kỳ lương đầu tiên' })).toBeNull();
  });

  it('có thanh lọc gồm tháng, ô tìm kỳ lương hoặc nhân viên và trạng thái', async () => {
    setup({});
    render(<PayrollScreen />);
    await screen.findByText('Chưa có kỳ lương');
    expect(screen.getByPlaceholderText('Tất cả các tháng')).toBeTruthy();
    expect(screen.getByPlaceholderText('Tìm kỳ lương hoặc nhân viên...')).toBeTruthy();
    expect(screen.getByPlaceholderText('Tất cả trạng thái')).toBeTruthy();
  });
});

describe('PayrollScreen: thẻ số liệu và danh sách kỳ lương', () => {
  const periods = [
    period('p1', 'OPEN', '2026-10-31'), // chưa có lần tính -> chờ tính
    period('p2', 'OPEN', '2026-09-30'), // đã tính -> chờ chốt
    period('p3', 'OPEN', '2026-08-31'), // lần tính mới nhất đang nháp, lần cũ đã hủy -> chờ tính
    period('p4', 'LOCKED', '2026-07-31'), // đã chốt -> đã phát hành
    period('p5', 'PAID', '2026-06-30'), // đã chi trả -> đã phát hành
  ];
  const runs = {
    p2: [run('r2', 1, 'CALCULATED')],
    p3: [run('r3a', 1, 'CANCELLED'), run('r3b', 2, 'DRAFT')],
    p4: [run('r4', 1, 'FINALIZED')],
  };
  const totals = {
    r2: [total('t1', 'NV001', 'Nguyễn Văn An'), total('t2', 'NV002', 'Trần Thị Bình')],
  };

  it('đếm số kỳ lương theo trạng thái kỳ và lần tính mới nhất', async () => {
    setup({ periods, runs, totals });
    render(<PayrollScreen />);
    await waitFor(() => expect(stat('payroll-stat-open')).toContain('3'));
    expect(stat('payroll-stat-waiting-calculation')).toContain('2');
    expect(stat('payroll-stat-waiting-finalize')).toContain('1');
    expect(stat('payroll-stat-released')).toContain('2');
    expect(screen.queryByText('Chưa có kỳ lương')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Quy trình tạo kỳ lương' })).toBeNull();
  });

  it('lọc danh sách kỳ theo trạng thái', async () => {
    setup({ periods, runs, totals });
    render(<PayrollScreen />);
    await screen.findByText('Kỳ lương (5)');
    fireEvent.click(screen.getByPlaceholderText('Tất cả trạng thái'));
    fireEvent.click(await screen.findByRole('option', { name: 'Đã khóa' }));
    expect(await screen.findByText('Kỳ lương (1)')).toBeTruthy();
  });

  it('lọc danh sách kỳ theo tháng', async () => {
    setup({ periods, runs, totals });
    render(<PayrollScreen />);
    await screen.findByText('Kỳ lương (5)');
    fireEvent.click(screen.getByPlaceholderText('Tất cả các tháng'));
    fireEvent.click(await screen.findByRole('option', { name: 'Tháng 09/2026' }));
    expect(await screen.findByText('Kỳ lương (1)')).toBeTruthy();
    expect(screen.getAllByText('KL-p2').length).toBeGreaterThan(0);
  });

  it('tìm theo mã kỳ lương', async () => {
    setup({ periods, runs, totals });
    render(<PayrollScreen />);
    await screen.findByText('Kỳ lương (5)');
    fireEvent.change(screen.getByPlaceholderText('Tìm kỳ lương hoặc nhân viên...'), {
      target: { value: 'kl-p4' },
    });
    expect(await screen.findByText('Kỳ lương (1)')).toBeTruthy();
  });

  it('tìm theo nhân viên của lần tính đang xem (gõ không dấu)', async () => {
    setup({ periods: [periods[1]], runs, totals });
    render(<PayrollScreen />);
    await screen.findByText('Trần Thị Bình');
    expect(screen.getByText('Nguyễn Văn An')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Tìm kỳ lương hoặc nhân viên...'), {
      target: { value: 'tran thi' },
    });
    await waitFor(() => expect(screen.queryByText('Nguyễn Văn An')).toBeNull());
    expect(screen.getByText('Trần Thị Bình')).toBeTruthy();
  });

  it('giữ nguyên các thao tác của lần tính: tính lương, chốt, phát hành, xuất', async () => {
    setup({ periods: [periods[1]], runs, totals });
    mockAllowed = new Set([
      'hrm.payroll.read',
      'hrm.payroll.calculate',
      'hrm.payroll.finalize',
      'hrm.payroll.publish',
      'hrm.payroll.export',
    ]);
    render(<PayrollScreen />);
    await screen.findByText('Trần Thị Bình');
    expect(screen.getByRole('button', { name: /Tính lương/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chốt lương/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Phát hành phiếu lương/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Xuất Excel/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Xuất đối soát/ })).toBeTruthy();
  });
});
