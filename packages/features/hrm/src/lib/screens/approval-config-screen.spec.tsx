/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  ApprovalRouteConfigItem,
  ApprovalRouteConfigResult,
} from '@enterprise-platform/contracts-hrm';
import { HrmApiError, hrmFetch } from '../hrm-api';
import { toast } from '../ui/toast';
import ApprovalConfigScreen, {
  groupApprovalItems,
  isRouteDirty,
  routePayload,
  savedRoute,
} from './approval-config-screen';

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
const toastError = toast.error as jest.Mock;

function item(
  over: Partial<ApprovalRouteConfigItem> &
    Pick<ApprovalRouteConfigItem, 'requestKind' | 'label'>,
): ApprovalRouteConfigItem {
  return {
    reasonId: null,
    reasonCode: null,
    reasonName: null,
    mode: 'DIRECT',
    procedureDefinitionId: null,
    procedureName: null,
    inherited: false,
    bindingId: null,
    conflict: false,
    ...over,
  };
}

const definitions = [
  { id: 'p1', code: 'QT-01', name: 'Duyệt nghỉ không lương' },
  { id: 'p2', code: 'QT-02', name: 'Duyệt OT' },
  { id: 'p3', code: 'QT-03', name: 'Duyệt công tác' },
];

const baseItems = (): ApprovalRouteConfigItem[] => [
  item({ requestKind: 'leave', label: 'Nghỉ phép' }),
  item({
    requestKind: 'leave',
    label: 'Nghỉ phép · Phép năm',
    reasonId: 'lt1',
    reasonCode: 'AL',
    reasonName: 'Phép năm',
    inherited: true,
  }),
  item({
    requestKind: 'leave',
    label: 'Nghỉ phép · Nghỉ không lương',
    reasonId: 'lt2',
    reasonCode: 'UL',
    reasonName: 'Nghỉ không lương',
    mode: 'PROCEDURE',
    procedureDefinitionId: 'p1',
    procedureName: 'Duyệt nghỉ không lương',
    bindingId: 'b1',
  }),
  item({
    requestKind: 'ot',
    label: 'Làm thêm giờ',
    mode: 'PROCEDURE',
    procedureDefinitionId: 'p2',
    procedureName: 'Duyệt OT',
    bindingId: 'b2',
  }),
  item({
    requestKind: 'ot',
    label: 'Làm thêm giờ · Theo yêu cầu công việc',
    reasonId: 'r1',
    reasonCode: 'YEU_CAU_CONG_VIEC',
    reasonName: 'Theo yêu cầu công việc',
    mode: 'PROCEDURE',
    procedureDefinitionId: 'p2',
    procedureName: 'Duyệt OT',
    inherited: true,
  }),
  item({ requestKind: 'business_trip', label: 'Công tác' }),
  item({
    requestKind: 'business_trip',
    label: 'Công tác · Gặp khách hàng',
    reasonId: 'r2',
    reasonCode: 'GAP_KHACH_HANG',
    reasonName: 'Gặp khách hàng',
    inherited: true,
  }),
  item({ requestKind: 'shift_change', label: 'Đổi ca' }),
  item({ requestKind: 'correction', label: 'Giải trình công' }),
  item({ requestKind: 'advance', label: 'Ứng lương' }),
  item({ requestKind: 'profile_correction', label: 'Đính chính hồ sơ' }),
];

interface Call {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}
let calls: Call[];
let config: ApprovalRouteConfigResult;
let definitionsResult: () => unknown;
let putResult: (body: Record<string, unknown>) => unknown;

const puts = () => calls.filter((c) => c.method === 'PUT');

/** PUT mặc định: áp dụng lựa chọn vào đúng dòng rồi trả lại toàn bộ danh sách như server. */
function applyPut(body: Record<string, unknown>): ApprovalRouteConfigResult {
  const items = config.items.map((i) => {
    if (
      i.requestKind !== body.requestKind ||
      (i.reasonCode ?? undefined) !== (body.reasonCode ?? undefined)
    )
      return i;
    if (body.mode === 'INHERIT')
      return { ...i, inherited: true, bindingId: null };
    const def = definitions.find((d) => d.id === body.procedureDefinitionId);
    return {
      ...i,
      mode: body.mode as 'DIRECT' | 'PROCEDURE',
      procedureDefinitionId: def?.id ?? null,
      procedureName: def?.name ?? null,
      inherited: false,
      bindingId: 'saved',
    };
  });
  return { items, procedureAvailable: config.procedureAvailable };
}

beforeEach(() => {
  mockActions.clear();
  mockActions.add('hrm.automation.manage');
  calls = [];
  config = { items: baseItems(), procedureAvailable: true };
  definitionsResult = () => ({ data: definitions });
  putResult = (body) => ({ data: applyPut(body) });
  fetchMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    const call: Call = {
      path,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    if (path === '/approval-config' && call.method === 'GET')
      return { data: config };
    if (path === '/approval-config' && call.method === 'PUT')
      return putResult(call.body as Record<string, unknown>);
    if (path === '/operations/procedure-definitions') return definitionsResult();
    throw new Error(`unexpected ${call.method} ${path}`);
  }) as never);
});

const rowOf = (key: string) => screen.getByTestId(`approval-row-${key}`);
const choiceBox = (row: HTMLElement, label: string) =>
  within(
    within(row).getByRole('group', { name: `Cách duyệt của ${label}` }),
  ).getByRole('textbox') as HTMLInputElement;
const procedureBox = (row: HTMLElement, label: string) =>
  within(
    within(row).getByRole('group', { name: `Quy trình của ${label}` }),
  ).getByRole('textbox') as HTMLInputElement;

async function pick(box: HTMLElement, option: string) {
  fireEvent.click(box);
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

async function renderLoaded() {
  render(<ApprovalConfigScreen />);
  // Chờ cả danh sách cấu hình lẫn danh sách quy trình.
  await screen.findByTestId('approval-row-leave:');
  await waitFor(() =>
    expect(calls.some((c) => c.path === '/operations/procedure-definitions')).toBe(true),
  );
  // Danh sách quy trình đã nạp khi dòng đang theo quy trình hiện đủ mã và tên quy trình.
  await waitFor(() =>
    expect(procedureBox(rowOf('ot:'), 'Làm thêm giờ').value).toBe('QT-02 · Duyệt OT'),
  );
  await act(async () => {
    await Promise.resolve();
  });
}

describe('ApprovalConfigScreen', () => {
  it('giải thích hai cách duyệt và nhóm bảy loại đơn kèm dòng lý do thụt vào', async () => {
    await renderLoaded();
    expect(screen.getByRole('heading', { name: 'Duyệt đơn' })).toBeTruthy();
    expect(screen.getByText('Quản lý trực tiếp (mặc định)')).toBeTruthy();
    expect(screen.getAllByText('Theo quy trình').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Người duyệt là quản lý trực tiếp và người có quyền duyệt toàn bộ/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Người duyệt do quy trình chỉ định theo từng bước/),
    ).toBeTruthy();

    for (const key of [
      'leave:',
      'ot:',
      'business_trip:',
      'shift_change:',
      'correction:',
      'advance:',
      'profile_correction:',
    ])
      expect(rowOf(key)).toBeTruthy();
    for (const label of [
      'Nghỉ phép',
      'Làm thêm giờ',
      'Công tác',
      'Đổi ca',
      'Giải trình công',
      'Ứng lương',
      'Đính chính hồ sơ',
    ])
      expect(within(rowOf(keyOfLabel(label))).getByText(label)).toBeTruthy();

    expect(within(rowOf('leave:')).getByText('2 lý do, 1 có cấu hình riêng')).toBeTruthy();
    expect(within(rowOf('advance:')).getByText('Không có lý do riêng')).toBeTruthy();
    expect(within(rowOf('leave:AL')).getByText('Phép năm')).toBeTruthy();
    expect(within(rowOf('leave:AL')).getByText('AL')).toBeTruthy();
    expect(within(rowOf('leave:UL')).getByText('Nghỉ không lương')).toBeTruthy();
  });

  it('hiển thị cách duyệt đang lưu, quy trình đã chọn và thẻ Theo cấu hình chung', async () => {
    await renderLoaded();
    expect(choiceBox(rowOf('leave:'), 'Nghỉ phép').value).toBe('Quản lý trực tiếp');
    expect(choiceBox(rowOf('ot:'), 'Làm thêm giờ').value).toBe('Theo quy trình');
    expect(procedureBox(rowOf('ot:'), 'Làm thêm giờ').value).toBe('QT-02 · Duyệt OT');

    const inherited = rowOf('leave:AL');
    expect(
      choiceBox(inherited, 'Nghỉ phép · Phép năm').value,
    ).toBe('Theo cấu hình chung');
    expect(within(inherited).getByText('Theo cấu hình chung')).toBeTruthy();
    expect(within(inherited).getByText(/Đang theo cấu hình chung:/)).toBeTruthy();

    const own = rowOf('leave:UL');
    expect(choiceBox(own, 'Nghỉ phép · Nghỉ không lương').value).toBe('Theo quy trình');
    expect(
      procedureBox(own, 'Nghỉ phép · Nghỉ không lương').value,
    ).toBe('QT-01 · Duyệt nghỉ không lương');
    expect(within(own).queryByText('Theo cấu hình chung')).toBeNull();

    // Dòng lý do kế thừa quy trình của loại đơn: mô tả quy trình đang áp dụng.
    const otReason = rowOf('ot:YEU_CAU_CONG_VIEC');
    expect(within(otReason).getByText('Quy trình Duyệt OT')).toBeTruthy();
  });

  it('dòng chung chỉ có hai cách duyệt, dòng lý do có thêm Theo cấu hình chung', async () => {
    await renderLoaded();
    fireEvent.click(choiceBox(rowOf('shift_change:'), 'Đổi ca'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Quản lý trực tiếp',
      'Theo quy trình',
    ]);
    fireEvent.keyDown(choiceBox(rowOf('shift_change:'), 'Đổi ca'), { key: 'Escape' });

    fireEvent.click(choiceBox(rowOf('leave:AL'), 'Nghỉ phép · Phép năm'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Theo cấu hình chung',
      'Quản lý trực tiếp',
      'Theo quy trình',
    ]);
  });

  it('thu gọn và mở các dòng lý do của từng loại đơn và của tất cả', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn lý do của Nghỉ phép' }));
    expect(screen.queryByTestId('approval-row-leave:AL')).toBeNull();
    expect(screen.getByTestId('approval-row-ot:YEU_CAU_CONG_VIEC')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mở lý do của Nghỉ phép' }));
    expect(screen.getByTestId('approval-row-leave:AL')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn tất cả lý do' }));
    expect(screen.queryByTestId('approval-row-leave:UL')).toBeNull();
    expect(screen.queryByTestId('approval-row-ot:YEU_CAU_CONG_VIEC')).toBeNull();
    expect(screen.queryByTestId('approval-row-business_trip:GAP_KHACH_HANG')).toBeNull();
    // Dòng chính của loại đơn vẫn còn.
    expect(screen.getByTestId('approval-row-leave:')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mở tất cả lý do' }));
    expect(screen.getByTestId('approval-row-leave:UL')).toBeTruthy();
  });

  it('chặn Theo quy trình khi chưa chọn quy trình, chọn xong mới lưu và gọi PUT đúng', async () => {
    await renderLoaded();
    const row = rowOf('business_trip:');
    await pick(choiceBox(row, 'Công tác'), 'Theo quy trình');
    const save = within(row).getByRole('button', {
      name: 'Lưu cách duyệt của Công tác',
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(within(row).getByText('Chọn quy trình để lưu.')).toBeTruthy();
    expect(within(row).getByText('Chưa lưu')).toBeTruthy();
    fireEvent.click(save);
    expect(puts()).toHaveLength(0);

    await pick(procedureBox(row, 'Công tác'), 'QT-03 · Duyệt công tác');
    expect(save.disabled).toBe(false);
    expect(within(row).queryByText('Chọn quy trình để lưu.')).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual({
      path: '/approval-config',
      method: 'PUT',
      body: {
        requestKind: 'business_trip',
        mode: 'PROCEDURE',
        procedureDefinitionId: 'p3',
      },
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Đã lưu cách duyệt: Công tác'),
    );
    // Danh sách lấy lại từ server: hết "Chưa lưu", dòng hiện quy trình đã lưu.
    await waitFor(() => expect(within(rowOf('business_trip:')).queryByText('Chưa lưu')).toBeNull());
    expect(procedureBox(rowOf('business_trip:'), 'Công tác').value).toBe(
      'QT-03 · Duyệt công tác',
    );
  });

  it('chuyển loại đơn về Quản lý trực tiếp gửi mode DIRECT, không kèm quy trình hay lý do', async () => {
    await renderLoaded();
    const row = rowOf('ot:');
    await pick(choiceBox(row, 'Làm thêm giờ'), 'Quản lý trực tiếp');
    expect(within(row).queryByRole('group', { name: 'Quy trình của Làm thêm giờ' })).toBeNull();
    fireEvent.click(
      within(row).getByRole('button', { name: 'Lưu cách duyệt của Làm thêm giờ' }),
    );
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ requestKind: 'ot', mode: 'DIRECT' });
  });

  it('dòng lý do: Theo cấu hình chung gửi INHERIT kèm mã lý do', async () => {
    await renderLoaded();
    const row = rowOf('leave:UL');
    await pick(choiceBox(row, 'Nghỉ phép · Nghỉ không lương'), 'Theo cấu hình chung');
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Lưu cách duyệt của Nghỉ phép · Nghỉ không lương',
      }),
    );
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({
      requestKind: 'leave',
      reasonCode: 'UL',
      mode: 'INHERIT',
    });
    await waitFor(() =>
      expect(within(rowOf('leave:UL')).getByText('Theo cấu hình chung')).toBeTruthy(),
    );
  });

  it('dòng lý do: Quản lý trực tiếp và Theo quy trình riêng gửi mode và mã lý do', async () => {
    await renderLoaded();
    const direct = rowOf('leave:AL');
    await pick(choiceBox(direct, 'Nghỉ phép · Phép năm'), 'Quản lý trực tiếp');
    fireEvent.click(
      within(direct).getByRole('button', { name: 'Lưu cách duyệt của Nghỉ phép · Phép năm' }),
    );
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({
      requestKind: 'leave',
      reasonCode: 'AL',
      mode: 'DIRECT',
    });
    // Chờ lần lưu đầu xong (nút Lưu biến mất) rồi mới sửa dòng khác.
    await waitFor(() =>
      expect(
        within(direct).queryByRole('button', { name: /^Lưu cách duyệt của/ }),
      ).toBeNull(),
    );

    const label = 'Công tác · Gặp khách hàng';
    const own = rowOf('business_trip:GAP_KHACH_HANG');
    await pick(choiceBox(own, label), 'Theo quy trình');
    await pick(procedureBox(own, label), 'QT-02 · Duyệt OT');
    fireEvent.click(within(own).getByRole('button', { name: `Lưu cách duyệt của ${label}` }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].body).toEqual({
      requestKind: 'business_trip',
      reasonCode: 'GAP_KHACH_HANG',
      mode: 'PROCEDURE',
      procedureDefinitionId: 'p2',
    });
  });

  it('Hoàn tác bỏ thay đổi chưa lưu và không gọi PUT', async () => {
    await renderLoaded();
    const row = rowOf('shift_change:');
    await pick(choiceBox(row, 'Đổi ca'), 'Theo quy trình');
    expect(within(row).getByText('Chưa lưu')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Hoàn tác thay đổi của Đổi ca' }));
    expect(within(row).queryByText('Chưa lưu')).toBeNull();
    expect(choiceBox(row, 'Đổi ca').value).toBe('Quản lý trực tiếp');
    expect(puts()).toHaveLength(0);
  });

  it('chọn lại đúng giá trị đang lưu thì không còn là thay đổi', async () => {
    await renderLoaded();
    const row = rowOf('shift_change:');
    await pick(choiceBox(row, 'Đổi ca'), 'Theo quy trình');
    await pick(choiceBox(row, 'Đổi ca'), 'Quản lý trực tiếp');
    expect(within(row).queryByText('Chưa lưu')).toBeNull();
    expect(
      within(row).queryByRole('button', { name: 'Lưu cách duyệt của Đổi ca' }),
    ).toBeNull();
  });

  it('hiển thị cảnh báo của server sau khi lưu', async () => {
    putResult = (body) => ({
      data: {
        ...applyPut(body),
        warnings: ['Bước đầu tiên của quy trình không phải bước khởi tạo.'],
      },
    });
    await renderLoaded();
    const row = rowOf('correction:');
    await pick(choiceBox(row, 'Giải trình công'), 'Theo quy trình');
    await pick(procedureBox(row, 'Giải trình công'), 'QT-01 · Duyệt nghỉ không lương');
    fireEvent.click(
      within(row).getByRole('button', { name: 'Lưu cách duyệt của Giải trình công' }),
    );
    const warning = await screen.findByText('Cảnh báo cấu hình');
    expect(warning.closest('[role="status"]')?.textContent).toContain(
      'Bước đầu tiên của quy trình không phải bước khởi tạo.',
    );
  });

  it('báo cấu hình mâu thuẫn ở đầu bảng và trên dòng', async () => {
    config = {
      items: baseItems().map((i) =>
        i.requestKind === 'advance' ? { ...i, conflict: true } : i,
      ),
      procedureAvailable: true,
    };
    await renderLoaded();
    expect(
      screen.getByText(/Có 1 dòng cấu hình mâu thuẫn\. Đơn thuộc dòng đó chưa gửi được/),
    ).toBeTruthy();
    expect(within(rowOf('advance:')).getByText('Cấu hình mâu thuẫn')).toBeTruthy();
    expect(within(rowOf('leave:')).queryByText('Cấu hình mâu thuẫn')).toBeNull();
  });

  it('Procedure không khả dụng: báo rõ, khóa lựa chọn Theo quy trình và không tải danh sách quy trình', async () => {
    config = {
      items: baseItems(),
      procedureAvailable: false,
    };
    render(<ApprovalConfigScreen />);
    await screen.findByTestId('approval-row-leave:');
    const alert = await screen.findByText(/Procedure Engine không khả dụng/);
    expect(alert.textContent).toContain('chỉ chọn được cách Quản lý trực tiếp');
    expect(calls.some((c) => c.path === '/operations/procedure-definitions')).toBe(false);

    fireEvent.click(choiceBox(rowOf('shift_change:'), 'Đổi ca'));
    const option = await screen.findByRole('option', { name: 'Theo quy trình' });
    expect(option.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(option);
    // Lựa chọn bị khóa: không phát sinh thay đổi.
    expect(within(rowOf('shift_change:')).queryByText('Chưa lưu')).toBeNull();
    fireEvent.keyDown(choiceBox(rowOf('shift_change:'), 'Đổi ca'), { key: 'Escape' });

    // Dòng đang Theo quy trình bị cảnh báo và vẫn chuyển về Quản lý trực tiếp được.
    const ot = rowOf('ot:');
    expect(within(ot).getByText('Procedure không khả dụng')).toBeTruthy();
    await pick(choiceBox(ot, 'Làm thêm giờ'), 'Quản lý trực tiếp');
    fireEvent.click(within(ot).getByRole('button', { name: 'Lưu cách duyệt của Làm thêm giờ' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({ requestKind: 'ot', mode: 'DIRECT' });
  });

  it('không tải được danh sách quy trình: báo lý do và khóa lựa chọn Theo quy trình', async () => {
    definitionsResult = () => {
      throw new HrmApiError('Bạn không còn quyền thực hiện thao tác này.', 403);
    };
    render(<ApprovalConfigScreen />);
    await screen.findByTestId('approval-row-leave:');
    const alert = await screen.findByText(/Không tải được danh sách quy trình/);
    expect(alert.textContent).toContain('chưa có quyền xem danh sách quy trình');
    fireEvent.click(choiceBox(rowOf('shift_change:'), 'Đổi ca'));
    const option = await screen.findByRole('option', { name: 'Theo quy trình' });
    expect(option.getAttribute('aria-disabled')).toBe('true');
  });

  it('lưu lỗi: hiện thông báo, giữ nguyên thay đổi chưa lưu', async () => {
    putResult = () => {
      throw new Error('Quy trình phải được công bố và thuộc tenant hiện tại');
    };
    await renderLoaded();
    const row = rowOf('ot:');
    await pick(choiceBox(row, 'Làm thêm giờ'), 'Quản lý trực tiếp');
    fireEvent.click(within(row).getByRole('button', { name: 'Lưu cách duyệt của Làm thêm giờ' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Quy trình phải được công bố và thuộc tenant hiện tại',
    );
    expect(toastError).toHaveBeenCalledWith(
      'Quy trình phải được công bố và thuộc tenant hiện tại',
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(within(rowOf('ot:')).getByText('Chưa lưu')).toBeTruthy();
  });

  it('người không có hrm.automation.manage không gọi API và thấy thông báo không có quyền', () => {
    mockActions.clear();
    mockActions.add('hrm.leave.manage');
    render(<ApprovalConfigScreen />);
    expect(screen.getByRole('alert').textContent).toBe(
      'Bạn không có quyền cấu hình cách duyệt đơn.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function keyOfLabel(label: string) {
  const found = baseItems().find((i) => i.label === label && !i.reasonCode);
  if (!found) throw new Error(label);
  return `${found.requestKind}:`;
}

describe('hàm xử lý cấu hình duyệt đơn', () => {
  const [leave, annual, unpaid] = baseItems();

  it('savedRoute: dòng kế thừa là INHERIT, dòng riêng theo mode, chỉ PROCEDURE có quy trình', () => {
    expect(savedRoute(leave)).toEqual({ choice: 'DIRECT', procedureId: '' });
    expect(savedRoute(annual)).toEqual({ choice: 'INHERIT', procedureId: '' });
    expect(savedRoute(unpaid)).toEqual({ choice: 'PROCEDURE', procedureId: 'p1' });
  });

  it('isRouteDirty so với cấu hình đang lưu', () => {
    expect(isRouteDirty(unpaid, { choice: 'PROCEDURE', procedureId: 'p1' })).toBe(false);
    expect(isRouteDirty(unpaid, { choice: 'PROCEDURE', procedureId: 'p3' })).toBe(true);
    expect(isRouteDirty(unpaid, { choice: 'DIRECT', procedureId: '' })).toBe(true);
    expect(isRouteDirty(annual, { choice: 'INHERIT', procedureId: '' })).toBe(false);
  });

  it('routePayload: chặn PROCEDURE chưa có quy trình, dòng chung không có reasonCode', () => {
    expect(() => routePayload(leave, { choice: 'PROCEDURE', procedureId: '' })).toThrow(
      'Chọn quy trình trước khi lưu',
    );
    expect(routePayload(leave, { choice: 'DIRECT', procedureId: '' })).toEqual({
      requestKind: 'leave',
      mode: 'DIRECT',
    });
    expect(routePayload(annual, { choice: 'INHERIT', procedureId: '' })).toEqual({
      requestKind: 'leave',
      reasonCode: 'AL',
      mode: 'INHERIT',
    });
    expect(routePayload(annual, { choice: 'PROCEDURE', procedureId: 'p2' })).toEqual({
      requestKind: 'leave',
      reasonCode: 'AL',
      mode: 'PROCEDURE',
      procedureDefinitionId: 'p2',
    });
  });

  it('groupApprovalItems gom dòng lý do vào đúng loại đơn theo thứ tự server', () => {
    const groups = groupApprovalItems(baseItems());
    expect(groups.map((g) => [g.general.label, g.reasons.length])).toEqual([
      ['Nghỉ phép', 2],
      ['Làm thêm giờ', 1],
      ['Công tác', 1],
      ['Đổi ca', 0],
      ['Giải trình công', 0],
      ['Ứng lương', 0],
      ['Đính chính hồ sơ', 0],
    ]);
  });
});
