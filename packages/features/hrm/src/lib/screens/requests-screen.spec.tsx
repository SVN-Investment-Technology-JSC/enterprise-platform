/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import RequestsPage from './requests-screen';

const mockActions = new Set<string>(['hrm.self.request']);
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

const hrmFetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;

interface FetchCall {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}
let calls: FetchCall[] = [];
let leaveRows: unknown[] = [];

const respond = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: async () => body } as Response);

beforeEach(() => {
  calls = [];
  leaveRows = [];
  mockActions.clear();
  mockActions.add('hrm.self.request');
  hrmFetchMock.mockReset();
  hrmFetchMock.mockResolvedValue({ data: [] } as never);
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.includes('/my-profile'))
      return respond({
        data: {
          employeeId: 'e1',
          fullName: 'Nguyễn Văn An',
          employeeCode: 'NV001',
          employmentStatus: 'OFFICIAL',
        },
      });
    if (url.includes('/request-drafts/'))
      return respond({
        data: { id: 'd1', updatedAt: '2026-10-01T00:00:00.000Z', payload: {} },
      });
    if (method === 'POST') return respond({ data: { id: 'new' } });
    if (url.includes('/leave-requests')) return respond({ data: leaveRows });
    if (url.includes('/procedure-definitions/binding'))
      return respond({ data: null });
    return respond({ data: [] });
  }) as never;
  URL.createObjectURL = jest.fn(() => 'blob:mock');
  URL.revokeObjectURL = jest.fn();
});

const leaveRow = (i: number) => ({
  id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
  status: 'PENDING',
  createdAt: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T01:00:00.000Z`,
  fromDate: '2026-10-01',
  toDate: '2026-10-02',
  duration: 2,
  reason: `Lý do số ${i}`,
});

const footer = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

async function openHistory(rows: number) {
  leaveRows = Array.from({ length: rows }, (_, i) => leaveRow(i));
  render(<RequestsPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Lịch sử đơn từ/ }));
}

describe('Đơn từ của tôi', () => {
  it('có tiêu đề mới và danh mục đủ 7 loại đơn có nút khởi tạo', async () => {
    render(<RequestsPage />);
    expect(
      await screen.findByRole('heading', { name: 'Đơn từ của tôi' }),
    ).toBeTruthy();
    for (const title of [
      'Đơn xin nghỉ phép',
      'Đơn làm thêm giờ (OT)',
      'Đơn đi công tác',
      'Đơn đổi ca',
      'Đơn giải trình / Bổ sung công',
      'Đơn tạm ứng lương',
      'Đơn đính chính hồ sơ',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    expect(
      screen.getAllByRole('button', { name: /Khởi tạo đơn này/ }),
    ).toHaveLength(7);
  });

  it('không có hrm.self.request thì ẩn nút tạo đơn', async () => {
    mockActions.clear();
    render(<RequestsPage />);
    await screen.findByRole('heading', { name: 'Đơn từ của tôi' });
    expect(screen.queryAllByRole('button', { name: /Khởi tạo đơn này/ })).toHaveLength(0);
    expect(screen.getByText(/chưa được cấp quyền tạo đơn/)).toBeTruthy();
  });

  it('danh sách lịch sử gọi API của chính mình, không dùng forApproval', async () => {
    render(<RequestsPage />);
    await screen.findByRole('heading', { name: 'Đơn từ của tôi' });
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/profile-corrections'))).toBe(true),
    );
    const listCalls = calls.filter((c) => c.method === 'GET' && /-requests|corrections/.test(c.url));
    expect(listCalls.length).toBeGreaterThanOrEqual(7);
    expect(listCalls.every((c) => !c.url.includes('forApproval'))).toBe(true);
    expect(listCalls.every((c) => c.url.includes('employee_id=e1'))).toBe(true);
  });

  it('gửi đơn tạm ứng lương tới salary-advance-requests', async () => {
    render(<RequestsPage />);
    const buttons = await screen.findAllByRole('button', { name: /Khởi tạo đơn này/ });
    fireEvent.click(buttons[5]);
    fireEvent.change(await screen.findByPlaceholderText(/Nhập chi tiết lý do/), {
      target: { value: 'Chi phí gia đình' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Gửi duyệt đơn/, hidden: true }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.url.endsWith('/salary-advance-requests')),
      ).toBe(true),
    );
    const draft = calls.find((c) => c.url.endsWith('/request-drafts/advance'));
    expect(draft?.body).toMatchObject({
      employeeId: 'e1',
      payload: { requestedAmount: 5000000, numberOfInstallments: 1, reason: 'Chi phí gia đình' },
    });
    const submit = calls.find((c) => c.url.endsWith('/salary-advance-requests') && c.method === 'POST');
    expect(submit?.body).toMatchObject({ employeeId: 'e1', draftId: 'd1' });
  });

  it('gửi đơn đính chính hồ sơ tới profile-corrections với bản thay đổi', async () => {
    render(<RequestsPage />);
    const buttons = await screen.findAllByRole('button', { name: /Khởi tạo đơn này/ });
    fireEvent.click(buttons[6]);
    fireEvent.change(await screen.findByPlaceholderText('Nhập họ và tên...'), {
      target: { value: 'Nguyễn Văn Bình' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Nhập chi tiết lý do/), {
      target: { value: 'Sai chính tả' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Gửi duyệt đơn/, hidden: true }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/profile-corrections'))).toBe(true),
    );
    const draft = calls.find((c) => c.url.endsWith('/request-drafts/profile_correction'));
    expect(draft?.body?.payload).toMatchObject({ changes: { fullName: 'Nguyễn Văn Bình' } });
  });

  it('đổi ca yêu cầu chọn đồng nghiệp và gửi tới shift-change-requests khi đủ thông tin', async () => {
    render(<RequestsPage />);
    const buttons = await screen.findAllByRole('button', { name: /Khởi tạo đơn này/ });
    fireEvent.click(buttons[3]);
    expect(await screen.findByText('Hình thức đổi ca *')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Nhập chi tiết lý do/), {
      target: { value: 'Việc riêng' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Gửi duyệt đơn/, hidden: true }));
    // Chưa có ca/đồng nghiệp: không gọi API gửi đơn.
    await waitFor(() => expect(screen.getAllByText(/Thiếu thông tin ca|Vui lòng chọn ca/).length).toBeGreaterThan(0));
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/shift-change-requests'))).toBe(false);
  });

  it('phân trang lịch sử 20 dòng mỗi trang', async () => {
    await openHistory(25);
    await waitFor(() => expect(footer()).toContain('Hiển thị 1-20 / 25 đơn từ'));
    expect(screen.getAllByRole('button', { name: 'Chi tiết' })).toHaveLength(20);
    expect(screen.getByText('1 / 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sau' }));
    await waitFor(() => expect(footer()).toContain('Hiển thị 21-25 / 25 đơn từ'));
    expect(screen.getAllByRole('button', { name: 'Chi tiết' })).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Sau' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Trước' }));
    await waitFor(() => expect(footer()).toContain('Hiển thị 1-20 / 25 đơn từ'));
  });

  it('xuất lịch sử đơn tạo file CSV thật từ các dòng đang lọc', async () => {
    await openHistory(3);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Chi tiết' })).toHaveLength(3));
    const clicked: string[] = [];
    const anchorClick = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      });
    fireEvent.click(screen.getByRole('button', { name: /Xuất lịch sử đơn/ }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (URL.createObjectURL as jest.Mock).mock.calls[0][0] as Blob;
    expect(blob.type).toContain('text/csv');
    expect(blob.size).toBeGreaterThan(100);
    expect(clicked[0]).toMatch(/^lich-su-don-tu-\d{4}-\d{2}-\d{2}\.csv$/);
    anchorClick.mockRestore();
  });
});
