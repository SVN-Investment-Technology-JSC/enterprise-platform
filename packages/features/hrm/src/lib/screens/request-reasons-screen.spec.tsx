/** @jest-environment jsdom */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { HrmRequestReason } from '@enterprise-platform/contracts-hrm';
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

interface Call {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}
let calls: Call[];
let reasons: HrmRequestReason[];
let respond: (call: Call) => unknown;

const writes = () => calls.filter((c) => c.method !== 'GET');

beforeEach(() => {
  mockActions.clear();
  mockActions.add('hrm.leave.manage');
  calls = [];
  reasons = [workReason, unpaidReason, otherReason, tripReason];
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
    return respond(call);
  }) as never);
});

/** Chọn một mục của SearchableSelect nằm trong ô có nhãn `label` của hộp thoại. */
async function choose(dialog: HTMLElement, label: RegExp, option: string) {
  const field = within(dialog).getByText(label).closest('label') as HTMLElement;
  fireEvent.click(within(field).getByRole('textbox'));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

function typeInto(dialog: HTMLElement, label: RegExp, value: string) {
  const field = within(dialog).getByText(label).closest('label') as HTMLElement;
  fireEvent.change(field.querySelector('input') as HTMLInputElement, {
    target: { value },
  });
}

describe('RequestReasonsScreen', () => {
  it('giải thích rõ lý do là danh mục cấu hình, khác với Mô tả', async () => {
    render(<RequestReasonsScreen />);
    expect(
      screen.getByRole('heading', { name: 'Lý do đơn từ' }),
    ).toBeTruthy();
    const note = screen.getByRole('note');
    expect(note.textContent).toContain(
      'Lý do là danh mục do quản trị cấu hình; người làm đơn chọn một lý do rồi có thể nhập thêm Mô tả. Mô tả là văn bản tự do, không phải lý do.',
    );
    expect(await screen.findByText('Theo yêu cầu công việc')).toBeTruthy();
  });

  it('hiển thị đủ bốn tab theo loại đơn và không có đơn nghỉ', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual([
      'Làm thêm giờ3',
      'Công tác1',
      'Giải trình công0',
      'Đổi ca0',
    ]);
    expect(screen.queryByRole('tab', { name: /Nghỉ/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /Làm thêm giờ/ }).getAttribute('aria-selected')).toBe('true');
    expect(calls.filter((c) => c.method === 'GET')).toEqual([
      { path: '/request-reasons', method: 'GET', body: undefined },
    ]);
  });

  it('tab Làm thêm giờ có cột Hưởng lương, tag Có lương, Không lương và ghi chú OT không lương', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    expect(screen.getByRole('columnheader', { name: /Hưởng lương/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Cần mô tả/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Số đơn đã dùng/ })).toBeTruthy();
    // Hai lý do có lương (Theo yêu cầu công việc, Khác) và một lý do không lương (Tự nguyện).
    expect(screen.getAllByText('Có lương')).toHaveLength(2);
    expect(screen.getByText('Không lương')).toBeTruthy();
    expect(
      screen.getByText('OT không lương được ghi nhận nhưng không tính tiền OT.'),
    ).toBeTruthy();
    // Dòng có mã, diễn giải, số đơn đã dùng và trạng thái.
    const row = screen.getByText('Theo yêu cầu công việc').closest('tr') as HTMLElement;
    expect(within(row).getByText('YEU_CAU_CONG_VIEC')).toBeTruthy();
    expect(within(row).getByText('OT do quản lý yêu cầu')).toBeTruthy();
    expect(within(row).getByText('3')).toBeTruthy();
    expect(within(row).getByText('Đang sử dụng')).toBeTruthy();
    const stopped = screen.getByText('Khác').closest('tr') as HTMLElement;
    expect(within(stopped).getByText('Ngừng sử dụng')).toBeTruthy();
    expect(within(stopped).getByText('Có')).toBeTruthy();
  });

  it('các tab khác ẩn cột Hưởng lương và chỉ hiện lý do của loại đơn đó', async () => {
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    fireEvent.click(screen.getByRole('tab', { name: /Công tác/ }));
    expect(await screen.findByText('Gặp khách hàng')).toBeTruthy();
    expect(screen.queryByText('Theo yêu cầu công việc')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /Hưởng lương/ })).toBeNull();
    expect(screen.queryByText('Không lương')).toBeNull();
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
        requiresDescription: true,
        active: true,
      },
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Đã thêm lý do'));
    // Tải lại danh mục sau khi thêm.
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });

  it('thêm lý do ở tab khác dùng đúng kind, có mã tự nhập và không có trường Hưởng lương', async () => {
    respond = () => ({ data: tripReason });
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    fireEvent.click(screen.getByRole('tab', { name: /Công tác/ }));
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

  it('sửa lý do gọi PATCH /request-reasons/:id, không gửi kind và mã', async () => {
    respond = () => ({ data: workReason });
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    fireEvent.click(
      screen.getByRole('button', { name: 'Sửa lý do Theo yêu cầu công việc' }),
    );
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
        requiresDescription: false,
        active: true,
        sortOrder: 10,
      },
    });
  });

  it('ngừng sử dụng qua Popconfirm và dùng lại bằng một lần bấm', async () => {
    respond = () => ({ data: workReason });
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    fireEvent.click(
      screen.getByRole('button', { name: 'Ngừng lý do Theo yêu cầu công việc' }),
    );
    expect(writes()).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Ngừng sử dụng' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: '/request-reasons/r1',
      method: 'PATCH',
      body: { active: false },
    });

    // Chờ thao tác đầu xong (nút bị khóa trong lúc đang xử lý) rồi mới dùng lại.
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Đã ngừng sử dụng lý do'),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Dùng lại lý do Khác' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dùng lại lý do Khác' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Xóa lý do Tự nguyện' }));
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
    fireEvent.click(
      screen.getByRole('button', { name: 'Xóa lý do Theo yêu cầu công việc' }),
    );
    // Popconfirm báo trước lý do sẽ chỉ bị ngừng sử dụng.
    expect(
      await screen.findByText(/đã được dùng trong 3 đơn nên không xóa được/),
    ).toBeTruthy();
    reasons = [{ ...workReason, active: false }, unpaidReason, otherReason, tripReason];
    fireEvent.click(screen.getByRole('button', { name: 'Xóa lý do' }));
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toBe(message);
    await waitFor(() => {
      const row = screen.getByText('Theo yêu cầu công việc').closest('tr') as HTMLElement;
      expect(within(row).getByText('Ngừng sử dụng')).toBeTruthy();
    });
  });

  it('tab rỗng hiện trạng thái trống với nút Tạo lý do mặc định', async () => {
    reasons = [workReason, tripReason];
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    fireEvent.click(screen.getByRole('tab', { name: /Đổi ca/ }));
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

  it('toàn bộ danh mục rỗng: mọi tab đều có nút Tạo lý do mặc định', async () => {
    reasons = [];
    render(<RequestReasonsScreen />);
    for (const name of [/Làm thêm giờ/, /Công tác/, /Giải trình công/, /Đổi ca/]) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(
        await screen.findByRole('button', { name: 'Tạo lý do mặc định' }),
      ).toBeTruthy();
    }
  });

  it('hiển thị lỗi của server khi thao tác thất bại', async () => {
    respond = () => {
      throw new Error('Lý do "Khác" đã có trong danh mục đơn làm thêm giờ.');
    };
    render(<RequestReasonsScreen />);
    await screen.findByText('Theo yêu cầu công việc');
    fireEvent.click(screen.getByRole('button', { name: 'Dùng lại lý do Khác' }));
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
});

describe('reasonFormFields và reasonPayload', () => {
  it('chỉ làm thêm giờ có trường Hưởng lương; mã chỉ có khi thêm mới', () => {
    const keys = (fields: { key: string }[]) => fields.map((f) => f.key);
    expect(keys(reasonFormFields('OVERTIME'))).toEqual([
      'name',
      'code',
      'description',
      'paid',
      'requiresDescription',
      'active',
      'sortOrder',
    ]);
    expect(keys(reasonFormFields('SHIFT_CHANGE'))).not.toContain('paid');
    expect(keys(reasonFormFields('OVERTIME', workReason))).not.toContain('code');
  });

  it('PATCH không gửi kind và code; paid chỉ gửi cho làm thêm giờ', () => {
    const values = {
      name: ' A ',
      code: 'ABC',
      description: ' ',
      paid: 'false',
      requiresDescription: 'false',
      active: 'true',
      sortOrder: '',
    };
    expect(reasonPayload('OVERTIME', values, false)).toEqual({
      name: 'A',
      description: null,
      paid: false,
      requiresDescription: false,
      active: true,
    });
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
