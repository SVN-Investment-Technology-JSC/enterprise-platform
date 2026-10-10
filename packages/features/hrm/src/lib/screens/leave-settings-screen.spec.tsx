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
    carryover: { allowed: true, maxDays: 5, expiryMonth: 3 },
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

beforeEach(() => {
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
const rowOf = (name: string) =>
  screen.getByRole('button', { name: `Sửa ${name}` }).closest('tr') as HTMLElement;
const cellsOf = (row: HTMLElement) => Array.from(row.querySelectorAll('td'));
async function pick(placeholder: string, option: string | RegExp) {
  fireEvent.click(screen.getByPlaceholderText(placeholder));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
async function openPolicyForm() {
  await screen.findByLabelText(/Số ngày phép một năm/);
}

describe('LeaveSettingsScreen: chính sách phép năm', () => {
  it('hiển thị một biểu mẫu chính sách đang áp dụng và dòng tóm tắt, không có tab hay lịch cộng phép', async () => {
    mockActions.add('hrm.leave.manage');
    render(<LeaveSettingsScreen />);
    expect(
      screen.getByRole('heading', { name: 'Phép năm và lý do nghỉ', level: 1 }),
    ).toBeTruthy();
    await openPolicyForm();
    expect(screen.getByRole('heading', { name: 'Chính sách phép năm' })).toBeTruthy();
    expect(field(/Số ngày phép một năm/).value).toBe('12');
    expect(field(/Bắt đầu cộng sau/).value).toBe('2');
    expect(field(/Số năm mốc 1/).value).toBe('5');
    expect(field(/Số ngày mốc 2/).value).toBe('2');
    expect(field(/Số ngày chuyển tối đa/).value).toBe('5');
    expect(
      screen.getByRole('switch', { name: 'Cho ứng phép' }).getAttribute('aria-checked'),
    ).toBe('true');
    // SearchableSelect đồng bộ nhãn hiển thị bằng effect nên chờ giá trị xuất hiện.
    await waitFor(() =>
      expect(
        (screen.getByPlaceholderText('Chọn căn cứ tính phép') as HTMLInputElement).value,
      ).toBe('Ngày ký HĐLĐ chính thức'),
    );
    await waitFor(() =>
      expect(
        (screen.getByPlaceholderText('Chọn tháng hết hạn') as HTMLInputElement).value,
      ).toBe('Hết tháng 3'),
    );
    expect(
      screen.getByText(/Đang áp dụng từ tháng 01\/2025 \(cập nhật lúc .+\)\./),
    ).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
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
    render(<LeaveSettingsScreen />);
    await openPolicyForm();
    fireEvent.change(field(/Số ngày phép một năm/), { target: { value: '14' } });
    fireEvent.change(field(/Hiệu lực từ tháng/), { target: { value: '2026-11' } });
    fireEvent.change(field(/Ghi chú thay đổi/), {
      target: { value: 'Tăng phép theo quy chế mới' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chính sách' }));
    await waitFor(() => expect(calls('PUT', '/annual-leave-policy')).toHaveLength(1));
    expect(calls('PUT', '/annual-leave-policy')[0]).toEqual({
      accrualBasis: 'CONTRACT_SIGN_DATE',
      annualDays: 14,
      startOffsetMonths: 2,
      advanceAllowed: true,
      seniorityTiers: [
        { minYears: 5, bonusDays: 1 },
        { minYears: 10, bonusDays: 2 },
      ],
      effectiveFrom: '2026-11-01',
      maxCarryoverDays: 5,
      carryoverExpiryMonth: 3,
      reason: 'Tăng phép theo quy chế mới',
      expectedUpdatedAt: policyUpdatedAt,
    });
    expect(await screen.findByText('Đã lưu chính sách phép năm.')).toBeTruthy();
  });

  it('thêm, xóa mốc thâm niên, đổi căn cứ ngày vào làm và gửi đúng nội dung', async () => {
    mockActions.add('hrm.leave.manage');
    render(<LeaveSettingsScreen />);
    await openPolicyForm();
    await pick('Chọn căn cứ tính phép', 'Ngày vào làm');
    expect(screen.getByText(/Căn cứ Ngày vào làm chỉ hỗ trợ/)).toBeTruthy();
    fireEvent.change(field(/Bắt đầu cộng sau/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm mốc thâm niên' }));
    fireEvent.change(field(/Số năm mốc 3/), { target: { value: '15' } });
    fireEvent.change(field(/Số ngày mốc 3/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa mốc 1' }));
    fireEvent.change(field(/Ghi chú thay đổi/), { target: { value: 'Đổi căn cứ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chính sách' }));
    await waitFor(() => expect(calls('PUT', '/annual-leave-policy')).toHaveLength(1));
    expect(calls('PUT', '/annual-leave-policy')[0]).toMatchObject({
      accrualBasis: 'JOIN_DATE',
      startOffsetMonths: 0,
      seniorityTiers: [
        { minYears: 10, bonusDays: 2 },
        { minYears: 15, bonusDays: 3 },
      ],
    });
  });

  it('thiếu Ghi chú thay đổi thì báo lỗi và không gọi PUT', async () => {
    mockActions.add('hrm.leave.manage');
    render(<LeaveSettingsScreen />);
    await openPolicyForm();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chính sách' }));
    expect(await screen.findByText('Cần nhập Ghi chú thay đổi')).toBeTruthy();
    expect(calls('PUT', '/annual-leave-policy')).toHaveLength(0);
  });

  it('hiển thị nguyên văn lỗi của server và cho tải lại khi dữ liệu đã bị người khác đổi', async () => {
    mockActions.add('hrm.leave.manage');
    const message =
      'Dữ liệu đã được người khác thay đổi. Tải lại bản ghi trước khi lưu.';
    setApi({ putError: new HrmApiError(message, 409, 'HRM_STALE_VERSION') });
    render(<LeaveSettingsScreen />);
    await openPolicyForm();
    fireEvent.change(field(/Ghi chú thay đổi/), { target: { value: 'Sửa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chính sách' }));
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
    render(<LeaveSettingsScreen />);
    await openPolicyForm();
    await pick('Chọn lý do nghỉ làm phép năm', /NGHI_PHEP/);
    fireEvent.change(field(/Ghi chú thay đổi/), { target: { value: 'Khởi tạo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chính sách' }));
    expect(
      await screen.findByText(
        /Đã dừng 2 lịch cộng phép cũ của các lý do nghỉ khác/,
      ),
    ).toBeTruthy();
  });

  it('chưa có phép năm: chọn lý do nghỉ làm phép năm lần đầu rồi lưu kèm leaveTypeId', async () => {
    mockActions.add('hrm.leave.manage');
    setApi({ policy: unconfiguredPolicy });
    render(<LeaveSettingsScreen />);
    await openPolicyForm();
    expect(
      screen.getByRole('heading', { name: 'Chọn lý do nghỉ dùng làm phép năm' }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Chưa có chính sách phép năm\. Nhập biểu mẫu và lưu/),
    ).toBeTruthy();
    // Chưa chọn lý do: báo lỗi, không gọi PUT.
    fireEvent.change(field(/Ghi chú thay đổi/), { target: { value: 'Khởi tạo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chính sách' }));
    expect(
      await screen.findByText('Cần chọn lý do nghỉ dùng làm phép năm'),
    ).toBeTruthy();
    expect(calls('PUT', '/annual-leave-policy')).toHaveLength(0);

    await pick('Chọn lý do nghỉ làm phép năm', /NGHI_PHEP/);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu chính sách' }));
    await waitFor(() => expect(calls('PUT', '/annual-leave-policy')).toHaveLength(1));
    const body = calls('PUT', '/annual-leave-policy')[0];
    expect(body).toEqual({
      leaveTypeId: 'lt2',
      accrualBasis: 'CONTRACT_SIGN_DATE',
      annualDays: 12,
      startOffsetMonths: 0,
      advanceAllowed: false,
      seniorityTiers: [{ minYears: 5, bonusDays: 1 }],
      maxCarryoverDays: 0,
      carryoverExpiryMonth: 3,
      reason: 'Khởi tạo',
    });
    expect('expectedUpdatedAt' in body).toBe(false);
  });

  it('chưa có phép năm và không có lý do phù hợp: hướng dẫn thêm lý do nghỉ có lương trước', async () => {
    mockActions.add('hrm.leave.manage');
    setApi({ policy: { ...unconfiguredPolicy, candidates: [] } });
    render(<LeaveSettingsScreen />);
    expect(
      await screen.findByText(
        'Chưa có lý do nghỉ phù hợp, hãy thêm lý do nghỉ có lương ở bảng bên dưới trước.',
      ),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText('Chọn lý do nghỉ làm phép năm')).toBeNull();
  });
});

describe('LeaveSettingsScreen: lý do nghỉ', () => {
  it('bảng lý do nghỉ: chỉ dòng phép năm trừ quỹ; lý do không lương có thẻ Không lương và không trừ quỹ', async () => {
    mockActions.add('hrm.leave.manage');
    render(<LeaveSettingsScreen />);
    await screen.findByText('Nghỉ không lương');
    expect(screen.getByRole('heading', { name: 'Lý do nghỉ' })).toBeTruthy();
    expect(
      screen.getByText(
        'Lý do nghỉ do quản trị cấu hình tại đây; người làm đơn chọn một lý do rồi nhập thêm Mô tả nếu cần.',
      ),
    ).toBeTruthy();
    for (const title of [
      'Tên',
      'Mã',
      'Hưởng lương',
      'Trừ quỹ phép năm',
      'Cần chứng từ',
      'Trạng thái',
    ])
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);

    const annual = cellsOf(rowOf('Phép năm'));
    expect(within(annual[2]).getByText('Có lương')).toBeTruthy();
    expect(annual[3].textContent).toBe('CóPhép năm');
    expect(within(annual[3]).getByText('Phép năm')).toBeTruthy();

    const unpaid = cellsOf(rowOf('Nghỉ không lương'));
    expect(within(unpaid[2]).getByText('Không lương')).toBeTruthy();
    expect(unpaid[3].textContent).toBe('Không');
    expect(within(unpaid[3]).queryByText('Phép năm')).toBeNull();

    const sick = cellsOf(rowOf('Nghỉ ốm'));
    expect(within(sick[2]).getByText('Có lương')).toBeTruthy();
    expect(sick[3].textContent).toBe('Không');
    expect(sick[4].textContent).toBe('Có');

    const stopped = cellsOf(rowOf('Nghỉ cũ'));
    expect(within(stopped[5]).getByText('Đã ngừng')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dùng lại Nghỉ cũ' })).toBeTruthy();
    // Phép năm không ngừng được.
    expect(screen.queryByRole('button', { name: 'Ngừng Phép năm' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ngừng Nghỉ ốm' })).toBeTruthy();
  });

  it('thêm lý do nghỉ bằng hộp thoại: gửi đúng POST, không gửi isAnnual hay deductBalance', async () => {
    mockActions.add('hrm.leave.manage');
    render(<LeaveSettingsScreen />);
    await screen.findByText('Nghỉ không lương');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lý do nghỉ' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.change(field(/Mã lý do nghỉ/), { target: { value: 'NGHI_CUOI' } });
    fireEvent.change(field(/Tên lý do nghỉ/), { target: { value: 'Nghỉ cưới' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Có lương' }));
    const getsBefore = calls('GET', '/leave-types').length;
    fireEvent.click(screen.getByRole('button', { name: 'Lưu lý do nghỉ' }));
    await waitFor(() => expect(calls('POST', '/leave-types')).toHaveLength(1));
    expect(calls('POST', '/leave-types')[0]).toEqual({
      code: 'NGHI_CUOI',
      name: 'Nghỉ cưới',
      unit: 'DAYS',
      paid: false,
      requiresAttachment: false,
      active: true,
    });
    await waitFor(() =>
      expect(calls('GET', '/leave-types').length).toBeGreaterThan(getsBefore),
    );
    expect(await screen.findByText('Đã thêm lý do nghỉ "Nghỉ cưới".')).toBeTruthy();
  });

  it('sửa lý do phép năm: khóa hưởng lương, không gửi paid, bắt buộc Ghi chú thay đổi', async () => {
    mockActions.add('hrm.leave.manage');
    render(<LeaveSettingsScreen />);
    await screen.findByText('Nghỉ không lương');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Phép năm' }));
    const dialog = await screen.findByRole('dialog');
    const paid = within(dialog).getByRole('switch', { name: 'Có lương' });
    expect(paid.getAttribute('aria-checked')).toBe('true');
    expect((paid as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText(/Đây là lý do Phép năm/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu lý do nghỉ' }));
    expect(await within(dialog).findByText('Cần nhập Ghi chú thay đổi')).toBeTruthy();
    expect(calls('PATCH', /\/leave-types\//)).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Ghi chú thay đổi/), {
      target: { value: 'Đổi tên hiển thị' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Tên lý do nghỉ/), {
      target: { value: 'Phép năm chuẩn' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu lý do nghỉ' }));
    await waitFor(() => expect(calls('PATCH', '/leave-types/lt1')).toHaveLength(1));
    expect(calls('PATCH', '/leave-types/lt1')[0]).toEqual({
      name: 'Phép năm chuẩn',
      requiresAttachment: false,
      expectedUpdatedAt: annualType.updatedAt,
      reason: 'Đổi tên hiển thị',
    });
  });

  it('sửa lý do thường: gửi paid, requiresAttachment, expectedUpdatedAt và ghi chú', async () => {
    mockActions.add('hrm.leave.manage');
    render(<LeaveSettingsScreen />);
    await screen.findByText('Nghỉ không lương');
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Nghỉ ốm' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Có lương' }));
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Cần chứng từ' }));
    fireEvent.change(within(dialog).getByLabelText(/Ghi chú thay đổi/), {
      target: { value: 'Chuyển thành không lương' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu lý do nghỉ' }));
    await waitFor(() => expect(calls('PATCH', '/leave-types/lt2')).toHaveLength(1));
    expect(calls('PATCH', '/leave-types/lt2')[0]).toEqual({
      name: 'Nghỉ ốm',
      paid: false,
      requiresAttachment: false,
      expectedUpdatedAt: sickType.updatedAt,
      reason: 'Chuyển thành không lương',
    });
  });

  it('ngừng và dùng lại lý do nghỉ qua Popconfirm có ghi chú thay đổi', async () => {
    mockActions.add('hrm.leave.manage');
    render(<LeaveSettingsScreen />);
    await screen.findByText('Nghỉ không lương');
    fireEvent.click(screen.getByRole('button', { name: 'Ngừng Nghỉ không lương' }));
    const confirm = screen.getByRole('button', { name: 'Xác nhận' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Ví dụ: không còn áp dụng'), {
      target: { value: 'Không còn dùng' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(calls('PATCH', '/leave-types/lt3')).toHaveLength(1));
    expect(calls('PATCH', '/leave-types/lt3')[0]).toEqual({
      active: false,
      expectedUpdatedAt: unpaidType.updatedAt,
      reason: 'Không còn dùng',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dùng lại Nghỉ cũ' }));
    fireEvent.change(screen.getByPlaceholderText('Ví dụ: áp dụng lại từ tháng này'), {
      target: { value: 'Dùng lại' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(calls('PATCH', '/leave-types/lt4')).toHaveLength(1));
    expect(calls('PATCH', '/leave-types/lt4')[0]).toMatchObject({ active: true });
  });
});

describe('LeaveSettingsScreen: tác vụ định kỳ và quyền', () => {
  it('khối Tác vụ định kỳ mặc định đóng; mở ra có ba tác vụ và chạy cộng phép tháng', async () => {
    mockActions.add('hrm.leave.manage');
    render(<LeaveSettingsScreen />);
    await openPolicyForm();
    const toggle = screen.getByRole('button', { name: /Tác vụ định kỳ/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Cộng phép tháng' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    for (const name of [
      'Cộng phép tháng',
      'Chuyển phép sang năm sau',
      'Hết hạn phép chuyển',
    ])
      expect(screen.getByRole('button', { name })).toBeTruthy();
    // Không còn quyết toán nghỉ việc, lịch cộng phép nhiều phiên bản, gộp loại nghỉ.
    expect(screen.queryByRole('button', { name: /Quyết toán|Lịch cộng phép|Gộp/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cộng phép tháng' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(calls('POST', '/leave-accruals/run')).toHaveLength(1));
    expect(calls('POST', '/leave-accruals/run')[0]).toEqual({
      month: expect.stringMatching(/^\d{4}-\d{2}$/),
    });
    expect(await screen.findByText(/Đã cộng phép cho 3 dòng/)).toBeTruthy();
  });

  it('chỉ có hrm.leave.read thì xem được nhưng không có nút lưu, thêm, sửa hay tác vụ định kỳ', async () => {
    mockActions.add('hrm.leave.read');
    render(<LeaveSettingsScreen />);
    await openPolicyForm();
    await screen.findByText('Nghỉ không lương');
    expect(field(/Số ngày phép một năm/).value).toBe('12');
    expect(field(/Số ngày phép một năm/).disabled).toBe(true);
    expect(screen.getByText('Chỉ xem')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lưu chính sách' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thêm lý do nghỉ' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Sửa / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Ngừng / })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tác vụ định kỳ/ })).toBeNull();
    expect(screen.queryByLabelText(/Ghi chú thay đổi/)).toBeNull();
    expect(calls('PUT', '/annual-leave-policy')).toHaveLength(0);
  });

  it('không có quyền đọc phép thì báo thiếu quyền và không gọi API', async () => {
    mockActions.add('hrm.read');
    render(<LeaveSettingsScreen />);
    expect(
      await screen.findByText('Bạn không có quyền xem phép năm và lý do nghỉ.'),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
