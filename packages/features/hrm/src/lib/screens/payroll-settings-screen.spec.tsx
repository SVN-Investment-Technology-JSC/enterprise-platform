/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmEmployeeOptions, hrmFetch } from '../hrm-api';
import PayrollSettingsScreen from './payroll-settings-screen';

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

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
const employeesMock = hrmEmployeeOptions as jest.MockedFunction<typeof hrmEmployeeOptions>;

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

const grade = {
  id: 'g1',
  tenantId: 't1',
  code: 'GR-ENG',
  name: 'Ngạch kỹ sư',
  description: null,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const step = {
  id: 's1',
  tenantId: 't1',
  salaryGradeId: 'g1',
  stepNo: 1,
  minSalary: 15000000,
  midSalary: 18500000,
  maxSalary: 22000000,
  baseSalary: 18000000,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const profile = {
  id: 'sp1',
  tenantId: 't1',
  employeeId: 'e1',
  salaryGradeId: 'g1',
  salaryStepId: 's1',
  salaryType: 'GROSS',
  baseSalary: 18000000 as number | null,
  currency: 'VND',
  changeReason: 'Ký hợp đồng chính thức',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

let sod = { separateCalcFinalize: false, separateFinalizePublish: true, enforced: true };
let profiles: unknown[] = [profile];

function grant(...keys: string[]) {
  mockActions.clear();
  for (const key of keys) mockActions.add(key);
}

function tabNames() {
  return screen.getAllByRole('tab').map((t) => t.textContent);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  fetchMock.mockReset();
  employeesMock.mockReset();
  employeesMock.mockResolvedValue([{ value: 'e1', label: 'NV001 · Nguyễn Văn An' }]);
  sod = { separateCalcFinalize: false, separateFinalizePublish: true, enforced: true };
  profiles = [profile];
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    if (path === '/payroll-configuration') return { data: [] };
    if (path === '/salary-grades') return { data: [grade] };
    if (path === '/salary-grades/g1/steps') return { data: [step] };
    if (path === '/employees/e1/salary-profiles') return { data: profiles };
    if (path === '/payroll-sod-settings') {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        sod = { ...body, enforced: true };
      }
      return { data: sod };
    }
    throw new Error(`Unexpected request ${path}`);
  }) as never);
});

describe('PayrollSettingsScreen tabs', () => {
  it('shows only the payroll tabs and defaults to Công thức for payroll.configure', async () => {
    grant('hrm.payroll.configure');
    render(<PayrollSettingsScreen />);
    expect(tabNames()).toEqual(['Công thức', 'Tham số nhân viên', 'Tách nhiệm vụ']);
    expect(screen.getByRole('tab', { name: 'Công thức' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/payroll-configuration'));
  });

  it('shows salary tabs only and defaults to Ngạch và bậc for salary.read', async () => {
    grant('hrm.salary.read');
    render(<PayrollSettingsScreen />);
    expect(tabNames()).toEqual(['Ngạch và bậc', 'Hồ sơ lương']);
    expect(screen.getByRole('tab', { name: 'Ngạch và bậc' }).getAttribute('aria-selected')).toBe('true');
    expect((await screen.findAllByText('GR-ENG')).length).toBeTruthy();
    // Người chỉ có payroll.configure mới gọi API công thức
    expect(fetchMock).not.toHaveBeenCalledWith('/payroll-configuration');
  });

  it('falls back to the first allowed tab for a forbidden deep link and maps legacy ids', () => {
    grant('hrm.payroll.configure');
    window.history.replaceState(null, '', '/?tab=profiles');
    const first = render(<PayrollSettingsScreen />);
    expect(screen.getByRole('tab', { name: 'Công thức' }).getAttribute('aria-selected')).toBe('true');
    first.unmount();

    window.history.replaceState(null, '', '/?tab=inputs');
    render(<PayrollSettingsScreen />);
    expect(
      screen.getByRole('tab', { name: 'Tham số nhân viên' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('shows no tab at all without any payroll or salary permission', () => {
    grant('hrm.read');
    render(<PayrollSettingsScreen />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toContain('không có quyền');
  });
});

describe('moved salary panels', () => {
  it('hides write controls without hrm.salary.manage and shows steps', async () => {
    grant('hrm.salary.read');
    render(<PayrollSettingsScreen />);
    expect((await screen.findAllByText('GR-ENG')).length).toBeTruthy();
    expect(await screen.findByText(/18\.000\.000/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Thêm ngạch/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Thêm bậc lương/ })).toBeNull();
  });

  it('offers grade and step creation with hrm.salary.manage', async () => {
    grant('hrm.salary.manage');
    render(<PayrollSettingsScreen />);
    await screen.findAllByText('GR-ENG');
    expect(screen.getByRole('button', { name: /Thêm ngạch/ })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Thêm bậc lương/ }));
    expect(await screen.findByRole('dialog', { name: /Thêm bậc lương cho ngạch GR-ENG/ })).toBeTruthy();
  });

  it('lists the salary profile history of the selected employee', async () => {
    grant('hrm.salary.read');
    window.history.replaceState(null, '', '/?tab=profiles');
    render(<PayrollSettingsScreen />);
    fireEvent.click(await screen.findByPlaceholderText('Chọn nhân viên...'));
    fireEvent.click(await screen.findByRole('option', { name: /NV001/ }));
    expect((await screen.findAllByText(/18\.000\.000/)).length).toBeGreaterThan(0);
    expect(screen.getByText('Đang hiệu lực', { selector: '*' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Thêm hồ sơ lương/ })).toBeNull();
  });

  it('shows a hidden marker when the salary amount is null', async () => {
    grant('hrm.salary.read');
    profiles = [{ ...profile, baseSalary: null }];
    window.history.replaceState(null, '', '/?tab=profiles');
    render(<PayrollSettingsScreen />);
    fireEvent.click(await screen.findByPlaceholderText('Chọn nhân viên...'));
    fireEvent.click(await screen.findByRole('option', { name: /NV001/ }));
    const hidden = await screen.findAllByTitle('Bạn không có quyền xem mức lương');
    expect(hidden.every((el) => el.textContent === 'Ẩn')).toBe(true);
  });
});

describe('SoD card', () => {
  async function openSod() {
    window.history.replaceState(null, '', '/?tab=sod');
    render(<PayrollSettingsScreen />);
    return screen.findAllByRole('switch');
  }

  it('loads the two switches from the API', async () => {
    grant('hrm.payroll.configure');
    const switches = await openSod();
    expect(switches).toHaveLength(2);
    expect(switches[0].getAttribute('aria-checked')).toBe('false');
    expect(switches[1].getAttribute('aria-checked')).toBe('true');
    expect(fetchMock).toHaveBeenCalledWith('/payroll-sod-settings');
  });

  it('saves changes with PUT and confirms success', async () => {
    grant('hrm.payroll.configure');
    const switches = await openSod();
    const save = screen.getByRole('button', { name: 'Lưu thay đổi' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(switches[0]);
    expect(switches[0].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(save);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/payroll-sod-settings',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ separateCalcFinalize: true, separateFinalizePublish: true }),
        }),
      ),
    );
    expect((await screen.findByRole('status')).textContent).toContain('Đã lưu');
  });

  it('shows the server error when saving fails', async () => {
    grant('hrm.payroll.configure');
    const switches = await openSod();
    fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path === '/payroll-sod-settings' && init?.method === 'PUT')
        throw new Error('Chưa áp dụng migration 0026');
      return { data: sod };
    }) as never);
    fireEvent.click(switches[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Chưa áp dụng migration 0026');
  });

  it('reports a load failure with a retry button', async () => {
    grant('hrm.payroll.configure');
    fetchMock.mockImplementation((async (path: string) => {
      if (path === '/payroll-sod-settings') throw new Error('Bạn không còn quyền thực hiện thao tác này.');
      return { data: [] };
    }) as never);
    window.history.replaceState(null, '', '/?tab=sod');
    render(<PayrollSettingsScreen />);
    expect((await screen.findByText(/Không tải được cấu hình tách nhiệm vụ/)).textContent).toContain('không còn quyền');
    expect(screen.getByRole('button', { name: 'Tải lại' })).toBeTruthy();
  });

  it('disables the switches when the system has not applied the settings table', async () => {
    grant('hrm.payroll.configure');
    sod = { separateCalcFinalize: false, separateFinalizePublish: false, enforced: false };
    const switches = await openSod();
    expect((switches[0] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/chưa áp dụng bảng cấu hình/)).toBeTruthy();
  });
});
