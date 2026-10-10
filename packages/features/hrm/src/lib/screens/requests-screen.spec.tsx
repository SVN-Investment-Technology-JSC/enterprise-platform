/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import RequestsPage, { computeLeaveFromPreview } from './requests-screen';

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
let otRows: unknown[] = [];
let leaveTypes: unknown[] = [];
/** Danh mục lý do trả về theo kind (OVERTIME, BUSINESS_TRIP, ATTENDANCE_CORRECTION, SHIFT_CHANGE). */
let reasonCatalog: Record<string, unknown[]> = {};
/** Phản hồi của GET /approval-route; Error thì giả lập lỗi tải. */
let approvalRoute: unknown = null;
let hrmPaths: string[] = [];

const respond = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: async () => body } as Response);

const catalogReason = (
  kind: string,
  id: string,
  name: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  tenantId: 't1',
  kind,
  code: id.toUpperCase(),
  name,
  description: null,
  paid: true,
  requiresDescription: false,
  active: true,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const leaveType = (
  id: string,
  code: string,
  name: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  code,
  name,
  unit: 'DAYS',
  paid: true,
  deductBalance: false,
  active: true,
  ...over,
});

beforeEach(() => {
  calls = [];
  leaveRows = [];
  otRows = [];
  leaveTypes = [];
  reasonCatalog = {};
  approvalRoute = null;
  hrmPaths = [];
  mockActions.clear();
  mockActions.add('hrm.self.request');
  hrmFetchMock.mockReset();
  hrmFetchMock.mockImplementation((async (path: string) => {
    hrmPaths.push(path);
    if (path.startsWith('/request-reasons')) {
      const kind = new URLSearchParams(path.split('?')[1]).get('kind') ?? '';
      return { data: reasonCatalog[kind] ?? [] };
    }
    if (path.startsWith('/approval-route')) {
      if (approvalRoute instanceof Error) throw approvalRoute;
      return { data: approvalRoute };
    }
    if (path.includes('/leave-day-preview')) {
      // Một ngày làm việc đầy đủ để số ngày nghỉ không phụ thuộc ngày chạy test.
      const from = new URLSearchParams(path.split('?')[1]).get('from') ?? '';
      return {
        data: [
          {
            date: from,
            kind: 'WORK',
            weight: 1,
            shiftMinutes: 480,
            startMinutes: 450,
            endMinutes: 1020,
            breakStartMinutes: 690,
            breakEndMinutes: 780,
          },
        ],
      };
    }
    return { data: [] };
  }) as never);
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
    if (url.includes('/leave-types')) return respond({ data: leaveTypes });
    if (url.includes('/ot-requests')) return respond({ data: otRows });
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

/** Mở ô "Lý do" (đã tải xong danh mục) và chọn một lý do theo tên. */
async function chooseReason(name: RegExp) {
  fireEvent.click(await screen.findByPlaceholderText(/^Chọn lý do/));
  fireEvent.click(await screen.findByRole('option', { name, hidden: true }));
}

const DESCRIPTION_LABEL = /Mô tả chi tiết/;
// Chỉ 4 loại đơn đang mở (nghỉ phép, OT, công tác, bổ sung công); đổi ca, tạm ứng, đính chính hồ sơ tạm ẩn.
const KIND_BUTTON = { leave: 0, ot: 1, business_trip: 2, correction: 3 };

async function openForm(kind: keyof typeof KIND_BUTTON) {
  render(<RequestsPage />);
  const buttons = await screen.findAllByRole('button', { name: /Khởi tạo đơn này/ });
  fireEvent.click(buttons[KIND_BUTTON[kind]]);
}

const submitButton = () =>
  screen.getByRole('button', { name: /Gửi duyệt đơn/, hidden: true }) as HTMLButtonElement;
const draftBody = (kind: string) =>
  calls.find((c) => c.url.endsWith(`/request-drafts/${kind}`) && c.method === 'POST')?.body;

async function openHistory(rows: number) {
  leaveRows = Array.from({ length: rows }, (_, i) => leaveRow(i));
  render(<RequestsPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Lịch sử đơn từ/ }));
}

describe('Đơn từ của tôi', () => {
  it('có tiêu đề mới và danh mục chỉ hiện 4 loại đơn đang mở', async () => {
    render(<RequestsPage />);
    expect(
      await screen.findByRole('heading', { name: 'Đơn từ & Yêu cầu' }),
    ).toBeTruthy();
    for (const title of [
      'Đơn xin nghỉ phép',
      'Đơn làm thêm giờ (OT)',
      'Đơn đi công tác',
      'Đơn giải trình / Bổ sung công',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    for (const title of ['Đơn đổi ca', 'Đơn tạm ứng lương', 'Đơn đính chính hồ sơ'])
      expect(screen.queryByRole('heading', { name: title })).toBeNull();
    expect(
      screen.getAllByRole('button', { name: /Khởi tạo đơn này/ }),
    ).toHaveLength(4);
  });

  it('không có hrm.self.request thì ẩn nút tạo đơn', async () => {
    mockActions.clear();
    render(<RequestsPage />);
    await screen.findByRole('heading', { name: 'Đơn từ & Yêu cầu' });
    expect(screen.queryAllByRole('button', { name: /Khởi tạo đơn này/ })).toHaveLength(0);
    expect(screen.getByText(/chưa được cấp quyền tạo đơn/)).toBeTruthy();
  });

  it('danh sách lịch sử gọi API của chính mình, không dùng forApproval', async () => {
    render(<RequestsPage />);
    await screen.findByRole('heading', { name: 'Đơn từ & Yêu cầu' });
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/profile-corrections'))).toBe(true),
    );
    const listCalls = calls.filter((c) => c.method === 'GET' && /-requests|corrections/.test(c.url));
    expect(listCalls.length).toBeGreaterThanOrEqual(7);
    expect(listCalls.every((c) => !c.url.includes('forApproval'))).toBe(true);
    expect(listCalls.every((c) => c.url.includes('employee_id=e1'))).toBe(true);
  });

  // Loại đơn tạm ẩn: giữ test để bật lại khi thêm loại đơn vào VISIBLE_REQUEST_KINDS.
  it.skip('gửi đơn tạm ứng lương tới salary-advance-requests', async () => {
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

  // Loại đơn tạm ẩn: giữ test để bật lại khi thêm loại đơn vào VISIBLE_REQUEST_KINDS.
  it.skip('gửi đơn đính chính hồ sơ tới profile-corrections với bản thay đổi', async () => {
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

  // Loại đơn tạm ẩn: giữ test để bật lại khi thêm loại đơn vào VISIBLE_REQUEST_KINDS.
  it.skip('đổi ca yêu cầu chọn đồng nghiệp và gửi tới shift-change-requests khi đủ thông tin', async () => {
    reasonCatalog = {
      SHIFT_CHANGE: [catalogReason('SHIFT_CHANGE', 'sc1', 'Việc riêng')],
    };
    render(<RequestsPage />);
    const buttons = await screen.findAllByRole('button', { name: /Khởi tạo đơn này/ });
    fireEvent.click(buttons[3]);
    expect(await screen.findByText('Hình thức đổi ca *')).toBeTruthy();
    await chooseReason(/Việc riêng/);
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

describe('Form tạo đơn: Lý do (danh mục) tách khỏi Mô tả (tự do)', () => {
  const otReasons = () => [
    catalogReason('OVERTIME', 'ot1', 'Theo yêu cầu công việc', {
      description: 'Làm thêm theo tiến độ dự án',
    }),
    catalogReason('OVERTIME', 'ot2', 'Làm bù không tính tiền', {
      paid: false,
      description: 'Làm thêm tự nguyện',
    }),
    catalogReason('OVERTIME', 'ot3', 'Khác', { requiresDescription: true }),
  ];

  it('đơn làm thêm giờ có ô Lý do chọn từ danh mục và ô Mô tả riêng, không còn ô Loại OT', async () => {
    reasonCatalog = { OVERTIME: otReasons() };
    await openForm('ot');
    await screen.findByPlaceholderText(/^Chọn lý do/);
    expect(hrmPaths).toContain('/request-reasons?kind=OVERTIME&active=true');
    // Hai phần tách biệt: ô Lý do làm thêm (chọn từ danh mục) và ô Mô tả chi tiết (bắt buộc với OT).
    expect(screen.getAllByText('Lý do làm thêm', { exact: false }).length).toBeGreaterThan(0);
    const description = screen.getByLabelText(DESCRIPTION_LABEL) as HTMLTextAreaElement;
    expect(description.tagName).toBe('TEXTAREA');
    expect(description.required).toBe(true);
    expect(footer()).not.toContain('Loại OT');
    expect(footer()).not.toContain('Mô tả chi tiết lý do làm thêm');
    // Chưa chọn lý do thì chưa gửi được.
    expect(submitButton().disabled).toBe(true);
  });

  it('hiện diễn giải của lý do bằng chữ nhỏ và thẻ Có lương / Không lương theo lý do OT', async () => {
    reasonCatalog = { OVERTIME: otReasons() };
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    const guide = screen.getByTestId('reason-guide');
    expect(guide.textContent).toContain('Làm thêm theo tiến độ dự án');
    expect(guide.textContent).toContain('Có lương');
    expect(guide.textContent).not.toContain('Không lương');
    await chooseReason(/Làm bù không tính tiền/);
    const unpaid = screen.getByTestId('reason-guide');
    expect(unpaid.textContent).toContain('Làm thêm tự nguyện');
    expect(unpaid.textContent).toContain('Không lương');
    expect(unpaid.textContent).toContain('không tính tiền OT');
  });

  it('chỉ bắt buộc Mô tả khi lý do cấu hình cần mô tả', async () => {
    reasonCatalog = { OVERTIME: otReasons() };
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    // OT: Mô tả chi tiết luôn bắt buộc; lỗi thiếu mô tả báo khi bấm gửi (nút chưa bị khóa).
    expect(submitButton().disabled).toBe(false);
    expect((screen.getByLabelText(DESCRIPTION_LABEL) as HTMLTextAreaElement).required).toBe(true);

    await chooseReason(/^Khác/);
    const description = screen.getByLabelText(DESCRIPTION_LABEL) as HTMLTextAreaElement;
    expect(description.required).toBe(true);
    expect(screen.getByText('Lý do đã chọn yêu cầu nhập mô tả.')).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    fireEvent.change(description, { target: { value: '   ' } });
    expect(submitButton().disabled).toBe(true);
    fireEvent.change(description, { target: { value: 'Xử lý sự cố đột xuất' } });
    expect(submitButton().disabled).toBe(false);
  });

  it('gửi đơn làm thêm giờ với reasonId và description, không gửi reason hay otType', async () => {
    reasonCatalog = { OVERTIME: otReasons() };
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    fireEvent.change(screen.getByLabelText(DESCRIPTION_LABEL), {
      target: { value: '  Hoàn thiện hồ sơ nghiệm thu  ' },
    });
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/ot-requests'))).toBe(true),
    );
    const payload = draftBody('ot')?.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      employeeId: 'e1',
      reasonId: 'ot1',
      description: 'Hoàn thiện hồ sơ nghiệm thu',
    });
    expect(payload).not.toHaveProperty('reason');
    expect(payload).not.toHaveProperty('otType');
    const attributes = payload.attributes as Record<string, unknown>;
    expect(attributes).not.toHaveProperty('otReasonCategory');
  });

  it('bỏ trống Mô tả (đơn bổ sung công, không bắt buộc) thì không gửi description', async () => {
    reasonCatalog = {
      ATTENDANCE_CORRECTION: [catalogReason('ATTENDANCE_CORRECTION', 'ac1', 'Quên chấm công')],
    };
    await openForm('correction');
    await chooseReason(/Quên chấm công/);
    fireEvent.click(submitButton());
    await waitFor(() => expect(draftBody('correction')).toBeTruthy());
    const payload = draftBody('correction')?.payload as Record<string, unknown>;
    expect(payload.reasonId).toBe('ac1');
    expect(payload).not.toHaveProperty('description');
    expect(payload).not.toHaveProperty('reason');
  });

  it('đơn nghỉ: lý do là loại nghỉ, hiện thẻ Có lương và ghi chú Trừ quỹ phép năm, gửi leaveTypeId + description', async () => {
    leaveTypes = [
      leaveType('lt-annual', 'ANNUAL', 'Nghỉ phép năm', { deductBalance: true, isAnnual: true }),
      leaveType('lt-sick', 'SICK', 'Nghỉ ốm', { paid: false }),
    ];
    await openForm('leave');
    await chooseReason(/Nghỉ phép năm/);
    const guide = screen.getByTestId('reason-guide');
    expect(guide.textContent).toContain('Có lương');
    expect(guide.textContent).toContain('Trừ quỹ phép năm');
    await chooseReason(/Nghỉ ốm/);
    expect(screen.getByTestId('reason-guide').textContent).toContain('Không lương');
    expect(screen.getByTestId('reason-guide').textContent).not.toContain('Trừ quỹ phép năm');

    fireEvent.change(screen.getByLabelText(DESCRIPTION_LABEL), {
      target: { value: 'Khám bệnh định kỳ' },
    });
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/leave-requests'))).toBe(true),
    );
    const payload = draftBody('leave')?.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      employeeId: 'e1',
      leaveTypeId: 'lt-sick',
      description: 'Khám bệnh định kỳ',
    });
    expect(payload).not.toHaveProperty('reason');
    expect(payload).not.toHaveProperty('reasonId');
  });

  it('công tác và giải trình công lấy lý do từ danh mục theo loại đơn', async () => {
    reasonCatalog = {
      BUSINESS_TRIP: [catalogReason('BUSINESS_TRIP', 'bt1', 'Khảo sát hiện trường')],
      ATTENDANCE_CORRECTION: [catalogReason('ATTENDANCE_CORRECTION', 'ac1', 'Quên chấm công')],
    };
    await openForm('business_trip');
    await screen.findByPlaceholderText(/^Chọn lý do/);
    expect(hrmPaths).toContain('/request-reasons?kind=BUSINESS_TRIP&active=true');
    // Ô "Lý do công tác" lấy từ danh mục lý do (không còn chọn tay theo phân loại cũ).
    expect(footer()).toContain('Lý do công tác');
    fireEvent.change(screen.getByPlaceholderText(/VD: Trạm biến áp/), {
      target: { value: 'Trạm biến áp Phố Nối' },
    });
    await chooseReason(/Khảo sát hiện trường/);
    fireEvent.change(screen.getByLabelText(DESCRIPTION_LABEL), {
      target: { value: 'Khảo sát tuyến dây' },
    });
    fireEvent.click(submitButton());
    await waitFor(() => expect(draftBody('business_trip')).toBeTruthy());
    const trip = draftBody('business_trip')?.payload as Record<string, unknown>;
    expect(trip).toMatchObject({ reasonId: 'bt1', destination: 'Trạm biến áp Phố Nối' });
    expect(trip).not.toHaveProperty('reason');
    expect(trip.attributes as Record<string, unknown>).not.toHaveProperty('tripReasonCategory');
  });

  it('công tác thêm khoảng thời gian: mỗi khoảng gửi thành một đơn riêng, bỏ khoảng thì chỉ còn một đơn', async () => {
    reasonCatalog = {
      BUSINESS_TRIP: [catalogReason('BUSINESS_TRIP', 'bt1', 'Khảo sát hiện trường')],
    };
    await openForm('business_trip');
    await screen.findByPlaceholderText(/^Chọn lý do/);
    fireEvent.change(screen.getByPlaceholderText(/VD: Trạm biến áp/), {
      target: { value: 'Trạm biến áp Phố Nối' },
    });
    await chooseReason(/Khảo sát hiện trường/);
    fireEvent.change(screen.getByLabelText(DESCRIPTION_LABEL), {
      target: { value: 'Khảo sát tuyến dây' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm khoảng công tác' }));
    expect(screen.getByText(/Tổng 2 khoảng công tác/)).toBeTruthy();
    fireEvent.click(submitButton());
    const tripPosts = () =>
      calls.filter((c) => c.method === 'POST' && c.url.endsWith('/business-trip-requests'));
    await waitFor(() => expect(tripPosts()).toHaveLength(2));
    // Khoảng bổ sung mang đủ nội dung (địa điểm, lý do) và nằm sau khoảng đầu.
    const [first, extra] = tripPosts().map((c) => c.body as Record<string, any>);
    expect(first).toMatchObject({ draftId: 'd1' });
    expect(extra).toMatchObject({
      employeeId: 'e1',
      destination: 'Trạm biến áp Phố Nối',
      reasonId: 'bt1',
    });
    expect(extra.fromDate > (draftBody('business_trip')?.payload as any).toDate).toBe(true);
  });

  it('công tác: xoá khoảng bổ sung thì chỉ gửi một đơn', async () => {
    reasonCatalog = {
      BUSINESS_TRIP: [catalogReason('BUSINESS_TRIP', 'bt1', 'Khảo sát hiện trường')],
    };
    await openForm('business_trip');
    await screen.findByPlaceholderText(/^Chọn lý do/);
    fireEvent.change(screen.getByPlaceholderText(/VD: Trạm biến áp/), {
      target: { value: 'Trạm biến áp Phố Nối' },
    });
    await chooseReason(/Khảo sát hiện trường/);
    fireEvent.change(screen.getByLabelText(DESCRIPTION_LABEL), {
      target: { value: 'Khảo sát tuyến dây' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm khoảng công tác' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xoá khoảng công tác 2' }));
    expect(screen.queryByText(/Tổng 2 khoảng công tác/)).toBeNull();
    fireEvent.click(submitButton());
    await waitFor(() => expect(draftBody('business_trip')).toBeTruthy());
    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === 'POST' && c.url.endsWith('/business-trip-requests')),
      ).toHaveLength(1),
    );
  });

  it('giải trình công gửi reasonId + description', async () => {
    reasonCatalog = {
      ATTENDANCE_CORRECTION: [catalogReason('ATTENDANCE_CORRECTION', 'ac1', 'Quên chấm công')],
    };
    await openForm('correction');
    await chooseReason(/Quên chấm công/);
    fireEvent.change(screen.getByLabelText(DESCRIPTION_LABEL), {
      target: { value: 'Quên quẹt thẻ buổi sáng' },
    });
    fireEvent.click(submitButton());
    await waitFor(() => expect(draftBody('correction')).toBeTruthy());
    const payload = draftBody('correction')?.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ reasonId: 'ac1', description: 'Quên quẹt thẻ buổi sáng' });
    expect(payload).not.toHaveProperty('reason');
  });

  it('giải trình công chỉ có một mốc vào - ra trong ngày, gửi đúng một phiên', async () => {
    reasonCatalog = {
      ATTENDANCE_CORRECTION: [catalogReason('ATTENDANCE_CORRECTION', 'ac1', 'Quên chấm công')],
    };
    await openForm('correction');
    expect(screen.getByText('Giờ vào *')).toBeTruthy();
    expect(screen.getByText('Giờ ra *')).toBeTruthy();
    expect(screen.queryByText('Thêm phiên')).toBeNull();
    await chooseReason(/Quên chấm công/);
    fireEvent.click(submitButton());
    await waitFor(() => expect(draftBody('correction')).toBeTruthy());
    const payload = draftBody('correction')?.payload as { sessions: { start: string; end: string }[] };
    expect(payload.sessions).toHaveLength(1);
    const [session] = payload.sessions;
    expect(new Date(session.end).getTime() - new Date(session.start).getTime()).toBe(9 * 3600 * 1000);
  });

  it('giải trình công: giờ ra không sau giờ vào thì chặn gửi và báo lỗi rõ ràng', async () => {
    reasonCatalog = {
      ATTENDANCE_CORRECTION: [catalogReason('ATTENDANCE_CORRECTION', 'ac1', 'Quên chấm công')],
    };
    await openForm('correction');
    await chooseReason(/Quên chấm công/);
    const out = screen.getAllByDisplayValue('17:00')[0];
    fireEvent.change(out, { target: { value: '07:00' } });
    fireEvent.blur(out);
    fireEvent.click(submitButton());
    expect(await screen.findByText('Giờ ra phải sau giờ vào trong cùng một ngày.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/attendance-corrections'))).toBe(false);
  });

  it('danh mục rỗng: hiện thông báo cho quản trị viên và khóa nút gửi', async () => {
    reasonCatalog = { OVERTIME: [] };
    await openForm('ot');
    expect(
      await screen.findByText(
        'Chưa có lý do nào cho loại đơn này. Quản trị viên cần cấu hình tại Cấu hình, Lý do đơn từ.',
      ),
    ).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
  });

  it('đơn nghỉ không có lý do nghỉ nào: thông báo trỏ tới Phép năm và lý do nghỉ, khóa nút gửi', async () => {
    leaveTypes = [];
    await openForm('leave');
    expect(
      await screen.findByText(
        'Chưa có lý do nào cho loại đơn này. Quản trị viên cần cấu hình tại Cấu hình, Phép năm và lý do nghỉ.',
      ),
    ).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
  });

  it('lỗi tải danh mục: báo lỗi, cho thử lại và khóa nút gửi', async () => {
    reasonCatalog = { OVERTIME: otReasons() };
    const original = hrmFetchMock.getMockImplementation() as (
      path: string,
      init?: RequestInit,
    ) => Promise<unknown>;
    let failed = false;
    hrmFetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
      if (path.startsWith('/request-reasons') && !failed) {
        failed = true;
        hrmPaths.push(path);
        throw new Error('Máy chủ bận');
      }
      return original(path, init);
    }) as never);
    await openForm('ot');
    expect(await screen.findByText(/Không tải được danh sách lý do: Máy chủ bận/)).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Thử lại', hidden: true })[0]);
    await screen.findByPlaceholderText(/^Chọn lý do/);
  });

  // Loại đơn tạm ẩn: giữ test để bật lại khi thêm loại đơn vào VISIBLE_REQUEST_KINDS.
  it.skip('ứng lương vẫn dùng lý do nhập tự do, gửi reason như trước', async () => {
    await openForm('advance' as keyof typeof KIND_BUTTON);
    expect(screen.queryByPlaceholderText('Chọn lý do...')).toBeNull();
    fireEvent.change(await screen.findByPlaceholderText(/Nhập chi tiết lý do/), {
      target: { value: 'Chi phí gia đình' },
    });
    fireEvent.click(submitButton());
    await waitFor(() => expect(draftBody('advance')).toBeTruthy());
    const payload = draftBody('advance')?.payload as Record<string, unknown>;
    expect(payload.reason).toBe('Chi phí gia đình');
    expect(payload).not.toHaveProperty('reasonId');
  });
});

describe('Form tạo đơn: khối Người duyệt', () => {
  const reasons = () => ({
    OVERTIME: [catalogReason('OVERTIME', 'ot1', 'Theo yêu cầu công việc')],
  });
  const preview = () => screen.findByTestId('approver-preview');

  it('chưa chọn lý do thì chưa gọi approval-route và chưa hiện khối', async () => {
    reasonCatalog = reasons();
    approvalRoute = { mode: 'DIRECT', directManager: null };
    await openForm('ot');
    await screen.findByPlaceholderText(/^Chọn lý do/);
    expect(screen.queryByTestId('approver-preview')).toBeNull();
    expect(hrmPaths.some((p) => p.startsWith('/approval-route'))).toBe(false);
  });

  it('DIRECT có quản lý: hiện Quản lý trực tiếp kèm họ tên, chức danh và gọi đúng tham số', async () => {
    reasonCatalog = reasons();
    approvalRoute = {
      mode: 'DIRECT',
      directManager: { employeeId: 'm1', fullName: 'Trần Văn B', positionName: 'Trưởng phòng' },
      selfApprovalBlocked: true,
    };
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    const block = await preview();
    expect(block.textContent).toBe('Người duyệt: Quản lý trực tiếp (Trần Văn B, Trưởng phòng)');
    expect(hrmPaths).toContain('/approval-route?kind=ot&employeeId=e1&reasonId=ot1');
  });

  it('PROCEDURE: hiện Duyệt theo quy trình kèm tên quy trình', async () => {
    reasonCatalog = reasons();
    approvalRoute = { mode: 'PROCEDURE', procedureName: 'Quy trình duyệt OT', directManager: null };
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    expect((await preview()).textContent).toBe(
      'Người duyệt: Duyệt theo quy trình (Quy trình duyệt OT)',
    );
  });

  it('DIRECT nhưng chưa có quản lý: hiện ghi chú của máy chủ', async () => {
    reasonCatalog = reasons();
    approvalRoute = {
      mode: 'DIRECT',
      directManager: null,
      note: 'Bạn chưa có quản lý trực tiếp; đơn sẽ do người có quyền duyệt toàn bộ xử lý.',
    };
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    const block = await preview();
    expect(block.textContent).toContain('Người duyệt: Quản lý trực tiếp');
    expect(block.textContent).toContain('Bạn chưa có quản lý trực tiếp');
  });

  it('lỗi tải người duyệt: ẩn khối và không chặn gửi đơn', async () => {
    reasonCatalog = reasons();
    approvalRoute = new Error('Lỗi máy chủ');
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    await waitFor(() =>
      expect(hrmPaths.some((p) => p.startsWith('/approval-route'))).toBe(true),
    );
    expect(screen.queryByTestId('approver-preview')).toBeNull();
    expect(submitButton().disabled).toBe(false);
  });

  it('đơn nghỉ gọi approval-route với reasonId là id loại nghỉ', async () => {
    leaveTypes = [leaveType('lt-annual', 'ANNUAL', 'Nghỉ phép năm', { isAnnual: true })];
    approvalRoute = {
      mode: 'DIRECT',
      directManager: { employeeId: 'm1', fullName: 'Trần Văn B', positionName: null },
    };
    await openForm('leave');
    await chooseReason(/Nghỉ phép năm/);
    expect((await preview()).textContent).toBe('Người duyệt: Quản lý trực tiếp (Trần Văn B)');
    expect(hrmPaths).toContain('/approval-route?kind=leave&employeeId=e1&reasonId=lt-annual');
  });

  // Loại đơn tạm ẩn: giữ test để bật lại khi thêm loại đơn vào VISIBLE_REQUEST_KINDS.
  it.skip('ứng lương không có lý do danh mục vẫn cho biết người duyệt, không kèm reasonId', async () => {
    approvalRoute = { mode: 'PROCEDURE', procedureName: 'Quy trình tạm ứng', directManager: null };
    await openForm('advance' as keyof typeof KIND_BUTTON);
    expect((await preview()).textContent).toBe(
      'Người duyệt: Duyệt theo quy trình (Quy trình tạm ứng)',
    );
    expect(hrmPaths).toContain('/approval-route?kind=advance&employeeId=e1');
  });
});

describe('Danh sách và chi tiết đơn: Lý do tách khỏi Mô tả', () => {
  const rows = () => {
    leaveRows = [
      {
        id: 'aaaaaaaa-0000-0000-0000-000000000001',
        status: 'PENDING',
        createdAt: '2026-09-10T01:00:00.000Z',
        fromDate: '2026-10-01',
        toDate: '2026-10-02',
        duration: 2,
        reasonId: 'lt-sick',
        reasonName: 'Nghỉ ốm',
        description: 'Đi khám tại bệnh viện',
        reason: 'Đi khám tại bệnh viện',
      },
      {
        id: 'aaaaaaaa-0000-0000-0000-000000000002',
        status: 'PENDING',
        createdAt: '2026-09-09T01:00:00.000Z',
        fromDate: '2026-10-05',
        toDate: '2026-10-05',
        duration: 1,
        reasonId: null,
        reasonName: null,
        description: 'Việc gia đình (đơn cũ)',
        reason: 'Việc gia đình (đơn cũ)',
      },
      {
        id: 'aaaaaaaa-0000-0000-0000-000000000003',
        status: 'PENDING',
        createdAt: '2026-09-08T01:00:00.000Z',
        fromDate: '2026-10-06',
        toDate: '2026-10-06',
        duration: 1,
        reasonId: 'lt-sick',
        reasonName: 'Nghỉ ốm',
        description: null,
        reason: '',
      },
    ];
    otRows = [
      {
        id: 'bbbbbbbb-0000-0000-0000-000000000001',
        status: 'PENDING',
        createdAt: '2026-09-11T01:00:00.000Z',
        workDate: '2026-10-03',
        startTime: '17:30',
        endTime: '19:30',
        plannedMinutes: 120,
        otType: 'WEEKDAY',
        otRateMultiplier: 1.5,
        paid: false,
        reasonId: 'ot2',
        reasonName: 'Làm bù không tính tiền',
        description: 'Tự nguyện hoàn thiện báo cáo',
        reason: 'Tự nguyện hoàn thiện báo cáo',
      },
    ];
  };

  const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLTableRowElement;
  const cells = (row: HTMLTableRowElement) =>
    Array.from(row.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim());

  it('lịch sử có hai cột riêng Lý do và Mô tả; đơn cũ thiếu lý do hiện "—"', async () => {
    rows();
    render(<RequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Lịch sử đơn từ/ }));
    await screen.findByText('Đi khám tại bệnh viện');
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    const reasonIndex = headers.indexOf('Lý do');
    expect(reasonIndex).toBeGreaterThan(-1);
    expect(headers[reasonIndex + 1]).toBe('Mô tả');

    const sick = cells(rowOf('Đi khám tại bệnh viện'));
    expect(sick[reasonIndex]).toBe('Nghỉ ốm');
    expect(sick[reasonIndex + 1]).toBe('Đi khám tại bệnh viện');
    // Mô tả không lẫn vào cột lý do.
    expect(sick[reasonIndex]).not.toContain('Đi khám');

    const legacy = cells(rowOf('Việc gia đình (đơn cũ)'));
    expect(legacy[reasonIndex]).toBe('—');
    expect(legacy[reasonIndex + 1]).toBe('Việc gia đình (đơn cũ)');
  });

  it('mô tả rỗng hiện "—"; đơn làm thêm giờ không lương có thẻ Không lương', async () => {
    rows();
    render(<RequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Lịch sử đơn từ/ }));
    await screen.findByText('Tự nguyện hoàn thiện báo cáo');
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    const reasonIndex = headers.indexOf('Lý do');
    const empty = Array.from(document.querySelectorAll('tbody tr'))
      .map((tr) => cells(tr as HTMLTableRowElement))
      .find((c) => c[reasonIndex] === 'Nghỉ ốm' && c[reasonIndex + 1] === '—');
    expect(empty).toBeTruthy();

    const ot = cells(rowOf('Tự nguyện hoàn thiện báo cáo'));
    expect(ot[reasonIndex]).toContain('Làm bù không tính tiền');
    expect(ot[reasonIndex]).toContain('Không lương');
    // Đơn có lương không bị gắn thẻ.
    expect(cells(rowOf('Đi khám tại bệnh viện'))[reasonIndex]).not.toContain('Không lương');
  });

  it('danh sách chờ duyệt ghi Lý do và Mô tả thành hai mục riêng', async () => {
    rows();
    render(<RequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Đơn đang chờ duyệt/ }));
    await screen.findByText('Đi khám tại bệnh viện');
    const text = footer();
    expect(text).toContain('Lý do: Nghỉ ốm');
    expect(text).toContain('Mô tả: Đi khám tại bệnh viện');
    expect(text).toContain('Lý do: — • Mô tả: Việc gia đình (đơn cũ)');
  });

  it('chi tiết đơn có khối Lý do và khối Mô tả riêng', async () => {
    rows();
    render(<RequestsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Lịch sử đơn từ/ }));
    await screen.findByText('Tự nguyện hoàn thiện báo cáo');
    const otRow = rowOf('Tự nguyện hoàn thiện báo cáo');
    fireEvent.click(otRow.querySelector('button') as HTMLButtonElement);
    const reason = await screen.findByTestId('detail-reason');
    expect(reason.textContent).toContain('Làm bù không tính tiền');
    expect(reason.textContent).toContain('Không lương');
    expect(reason.textContent).not.toContain('Tự nguyện hoàn thiện báo cáo');
    expect(screen.getByTestId('detail-description').textContent).toContain(
      'Tự nguyện hoàn thiện báo cáo',
    );
  });
});

describe('computeLeaveFromPreview: hệ số 0.5', () => {
  const workDay = (date: string) => ({
    date,
    kind: 'WORK' as const,
    weight: 1,
    shiftMinutes: 480,
    startMinutes: 450,
    endMinutes: 1020,
    breakStartMinutes: 690,
    breakEndMinutes: 780,
  });
  const days = [workDay('2026-10-14'), workDay('2026-10-15')];
  it('ngày cuối nghỉ tới 10:30 (3 giờ): quy về 0.5 thay vì 0.375', () => {
    expect(computeLeaveFromPreview(days, '07:30', '10:30', true).total).toBe(1.5);
    expect(computeLeaveFromPreview(days, '07:30', '10:30', false).total).toBe(1.375);
  });
  it('nghỉ tới 11:30 ngày cuối: 1 + 0.5', () => {
    expect(computeLeaveFromPreview(days, '07:30', '11:30', true).total).toBe(1.5);
  });
  it('nghỉ cả hai ngày trọn ca: 2', () => {
    expect(computeLeaveFromPreview(days, '07:30', '17:00', true).total).toBe(2);
  });
});
