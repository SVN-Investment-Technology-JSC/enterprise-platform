/** @jest-environment jsdom */
import {
  dispatchAssistantAction,
  setAssistantResultSink,
} from '@enterprise-platform/feature-module-shell';
import { act, fireEvent, within, render, screen, waitFor } from '@testing-library/react';
import { hrmFetch } from '../hrm-api';
import { toast } from '../ui/toast';
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
let otRows: unknown[] = [];
let leaveTypes: unknown[] = [];
let leaveBalanceRows: unknown[] = [];
/** Danh mục lý do trả về theo kind (OVERTIME, BUSINESS_TRIP, ATTENDANCE_CORRECTION, SHIFT_CHANGE). */
let reasonCatalog: Record<string, unknown[]> = {};
/** Phản hồi của GET /approval-route; Error thì giả lập lỗi tải. */
let approvalRoute: unknown = null;
let hrmPaths: string[] = [];
/** Danh mục loại đơn cấu hình (GET /request-types) và đơn của các loại tuỳ chỉnh. */
let requestTypeRows: unknown[] = [];
let customRows: unknown[] = [];
/** Kết quả GET /requests/time-preview. */
let timePreviewResult: unknown = null;
// Khi có: quyết định kết quả xem trước theo đường dẫn (khoảng nào của đơn nhiều khoảng).
let timePreviewFn: ((path: string) => unknown) | null = null;
// Số lần POST tới /ot-requests đã gọi và lần bắt đầu trả lỗi (0 = không lỗi).
let otPostCount = 0;
let otFailFrom = 0;

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
  leaveBalanceRows = [];
  reasonCatalog = {};
  approvalRoute = null;
  hrmPaths = [];
  requestTypeRows = [];
  customRows = [];
  timePreviewResult = null;
  timePreviewFn = null;
  otPostCount = 0;
  otFailFrom = 0;
  mockActions.clear();
  mockActions.add('hrm.self.request');
  hrmFetchMock.mockReset();
  hrmFetchMock.mockImplementation((async (path: string) => {
    hrmPaths.push(path);
    if (path.startsWith('/request-reasons')) {
      const kind = new URLSearchParams(path.split('?')[1]).get('kind') ?? '';
      return { data: reasonCatalog[kind] ?? [] };
    }
    if (path.startsWith('/requests/time-preview'))
      return { data: timePreviewFn ? timePreviewFn(path) : timePreviewResult };
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
    if (method === 'POST' && url.endsWith('/ot-requests') && otFailFrom && ++otPostCount >= otFailFrom)
      return respond({ error: { message: 'Trùng đơn đã có' } }, false, 409);
    if (method === 'POST') return respond({ data: { id: 'new' } });
    if (url.includes('/request-types')) return respond({ data: requestTypeRows });
    if (url.includes('/custom-requests')) return respond({ data: customRows });
    if (url.includes('/leave-balances')) return respond({ data: leaveBalanceRows });
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
  fireEvent.click(await screen.findByPlaceholderText('Chọn lý do...'));
  fireEvent.click(await screen.findByRole('option', { name, hidden: true }));
}

const DESCRIPTION_LABEL = /Mô tả \(nhập thêm chi tiết nếu cần\)/;
// Đơn làm thêm giờ và công tác bắt buộc Mô tả (nội dung công việc).
const OT_DESCRIPTION_LABEL = /Mô tả nội dung công việc làm thêm/;
const TRIP_DESCRIPTION_LABEL = /Nội dung công việc công tác/;
// Đơn đổi ca không còn trong danh mục tạo đơn (ca cố định toàn công ty).
const KIND_BUTTON = { leave: 0, ot: 1, business_trip: 2, correction: 3, advance: 4 };

/** Mọi nút khởi tạo đơn: bốn loại tạo nhanh rồi tới các loại còn lại (mở bằng "Tất cả loại đơn"). */
async function allTypeButtons() {
  await screen.findAllByRole('button', { name: /Khởi tạo đơn này/ });
  const toggle = screen.queryByRole('button', { name: /Tất cả loại đơn/ });
  if (toggle && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  return screen.getAllByRole('button', { name: /Khởi tạo đơn này/ });
}

async function openForm(kind: keyof typeof KIND_BUTTON) {
  render(<RequestsPage />);
  const buttons = await allTypeButtons();
  fireEvent.click(buttons[KIND_BUTTON[kind]]);
}

const submitButton = () =>
  screen.getByRole('button', { name: /Gửi duyệt đơn/, hidden: true }) as HTMLButtonElement;
const draftBody = (kind: string) =>
  calls.find((c) => c.url.endsWith(`/request-drafts/${kind}`) && c.method === 'POST')?.body;

/** Xem đơn của mọi tháng (dữ liệu mẫu tạo ở các tháng cố định, không phụ thuộc tháng hiện tại). */
async function showAllMonths() {
  fireEvent.click(await screen.findByRole('button', { name: 'Tất cả tháng' }));
}

async function openHistory(rows: number) {
  leaveRows = Array.from({ length: rows }, (_, i) => leaveRow(i));
  render(<RequestsPage />);
  await showAllMonths();
}

describe('Lối tắt ?create= từ Bàn làm việc', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('mở thẳng form tạo đơn của loại được chọn, một lần', async () => {
    window.history.replaceState(null, '', '/?create=ot');
    render(<RequestsPage />);
    expect(await screen.findByRole('button', { name: /Gửi duyệt đơn/, hidden: true })).toBeTruthy();
  });

  it('?request= mở đúng đơn dù không phải đơn đầu tiên và nằm ở trang sau', async () => {
    leaveRows = Array.from({ length: 25 }, (_, i) => leaveRow(i));
    const target = leaveRow(0).id;
    window.history.replaceState(null, '', `/?request=${target}`);
    render(<RequestsPage />);
    const row = await screen.findByTestId(`request-row-${target}`);
    await waitFor(() =>
      expect(screen.getByTestId(`request-row-${target}`).getAttribute('aria-selected')).toBe('true'),
    );
    expect(row.getAttribute('data-testid')).toBe(`request-row-${target}`);
  });

  it('loại không có trong danh mục thì không mở gì', async () => {
    window.history.replaceState(null, '', '/?create=khong-co');
    render(<RequestsPage />);
    await screen.findAllByRole('button', { name: /Khởi tạo đơn này/ });
    expect(screen.queryByRole('button', { name: /Gửi duyệt đơn/, hidden: true })).toBeNull();
  });
});

describe('Đơn từ của tôi', () => {
  it('có tiêu đề mới và danh mục đủ 6 loại đơn có nút khởi tạo, không có đơn đổi ca', async () => {
    render(<RequestsPage />);
    expect(
      await screen.findByRole('heading', { name: 'Đơn từ của tôi' }),
    ).toBeTruthy();
    // Bốn loại tạo nhanh hiện sẵn; tạm ứng và đính chính hồ sơ nằm sau "Tất cả loại đơn".
    expect(await screen.findAllByRole('button', { name: /Khởi tạo đơn này/ })).toHaveLength(4);
    expect(await allTypeButtons()).toHaveLength(6);
    for (const title of [
      'Đơn xin nghỉ phép',
      'Đơn làm thêm giờ (OT)',
      'Đơn đi công tác',
      'Đơn giải trình / Bổ sung công',
      'Đơn tạm ứng lương',
      'Đơn đính chính hồ sơ',
    ]) {
      expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    }
    expect(screen.queryByRole('heading', { name: 'Đơn đổi ca' })).toBeNull();
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
    const buttons = await allTypeButtons();
    fireEvent.click(buttons[4]);
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
    const buttons = await allTypeButtons();
    fireEvent.click(buttons[5]);
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

  it('phân trang lịch sử 20 dòng mỗi trang', async () => {
    await openHistory(25);
    await waitFor(() => expect(footer()).toContain('Hiển thị 1-20 trên 25 đơn'));
    expect(screen.getAllByRole('button', { name: /^Chi tiết đơn / })).toHaveLength(20);
    expect(screen.getByText('1 / 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sau' }));
    await waitFor(() => expect(footer()).toContain('Hiển thị 21-25 trên 25 đơn'));
    expect(screen.getAllByRole('button', { name: /^Chi tiết đơn / })).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Sau' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Trước' }));
    await waitFor(() => expect(footer()).toContain('Hiển thị 1-20 trên 25 đơn'));
  });

  it('xuất lịch sử đơn tạo file CSV thật từ các dòng đang lọc', async () => {
    await openHistory(3);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Chi tiết đơn / })).toHaveLength(3));
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
    await screen.findByPlaceholderText('Chọn lý do...');
    expect(hrmPaths).toContain('/request-reasons?kind=OVERTIME&active=true');
    // Hai phần tách biệt: nhãn Lý do (bắt buộc) và ô Mô tả nội dung công việc (đơn làm thêm giờ luôn bắt buộc).
    expect(screen.getAllByText('Lý do', { exact: false }).length).toBeGreaterThan(0);
    const description = screen.getByLabelText(OT_DESCRIPTION_LABEL) as HTMLTextAreaElement;
    expect(description.tagName).toBe('TEXTAREA');
    expect(description.required).toBe(true);
    expect(footer()).not.toContain('Loại OT');
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

  it('đơn làm thêm giờ luôn bắt buộc Mô tả; lý do cấu hình cần mô tả thì thêm cảnh báo riêng', async () => {
    reasonCatalog = { OVERTIME: otReasons() };
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    const description = screen.getByLabelText(OT_DESCRIPTION_LABEL) as HTMLTextAreaElement;
    expect(description.required).toBe(true);
    expect(screen.queryByText('Lý do đã chọn yêu cầu nhập mô tả.')).toBeNull();
    // Chưa nhập Mô tả thì chưa gửi được, kể cả khi lý do không yêu cầu.
    expect(submitButton().disabled).toBe(true);
    fireEvent.change(description, { target: { value: '   ' } });
    expect(submitButton().disabled).toBe(true);
    fireEvent.change(description, { target: { value: 'Chạy kịp tiến độ bàn giao' } });
    expect(submitButton().disabled).toBe(false);

    await chooseReason(/^Khác/);
    expect(screen.getByText('Lý do đã chọn yêu cầu nhập mô tả.')).toBeTruthy();
  });

  it('đơn công tác luôn bắt buộc Nội dung công việc', async () => {
    reasonCatalog = { BUSINESS_TRIP: [catalogReason('BUSINESS_TRIP', 'bt1', 'Khảo sát hiện trường')] };
    await openForm('business_trip');
    await chooseReason(/Khảo sát hiện trường/);
    fireEvent.change(screen.getByPlaceholderText(/VD: Trạm biến áp/), { target: { value: 'Trạm biến áp' } });
    const description = screen.getByLabelText(TRIP_DESCRIPTION_LABEL) as HTMLTextAreaElement;
    expect(description.required).toBe(true);
    expect(submitButton().disabled).toBe(true);
    fireEvent.change(description, { target: { value: 'Kiểm tra thiết bị' } });
    await waitFor(() => expect(submitButton().disabled).toBe(false));
  });

  it('gửi đơn làm thêm giờ với reasonId và description, không gửi reason hay otType', async () => {
    reasonCatalog = { OVERTIME: otReasons() };
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    fireEvent.change(screen.getByLabelText(OT_DESCRIPTION_LABEL), {
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

  it('đơn nghỉ bỏ trống Mô tả thì không gửi description (Mô tả không bắt buộc)', async () => {
    leaveTypes = [leaveType('lt-sick', 'SICK', 'Nghỉ ốm', { paid: false })];
    await openForm('leave');
    await chooseReason(/Nghỉ ốm/);
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(submitButton());
    await waitFor(() => expect(draftBody('leave')).toBeTruthy());
    const payload = draftBody('leave')?.payload as Record<string, unknown>;
    expect(payload.leaveTypeId).toBe('lt-sick');
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

  it('đơn nghỉ: quỹ phép chỉ hiện khi chọn lý do trừ phép năm; lý do khác không có quỹ', async () => {
    leaveTypes = [
      leaveType('lt-annual', 'ANNUAL', 'Nghỉ phép năm', { deductBalance: true, isAnnual: true }),
      leaveType('lt-sick', 'SICK', 'Nghỉ ốm', { paid: false }),
    ];
    await openForm('leave');
    // chưa chọn lý do: chưa có quỹ
    await screen.findByPlaceholderText('Chọn lý do...');
    expect(screen.queryByTestId('leave-fund')).toBeNull();
    await chooseReason(/Nghỉ phép năm/);
    expect(screen.getByTestId('leave-fund').textContent).toContain('Quỹ phép năm khả dụng');
    await chooseReason(/Nghỉ ốm/);
    expect(screen.queryByTestId('leave-fund')).toBeNull();
    // số ngày nghỉ tính toán vẫn có cho mọi lý do
    expect(screen.getByTestId('leave-info').textContent).toContain('Số ngày nghỉ tính toán');
  });

  it('phép năm chưa có quỹ hoặc quỹ bằng 0: báo không đủ quỹ và khoá nút gửi; lý do khác vẫn gửi được', async () => {
    leaveTypes = [
      leaveType('lt-annual', 'ANNUAL', 'Nghỉ phép năm', { deductBalance: true, isAnnual: true }),
      leaveType('lt-sick', 'SICK', 'Nghỉ ốm', { paid: false }),
    ];
    // Chưa có dòng quỹ nào
    await openForm('leave');
    await chooseReason(/Nghỉ phép năm/);
    expect((await screen.findByTestId('leave-fund-error')).textContent).toContain('quỹ hiện bằng 0');
    expect(submitButton().disabled).toBe(true);
    // Đổi sang lý do không trừ phép năm: hết chặn
    await chooseReason(/Nghỉ ốm/);
    expect(screen.queryByTestId('leave-fund-error')).toBeNull();
    await waitFor(() => expect(submitButton().disabled).toBe(false));
  });

  it('phép năm có quỹ 0 ngày khả dụng bị chặn; có quỹ đủ thì gửi được, nghỉ quá quỹ thì chặn', async () => {
    leaveTypes = [leaveType('lt-annual', 'ANNUAL', 'Nghỉ phép năm', { deductBalance: true, isAnnual: true })];
    leaveBalanceRows = [{ leaveTypeId: 'lt-annual', remaining: 0, pending: 0, available: 0 }];
    await openForm('leave');
    await chooseReason(/Nghỉ phép năm/);
    expect((await screen.findByTestId('leave-fund-error')).textContent).toContain('Chưa có quỹ phép năm khả dụng');
    expect(submitButton().disabled).toBe(true);
  });

  it('phép năm còn quỹ đủ: hiện quỹ khả dụng và cho gửi', async () => {
    leaveTypes = [leaveType('lt-annual', 'ANNUAL', 'Nghỉ phép năm', { deductBalance: true, isAnnual: true })];
    leaveBalanceRows = [{ leaveTypeId: 'lt-annual', remaining: 5, pending: 0, available: 5 }];
    await openForm('leave');
    await chooseReason(/Nghỉ phép năm/);
    expect((await screen.findByTestId('leave-fund')).textContent).toContain('5');
    expect(screen.queryByTestId('leave-fund-error')).toBeNull();
    await waitFor(() => expect(submitButton().disabled).toBe(false));
  });

  it('đơn nghỉ không còn ô ứng phép / âm phép; tệp đính kèm không bắt buộc', async () => {
    leaveTypes = [leaveType('lt-sick', 'SICK', 'Nghỉ ốm', { paid: false })];
    await openForm('leave');
    await chooseReason(/Nghỉ ốm/);
    expect(screen.queryByText(/ứng trước \/ âm phép/)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/Tệp đính kèm \(không bắt buộc\)/)).toBeTruthy();
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/leave-requests'))).toBe(true),
    );
    const sent = draftBody('leave')?.payload as Record<string, unknown>;
    expect(sent.isNegativeLeave).toBe(false);
    expect(sent.attachmentFileId).toBeUndefined();
  });

  it('giờ nghỉ chọn được từ danh sách 24 giờ và gõ tay', async () => {
    leaveTypes = [leaveType('lt-sick', 'SICK', 'Nghỉ ốm', { paid: false })];
    await openForm('leave');
    const toTime = (await screen.findByLabelText('Đến ngày giờ (giờ)')) as HTMLInputElement;
    fireEvent.click(toTime);
    const list = await screen.findByRole('listbox', { name: /24 giờ/ });
    fireEvent.click(within(list).getByRole('option', { name: '12:00' }));
    expect(toTime.value).toBe('12:00');
    const fromTime = screen.getByLabelText('Từ ngày giờ (giờ)') as HTMLInputElement;
    fireEvent.change(fromTime, { target: { value: '830' } });
    fireEvent.blur(fromTime);
    expect(fromTime.value).toBe('08:30');
  });

  it('công tác và giải trình công lấy lý do từ danh mục theo loại đơn', async () => {
    reasonCatalog = {
      BUSINESS_TRIP: [catalogReason('BUSINESS_TRIP', 'bt1', 'Khảo sát hiện trường')],
      ATTENDANCE_CORRECTION: [catalogReason('ATTENDANCE_CORRECTION', 'ac1', 'Quên chấm công')],
    };
    await openForm('business_trip');
    await screen.findByPlaceholderText('Chọn lý do...');
    expect(hrmPaths).toContain('/request-reasons?kind=BUSINESS_TRIP&active=true');
    // Ô "Lý do công tác" chọn tay kiểu cũ đã được thay bằng danh mục.
    expect(footer()).not.toContain('Lý do công tác');
    fireEvent.change(screen.getByPlaceholderText(/VD: Trạm biến áp/), {
      target: { value: 'Trạm biến áp Phố Nối' },
    });
    await chooseReason(/Khảo sát hiện trường/);
    fireEvent.change(screen.getByLabelText(TRIP_DESCRIPTION_LABEL), { target: { value: 'Kiểm tra thiết bị' } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(draftBody('business_trip')).toBeTruthy());
    const trip = draftBody('business_trip')?.payload as Record<string, unknown>;
    expect(trip).toMatchObject({ reasonId: 'bt1', destination: 'Trạm biến áp Phố Nối' });
    expect(trip).not.toHaveProperty('reason');
    expect(trip.attributes as Record<string, unknown>).not.toHaveProperty('tripReasonCategory');
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

  async function openCorrection() {
    reasonCatalog = {
      ATTENDANCE_CORRECTION: [catalogReason('ATTENDANCE_CORRECTION', 'ac1', 'Quên chấm công')],
    };
    await openForm('correction');
    await chooseReason(/Quên chấm công/);
  }

  it('giải trình công chỉ một mốc: mặc định giờ vào 08:00, ngày không hiện lặp lại, không có nút thêm dòng hay tab theo phiên', async () => {
    await openCorrection();
    const punches = await screen.findByTestId('correction-punches');
    expect((within(screen.getByTestId('correction-punch-1')).getByLabelText('Giờ vào (giờ)') as HTMLInputElement).value).toBe('08:00');
    // Ngày chỉ nhập một lần ở "Ngày phát sinh điều chỉnh"; không còn thêm dòng hay khai báo theo phiên.
    expect(within(punches).queryByTestId('correction-punch-date')).toBeNull();
    expect(within(punches).queryByRole('button', { name: /^Thêm giờ/i })).toBeNull();
    expect(screen.queryByTestId('correction-punch-2')).toBeNull();
    expect(screen.queryByRole('tab', { name: /phiên/i })).toBeNull();
    fireEvent.change(within(punches).getByLabelText('Giờ vào (giờ)'), { target: { value: '0830' } });
    fireEvent.blur(within(punches).getByLabelText('Giờ vào (giờ)'));
    fireEvent.click(submitButton());
    await waitFor(() => expect(draftBody('correction')).toBeTruthy());
    const payload = draftBody('correction')?.payload as { punches: { kind: string; at: string }[] } & Record<string, unknown>;
    expect(payload).not.toHaveProperty('sessions');
    expect(payload.punches).toHaveLength(1);
    expect(payload.punches[0].kind).toBe('IN');
    expect(new Date(payload.punches[0].at).getMinutes()).toBe(30);
  });

  it('giải trình công chỉ bổ sung giờ ra (quên chấm ra): đổi loại sang giờ ra, giờ gợi ý theo loại mới, chỉ gửi một mốc giờ ra', async () => {
    await openCorrection();
    const punches = await screen.findByTestId('correction-punches');
    fireEvent.click(within(punches).getByPlaceholderText('Chọn giờ vào / ra'));
    fireEvent.click(await screen.findByRole('option', { name: 'Giờ ra', hidden: true }));
    // Giờ còn là giờ gợi ý của loại cũ nên đổi theo gợi ý của giờ ra.
    expect((within(punches).getByLabelText('Giờ ra (giờ)') as HTMLInputElement).value).toBe('17:00');
    fireEvent.click(submitButton());
    await waitFor(() => expect(draftBody('correction')).toBeTruthy());
    const payload = draftBody('correction')?.payload as { punches: { kind: string }[] };
    expect(payload.punches).toHaveLength(1);
    expect(payload.punches[0].kind).toBe('OUT');
  });


  it('danh mục rỗng: hiện thông báo cho quản trị viên và khóa nút gửi', async () => {
    reasonCatalog = { OVERTIME: [] };
    await openForm('ot');
    expect(
      await screen.findByText(
        'Chưa có lý do nào cho loại đơn này. Quản trị viên cần cấu hình tại Cấu hình, Loại đơn và lý do.',
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
    await screen.findByPlaceholderText('Chọn lý do...');
  });

  it('ứng lương vẫn dùng lý do nhập tự do, gửi reason như trước', async () => {
    await openForm('advance');
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
    await screen.findByPlaceholderText('Chọn lý do...');
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
    fireEvent.change(screen.getByLabelText(OT_DESCRIPTION_LABEL), { target: { value: 'Chạy tiến độ' } });
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

  it('ứng lương không có lý do danh mục vẫn cho biết người duyệt, không kèm reasonId', async () => {
    approvalRoute = { mode: 'PROCEDURE', procedureName: 'Quy trình tạm ứng', directManager: null };
    await openForm('advance');
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

  const ID = {
    sick: 'aaaaaaaa-0000-0000-0000-000000000001',
    legacy: 'aaaaaaaa-0000-0000-0000-000000000002',
    ot: 'bbbbbbbb-0000-0000-0000-000000000001',
  };
  const rowById = (id: string) => screen.getByTestId(`request-row-${id}`) as HTMLTableRowElement;
  const cells = (row: HTMLTableRowElement) =>
    Array.from(row.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim());
  it('bảng không còn cột Thời gian, Số ngày/giờ, Lý do; đơn cũ thiếu lý do vẫn hiện ở chi tiết là "—"', async () => {
    rows();
    render(<RequestsPage />);
    await showAllMonths();
    await screen.findByTestId(`request-row-${ID.sick}`);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    for (const gone of ['Thời gian', 'Số ngày/giờ', 'Lý do', 'Mô tả']) expect(headers).not.toContain(gone);
    expect(headers).toContain('Loại đơn');
    // Bảng chỉ còn 5 cột dữ liệu + cột mở chi tiết: không lẫn lý do vào dòng.
    expect(cells(rowById(ID.sick)).join(' ')).not.toContain('Nghỉ ốm');
  });

  it('đơn làm thêm giờ không lương có thẻ Không lương ở cột Loại đơn; đơn có lương không bị gắn thẻ', async () => {
    rows();
    render(<RequestsPage />);
    await showAllMonths();
    await screen.findByTestId(`request-row-${ID.ot}`);
    expect(cells(rowById(ID.ot)).join(' ')).toContain('Không lương');
    expect(cells(rowById(ID.sick)).join(' ')).not.toContain('Không lương');
  });

  it('chi tiết bên phải ghi Lý do và Mô tả thành hai mục riêng, mô tả rỗng hiện "—"', async () => {
    rows();
    render(<RequestsPage />);
    await showAllMonths();
    fireEvent.click(await screen.findByTestId(`request-row-${ID.sick}`));
    expect((await screen.findByTestId('card-reason')).textContent).toBe('Nghỉ ốm');
    expect(screen.getByTestId('card-description').textContent).toBe('Đi khám tại bệnh viện');

    fireEvent.click(screen.getByTestId(`request-row-${ID.legacy}`));
    expect(screen.getByTestId('card-reason').textContent).toBe('—');
    expect(screen.getByTestId('card-description').textContent).toBe('Việc gia đình (đơn cũ)');
  });

  it('chi tiết đơn làm thêm giờ có khối Lý do kèm thẻ Không lương và khối Mô tả riêng', async () => {
    rows();
    render(<RequestsPage />);
    await showAllMonths();
    fireEvent.click(await screen.findByTestId(`request-row-${ID.ot}`));
    const reason = await screen.findByTestId('card-reason');
    expect(reason.textContent).toContain('Làm bù không tính tiền');
    expect(reason.textContent).toContain('Không lương');
    expect(reason.textContent).not.toContain('Tự nguyện hoàn thiện báo cáo');
    expect(screen.getByTestId('card-description').textContent).toContain('Tự nguyện hoàn thiện báo cáo');
  });

  it('nút Xem đầy đủ chi tiết mở ngăn kéo đầy đủ của đơn', async () => {
    rows();
    render(<RequestsPage />);
    await showAllMonths();
    fireEvent.click(await screen.findByTestId(`request-row-${ID.ot}`));
    fireEvent.click(await screen.findByRole('button', { name: 'Xem đầy đủ chi tiết' }));
    expect(await screen.findByTestId('detail-reason')).toBeTruthy();
    expect(screen.getByTestId('detail-description').textContent).toContain('Tự nguyện hoàn thiện báo cáo');
  });
});

describe('Đơn từ của tôi: tháng, thẻ tổng quan và lọc theo trạng thái', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const leave = (id: string, status: string, createdAt: string, reason: string) => ({
    id,
    status,
    createdAt,
    fromDate: '2026-10-01',
    toDate: '2026-10-01',
    duration: 1,
    reason,
    reasonName: reason,
    description: null,
  });
  const rowOf = (id: string) => screen.queryByTestId(`request-row-${id}`);

  it('mặc định xem tháng hiện tại; đơn tháng khác chỉ hiện khi chọn Tất cả tháng', async () => {
    const thisMonth = 'aaaaaaaa-1111-0000-0000-000000000001';
    const old = 'aaaaaaaa-1111-0000-0000-000000000002';
    leaveRows = [
      leave(thisMonth, 'PENDING', new Date().toISOString(), 'Đơn tháng này'),
      leave(old, 'PENDING', daysAgo(75), 'Đơn rất cũ'),
    ];
    render(<RequestsPage />);
    await screen.findByTestId(`request-row-${thisMonth}`);
    expect(rowOf(old)).toBeNull();
    await showAllMonths();
    expect(await screen.findByTestId(`request-row-${old}`)).toBeTruthy();
  });

  it('không còn thẻ tổng quan; tab trạng thái đếm và lọc danh sách', async () => {
    const now = new Date().toISOString();
    const [a, b, c, d] = [1, 2, 3, 4].map((n) => `aaaaaaaa-2222-0000-0000-00000000000${n}`);
    leaveRows = [
      leave(a, 'PENDING', now, 'Chờ A'),
      leave(b, 'PENDING', now, 'Chờ B'),
      leave(c, 'APPROVED', now, 'Duyệt C'),
      leave(d, 'REJECTED', now, 'Từ chối D'),
    ];
    render(<RequestsPage />);
    await screen.findByTestId(`request-row-${a}`);
    // Không còn thẻ tổng quan (tổng đơn, chờ duyệt, đã duyệt, từ chối); số đơn nằm trên các tab trạng thái.
    expect(screen.queryByTestId('request-stats')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /^Chờ duyệt \(2\)/ }));
    expect(rowOf(c)).toBeNull();
    expect(rowOf(b)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /^Từ chối \(1\)/ }));
    expect(rowOf(d)).toBeTruthy();
    expect(rowOf(a)).toBeNull();
  });

  it('đơn chờ duyệt có nút Thu hồi đơn: xác nhận rồi gọi withdraw', async () => {
    const id = 'aaaaaaaa-3333-0000-0000-000000000001';
    leaveRows = [leave(id, 'PENDING', new Date().toISOString(), 'Cần thu hồi')];
    render(<RequestsPage />);
    await screen.findByTestId(`request-row-${id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Thu hồi đơn' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ đơn' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith(`/requests/leave/${id}/withdraw`))).toBe(true),
    );
  });
});

const systemType = (id: string, code: string, engine: string, name: string) => ({
  id,
  tenantId: 't1',
  code,
  name,
  description: null,
  engine,
  kind: 'x',
  timeMode: 'RANGE_DATETIME',
  requiresAttachment: false,
  fields: [],
  icon: null,
  isSystem: true,
  active: true,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const customTypeRow = (over: Record<string, unknown> = {}) => ({
  ...systemType('ct1', 'DI_MUON', 'GENERIC', 'Xin đi muộn'),
  kind: 'custom',
  isSystem: false,
  timeMode: 'NONE',
  description: 'Đi muộn có báo trước',
  fields: [{ key: 'noi_den', label: 'Nơi đến', type: 'text', required: true }],
  ...over,
});

describe('Loại đơn cấu hình và thời gian từ ngày giờ đến ngày giờ', () => {
  it('danh mục tạo đơn lấy từ loại đơn cấu hình: đổi tên loại hệ thống và thêm loại tuỳ chỉnh', async () => {
    requestTypeRows = [
      systemType('s1', 'LEAVE', 'LEAVE', 'Nghỉ phép'),
      systemType('s2', 'OVERTIME', 'OVERTIME', 'Tăng ca'),
      customTypeRow(),
    ];
    render(<RequestsPage />);
    await allTypeButtons();
    expect(await screen.findByRole('heading', { name: 'Xin đi muộn' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tăng ca' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Đơn làm thêm giờ (OT)' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Khởi tạo đơn này/ })).toHaveLength(3);
  });

  it('đơn nghỉ có hai ô từ ngày giờ và đến ngày giờ, và hỏi máy chủ số giờ theo ca', async () => {
    timePreviewResult = {
      fromAt: 'a',
      toAt: 'b',
      timezone: 'Asia/Ho_Chi_Minh',
      totalMinutes: 480,
      totalHours: 8,
      totalDays: 1,
      days: [],
      warnings: [],
      errors: [],
    };
    await openForm('leave');
    expect(await screen.findByLabelText('Từ ngày giờ (ngày)')).toBeTruthy();
    expect(screen.getByLabelText('Đến ngày giờ (giờ)')).toBeTruthy();
    await waitFor(() =>
      expect(
        hrmPaths.some(
          (p) =>
            p.startsWith('/requests/time-preview?employeeId=e1&fromAt=') &&
            p.includes('&toAt='),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('8 giờ (1 ngày công)')).toBeTruthy();
  });

  it('khoảng thời gian có lỗi từ máy chủ thì chặn gửi và báo lỗi đầu tiên', async () => {
    reasonCatalog = { OVERTIME: [catalogReason('OVERTIME', 'ot1', 'Theo yêu cầu công việc')] };
    timePreviewResult = {
      fromAt: 'a',
      toAt: 'b',
      timezone: 'Asia/Ho_Chi_Minh',
      totalMinutes: 0,
      totalHours: 0,
      totalDays: 0,
      days: [],
      warnings: [],
      errors: ['Khoảng giờ nằm ngoài ca làm việc.'],
    };
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    fireEvent.change(screen.getByLabelText(OT_DESCRIPTION_LABEL), { target: { value: 'Chạy tiến độ' } });
    await screen.findAllByText('Khoảng giờ nằm ngoài ca làm việc.');
    fireEvent.click(submitButton());
    expect((await screen.findAllByText('Thời gian không hợp lệ')).length).toBeGreaterThan(0);
    expect(draftBody('ot')).toBeUndefined();
  });

  it('đơn làm thêm giờ: máy chủ báo trùng ca thì hiện lỗi, giữ nguyên lý do, mô tả và giờ đã chọn', async () => {
    reasonCatalog = { OVERTIME: [catalogReason('OVERTIME', 'ot1', 'Theo yêu cầu công việc')] };
    timePreviewResult = {
      fromAt: 'a',
      toAt: 'b',
      timezone: 'Asia/Ho_Chi_Minh',
      totalMinutes: 180,
      totalHours: 3,
      totalDays: 0,
      days: [],
      warnings: [],
      errors: ['Giờ làm thêm 16:00 - 17:00 ngày 12/10 trùng ca làm việc (08:00 - 17:00); OT chỉ được đăng ký ngoài ca.'],
    };
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    fireEvent.change(screen.getByLabelText(OT_DESCRIPTION_LABEL), { target: { value: 'Chạy tiến độ' } });
    const fromTime = screen.getByLabelText('Từ ngày giờ làm thêm (giờ)') as HTMLInputElement;
    fireEvent.change(fromTime, { target: { value: '16:00' } });
    fireEvent.blur(fromTime);
    await screen.findAllByText(/trùng ca làm việc/);
    // Lỗi chỉ hiện, không đụng tới lựa chọn của người dùng.
    expect((screen.getByPlaceholderText(/Chọn lý do|Theo yêu cầu/) as HTMLInputElement).value).toBe('Theo yêu cầu công việc');
    expect((screen.getByLabelText(OT_DESCRIPTION_LABEL) as HTMLTextAreaElement).value).toBe('Chạy tiến độ');
    expect((screen.getByLabelText('Từ ngày giờ làm thêm (giờ)') as HTMLInputElement).value).toBe('16:00');
    // Bấm gửi: báo lỗi thời gian, không gửi, và vẫn giữ lựa chọn.
    fireEvent.click(submitButton());
    expect((await screen.findAllByText('Thời gian không hợp lệ')).length).toBeGreaterThan(0);
    expect(draftBody('ot')).toBeUndefined();
    expect((screen.getByLabelText(OT_DESCRIPTION_LABEL) as HTMLTextAreaElement).value).toBe('Chạy tiến độ');
    expect((screen.getByLabelText('Từ ngày giờ làm thêm (giờ)') as HTMLInputElement).value).toBe('16:00');
  });

  it('đơn làm thêm giờ: đổi giờ bắt đầu muộn hơn giờ kết thúc chỉ hiện lỗi, không tự đổi ngày hay giờ kết thúc', async () => {
    reasonCatalog = { OVERTIME: [catalogReason('OVERTIME', 'ot1', 'Theo yêu cầu công việc')] };
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    const fromTime = (await screen.findByLabelText('Từ ngày giờ làm thêm (giờ)')) as HTMLInputElement;
    const toTime = screen.getByLabelText('Đến ngày giờ làm thêm (giờ)') as HTMLInputElement;
    const toDate = screen.getByLabelText('Đến ngày giờ làm thêm (ngày)') as HTMLInputElement;
    const dateBefore = toDate.value;
    // Mặc định 17:30 - 20:30; đặt bắt đầu 21:00 (sau giờ kết thúc cũ).
    fireEvent.change(fromTime, { target: { value: '2100' } });
    fireEvent.blur(fromTime);
    expect(fromTime.value).toBe('21:00');
    expect(toTime.value).toBe('20:30');
    expect(toDate.value).toBe(dateBefore);
    expect((await screen.findAllByText('Thời điểm kết thúc phải sau thời điểm bắt đầu.')).length).toBeGreaterThan(0);
    // Người dùng tự chọn giờ kết thúc 23:00 cùng ngày: giữ nguyên, hợp lệ.
    fireEvent.change(toTime, { target: { value: '2300' } });
    fireEvent.blur(toTime);
    expect(toTime.value).toBe('23:00');
    expect(toDate.value).toBe(dateBefore);
    expect(screen.queryByText('Thời điểm kết thúc phải sau thời điểm bắt đầu.')).toBeNull();
  });

  const okPreview = (over: Record<string, unknown> = {}) => ({
    fromAt: 'a',
    toAt: 'b',
    timezone: 'Asia/Ho_Chi_Minh',
    totalMinutes: 180,
    totalHours: 3,
    totalDays: 0,
    days: [],
    warnings: [],
    errors: [],
    ...over,
  });

  async function openOtWithExtraRange() {
    reasonCatalog = { OVERTIME: [catalogReason('OVERTIME', 'ot1', 'Theo yêu cầu công việc')] };
    timePreviewResult = okPreview();
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    fireEvent.change(screen.getByLabelText(OT_DESCRIPTION_LABEL), { target: { value: 'Chạy tiến độ' } });
    fireEvent.click(await screen.findByRole('button', { name: /Thêm khoảng làm thêm/ }));
    const extra = await screen.findByTestId('extra-range-2');
    // Máy chủ tính xong khoảng bổ sung (có trễ nhỏ) thì mới gửi được.
    await within(extra).findByTestId('time-total');
    return extra;
  }

  it('đơn làm thêm giờ nhiều khoảng: thêm khoảng, gửi thành từng đơn riêng với cùng lý do và mô tả', async () => {
    const successSpy = jest.spyOn(toast, 'success');
    const extra = await openOtWithExtraRange();
    // Khoảng 2 lấy ngày liền sau khoảng chính, cùng giờ 17:30 - 20:30.
    const from = within(extra).getByLabelText('Từ ngày giờ làm thêm (giờ)') as HTMLInputElement;
    expect(from.value).toBe('17:30');
    expect((within(extra).getByLabelText('Đến ngày giờ làm thêm (giờ)') as HTMLInputElement).value).toBe('20:30');
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(submitButton());
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/ot-requests'))).toHaveLength(2));
    const drafts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/request-drafts/ot'));
    expect(drafts).toHaveLength(2);
    const payloads = drafts.map((d) => d.body?.payload as Record<string, string>);
    expect(payloads[0].fromAt).not.toBe(payloads[1].fromAt);
    expect(payloads[1].fromAt.slice(11)).toBe('17:30');
    expect(new Date(payloads[1].fromAt).getTime()).toBeGreaterThan(new Date(payloads[0].toAt).getTime());
    for (const payload of payloads) {
      expect(payload).toMatchObject({ reasonId: 'ot1', description: 'Chạy tiến độ', plannedMinutes: 180 });
    }
    await waitFor(() => expect(successSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Đã gửi 2 đơn' })));
  });

  it('đơn làm thêm giờ nhiều khoảng: khoảng bổ sung trùng ca bị báo lỗi theo khoảng và không gửi đơn nào', async () => {
    reasonCatalog = { OVERTIME: [catalogReason('OVERTIME', 'ot1', 'Theo yêu cầu công việc')] };
    // Khoảng chính hợp lệ; khoảng bổ sung (lần xem trước thứ hai trở đi) trùng ca.
    let previews = 0;
    timePreviewFn = () =>
      ++previews > 1
        ? okPreview({ errors: ['Giờ làm thêm 16:00 - 17:00 ngày 13/10 trùng ca làm việc (08:00 - 17:00); OT chỉ được đăng ký ngoài ca.'] })
        : okPreview();
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    fireEvent.change(screen.getByLabelText(OT_DESCRIPTION_LABEL), { target: { value: 'Chạy tiến độ' } });
    await waitFor(() => expect(previews).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: /Thêm khoảng làm thêm/ }));
    const extra = await screen.findByTestId('extra-range-2');
    await within(extra).findByText(/trùng ca làm việc/);
    fireEvent.click(submitButton());
    expect(
      (await screen.findAllByText(/Khoảng làm thêm 2: Giờ làm thêm 16:00 - 17:00 ngày 13\/10 trùng ca/)).length,
    ).toBeGreaterThan(0);
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/ot-requests'))).toHaveLength(0);
  });

  it('đơn làm thêm giờ nhiều khoảng: bỏ khoảng bổ sung thì chỉ gửi một đơn', async () => {
    const extra = await openOtWithExtraRange();
    fireEvent.click(within(extra).getByRole('button', { name: /Xoá khoảng làm thêm 2/i }));
    expect(screen.queryByTestId('extra-range-2')).toBeNull();
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(submitButton());
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/ot-requests'))).toHaveLength(1));
  });

  it('đơn làm thêm giờ nhiều khoảng: khoảng thứ hai bị máy chủ từ chối thì báo rõ khoảng lỗi và số đơn đã gửi', async () => {
    otFailFrom = 2;
    const errorSpy = jest.spyOn(toast, 'error');
    await openOtWithExtraRange();
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(submitButton());
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    const message = errorSpy.mock.calls[errorSpy.mock.calls.length - 1][0] as { title: string; description: string };
    expect(message.title).toBe('Khoảng làm thêm 2 gửi không thành công');
    expect(message.description).toContain('Trùng đơn đã có');
    expect(message.description).toContain('Đã gửi thành công 1 khoảng trước đó');
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/ot-requests'))).toHaveLength(2);
    // Một khoảng đã thành đơn: form đóng để không gửi trùng.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Gửi duyệt đơn/, hidden: true })).toBeNull());
  });

  it('đơn nghỉ nhiều khoảng: tổng số ngày cộng các khoảng và phép năm bị chặn khi tổng vượt quỹ', async () => {
    leaveTypes = [leaveType('lt-annual', 'ANNUAL', 'Nghỉ phép năm', { deductBalance: true, isAnnual: true })];
    leaveBalanceRows = [{ leaveTypeId: 'lt-annual', remaining: 1.5, pending: 0, available: 1.5 }];
    timePreviewFn = () => okPreview({ totalMinutes: 480, totalHours: 8, totalDays: 1 });
    await openForm('leave');
    await chooseReason(/Nghỉ phép năm/);
    await waitFor(() => expect(screen.getByTestId('leave-fund').textContent).toContain('1.5'));
    // Một khoảng 1 ngày: còn quỹ, không báo lỗi.
    await waitFor(() => expect(screen.queryByTestId('leave-fund-error')).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: /Thêm khoảng nghỉ/ }));
    const extra = await screen.findByTestId('extra-range-2');
    await within(extra).findByText(/8 giờ/);
    // Hai khoảng, tổng 2 ngày vượt quỹ 1,5 ngày.
    expect((await screen.findByTestId('leave-fund-error')).textContent).toContain('vượt quỹ phép năm khả dụng');
    expect(screen.getByTestId('leave-info').textContent).toContain('Khoảng 1: 1.0');
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(within(extra).getByRole('button', { name: /Xoá khoảng nghỉ 2/i }));
    await waitFor(() => expect(screen.queryByTestId('leave-fund-error')).toBeNull());
  });

  it('đơn làm thêm giờ gửi cả fromAt và toAt', async () => {
    reasonCatalog = { OVERTIME: [catalogReason('OVERTIME', 'ot1', 'Theo yêu cầu công việc')] };
    await openForm('ot');
    await chooseReason(/Theo yêu cầu công việc/);
    fireEvent.change(screen.getByLabelText(OT_DESCRIPTION_LABEL), { target: { value: 'Chạy tiến độ' } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(draftBody('ot')).toBeTruthy());
    const payload = draftBody('ot')?.payload as Record<string, unknown>;
    expect(payload.fromAt).toMatch(/^\d{4}-\d{2}-\d{2}T17:30$/);
    expect(payload.toAt).toMatch(/^\d{4}-\d{2}-\d{2}T20:30$/);
    expect(payload).toMatchObject({ startTime: '17:30', endTime: '20:30', plannedMinutes: 180 });
  });

  it('loại tuỳ chỉnh: thiếu trường bắt buộc thì báo lỗi, đủ thì gửi tới custom-requests kèm trường động', async () => {
    requestTypeRows = [systemType('s1', 'LEAVE', 'LEAVE', 'Nghỉ phép'), customTypeRow()];
    render(<RequestsPage />);
    const buttons = await allTypeButtons();
    fireEvent.click(buttons[1]);
    expect((await screen.findAllByText('Đi muộn có báo trước')).length).toBe(2);
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(submitButton());
    expect((await screen.findAllByText(/Vui lòng nhập: Nơi đến\./)).length).toBeGreaterThan(0);
    expect(draftBody('custom')).toBeUndefined();

    fireEvent.change(screen.getByLabelText(/Nơi đến/), { target: { value: 'Trạm biến áp' } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(draftBody('custom')).toBeTruthy());
    expect(draftBody('custom')?.payload).toMatchObject({
      typeId: 'ct1',
      fields: { noi_den: 'Trạm biến áp' },
      fromAt: null,
      toAt: null,
    });
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/custom-requests'))).toBe(true),
    );
  });

  it('loại tuỳ chỉnh theo khoảng ngày giờ: chưa chọn thời gian thì không gửi', async () => {
    requestTypeRows = [
      systemType('s1', 'LEAVE', 'LEAVE', 'Nghỉ phép'),
      customTypeRow({ timeMode: 'RANGE_DATETIME', fields: [] }),
    ];
    render(<RequestsPage />);
    const buttons = await allTypeButtons();
    fireEvent.click(buttons[1]);
    expect(await screen.findByLabelText('Từ ngày giờ (ngày)')).toBeTruthy();
    fireEvent.click(submitButton());
    expect(
      (await screen.findAllByText('Vui lòng chọn từ ngày giờ và đến ngày giờ.')).length,
    ).toBeGreaterThan(0);
    expect(draftBody('custom')).toBeUndefined();
  });

  it('đơn tuỳ chỉnh có trong lịch sử với tên loại và khoảng thời gian rõ ràng', async () => {
    customRows = [
      {
        id: 'cccccccc-0000-0000-0000-000000000001',
        typeCode: 'DI_MUON',
        typeName: 'Xin đi muộn',
        status: 'PENDING',
        createdAt: '2026-09-02T01:00:00.000Z',
        fromAt: '2026-11-02T02:00:00.000Z',
        toAt: '2026-11-02T04:30:00.000Z',
        durationMinutes: 150,
        reasonName: null,
        description: 'Kẹt xe',
      },
    ];
    render(<RequestsPage />);
    await showAllMonths();
    expect(await screen.findByText('Xin đi muộn', { selector: 'td' })).toBeTruthy();
    expect(footer()).toContain('02/11/2026 09:00 -> 02/11/2026 11:30');
  });
});

type AssistantActionResult = Parameters<
  NonNullable<Parameters<typeof setAssistantResultSink>[0]>
>[0];

describe('Trợ lý Savina mở form tạo đơn với bản nháp', () => {
  let results: AssistantActionResult[] = [];
  const ask = (key: string, requestId: string, draft: Record<string, unknown>, variant?: string) =>
    act(() => {
      dispatchAssistantAction({ key, requestId, draft, ...(variant ? { variant } : {}) }, 'u1');
    });

  beforeEach(() => {
    results = [];
    setAssistantResultSink((result) => results.push(result));
  });
  afterEach(() => setAssistantResultSink(undefined));

  it('đơn làm thêm giờ: điền sẵn, cập nhật theo cùng yêu cầu, gửi xong báo đã lưu kèm link', async () => {
    reasonCatalog = { OVERTIME: [catalogReason('OVERTIME', 'ot1', 'Theo yêu cầu công việc')] };
    render(<RequestsPage />);
    await allTypeButtons();
    ask('hrm.ot-request.create', 'r1', {
      fromAt: '2026-10-20T18:00',
      toAt: '2026-10-20T21:00',
      reasonId: 'ot1',
    });
    await screen.findByRole('button', { name: /Gửi duyệt đơn/, hidden: true });
    ask('hrm.ot-request.create', 'r1', { description: 'Hoàn thiện hồ sơ nghiệm thu' });
    await waitFor(() =>
      expect((screen.getByLabelText(OT_DESCRIPTION_LABEL) as HTMLTextAreaElement).value).toBe(
        'Hoàn thiện hồ sơ nghiệm thu',
      ),
    );
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(submitButton());
    await waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toMatchObject({
      requestId: 'r1',
      key: 'hrm.ot-request.create',
      outcome: 'saved',
      id: 'new',
      href: '/modules/hrm/requests?request=new',
    });
    expect(draftBody('ot')?.payload).toMatchObject({
      reasonId: 'ot1',
      description: 'Hoàn thiện hồ sơ nghiệm thu',
      fromAt: '2026-10-20T18:00',
      toAt: '2026-10-20T21:00',
    });
  });

  it('đóng form không gửi thì báo đã huỷ', async () => {
    leaveTypes = [leaveType('lt-sick', 'SICK', 'Nghỉ ốm')];
    render(<RequestsPage />);
    await allTypeButtons();
    ask('hrm.leave-request.create', 'r2', { leaveTypeId: 'lt-sick', fromDate: '2026-10-20' });
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy', hidden: true }));
    await waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toMatchObject({ requestId: 'r2', outcome: 'cancelled' });
  });

  it('loại đơn tuỳ chỉnh: mở đúng loại theo biến thể; loại không có thì báo không thực hiện được', async () => {
    requestTypeRows = [systemType('s1', 'LEAVE', 'LEAVE', 'Nghỉ phép'), customTypeRow()];
    render(<RequestsPage />);
    await allTypeButtons();
    ask('hrm.custom-request.create', 'r3', {}, 'khong-co');
    await waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toMatchObject({ requestId: 'r3', outcome: 'unavailable' });

    ask('hrm.custom-request.create', 'r4', { fields: { noi_den: 'Trạm biến áp' } }, 'ct1');
    await waitFor(() =>
      expect((screen.getByLabelText(/Nơi đến/) as HTMLInputElement).value).toBe('Trạm biến áp'),
    );
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(submitButton());
    await waitFor(() => expect(results).toHaveLength(2));
    expect(results[1]).toMatchObject({ requestId: 'r4', outcome: 'saved', label: 'Xin đi muộn' });
    expect(draftBody('custom')?.payload).toMatchObject({ typeId: 'ct1', fields: { noi_den: 'Trạm biến áp' } });
  });
});
