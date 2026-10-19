/** @jest-environment jsdom */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { act } from 'react';
import type {
  HrmLeaveType,
  HrmRequestReason,
  HrmRequestType,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { toast } from '../ui/toast';
import RequestReasonsScreen, {
  reasonFormFields,
  reasonPayload,
} from './request-reasons-screen';

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
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

const fetchMock = hrmFetch as jest.MockedFunction<typeof hrmFetch>;
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

function reason(
  over: Partial<HrmRequestReason> & Pick<HrmRequestReason, 'id' | 'kind' | 'code' | 'name'>,
): HrmRequestReason {
  return {
    tenantId: 't',
    description: null,
    paid: true,
    requiresDescription: false,
    active: true,
    sortOrder: 10,
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const workReason = reason({
  id: 'r1',
  kind: 'OVERTIME',
  code: 'YEU_CAU_CONG_VIEC',
  name: 'Theo yêu cầu công việc',
  description: 'OT do quản lý yêu cầu',
  usageCount: 3,
});
const unpaidReason = reason({
  rateMultiplier: 2.5,
  id: 'r2',
  kind: 'OVERTIME',
  code: 'TU_NGUYEN',
  name: 'Tự nguyện',
  paid: false,
  sortOrder: 20,
});
const otherReason = reason({
  id: 'r3',
  kind: 'OVERTIME',
  code: 'KHAC',
  name: 'Khác',
  requiresDescription: true,
  active: false,
  sortOrder: 30,
});
const tripReason = reason({
  id: 't1',
  kind: 'BUSINESS_TRIP',
  code: 'GAP_KHACH_HANG',
  name: 'Gặp khách hàng',
});

function requestType(
  over: Partial<HrmRequestType> & Pick<HrmRequestType, 'id' | 'code' | 'name'>,
): HrmRequestType {
  return {
    tenantId: 't',
    description: null,
    engine: 'GENERIC',
    kind: 'custom',
    timeMode: 'RANGE_DATETIME',
    requiresAttachment: false,
    fields: [],
    icon: null,
    isSystem: false,
    active: true,
    sortOrder: 100,
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const leaveRequestType = requestType({
  id: 'y0',
  code: 'LEAVE',
  name: 'Đơn xin nghỉ',
  description: 'Nghỉ phép, nghỉ ốm, việc riêng',
  engine: 'LEAVE',
  kind: 'leave',
  isSystem: true,
  timeMode: 'DATE_RANGE',
});
const advanceType = requestType({
  id: 'y5',
  code: 'ADVANCE',
  name: 'Tạm ứng lương',
  description: 'Đề nghị tạm ứng lương',
  engine: 'ADVANCE',
  kind: 'advance',
  isSystem: true,
});

const baseLeave = {
  tenantId: 't',
  unit: 'DAYS',
  negativeLimit: 0,
  carryoverAllowed: false,
  maxCarryoverDays: 0,
  carryoverExpiryMonth: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
} as const;
const annualLeave: HrmLeaveType = {
  ...baseLeave,
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
const sickLeave: HrmLeaveType = {
  ...baseLeave,
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
const unpaidLeave: HrmLeaveType = {
  ...baseLeave,
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
const stoppedLeave: HrmLeaveType = {
  ...baseLeave,
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

const systemTypes: HrmRequestType[] = [
  requestType({ id: 'y1', code: 'OVERTIME', name: 'Làm thêm giờ', engine: 'OVERTIME', kind: 'ot', isSystem: true }),
  requestType({ id: 'y2', code: 'BUSINESS_TRIP', name: 'Công tác', engine: 'BUSINESS_TRIP', kind: 'business_trip', isSystem: true }),
  requestType({ id: 'y3', code: 'ATTENDANCE_CORRECTION', name: 'Giải trình công', engine: 'ATTENDANCE_CORRECTION', kind: 'correction', isSystem: true }),
  requestType({ id: 'y4', code: 'SHIFT_CHANGE', name: 'Đổi ca', engine: 'SHIFT_CHANGE', kind: 'shift_change', isSystem: true }),
];
const customType = requestType({
  id: 'y9',
  code: 'XIN_DI_MUON',
  name: 'Xin đi muộn',
  description: 'Đi muộn có lý do',
  usageCount: 2,
});

interface Call {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}
let calls: Call[];
let reasons: HrmRequestReason[];
let types: HrmRequestType[];
let leaveTypes: HrmLeaveType[];
let respond: (call: Call) => unknown;

const writes = () => calls.filter((c) => c.method !== 'GET');

beforeEach(() => {
  mockActions.clear();
  mockActions.add('hrm.leave.manage');
  calls = [];
  reasons = [workReason, unpaidReason, otherReason, tripReason];
  types = [...systemTypes];
  leaveTypes = [annualLeave, sickLeave, unpaidLeave, stoppedLeave];
  window.history.replaceState(null, '', '/');
  respond = () => ({ data: {} });
  fetchMock.mockReset();
  toastSuccess.mockReset();
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    const call: Call = {
      path,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    if (call.method === 'GET' && path === '/request-reasons')
      return { data: reasons };
    if (call.method === 'GET' && path === '/request-types/manage')
      return { data: types };
    if (call.method === 'GET' && path === '/leave-types')
      return { data: leaveTypes };
    if (call.method === 'GET' && path.startsWith('/operations/audit'))
      return { data: [], meta: { total: 0, actions: [] } };
    return respond(call);
  }) as never);
});

/** Chọn một mục của SearchableSelect nằm trong ô có nhãn `label` của hộp thoại. */
async function choose(dialog: HTMLElement, label: RegExp, option: string) {
  const field = within(dialog).getByText(label).closest('label, [role="group"]') as HTMLElement;
  fireEvent.click(within(field).getByRole('textbox'));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

function typeInto(dialog: HTMLElement, label: RegExp, value: string) {
  const field = within(dialog).getByText(label).closest('label, [role="group"]') as HTMLElement;
  fireEvent.change(field.querySelector('input') as HTMLInputElement, {
    target: { value },
  });
}

const urlTab = () => new URLSearchParams(window.location.search).get('tab');
const selectType = (code: string) => fireEvent.click(screen.getByTestId(`type-${code}`));
/** Dòng (role row) chứa một chữ nào đó trong bảng/danh sách lý do. */
const rowOf = (text: string) => screen.getByText(text).closest('[role="row"]') as HTMLElement;
/** Mở menu "..." của một dòng rồi chọn mục. */
async function rowAction(label: string, item: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}
const typeMenu = async (item: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Thiết lập loại đơn' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
};

describe('RequestReasonsScreen: danh sách loại đơn và lý do của từng loại', () => {
  it('đầu trang theo mẫu, giải thích lý do là danh mục cấu hình khác với Mô tả, chọn loại đầu tiên', async () => {
    render(<RequestReasonsScreen />);
    expect(screen.getByRole('heading', { name: 'Loại đơn & lý do' })).toBeTruthy();
    expect(
      screen.getByText('Quản lý loại đơn và danh mục lý do được nhân viên lựa chọn khi tạo đơn.'),
    ).toBeTruthy();
    expect(await screen.findByText('Theo yêu cầu công việc')).toBeTruthy();
    const note = screen.getAllByRole('note').map((n) => n.textContent ?? '').join(' ');
    expect(note).toContain(
      'Lý do là danh mục do quản trị cấu hình; người làm đơn chọn một lý do rồi có thể nhập thêm Mô tả. Mô tả là văn bản tự do, không phải lý do.',
    );
    expect(screen.getByTestId('type-OVERTIME').getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Lý do của làm thêm giờ' })).toBeTruthy();
  });

  it('danh sách loại đơn hiện số lý do thật của từng loại; loại không có danh mục lý do thì không có số', async () => {
    types = [leaveRequestType, ...systemTypes, advanceType];
    render(<RequestReasonsScreen />);
    await waitFor(() => expect(screen.getByTestId('type-LEAVE').textContent).toContain('4'));
    const counts = (code: string) => within(screen.getByTestId(`type-${code}`)).queryByLabelText(/lý do$/)?.textContent ?? null;
    expect(counts('LEAVE')).toBe('4');
    expect(counts('OVERTIME')).toBe('3');
    expect(counts('BUSINESS_TRIP')).toBe('1');
    expect(counts('ATTENDANCE_CORRECTION')).toBe('0');
    expect(counts('SHIFT_CHANGE')).toBe('0');
    expect(counts('ADVANCE')).toBeNull();
    // Gọi đúng ba nguồn dữ liệu: lý do đơn, loại đơn, loại nghỉ.
    expect(
      calls
        .filter((c) => c.method === 'GET')
        .map((c) => c.path)
        .sort(),
    ).toEqual(['/leave-types', '/request-reasons', '/request-types/manage']);
  });

  it('tìm loại đơn trong danh sách bên trái', async () => {
    types = [leaveRequestType, ...systemTypes, advanceType];
    render(<RequestReasonsScreen />);
    await screen.findByTestId('type-LEAVE');
    fireEvent.change(screen.getByLabelText('Tìm loại đơn'), { target: { value: 'tam ung' } });
    expect(screen.getByTestId('type-ADVANCE')).toBeTruthy();
    expect(screen.queryByTestId('type-OVERTIME')).toBeNull();
    fireEvent.change(screen.getByLabelText('Tìm loại đơn'), { target: { value: 'khong co gi' } });
    expect(screen.getByText('Không có loại đơn nào khớp.')).toBeTruthy();
  });

  it('loại Làm thêm giờ có cột Hưởng lương, Hệ số, tag Có lương, Không lương và ghi chú OT không lương', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    expect(screen.getByRole('columnheader', { name: /Hưởng lương/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Hệ số/ })).toBeTruthy();
    // Lý do có hệ số riêng hiện x2,5; lý do không đặt thì theo chính sách OT.
    expect(screen.getByText('x2,5')).toBeTruthy();
    expect(screen.getAllByText('Theo chính sách OT').length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: /Cần mô tả/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Số đơn đã dùng/ })).toBeTruthy();
    // Hai lý do có lương (Theo yêu cầu công việc, Khác) và một lý do không lương (Tự nguyện).
    expect(screen.getAllByText('Có lương')).toHaveLength(2);
    expect(screen.getByText('Không lương')).toBeTruthy();
    expect(screen.getByText(/OT không lương được ghi nhận nhưng không tính tiền OT\./)).toBeTruthy();
    // Dòng có mã, diễn giải, số đơn đã dùng và trạng thái.
    const row = rowOf('Theo yêu cầu công việc');
    expect(within(row).getByText('YEU_CAU_CONG_VIEC')).toBeTruthy();
    expect(within(row).getByText('OT do quản lý yêu cầu')).toBeTruthy();
    expect(within(row).getByText('3')).toBeTruthy();
    expect(within(row).getByText('Đang sử dụng')).toBeTruthy();
    const stopped = rowOf('Khác');
    expect(within(stopped).getByText('Ngừng sử dụng')).toBeTruthy();
    expect(within(stopped).getByText('Có')).toBeTruthy();
  });

  it('chọn loại khác ghi ?tab= lên URL, ẩn cột Hưởng lương và chỉ hiện lý do của loại đó', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    selectType('BUSINESS_TRIP');
    expect(urlTab()).toBe('BUSINESS_TRIP');
    expect(await screen.findByText('Gặp khách hàng')).toBeTruthy();
    expect(screen.queryByText('Theo yêu cầu công việc')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /Hưởng lương/ })).toBeNull();
    expect(screen.queryByText('Không lương')).toBeNull();
  });

  it('mở thẳng bằng ?tab=, mã lạ rơi về loại đầu tiên, nghe popstate', async () => {
    window.history.replaceState(null, '', '/?tab=BUSINESS_TRIP');
    render(<RequestReasonsScreen />);
    expect(await screen.findByText('Gặp khách hàng')).toBeTruthy();
    expect(screen.getByTestId('type-BUSINESS_TRIP').getAttribute('aria-current')).toBe('true');
    act(() => {
      window.history.replaceState(null, '', '/?tab=KHONG_CO');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByText('Theo yêu cầu công việc')).toBeTruthy();
    expect(screen.getByTestId('type-OVERTIME').getAttribute('aria-current')).toBe('true');
  });

  it('tìm lý do và lọc theo trạng thái (không dấu); lọc không ra thì báo không khớp', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    fireEvent.change(screen.getByLabelText('Tìm lý do'), { target: { value: 'tu nguyen' } });
    expect(screen.getByText('Tự nguyện')).toBeTruthy();
    expect(screen.queryByText('Theo yêu cầu công việc')).toBeNull();
    fireEvent.change(screen.getByLabelText('Tìm lý do'), { target: { value: '' } });
    // Lọc "Ngừng sử dụng": chỉ còn lý do Khác.
    const panel = screen.getByTestId('type-detail');
    fireEvent.click(within(panel).getByDisplayValue('Tất cả trạng thái'));
    fireEvent.click(await screen.findByRole('option', { name: 'Ngừng sử dụng' }));
    expect(screen.getByText('Khác')).toBeTruthy();
    expect(screen.queryByText('Tự nguyện')).toBeNull();
    fireEvent.change(screen.getByLabelText('Tìm lý do'), { target: { value: 'zzz' } });
    expect(screen.getByText('Không có lý do nào khớp')).toBeTruthy();
  });

  it('thêm lý do làm thêm giờ gọi POST /request-reasons với kind, tên, diễn giải, hưởng lương', async () => {
    respond = () => ({ data: workReason });
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lý do' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Thêm lý do cho đơn Làm thêm giờ'),
    ).toBeTruthy();
    typeInto(dialog, /^Tên lý do/, '  Làm bù cuối tuần ');
    typeInto(dialog, /^Diễn giải/, 'Dùng khi làm bù');
    await choose(dialog, /^Hưởng lương/, 'Không lương');
    typeInto(dialog, /^Hệ số tăng ca/, '2.5');
    await choose(dialog, /^Bắt buộc nhập mô tả/, 'Có');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: '/request-reasons',
      method: 'POST',
      body: {
        kind: 'OVERTIME',
        name: 'Làm bù cuối tuần',
        description: 'Dùng khi làm bù',
        paid: false,
        rateMultiplier: 2.5,
        requiresDescription: true,
        active: true,
      },
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Đã thêm lý do'));
    // Tải lại danh mục lý do sau khi thêm (ngoài lần tải ban đầu).
    expect(
      calls.filter((c) => c.method === 'GET' && c.path === '/request-reasons'),
    ).toHaveLength(2);
  });

  it('thêm lý do ở loại khác dùng đúng kind, có mã tự nhập và không có trường Hưởng lương', async () => {
    respond = () => ({ data: tripReason });
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    selectType('BUSINESS_TRIP');
    await screen.findByText('Gặp khách hàng');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lý do' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/^Hưởng lương/)).toBeNull();
    typeInto(dialog, /^Tên lý do/, 'Khảo sát địa điểm');
    typeInto(dialog, /^Mã lý do/, 'KHAO_SAT');
    typeInto(dialog, /^Thứ tự hiển thị/, '40');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: '/request-reasons',
      method: 'POST',
      body: {
        kind: 'BUSINESS_TRIP',
        code: 'KHAO_SAT',
        name: 'Khảo sát địa điểm',
        description: null,
        requiresDescription: false,
        active: true,
        sortOrder: 40,
      },
    });
  });

  it('sửa lý do qua menu "..." gọi PATCH /request-reasons/:id, không gửi kind và mã', async () => {
    respond = () => ({ data: workReason });
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    await rowAction('Thao tác với lý do Theo yêu cầu công việc', 'Sửa');
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Sửa lý do "Theo yêu cầu công việc"'),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/^Mã lý do/)).toBeNull();
    typeInto(dialog, /^Tên lý do/, 'Theo yêu cầu của quản lý');
    typeInto(dialog, /^Diễn giải/, '');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: '/request-reasons/r1',
      method: 'PATCH',
      body: {
        name: 'Theo yêu cầu của quản lý',
        description: null,
        paid: true,
        // Lý do chưa có hệ số riêng: gửi null để theo chính sách OT.
        rateMultiplier: null,
        requiresDescription: false,
        active: true,
        sortOrder: 10,
      },
    });
  });

  it('ngừng sử dụng qua Popconfirm tại nút "..." và dùng lại bằng một lần chọn', async () => {
    respond = () => ({ data: workReason });
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    await rowAction('Thao tác với lý do Theo yêu cầu công việc', 'Ngừng sử dụng');
    expect(writes()).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Ngừng sử dụng' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: '/request-reasons/r1',
      method: 'PATCH',
      body: { active: false },
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Đã ngừng sử dụng lý do'),
    );

    await rowAction('Thao tác với lý do Khác', 'Dùng lại');
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual({
      path: '/request-reasons/r3',
      method: 'PATCH',
      body: { active: true },
    });
  });

  it('xóa lý do chưa có đơn gọi DELETE sau Popconfirm và hiện thông báo của server', async () => {
    respond = () => ({
      data: { id: 'r2', deleted: true, active: false, usageCount: 0 },
      message: 'Đã xóa lý do "Tự nguyện".',
    });
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    await rowAction('Thao tác với lý do Tự nguyện', 'Xóa');
    expect(writes()).toHaveLength(0);
    reasons = [workReason, otherReason, tripReason];
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa lý do' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: '/request-reasons/r2',
      method: 'DELETE',
      body: undefined,
    });
    expect((await screen.findByRole('status')).textContent).toBe(
      'Đã xóa lý do "Tự nguyện".',
    );
    await waitFor(() => expect(screen.queryByText('Tự nguyện')).toBeNull());
  });

  it('lý do đã có đơn dùng: hiển thị đúng thông báo server và dòng chuyển sang ngừng sử dụng', async () => {
    const message =
      'Lý do "Theo yêu cầu công việc" đã được dùng trong 3 đơn nên không xóa được; hệ thống chỉ ngừng sử dụng lý do này.';
    respond = () => ({
      data: { id: 'r1', deleted: false, active: false, usageCount: 3 },
      message,
    });
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    await rowAction('Thao tác với lý do Theo yêu cầu công việc', 'Xóa');
    // Popconfirm báo trước lý do sẽ chỉ bị ngừng sử dụng.
    expect(
      await screen.findByText(/đã được dùng trong 3 đơn nên không xóa được/),
    ).toBeTruthy();
    reasons = [{ ...workReason, active: false }, unpaidReason, otherReason, tripReason];
    fireEvent.click(screen.getByRole('button', { name: 'Xóa lý do' }));
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toBe(message);
    await waitFor(() => {
      expect(within(rowOf('Theo yêu cầu công việc')).getByText('Ngừng sử dụng')).toBeTruthy();
    });
  });

  it('loại rỗng hiện trạng thái trống với nút Tạo lý do mặc định', async () => {
    reasons = [workReason, tripReason];
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    selectType('SHIFT_CHANGE');
    expect(await screen.findByText('Đơn đổi ca chưa có lý do nào')).toBeTruthy();
    respond = () => ({ data: { created: 2 } });
    reasons = [
      workReason,
      tripReason,
      reason({ id: 's1', kind: 'SHIFT_CHANGE', code: 'DOI_CA_CA_NHAN', name: 'Việc cá nhân' }),
    ];
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lý do mặc định' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].path).toBe('/request-reasons/defaults');
    expect(writes()[0].method).toBe('POST');
    expect(await screen.findByText('Việc cá nhân')).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalledWith('Đã tạo 2 lý do mặc định');
  });

  it('toàn bộ danh mục rỗng: mọi loại hệ thống đều có nút Tạo lý do mặc định', async () => {
    reasons = [];
    render(<RequestReasonsScreen />);
    for (const code of ['OVERTIME', 'BUSINESS_TRIP', 'ATTENDANCE_CORRECTION', 'SHIFT_CHANGE']) {
      await screen.findByTestId(`type-${code}`);
      selectType(code);
      expect(await screen.findByRole('button', { name: 'Tạo lý do mặc định' })).toBeTruthy();
    }
  });

  it('hiển thị lỗi của server khi thao tác thất bại', async () => {
    respond = () => {
      throw new Error('Lý do "Khác" đã có trong danh mục đơn làm thêm giờ.');
    };
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    await rowAction('Thao tác với lý do Khác', 'Dùng lại');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'đã có trong danh mục',
    );
  });

  it('người không có hrm.leave.manage không gọi API và thấy thông báo không có quyền', () => {
    mockActions.clear();
    mockActions.add('hrm.read');
    render(<RequestReasonsScreen />);
    expect(screen.getByRole('alert').textContent).toBe(
      'Bạn không có quyền cấu hình lý do đơn từ.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Thêm lý do' })).toBeNull();
  });

  it('nút Lịch sử thay đổi chỉ có khi có hrm.audit.read và mở ngăn kéo', async () => {
    const first = render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    expect(screen.queryByRole('button', { name: 'Lịch sử thay đổi' })).toBeNull();
    first.unmount();
    mockActions.add('hrm.audit.read');
    render(<RequestReasonsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lịch sử thay đổi' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});

describe('RequestReasonsScreen: lý do của Đơn xin nghỉ (loại nghỉ)', () => {
  beforeEach(() => {
    types = [leaveRequestType, ...systemTypes];
    window.history.replaceState(null, '', '/?tab=LEAVE');
  });

  it('bảng lý do nghỉ: chỉ dòng phép năm trừ quỹ; lý do không lương có thẻ Không lương và không trừ quỹ', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Nghỉ không lương');
    expect(screen.getByRole('heading', { name: 'Lý do của đơn xin nghỉ' })).toBeTruthy();
    for (const title of ['Tên lý do', 'Mã', 'Hưởng lương', 'Trừ quỹ phép', 'Cần chứng từ', 'Trạng thái'])
      expect(screen.getAllByRole('columnheader', { name: title }).length).toBeGreaterThan(0);

    const annual = screen
      .getByText('Phép năm', { selector: 'span.text-slate-900' })
      .closest('[role="row"]') as HTMLElement;
    expect(within(annual).getByText('Có lương')).toBeTruthy();
    expect(within(annual).getByText('Phép năm', { selector: 'span.inline-flex' })).toBeTruthy();

    const unpaid = rowOf('Nghỉ không lương');
    expect(within(unpaid).getByText('Không lương')).toBeTruthy();
    expect(within(unpaid).queryByText('Phép năm', { selector: 'span.inline-flex' })).toBeNull();

    const sick = rowOf('Nghỉ ốm');
    expect(within(sick).getByText('Có lương')).toBeTruthy();
    expect(within(sick).getByText('Có', { selector: 'div[role="cell"]' })).toBeTruthy();

    const stopped = rowOf('Nghỉ cũ');
    expect(within(stopped).getByText('Đã ngừng')).toBeTruthy();
    expect(
      screen.getByText(/Chỉ lý do Phép năm trừ quỹ phép; các lý do khác không làm thay đổi số dư phép/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Chính sách phép năm' }).getAttribute('href')).toBe('/settings?view=leave');
  });

  it('thêm lý do nghỉ bằng hộp thoại: gửi đúng POST, không gửi isAnnual hay deductBalance', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Nghỉ không lương');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lý do' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Mã lý do nghỉ/), { target: { value: 'NGHI_CUOI' } });
    fireEvent.change(within(dialog).getByLabelText(/Tên lý do nghỉ/), { target: { value: 'Nghỉ cưới' } });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Có lương' }));
    const getsBefore = calls.filter((c) => c.method === 'GET' && c.path === '/leave-types').length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu lý do nghỉ' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: '/leave-types',
      method: 'POST',
      body: {
        code: 'NGHI_CUOI',
        name: 'Nghỉ cưới',
        unit: 'DAYS',
        paid: false,
        requiresAttachment: false,
        active: true,
      },
    });
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'GET' && c.path === '/leave-types').length).toBeGreaterThan(getsBefore),
    );
    expect(await screen.findByText('Đã thêm lý do nghỉ "Nghỉ cưới".')).toBeTruthy();
  });

  it('sửa lý do phép năm: khóa hưởng lương, không gửi paid, bắt buộc Ghi chú thay đổi', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Nghỉ không lương');
    await rowAction('Thao tác với lý do nghỉ Phép năm', 'Sửa');
    const dialog = await screen.findByRole('dialog');
    const paid = within(dialog).getByRole('switch', { name: 'Có lương' });
    expect(paid.getAttribute('aria-checked')).toBe('true');
    expect((paid as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu lý do nghỉ' }));
    expect(await within(dialog).findByText('Cần nhập Ghi chú thay đổi')).toBeTruthy();
    expect(writes()).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/Ghi chú thay đổi/), { target: { value: 'Đổi tên hiển thị' } });
    fireEvent.change(within(dialog).getByLabelText(/Tên lý do nghỉ/), { target: { value: 'Phép năm chuẩn' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu lý do nghỉ' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: '/leave-types/lt1',
      method: 'PATCH',
      body: {
        name: 'Phép năm chuẩn',
        requiresAttachment: false,
        expectedUpdatedAt: annualLeave.updatedAt,
        reason: 'Đổi tên hiển thị',
      },
    });
  });

  it('sửa lý do thường: gửi paid, requiresAttachment, expectedUpdatedAt và ghi chú', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Nghỉ không lương');
    await rowAction('Thao tác với lý do nghỉ Nghỉ ốm', 'Sửa');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Có lương' }));
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Cần chứng từ' }));
    fireEvent.change(within(dialog).getByLabelText(/Ghi chú thay đổi/), { target: { value: 'Chuyển thành không lương' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu lý do nghỉ' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: '/leave-types/lt2',
      method: 'PATCH',
      body: {
        name: 'Nghỉ ốm',
        paid: false,
        requiresAttachment: false,
        expectedUpdatedAt: sickLeave.updatedAt,
        reason: 'Chuyển thành không lương',
      },
    });
  });

  it('ngừng và dùng lại lý do nghỉ qua Popconfirm có ghi chú thay đổi bắt buộc; phép năm không ngừng được', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Nghỉ không lương');
    // Phép năm không có mục Ngừng.
    fireEvent.click(screen.getByRole('button', { name: 'Thao tác với lý do nghỉ Phép năm' }));
    expect(await screen.findByRole('menuitem', { name: 'Sửa' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Ngừng' })).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });

    await rowAction('Thao tác với lý do nghỉ Nghỉ không lương', 'Ngừng');
    const confirm = await screen.findByRole('button', { name: 'Xác nhận' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Ví dụ: không còn áp dụng'), { target: { value: 'Không còn dùng' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: '/leave-types/lt3',
      method: 'PATCH',
      body: { active: false, expectedUpdatedAt: unpaidLeave.updatedAt, reason: 'Không còn dùng' },
    });
    expect(await screen.findByText('Đã ngừng lý do nghỉ "Nghỉ không lương" cho các đơn mới.')).toBeTruthy();

    await rowAction('Thao tác với lý do nghỉ Nghỉ cũ', 'Dùng lại');
    fireEvent.change(await screen.findByPlaceholderText('Ví dụ: áp dụng lại từ tháng này'), { target: { value: 'Dùng lại' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toMatchObject({ active: true });
  });

  it('chọn Đơn xin nghỉ rồi Thêm lý do không dùng form lý do đơn từ (kind) mà dùng hộp thoại lý do nghỉ', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Nghỉ không lương');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lý do' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Mã lý do nghỉ/)).toBeTruthy();
    expect(within(dialog).queryByText(/Hệ số tăng ca/)).toBeNull();
  });

  it('xóa lý do nghỉ gọi DELETE /leave-types/:id kèm expectedUpdatedAt', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Nghỉ không lương');
    await rowAction('Thao tác với lý do nghỉ Nghỉ không lương', 'Xóa');
    const confirm = await screen.findByRole('button', { name: 'Xóa lý do' });
    fireEvent.click(confirm);
    await waitFor(() => expect(writes().some((c) => c.method === 'DELETE')).toBe(true));
    const del = writes().find((c) => c.method === 'DELETE');
    expect(del?.path).toBe('/leave-types/lt3');
    expect(del?.body).toMatchObject({ expectedUpdatedAt: unpaidLeave.updatedAt });
  });
});

describe('RequestReasonsScreen: loại đơn', () => {
  it('liệt kê loại hệ thống và loại tuỳ chỉnh với số lý do; thông tin loại đang chọn có nguồn, thời gian, số đơn', async () => {
    types = [...systemTypes, customType];
    render(<RequestReasonsScreen />);
    await screen.findByTestId('type-XIN_DI_MUON');
    expect(within(screen.getByTestId('type-XIN_DI_MUON')).getByText('Xin đi muộn')).toBeTruthy();
    selectType('XIN_DI_MUON');
    const detail = screen.getByTestId('type-detail');
    expect(within(detail).getByText('Tuỳ chỉnh')).toBeTruthy();
    expect(within(detail).getByText('2 đơn đã tạo')).toBeTruthy();
    selectType('BUSINESS_TRIP');
    expect(within(screen.getByTestId('type-detail')).getByText('Hệ thống')).toBeTruthy();
  });

  it('loại tuỳ chỉnh rỗng không ép tạo lý do mặc định, thêm lý do dùng mã loại làm kind', async () => {
    types = [...systemTypes, customType];
    render(<RequestReasonsScreen />);
    await screen.findByTestId('type-XIN_DI_MUON');
    selectType('XIN_DI_MUON');
    expect(await screen.findByText('Đơn xin đi muộn chưa có lý do nào')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tạo lý do mặc định' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lý do' }));
    const dialog = await screen.findByRole('dialog');
    typeInto(dialog, /^Tên lý do/, 'Kẹt xe');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ kind: 'XIN_DI_MUON', name: 'Kẹt xe' });
  });

  it('loại không có danh mục lý do (Tạm ứng lương): giải thích, không có nút Thêm lý do, vẫn có Thiết lập loại đơn', async () => {
    types = [...systemTypes, advanceType];
    render(<RequestReasonsScreen />);
    await screen.findByTestId('type-ADVANCE');
    selectType('ADVANCE');
    expect(screen.getByText(/Loại đơn này không có danh mục lý do/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thêm lý do' })).toBeNull();
    expect(screen.queryByLabelText('Tìm lý do')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thiết lập loại đơn' }));
    expect(await screen.findByRole('menuitem', { name: 'Sửa loại đơn' })).toBeTruthy();
  });

  it('ngừng loại tuỳ chỉnh qua Popconfirm gửi PATCH kèm expectedUpdatedAt', async () => {
    types = [...systemTypes, customType];
    render(<RequestReasonsScreen />);
    await screen.findByTestId('type-XIN_DI_MUON');
    selectType('XIN_DI_MUON');
    await typeMenu('Ngừng sử dụng loại đơn');
    expect(writes()).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Ngừng sử dụng' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: '/request-types/y9',
      method: 'PATCH',
      body: { active: false, expectedUpdatedAt: customType.updatedAt },
    });
  });

  it('mục xóa chỉ hiện với loại đã ngừng sử dụng (kể cả loại hệ thống)', async () => {
    types = [...systemTypes, customType];
    render(<RequestReasonsScreen />);
    await screen.findByTestId('type-BUSINESS_TRIP');
    selectType('BUSINESS_TRIP');
    fireEvent.click(screen.getByRole('button', { name: 'Thiết lập loại đơn' }));
    expect(await screen.findByRole('menuitem', { name: 'Sửa loại đơn' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Xóa loại đơn' })).toBeNull();
  });

  it('xóa loại hệ thống đã ngừng: xác nhận rồi gọi DELETE, báo kết quả của máy chủ', async () => {
    types = systemTypes.map((t) => (t.code === 'BUSINESS_TRIP' ? { ...t, active: false, usageCount: 0 } : t));
    render(<RequestReasonsScreen />);
    await screen.findByTestId('type-BUSINESS_TRIP');
    selectType('BUSINESS_TRIP');
    await typeMenu('Xóa loại đơn');
    expect(writes()).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa loại đơn' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'DELETE' });
    expect(writes()[0].path).toMatch(/^\/request-types\//);
  });

  it('Đơn xin nghỉ luôn bật: không có mục ngừng sử dụng loại đơn', async () => {
    types = [leaveRequestType, ...systemTypes];
    window.history.replaceState(null, '', '/?tab=LEAVE');
    render(<RequestReasonsScreen />);
    await screen.findByText('Nghỉ không lương');
    fireEvent.click(screen.getByRole('button', { name: 'Thiết lập loại đơn' }));
    expect(await screen.findByRole('menuitem', { name: 'Sửa loại đơn' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Ngừng sử dụng loại đơn' })).toBeNull();
  });

  it('thêm loại đơn mở hộp thoại tạo loại tuỳ chỉnh', async () => {
    types = [...systemTypes];
    render(<RequestReasonsScreen />);
    await screen.findByTestId('type-OVERTIME');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm loại' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('không tải được danh mục loại đơn: vẫn dùng được đơn nghỉ và bốn loại hệ thống có lý do', async () => {
    fetchMock.mockImplementation((async (path: string) => {
      if (path === '/request-types/manage') throw new Error('HRM_NOT_MIGRATED');
      if (path === '/leave-types') return { data: leaveTypes };
      return { data: reasons };
    }) as never);
    render(<RequestReasonsScreen />);
    await screen.findByTestId('type-LEAVE');
    for (const code of ['LEAVE', 'OVERTIME', 'BUSINESS_TRIP', 'ATTENDANCE_CORRECTION', 'SHIFT_CHANGE'])
      expect(screen.getByTestId(`type-${code}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thêm loại' })).toBeNull();
  });
});

describe('reasonFormFields và reasonPayload', () => {
  it('chỉ làm thêm giờ có trường Hưởng lương và Hệ số tăng ca; mã chỉ có khi thêm mới', () => {
    const keys = (fields: { key: string }[]) => fields.map((f) => f.key);
    expect(keys(reasonFormFields('OVERTIME'))).toEqual([
      'name',
      'code',
      'description',
      'paid',
      'rateMultiplier',
      'requiresDescription',
      'active',
      'sortOrder',
    ]);
    expect(keys(reasonFormFields('SHIFT_CHANGE'))).not.toContain('paid');
    expect(keys(reasonFormFields('SHIFT_CHANGE'))).not.toContain('rateMultiplier');
    expect(keys(reasonFormFields('OVERTIME', workReason))).not.toContain('code');
  });

  it('PATCH không gửi kind và code; paid chỉ gửi cho làm thêm giờ', () => {
    const values = {
      name: ' A ',
      code: 'ABC',
      description: ' ',
      paid: 'false',
      rateMultiplier: ' 1,5 '.replace(',', '.'),
      requiresDescription: 'false',
      active: 'true',
      sortOrder: '',
    };
    expect(reasonPayload('OVERTIME', values, false)).toEqual({
      name: 'A',
      description: null,
      paid: false,
      rateMultiplier: 1.5,
      requiresDescription: false,
      active: true,
    });
    // Bỏ trống hệ số: null (gỡ hệ số riêng, theo chính sách OT).
    expect(reasonPayload('OVERTIME', { ...values, rateMultiplier: '' }, false).rateMultiplier).toBeNull();
    expect(reasonPayload('SHIFT_CHANGE', values, true)).toEqual({
      kind: 'SHIFT_CHANGE',
      code: 'ABC',
      name: 'A',
      description: null,
      requiresDescription: false,
      active: true,
    });
  });
});
