/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  AnnualLeavePolicyResponse,
  HrmLeaveType,
} from '@enterprise-platform/contracts-hrm';
import { HrmApiError, hrmFetch } from '../hrm-api';
import LeaveSettingsScreen from './leave-settings-screen';

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
  if (!globalThis.crypto?.randomUUID)
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
      configurable: true,
    });
});
afterAll(() => {
  window.getComputedStyle = nativeGetComputedStyle;
});

const baseType = {
  tenantId: 't',
  unit: 'DAYS',
  negativeLimit: 0,
  carryoverAllowed: false,
  maxCarryoverDays: 0,
  carryoverExpiryMonth: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
} as const;
const annualType: HrmLeaveType = {
  ...baseType,
  id: 'lt1',
  code: 'AL',
  name: 'Phép năm',
  paid: true,
  deductBalance: true,
  isAnnual: true,
  requiresAttachment: false,
  active: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const sickType: HrmLeaveType = {
  ...baseType,
  id: 'lt2',
  code: 'NGHI_OM',
  name: 'Nghỉ ốm',
  paid: true,
  deductBalance: false,
  isAnnual: false,
  requiresAttachment: true,
  active: true,
  updatedAt: '2026-02-01T00:00:00.000Z',
};
const unpaidType: HrmLeaveType = {
  ...baseType,
  id: 'lt3',
  code: 'KHONG_LUONG',
  name: 'Nghỉ không lương',
  paid: false,
  deductBalance: false,
  isAnnual: false,
  requiresAttachment: false,
  active: true,
  updatedAt: '2026-03-01T00:00:00.000Z',
};
const stoppedType: HrmLeaveType = {
  ...baseType,
  id: 'lt4',
  code: 'CU',
  name: 'Nghỉ cũ',
  paid: true,
  deductBalance: false,
  isAnnual: false,
  requiresAttachment: false,
  active: false,
  updatedAt: '2026-04-01T00:00:00.000Z',
};

const policyUpdatedAt = '2026-03-05T08:30:00.000Z';
const configuredPolicy: AnnualLeavePolicyResponse = {
  leaveType: { id: 'lt1', code: 'AL', name: 'Phép năm' },
  candidates: [],
  closedOtherSchedules: 0,
  policy: {
    accrualBasis: 'CONTRACT_SIGN_DATE',
    annualDays: 12,
    startOffsetMonths: 2,
    advanceAllowed: true,
    effectiveFrom: '2025-01-01',
    seniorityTiers: [
      { minYears: 5, bonusDays: 1 },
      { minYears: 10, bonusDays: 2 },
    ],
    carryover: { allowed: false, maxDays: 0, expiryMonth: 3 },
    updatedAt: policyUpdatedAt,
  },
};
const unconfiguredPolicy: AnnualLeavePolicyResponse = {
  leaveType: null,
  candidates: [
    { id: 'lt2', code: 'NGHI_PHEP', name: 'Nghỉ phép', paid: true, deductBalance: false },
    { id: 'lt3', code: 'NGHI_KL', name: 'Nghỉ tự do', paid: false, deductBalance: false },
  ],
  closedOtherSchedules: 0,
  policy: null,
};

interface ApiState {
  policy: AnnualLeavePolicyResponse;
  types: HrmLeaveType[];
  putResult?: AnnualLeavePolicyResponse;
  putError?: Error;
}
let api: ApiState;

function setApi(overrides: Partial<ApiState> = {}) {
  api = { policy: configuredPolicy, types: [annualType, sickType, unpaidType, stoppedType], ...overrides };
}
/** Các lần gọi (method, path) đã ghi nhận, kèm nội dung JSON đã gửi. */
function calls(method: string, path: string | RegExp) {
  return fetchMock.mock.calls
    .filter(([p, init]) => {
      const m = (init as RequestInit | undefined)?.method ?? 'GET';
      return (
        m === method &&
        (typeof path === 'string' ? p === path : path.test(String(p)))
      );
    })
    .map(([, init]) =>
      JSON.parse(String((init as RequestInit | undefined)?.body ?? 'null')),
    );
}

function renderScreen() {
  return render(<LeaveSettingsScreen />);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  mockActions.clear();
  fetchMock.mockReset();
  setApi();
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (path === '/annual-leave-policy' && method === 'GET')
      return { data: api.policy };
    if (path === '/annual-leave-policy' && method === 'PUT') {
      if (api.putError) throw api.putError;
      return { data: api.putResult ?? api.policy };
    }
    if (path === '/leave-types' && method === 'GET') return { data: api.types };
    if (path === '/leave-types' && method === 'POST') return { data: {} };
    if (/^\/leave-types\/[^/]+$/.test(path) && method === 'PATCH')
      return { data: {} };
    if (path === '/leave-accruals/run' && method === 'POST')
      return { data: { credited: 3 } };
    throw new Error(`unexpected ${method} ${path}`);
  }) as never);
});

const field = (name: RegExp) => screen.getByLabelText(name) as HTMLInputElement;
async function pick(placeholder: string, option: string | RegExp) {
  fireEvent.click(screen.getByPlaceholderText(placeholder));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
async function openPolicyForm() {
  await screen.findByLabelText(/Số ngày phép mỗi năm/);
}

describe('LeaveSettingsScreen: chính sách phép năm', () => {
  it('hiển thị một biểu mẫu chính sách đang áp dụng và dòng tóm tắt, không có lịch cộng phép', async () => {
    mockActions.add('hrm.leave.manage');
    renderScreen();
    expect(
      screen.getByRole('heading', { name: 'Chính sách phép năm', level: 1 }),
    ).toBeTruthy();
    await openPolicyForm();
    for (const name of ['Cách tính phép', 'Phép thâm niên', 'Hiệu lực & ghi chú', 'Tóm tắt chính sách', 'Lưu ý khi thay đổi'])
      expect(screen.getByRole('heading', { name })).toBeTruthy();
    expect(screen.getByTestId('policy-status').textContent).toBe('Đang áp dụng');
    expect(field(/Số ngày phép mỗi năm/).value).toBe('12');
    expect(field(/Bắt đầu cộng sau/).value).toBe('2');
    expect(field(/Số năm mốc 1/).value).toBe('5');
    // Chỉ một mốc thâm niên: không có dòng thứ hai, không có nút thêm/xóa mốc.
    expect(screen.queryByLabelText(/Số năm mốc 2/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm mốc thâm niên' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Xóa mốc/ })).toBeNull();
    expect(screen.queryByLabelText(/Số ngày chuyển tối đa/)).toBeNull();
    expect(screen.getByText(/Phép năm không chuyển sang năm sau/)).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: 'Cho ứng phép' }).getAttribute('aria-checked'),
    ).toBe('true');
    // SearchableSelect đồng bộ nhãn hiển thị bằng effect nên chờ giá trị xuất hiện.
    await waitFor(() =>
      expect(
        (screen.getByPlaceholderText('Chọn căn cứ tính phép') as HTMLInputElement).value,
      ).toBe('Ngày ký HĐLĐ chính thức'),
    );
    expect(screen.queryByPlaceholderText('Chọn tháng hết hạn')).toBeNull();
    expect(
      screen.getByText(/Đang áp dụng từ ngày 01\/01\/2025 \(cập nhật lúc .+\)\./),
    ).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(
      fetchMock.mock.calls.some(([p]) =>
        /accrual-schedules|leave-balances|leave-transactions|leave-settlements/.test(
          String(p),
        ),
      ),
    ).toBe(false);
  });

  it('lưu gọi đúng PUT với đúng nội dung và expectedUpdatedAt, rồi báo đã lưu', async () => {
    mockActions.add('hrm.leave.manage');
    renderScreen();
    await openPolicyForm();
    fireEvent.change(field(/Số ngày phép mỗi năm/), { target: { value: '14' } });
    await pick('Tự động', `Từ 01/01/${new Date().getFullYear() + 1}`);
    fireEvent.change(field(/Ghi chú thay đổi/), {
      target: { value: 'Tăng phép theo quy chế mới' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(calls('PUT', '/annual-leave-policy')).toHaveLength(1));
    expect(calls('PUT', '/annual-leave-policy')[0]).toEqual({
      accrualBasis: 'CONTRACT_SIGN_DATE',
      annualDays: 14,
      startOffsetMonths: 2,
      advanceAllowed: true,
      seniorityTiers: [{ minYears: 5, bonusDays: 1 }],
      effectiveFrom: `${new Date().getFullYear() + 1}-01-01`,
      reason: 'Tăng phép theo quy chế mới',
      expectedUpdatedAt: policyUpdatedAt,
    });
    expect(await screen.findByText('Đã lưu chính sách phép năm.')).toBeTruthy();
  });

  it('chỉ còn căn cứ ngày ký HĐLĐ và một mốc thâm niên duy nhất; đổi mốc gửi đúng nội dung', async () => {
    mockActions.add('hrm.leave.manage');
    renderScreen();
    await openPolicyForm();
    // Căn cứ Ngày vào làm bị ẩn: danh sách chỉ có một lựa chọn.
    fireEvent.click(screen.getByPlaceholderText('Chọn căn cứ tính phép'));
    expect(await screen.findByRole('option', { name: 'Ngày ký HĐLĐ chính thức' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Ngày vào làm' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'Ngày ký HĐLĐ chính thức' }));
    fireEvent.change(field(/Bắt đầu cộng sau/), { target: { value: '0' } });
    fireEvent.change(field(/Số năm mốc 1/), { target: { value: '10' } });
    fireEvent.change(field(/Số ngày mốc 1/), { target: { value: '2' } });
    fireEvent.change(field(/Ghi chú thay đổi/), { target: { value: 'Đổi mốc thâm niên' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(calls('PUT', '/annual-leave-policy')).toHaveLength(1));
    expect(calls('PUT', '/annual-leave-policy')[0]).toMatchObject({
      accrualBasis: 'CONTRACT_SIGN_DATE',
      startOffsetMonths: 0,
      seniorityTiers: [{ minYears: 10, bonusDays: 2 }],
    });
  });

  it('thiếu Ghi chú thay đổi thì báo lỗi và không gọi PUT', async () => {
    mockActions.add('hrm.leave.manage');
    renderScreen();
    await openPolicyForm();
    // Chưa có thay đổi thì nút Lưu thay đổi bị vô hiệu.
    expect(
      (screen.getByRole('button', { name: 'Lưu thay đổi' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(field(/Số ngày phép mỗi năm/), { target: { value: '13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(await screen.findByText('Cần nhập Ghi chú thay đổi')).toBeTruthy();
    expect(calls('PUT', '/annual-leave-policy')).toHaveLength(0);
  });

  it('hiển thị nguyên văn lỗi của server và cho tải lại khi dữ liệu đã bị người khác đổi', async () => {
    mockActions.add('hrm.leave.manage');
    const message =
      'Dữ liệu đã được người khác thay đổi. Tải lại bản ghi trước khi lưu.';
    setApi({ putError: new HrmApiError(message, 409, 'HRM_STALE_VERSION') });
    renderScreen();
    await openPolicyForm();
    fireEvent.change(field(/Ghi chú thay đổi/), { target: { value: 'Sửa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(await screen.findByText(message)).toBeTruthy();
    const before = calls('GET', '/annual-leave-policy').length;
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại chính sách' }));
    await waitFor(() =>
      expect(calls('GET', '/annual-leave-policy').length).toBe(before + 1),
    );
  });

  it('báo số lịch cộng phép cũ đã dừng khi lần lưu đầu tiên đặt phép năm', async () => {
    mockActions.add('hrm.leave.manage');
    setApi({
      policy: unconfiguredPolicy,
      putResult: { ...configuredPolicy, closedOtherSchedules: 2 },
    });
    renderScreen();
    await openPolicyForm();
    await pick('Chọn lý do nghỉ làm phép năm', /NGHI_PHEP/);
    fireEvent.change(field(/Ghi chú thay đổi/), { target: { value: 'Khởi tạo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(
      await screen.findByText(
        /Đã dừng 2 lịch cộng phép cũ của các lý do nghỉ khác/,
      ),
    ).toBeTruthy();
  });

  it('chưa có phép năm: chọn lý do nghỉ làm phép năm lần đầu rồi lưu kèm leaveTypeId', async () => {
    mockActions.add('hrm.leave.manage');
    setApi({ policy: unconfiguredPolicy });
    renderScreen();
    await openPolicyForm();
    expect(
      screen.getByRole('heading', { name: 'Chọn lý do nghỉ dùng làm phép năm' }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Chưa có chính sách phép năm\. Nhập biểu mẫu và lưu/),
    ).toBeTruthy();
    // Chưa chọn lý do: báo lỗi, không gọi PUT.
    fireEvent.change(field(/Ghi chú thay đổi/), { target: { value: 'Khởi tạo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(
      await screen.findByText('Cần chọn lý do nghỉ dùng làm phép năm'),
    ).toBeTruthy();
    expect(calls('PUT', '/annual-leave-policy')).toHaveLength(0);

    await pick('Chọn lý do nghỉ làm phép năm', /NGHI_PHEP/);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(calls('PUT', '/annual-leave-policy')).toHaveLength(1));
    const body = calls('PUT', '/annual-leave-policy')[0];
    expect(body).toEqual({
      leaveTypeId: 'lt2',
      accrualBasis: 'CONTRACT_SIGN_DATE',
      annualDays: 12,
      startOffsetMonths: 0,
      advanceAllowed: false,
      seniorityTiers: [{ minYears: 5, bonusDays: 1 }],
      reason: 'Khởi tạo',
    });
    expect('expectedUpdatedAt' in body).toBe(false);
  });

  it('chưa có phép năm và không có lý do phù hợp: hướng dẫn thêm lý do nghỉ có lương trước', async () => {
    mockActions.add('hrm.leave.manage');
    setApi({ policy: { ...unconfiguredPolicy, candidates: [] } });
    renderScreen();
    expect(
      await screen.findByText(
        'Chưa có lý do nghỉ phù hợp, hãy thêm lý do nghỉ có lương ở màn Lý do nghỉ trước.',
      ),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText('Chọn lý do nghỉ làm phép năm')).toBeNull();
  });
});

describe('LeaveSettingsScreen: tác vụ định kỳ và quyền', () => {
  it('trang không còn tab; Lý do nghỉ là chức năng riêng; tác vụ định kỳ hiện sẵn ở cuối trang', async () => {
    mockActions.add('hrm.leave.manage');
    renderScreen();
    await openPolicyForm();
    expect(screen.getByRole('heading', { name: 'Chính sách phép năm' })).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText(/Lý do nghỉ \(/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm lý do nghỉ' })).toBeNull();
    expect(calls('GET', '/leave-types')).toHaveLength(0);
    for (const name of ['Cộng phép tháng', 'Chốt phép cuối năm'])
      expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Chuyển phép|Hết hạn phép chuyển/ })).toBeNull();
    // Không còn quyết toán nghỉ việc, lịch cộng phép nhiều phiên bản, gộp loại nghỉ.
    expect(screen.queryByRole('button', { name: /Quyết toán|Lịch cộng phép|Gộp/ })).toBeNull();
  });

  it('chạy cộng phép tháng gọi đúng API và báo kết quả', async () => {
    mockActions.add('hrm.leave.manage');
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Cộng phép tháng' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(calls('POST', '/leave-accruals/run')).toHaveLength(1));
    expect(calls('POST', '/leave-accruals/run')[0]).toEqual({
      month: expect.stringMatching(/^\d{4}-\d{2}$/),
    });
    expect(await screen.findByText(/Đã cộng phép cho 3 dòng/)).toBeTruthy();
  });

  it('chỉ có hrm.leave.read thì xem được nhưng không có nút lưu hay tác vụ định kỳ', async () => {
    mockActions.add('hrm.leave.read');
    renderScreen();
    await openPolicyForm();
    expect(field(/Số ngày phép mỗi năm/).value).toBe('12');
    expect(field(/Số ngày phép mỗi năm/).disabled).toBe(true);
    expect(screen.getByText('Chỉ xem')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lưu thay đổi' })).toBeNull();
    expect(screen.queryByLabelText(/Ghi chú thay đổi/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cộng phép tháng' })).toBeNull();
    expect(calls('PUT', '/annual-leave-policy')).toHaveLength(0);
  });

  it('không có quyền đọc phép thì báo thiếu quyền và không gọi API', async () => {
    mockActions.add('hrm.read');
    renderScreen();
    expect(await screen.findByText('Bạn không có quyền xem chính sách phép năm.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('LeaveSettingsScreen: nút Lưu thay đổi ở tiêu đề và tóm tắt', () => {
  it('nút ở tiêu đề vô hiệu khi chưa sửa, bấm thì gọi đúng PUT như luồng lưu của biểu mẫu', async () => {
    mockActions.add('hrm.leave.manage');
    renderScreen();
    await openPolicyForm();
    const save = screen.getByRole('button', { name: 'Lưu thay đổi' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(field(/Số ngày phép mỗi năm/), { target: { value: '15' } });
    expect(save.disabled).toBe(false);
    fireEvent.change(field(/Ghi chú thay đổi/), { target: { value: 'Quy chế mới' } });
    expect(screen.getByTestId('reason-counter').textContent).toBe('11/1000');
    fireEvent.click(save);
    await waitFor(() => expect(calls('PUT', '/annual-leave-policy')).toHaveLength(1));
    expect(calls('PUT', '/annual-leave-policy')[0]).toMatchObject({
      annualDays: 15,
      reason: 'Quy chế mới',
      expectedUpdatedAt: policyUpdatedAt,
    });
    expect(await screen.findByText('Đã lưu chính sách phép năm.')).toBeTruthy();
  });

  it('thẻ Tóm tắt chính sách tính từ chính sách hiện có và đổi theo biểu mẫu', async () => {
    mockActions.add('hrm.leave.manage');
    renderScreen();
    await openPolicyForm();
    const summary = within(screen.getByTestId('policy-summary'));
    expect(summary.getByText('12 ngày mỗi năm')).toBeTruthy();
    expect(summary.getByText('Theo ngày ký HĐLĐ, sau 2 tháng')).toBeTruthy();
    expect(summary.getByText('+1 ngày mỗi năm từ đủ 5 năm')).toBeTruthy();
    expect(summary.getByText('Không chuyển sang năm sau')).toBeTruthy();

    fireEvent.change(field(/Số ngày phép mỗi năm/), { target: { value: '14' } });
    fireEvent.change(field(/Bắt đầu cộng sau/), { target: { value: '0' } });
    expect(summary.getByText('14 ngày mỗi năm')).toBeTruthy();
    expect(summary.getByText('Theo ngày ký HĐLĐ')).toBeTruthy();
    expect(summary.getByText('+1 ngày mỗi năm từ đủ 5 năm')).toBeTruthy();
    fireEvent.change(field(/Số năm mốc 1/), { target: { value: '' } });
    fireEvent.change(field(/Số ngày mốc 1/), { target: { value: '' } });
    expect(summary.getByText('Không có')).toBeTruthy();
  });
});
