/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const employeesMock = hrmEmployeeOptions as jest.MockedFunction<
  typeof hrmEmployeeOptions
>;
const paths = () => fetchMock.mock.calls.map((call) => call[0] as string);

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

function setup(lists: Record<string, unknown[] | Error>) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/approval-scope')
      return { data: { noReportingLine: false, message: null } } as never;
    if (path === '/request-workflows') return { data: [] } as never;
    const key = Object.keys(lists).find((k) => path.startsWith(`/${k}?`));
    if (!key) throw new Error(`Unexpected request ${path}`);
    const value = lists[key];
    if (value instanceof Error) throw value;
    return { data: value } as never;
  });
  employeesMock.mockResolvedValue([
    { value: 'e1', label: 'NV001 · Nguyễn Văn An' },
  ]);
}

beforeAll(() => {
  // antd Table cần ResizeObserver, jsdom không có.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
});

beforeEach(() => {
  fetchMock.mockReset();
  employeesMock.mockReset();
  mockType = null;
  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({
        matches: false,
        media: query,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList);
});

describe('ApprovalsScreen', () => {
  it('moi danh sach deu kem forApproval=1 va chi goi loai duoc duyet', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve.all', 'hrm.advance.approve'];
    setup({
      'leave-requests': [leave],
      'ot-requests': [ot],
      'salary-advance-requests': [],
    });
    render(<ApprovalsScreen />);
    await waitFor(() => {
      const lists = paths().filter(
        (p) => !['/approval-scope', '/request-workflows'].includes(p),
      );
      expect(lists.length).toBe(3);
    });
    const lists = paths().filter(
      (p) => !['/approval-scope', '/request-workflows'].includes(p),
    );
    for (const p of lists) expect(p).toContain('forApproval=1');
    expect(lists.some((p) => p.startsWith('/business-trip-requests'))).toBe(false);
  });

  it('hien ma nhan vien', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ 'leave-requests': [leave] });
    render(<ApprovalsScreen />);
    expect(await screen.findByText('NV001')).toBeTruthy();
    expect(screen.getByText('Nguyễn Văn An')).toBeTruthy();
  });

  it('?type= chon san bo loc loai don', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve'];
    mockType = 'ot';
    setup({ 'leave-requests': [leave], 'ot-requests': [ot] });
    render(<ApprovalsScreen />);
    expect(await screen.findByText('Tăng ca cuối tháng')).toBeTruthy();
    expect(screen.queryByText('Nghỉ việc riêng')).toBeNull();
  });

  it('khong co ?type= thi hien tat ca loai', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve'];
    setup({ 'leave-requests': [leave], 'ot-requests': [ot] });
    render(<ApprovalsScreen />);
    expect(await screen.findByText('Tăng ca cuối tháng')).toBeTruthy();
    expect(screen.getByText('Nghỉ việc riêng')).toBeTruthy();
  });

  it('loai don bi 403 duoc bo qua, khong bao loi', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve'];
    setup({
      'leave-requests': [leave],
      'ot-requests': new HrmApiError('Forbidden', 403),
    });
    render(<ApprovalsScreen />);
    expect(await screen.findByText('Nghỉ việc riêng')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lien ket Procedure dung duong dan', async () => {
    mockActions = ['hrm.leave.approve'];
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/approval-scope')
        return { data: { noReportingLine: false, message: null } } as never;
      if (path === '/request-workflows')
        return {
          data: [
            {
              id: 'w1',
              request_kind: 'LEAVE',
              request_id: 'l1',
              instance_code: 'PE-001',
              status: 'RUNNING',
              last_error: '',
            },
          ],
        } as never;
      return { data: [leave] } as never;
    });
    employeesMock.mockResolvedValue([{ value: 'e1', label: 'NV001 · Nguyễn Văn An' }]);
    render(<ApprovalsScreen />);
    const link = await screen.findByRole('link', { name: /PE-001/ });
    expect(link.getAttribute('href')).toBe('/modules/procedure-engine/instances');
  });
});

describe('ApprovalsScreen: Lý do tách khỏi Mô tả', () => {
  const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent);
  const rowWith = (text: string) => screen.getByText(text).closest('tr') as HTMLTableRowElement;
  const cell = (row: HTMLTableRowElement, title: string) => {
    const index = headers().indexOf(title);
    return (row.querySelectorAll('td')[index]?.textContent ?? '').trim();
  };

  it('có hai cột riêng Lý do và Mô tả, mô tả không lẫn vào cột lý do', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ 'leave-requests': [leave] });
    render(<ApprovalsScreen />);
    await screen.findByText('Có việc gia đình đột xuất');
    const names = headers();
    expect(names).toContain('Lý do');
    expect(names).toContain('Mô tả');
    expect(names.indexOf('Mô tả')).toBe(names.indexOf('Lý do') + 1);
    const row = rowWith('Nghỉ việc riêng');
    expect(cell(row, 'Lý do')).toBe('Nghỉ việc riêng');
    expect(cell(row, 'Mô tả')).toBe('Có việc gia đình đột xuất');
  });

  it('đơn cũ chưa có lý do danh mục hiện "—" ở cột Lý do và giữ nội dung cũ ở Mô tả', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({
      'leave-requests': [
        { ...leave, reasonId: null, reasonName: null, description: 'Nội dung cũ', reason: 'Nội dung cũ' },
      ],
    });
    render(<ApprovalsScreen />);
    await screen.findByText('Nội dung cũ');
    const row = rowWith('Nội dung cũ');
    expect(cell(row, 'Lý do')).toBe('—');
    expect(cell(row, 'Mô tả')).toBe('Nội dung cũ');
  });

  it('mô tả rỗng hiện "—"', async () => {
    mockActions = ['hrm.leave.approve'];
    setup({ 'leave-requests': [{ ...leave, description: null, reason: '' }] });
    render(<ApprovalsScreen />);
    await screen.findByText('Nghỉ việc riêng');
    const row = rowWith('Nghỉ việc riêng');
    expect(cell(row, 'Mô tả')).toBe('—');
  });

  it('đơn làm thêm giờ không lương có thẻ Không lương cạnh lý do', async () => {
    mockActions = ['hrm.ot.approve'];
    setup({
      'ot-requests': [
        ot,
        { ...ot, id: 'o2', reasonName: 'Làm bù tự nguyện', description: 'Tự nguyện', paid: false },
      ],
    });
    render(<ApprovalsScreen />);
    await screen.findByText('Tự nguyện');
    expect(cell(rowWith('Tự nguyện'), 'Lý do')).toContain('Không lương');
    expect(cell(rowWith('Hoàn thiện báo cáo quý'), 'Lý do')).not.toContain('Không lương');
  });

  it('ứng lương không có danh mục: nội dung nhập tự do hiện ở cột Lý do', async () => {
    mockActions = ['hrm.advance.approve'];
    setup({
      'salary-advance-requests': [
        {
          id: 'a1',
          employeeId: 'e1',
          status: 'PENDING',
          reason: 'Chi phí gia đình',
          requestedAmount: 5000000,
          requestDate: '2026-03-04',
          createdAt: '2026-03-03T01:00:00.000Z',
        },
      ],
    });
    render(<ApprovalsScreen />);
    await screen.findByText('Chi phí gia đình');
    const row = rowWith('Chi phí gia đình');
    expect(cell(row, 'Lý do')).toBe('Chi phí gia đình');
    expect(cell(row, 'Mô tả')).toBe('—');
  });

  it('chi tiết đơn có khối Lý do và khối Mô tả riêng', async () => {
    mockActions = ['hrm.ot.approve'];
    setup({
      'ot-requests': [{ ...ot, reasonName: 'Làm bù tự nguyện', description: 'Tự nguyện', paid: false }],
    });
    render(<ApprovalsScreen />);
    await screen.findByText('Tự nguyện');
    fireEvent.click(screen.getByRole('button', { name: 'Chi tiết' }));
    const reason = await screen.findByTestId('approval-detail-reason');
    expect(reason.textContent).toContain('Làm bù tự nguyện');
    expect(reason.textContent).toContain('Không lương');
    expect(reason.textContent).not.toContain('Tự nguyện');
    expect(screen.getByTestId('approval-detail-description').textContent).toBe('Tự nguyện');
  });

  it('tìm kiếm theo cả lý do lẫn mô tả', async () => {
    mockActions = ['hrm.leave.approve', 'hrm.ot.approve'];
    setup({ 'leave-requests': [leave], 'ot-requests': [ot] });
    render(<ApprovalsScreen />);
    await screen.findByText('Hoàn thiện báo cáo quý');
    fireEvent.change(screen.getByLabelText('Tìm đơn'), { target: { value: 'gia dinh' } });
    await waitFor(() => expect(screen.queryByText('Hoàn thiện báo cáo quý')).toBeNull());
    expect(screen.getByText('Có việc gia đình đột xuất')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Tìm đơn'), { target: { value: 'cuoi thang' } });
    await waitFor(() => expect(screen.queryByText('Có việc gia đình đột xuất')).toBeNull());
    expect(screen.getByText('Hoàn thiện báo cáo quý')).toBeTruthy();
  });
});
