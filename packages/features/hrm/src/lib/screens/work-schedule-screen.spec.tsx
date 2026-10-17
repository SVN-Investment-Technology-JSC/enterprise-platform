/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HrmApiError, hrmEmployeeOptions, hrmFetch } from '../hrm-api';
import { addDays, endOfMonth, startOfMonth, todayIso } from '../hrm-work-schedule-model';
import WorkScheduleScreen from './work-schedule-screen';

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

const month = startOfMonth(todayIso());
const d5 = addDays(month, 4);
const d6 = addDays(month, 5);
const d7 = addDays(month, 6);

const shifts = [
  { id: 's-hc', code: 'HC', name: 'Hành chính', startTime: '08:00', endTime: '17:00', status: 'ACTIVE' },
  { id: 's-half', code: 'HC4', name: 'Nửa ngày', startTime: '08:00', endTime: '12:00', status: 'ACTIVE' },
];
const template = {
  id: 't1',
  code: 'HC_T2_T6',
  name: 'Hành chính T2-T6',
  status: 'ACTIVE',
  description: null,
  days: [{ weekday: 1, dayType: 'SHIFT', shiftId: 's-hc' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const grid = {
  employees: [{ employeeId: 'e1', code: 'NV001', name: 'Nguyễn Văn An', unitId: 'u1', unitName: 'Sản xuất' }],
  days: [
    { employeeId: 'e1', date: d5, dayType: 'SHIFT', shiftId: 's-hc', shiftCode: 'HC', shiftName: 'Hành chính', startTime: '08:00', endTime: '17:00', source: 'TEMPLATE', holidayId: null, note: null },
    { employeeId: 'e1', date: d6, dayType: 'OFF', shiftId: null, shiftCode: null, shiftName: null, startTime: null, endTime: null, source: 'MANUAL', holidayId: null, note: null },
    { employeeId: 'e1', date: d7, dayType: 'HOLIDAY', shiftId: null, shiftCode: null, shiftName: null, startTime: null, endTime: null, source: 'HOLIDAY', holidayId: 'h1', note: null },
  ],
  holidays: [
    { id: 'h1', name: 'Quốc khánh', kind: 'HOLIDAY', fromDate: d7, toDate: d7, scopeType: 'COMPANY', treatment: 'OFF', status: 'ACTIVE' },
  ],
  meta: { total: 1, page: 1, pageSize: 50 },
};
const preview = {
  summary: { insert: 20, replace: 0, same: 0, skipped: 0, conflicts: 0, employees: 1 },
  employeeCount: 1,
  dayCount: 30,
  conflictTotal: 0,
  conflicts: [],
  employees: [{ employeeId: 'e1', code: 'NV001', name: 'Nguyễn Văn An', unitName: 'Sản xuất', days: 30 }],
  requiresConfirmation: false,
  confirmReasons: [],
  lockedPeriods: [],
};
const conflictRow = {
  employeeId: 'e1',
  employeeCode: 'NV001',
  employeeName: 'Nguyễn Văn An',
  date: d5,
  existing: { dayType: 'SHIFT', shiftCode: 'HC', source: 'TEMPLATE' },
  incoming: { dayType: 'OFF', shiftCode: null },
};

const auditRows: unknown[] = [];

type Handler = (path: string, init?: RequestInit) => unknown | Promise<unknown>;
function route(overrides: Record<string, Handler> = {}) {
  fetchMock.mockImplementation((async (path: string, init?: RequestInit) => {
    for (const [prefix, handler] of Object.entries(overrides))
      if (path === prefix || path.startsWith(`${prefix}?`)) return handler(path, init);
    if (path === '/shifts') return { data: shifts };
    if (path === '/shift-units') return { data: [{ id: 'u1', parentId: null, code: 'SX', name: 'Sản xuất' }] };
    if (path === '/work-schedule-templates') return { data: [template] };
    if (path.startsWith('/work-schedules/grid')) return grid;
    if (path.startsWith('/work-schedules/list')) return { data: [], meta: { total: 0, page: 1, pageSize: 50 } };
    if (path.startsWith('/work-schedules/audit')) return { data: auditRows };
    if (path.startsWith('/work-schedules/rules')) return { data: [] };
    if (path === '/work-schedules/preview') return { data: preview };
    throw new Error(`Unexpected request ${path}`);
  }) as never);
}

function grant(...keys: string[]) {
  mockActions.clear();
  for (const key of keys) mockActions.add(key);
}

async function pickOption(placeholder: RegExp, option: RegExp | string) {
  fireEvent.click(await screen.findByPlaceholderText(placeholder));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

const setTab = (tab?: string) => window.history.replaceState(null, '', tab ? `/?tab=${tab}` : '/');

/** Mở màn ở tab Lịch làm việc (lưới/danh sách) - giữ các kiểm tra cũ của lưới. */
function renderCalendar() {
  setTab('calendar');
  return render(<WorkScheduleScreen />);
}

/** Mở menu Công cụ ở đầu trang rồi chọn một mục. */
async function openTool(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Công cụ phân ca' }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

/** Mở phần Tuỳ chọn nâng cao của biểu mẫu Phân ca. */
function openAdvanced() {
  const toggle = screen.getByRole('button', { name: /Tuỳ chọn nâng cao/ });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}

/**
 * Điền biểu mẫu Phân ca trong trang tới lúc bấm "Xác nhận phân ca" (xem trước): chọn nhân viên và mẫu lịch đã lưu.
 * Mặc định giữ "Không có ngày kết thúc" (bật sẵn); fixedRange=true tắt tùy chọn để dùng khoảng ngày.
 */
async function walkToPreview(fixedRange = false) {
  await pickOption(/Tìm theo mã hoặc tên nhân viên/, /NV001/);
  await pickOption(/Chọn ca làm việc/, /Mẫu lịch tuần: Hành chính T2-T6/);
  if (fixedRange) {
    openAdvanced();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Không có ngày kết thúc/ }));
  }
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận phân ca' }));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  employeesMock.mockReset();
  employeesMock.mockResolvedValue([{ value: 'e1', label: 'NV001 · Nguyễn Văn An' }]);
  grant('hrm.schedule.read', 'hrm.schedule.manage');
  setTab();
  route();
});

describe('WorkScheduleScreen', () => {
  it('renders employees, shift codes, OFF and holiday cells on the month grid', async () => {
    renderCalendar();
    expect(await screen.findByText('NV001')).toBeTruthy();
    expect(screen.getByText('Nguyễn Văn An')).toBeTruthy();
    const shiftCell = await screen.findByTitle(/Hành chính 08:00-17:00 \(Mẫu\)/);
    expect(shiftCell.textContent).toContain('HC');
    expect(screen.getByTitle(/Ngày nghỉ \(Thủ công\)/).textContent).toBe('OFF');
    const holidayCell = screen.getByTitle('Quốc khánh - nghỉ lễ');
    expect(holidayCell.getAttribute('data-kind')).toBe('HOLIDAY');
    expect(holidayCell.textContent).toBe('Lễ');
    expect(screen.getByRole('list', { name: 'Chú giải màu' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Lịch tháng' }).getAttribute('aria-selected')).toBe('true');
    const gridCall = fetchMock.mock.calls.map(([p]) => p).find((p) => p.startsWith('/work-schedules/grid'));
    expect(gridCall).toContain(`from=${month}`);
    expect(gridCall).toContain(`to=${endOfMonth(month)}`);
    expect(gridCall).toContain('pageSize=50');
  });

  it('overlays approved and pending leave or trip requests on the grid cells', async () => {
    route({
      '/work-schedules/grid': () => ({
        ...grid,
        requests: [
          { employeeId: 'e1', date: d5, kind: 'LEAVE', requestId: 'l1', status: 'APPROVED' },
          { employeeId: 'e1', date: d6, kind: 'TRIP', requestId: 't1', status: 'PENDING' },
        ],
      }),
    });
    renderCalendar();
    const approved = await screen.findByTitle(/Hành chính 08:00-17:00 \(Mẫu\)\. Nghỉ phép đã duyệt/);
    expect(approved.getAttribute('data-request')).toBe('approved');
    expect(approved.textContent).toContain('P');
    const pending = screen.getByTitle(/Ngày nghỉ \(Thủ công\)\. Công tác đang chờ duyệt/);
    expect(pending.getAttribute('data-request')).toBe('pending');
    expect(pending.textContent).toContain('CT');
  });

  it('shows the not-initialised notice instead of the screen when the schedule tables are missing', async () => {
    route({
      '/work-schedules/grid': () => {
        throw new HrmApiError('x', 409, 'HRM_SCHEDULE_NOT_MIGRATED', { code: 'HRM_SCHEDULE_NOT_MIGRATED' });
      },
    });
    renderCalendar();
    expect(await screen.findByText('Chưa khởi tạo dữ liệu phân ca')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Lịch tuần' })).toBeNull();
  });

  it('cannot save a new assignment before the preview has loaded, then applies after it', async () => {
    let resolvePreview: (value: unknown) => void = () => undefined;
    const applyCalls: unknown[] = [];
    route({
      '/work-schedules/preview': () => new Promise((resolve) => (resolvePreview = resolve)),
      '/work-schedules': (_p, init) => {
        applyCalls.push(JSON.parse(String(init?.body)));
        return { data: { batchId: 'batch-1', summary: preview.summary, employeeCount: 1, appliedDays: 20 } };
      },
    });
    render(<WorkScheduleScreen />);
    await walkToPreview(true);

    // Đang kiểm tra: nút chính bị khóa nên chưa thể lưu khi chưa có kết quả xem trước.
    const checking = await screen.findByRole('button', { name: 'Đang kiểm tra…' });
    expect((checking as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(checking);
    expect(applyCalls).toHaveLength(0);

    resolvePreview({ data: preview });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByLabelText('Tóm tắt xem trước')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân ca' }));
    expect(await screen.findByTestId('assign-result')).toBeTruthy();
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0]).toHaveProperty('toDate');
    expect(applyCalls[0]).toMatchObject({
      kind: 'ASSIGN',
      templateId: 't1',
      scope: { type: 'EMPLOYEE', employeeIds: ['e1'] },
    });
    const previewIndex = fetchMock.mock.calls.findIndex(([p]) => p === '/work-schedules/preview');
    const applyIndex = fetchMock.mock.calls.findIndex(([p]) => p === '/work-schedules');
    expect(previewIndex).toBeGreaterThanOrEqual(0);
    expect(applyIndex).toBeGreaterThan(previewIndex);
  });

  it('shows the conflict table when apply returns HRM_SCHEDULE_CONFLICT and blocks saving', async () => {
    route({
      '/work-schedules': () => {
        throw new HrmApiError('Có 1 ngày đã có lịch khác', 409, 'HRM_SCHEDULE_CONFLICT', {
          code: 'HRM_SCHEDULE_CONFLICT',
          conflicts: [conflictRow],
          summary: { ...preview.summary, conflicts: 1 },
        });
      },
    });
    render(<WorkScheduleScreen />);
    await walkToPreview(true);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân ca' }));

    const table = await screen.findByTestId('conflict-table');
    expect(within(table).getByText('NV001')).toBeTruthy();
    expect(within(table).getByText(/Lịch hiện có/)).toBeTruthy();
    expect(within(table).getByText(/\(Mẫu\)/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement).disabled).toBe(true);
    // Người dùng có thể chọn cách xử lý khác và hệ thống xem trước lại.
    expect(screen.getByRole('radio', { name: 'Bỏ qua ngày đã có lịch' })).toBeTruthy();
  });

  it('requires an explicit confirmation when the preview asks for it', async () => {
    const applyCalls: Record<string, unknown>[] = [];
    route({
      '/work-schedules/preview': () => ({
        data: { ...preview, requiresConfirmation: true, confirmReasons: ['Ghi đè 5 ngày đã có lịch'] },
      }),
      '/work-schedules': (_p, init) => {
        applyCalls.push(JSON.parse(String(init?.body)));
        return { data: { batchId: 'b2', summary: preview.summary, employeeCount: 1, appliedDays: 20 } };
      },
    });
    render(<WorkScheduleScreen />);
    await walkToPreview(true);
    expect(await screen.findByText('Ghi đè 5 ngày đã có lịch')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /đồng ý áp dụng/ }));
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await screen.findByTestId('assign-result');
    expect(applyCalls[0].confirm).toBe(true);
  });

  it('hides bulk and whole-company options without hrm.schedule.bulk', async () => {
    grant('hrm.schedule.read', 'hrm.schedule.manage');
    const { unmount } = render(<WorkScheduleScreen />);
    await screen.findByText('Thông tin phân ca');
    // Chỉ một nhân viên: không có thẻ chọn phạm vi nào khác.
    expect(screen.queryByRole('radio', { name: /Toàn bộ nhân viên/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Nhiều nhân viên/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Công cụ phân ca' }));
    expect(await screen.findByRole('menuitem', { name: 'Mẫu lịch tuần' })).toBeTruthy();
    for (const name of ['Sao chép lịch', 'Thiết lập ngoại lệ', 'Lịch lễ/Tết'])
      expect(screen.queryByRole('menuitem', { name })).toBeNull();
    unmount();

    grant('hrm.schedule.read', 'hrm.schedule.manage', 'hrm.schedule.bulk');
    render(<WorkScheduleScreen />);
    expect(await screen.findByRole('radio', { name: /Toàn bộ nhân viên/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Theo đơn vị/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Nhiều nhân viên/ })).toBeTruthy();
  });

  it('shows only read-only controls to a user with hrm.schedule.read', async () => {
    grant('hrm.schedule.read');
    render(<WorkScheduleScreen />);
    await screen.findByText('NV001');
    // Chỉ có tab Lịch làm việc: không có biểu mẫu Phân ca/Nhả ca và không có thanh tab chế độ.
    expect(screen.queryByRole('tablist', { name: 'Chế độ phân ca' })).toBeNull();
    expect(screen.queryByText('Thông tin phân ca')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xác nhận phân ca' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lịch sử thao tác' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Công cụ phân ca' }));
    expect(await screen.findByRole('menuitem', { name: 'Mẫu lịch tuần' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Lịch định kỳ' })).toBeTruthy();
    for (const name of ['Sao chép lịch', 'Thiết lập ngoại lệ', 'Lịch lễ/Tết'])
      expect(screen.queryByRole('menuitem', { name })).toBeNull();
  });

  it('switches to the list view and calls the list endpoint', async () => {
    renderCalendar();
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('tab', { name: 'Danh sách phân ca' }));
    expect(await screen.findByText('Chưa có phân ca nào trong khoảng ngày đã chọn.')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([p]) => p.startsWith('/work-schedules/list?'))).toBe(true);
  });
});

const rulePreview = {
  rules: [
    {
      scopeType: 'EMPLOYEE',
      scopeLabel: 'NV001 - Nguyễn Văn An',
      changes: [
        { id: 'old-1', from: '2026-01-01', to: null, templateName: 'Hành chính cũ', action: 'TRUNCATE', newTo: '2026-10-31' },
      ],
    },
  ],
  ruleCount: 1,
  changedRules: 1,
  employeeCount: 1,
  replacedDays: 3,
  replacedEmployees: 1,
  conflictTotal: 0,
  skippedTargets: 0,
  requiresConfirmation: false,
  confirmReasons: [],
  lockedPeriods: [],
};
const ruleResult = { batchId: 'batch-rule-1', ruleCount: 1, changedRules: 1, skippedTargets: 0, employeeCount: 1 };

describe('WorkScheduleScreen open-ended recurring schedules', () => {
  it('turns the no-end-date switch on by default, hides Đến ngày and explains it', async () => {
    render(<WorkScheduleScreen />);
    await pickOption(/Tìm theo mã hoặc tên nhân viên/, /NV001/);
    await pickOption(/Chọn ca làm việc/, /Mẫu lịch tuần: Hành chính T2-T6/);
    openAdvanced();
    const toggle = (await screen.findByRole('checkbox', { name: /Không có ngày kết thúc/ })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.queryByLabelText('Đến ngày')).toBeNull();
    expect(screen.getByText(/tự chạy đến khi bạn kết thúc; không cần gán lại theo tháng/)).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Đến ngày')).toBeTruthy();
  });

  it('hides the switch for exceptions, which always need an end date', async () => {
    grant('hrm.schedule.read', 'hrm.schedule.manage', 'hrm.schedule.calendar');
    renderCalendar();
    await openTool('Thiết lập ngoại lệ');
    await pickOption(/Tìm theo mã hoặc tên nhân viên/, /NV001/);
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục' }));
    expect(await screen.findByLabelText('Đến ngày')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /Không có ngày kết thúc/ })).toBeNull();
  });

  it('previews and applies an open-ended schedule without sending toDate', async () => {
    let resolvePreview: (value: unknown) => void = () => undefined;
    const previewBodies: Record<string, unknown>[] = [];
    const applyBodies: Record<string, unknown>[] = [];
    route({
      '/work-schedules/preview': (_p, init) => {
        previewBodies.push(JSON.parse(String(init?.body)));
        return new Promise((resolve) => (resolvePreview = resolve));
      },
      '/work-schedules': (_p, init) => {
        applyBodies.push(JSON.parse(String(init?.body)));
        return { data: ruleResult };
      },
    });
    render(<WorkScheduleScreen />);
    await walkToPreview();

    const save = await screen.findByRole('button', { name: /Đang kiểm tra…|Lưu phân ca/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(previewBodies).toHaveLength(1));
    expect(previewBodies[0]).not.toHaveProperty('toDate');
    expect(previewBodies[0]).toMatchObject({ kind: 'ASSIGN', templateId: 't1', scope: { type: 'EMPLOYEE', employeeIds: ['e1'] } });

    resolvePreview({ data: rulePreview });
    expect(await screen.findByText('Lịch định kỳ sẽ tạo')).toBeTruthy();
    expect(screen.getByText('Nhân viên đang được áp dụng')).toBeTruthy();
    expect(within(screen.getByLabelText('Tóm tắt xem trước lịch định kỳ')).getByText('Ngày phân từng ngày bị thay').parentElement?.textContent).toContain('3');
    const changes = screen.getByTestId('rule-changes');
    expect(within(changes).getByText('Hành chính cũ')).toBeTruthy();
    expect(within(changes).getByText(/Kết thúc sớm/)).toBeTruthy();
    expect(within(changes).getByText(/Không kết thúc/)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân ca' }));
    const done = await screen.findByTestId('assign-result');
    expect(done.textContent).toContain('Đã lưu lịch định kỳ');
    // Mã đợt chỉ để tra cứu nội bộ, không hiện cho người dùng.
    expect(done.textContent).not.toContain('batch-rule-1');
    expect(done.getAttribute('data-batch-id')).toBe('batch-rule-1');
    expect(applyBodies).toHaveLength(1);
    expect(applyBodies[0]).not.toHaveProperty('toDate');
  });

  it('lịch tự cấu hình: chọn ca ở ô chính (T2-T6) và chỉnh thứ bảy, chủ nhật ở Tuỳ chọn nâng cao thì request mang đủ lịch tuần', async () => {
    const previewBodies: Record<string, unknown>[] = [];
    const applyBodies: Record<string, unknown>[] = [];
    route({
      '/work-schedules/preview': (_p, init) => {
        previewBodies.push(JSON.parse(String(init?.body)));
        return { data: rulePreview };
      },
      '/work-schedules': (_p, init) => {
        applyBodies.push(JSON.parse(String(init?.body)));
        return { data: ruleResult };
      },
    });
    render(<WorkScheduleScreen />);
    await pickOption(/Tìm theo mã hoặc tên nhân viên/, /NV001/);
    // Ô chính: một ca cho Thứ hai đến Thứ sáu.
    await pickOption(/Chọn ca làm việc/, /^HC - Hành chính/);
    openAdvanced();
    await pickOption(/Chọn ca làm việc thứ bảy/, /Nửa ngày/);
    fireEvent.click(screen.getByRole('button', { name: 'Chủ nhật nghỉ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận phân ca' }));
    await waitFor(() => expect(previewBodies).toHaveLength(1));
    await screen.findByTestId('pattern-summary');
    expect(screen.getByTestId('pattern-summary').textContent).toContain('T2-T6: HC; T7: HC4; CN: Nghỉ');
    const pattern = (previewBodies[0] as { pattern: { weekday: number; dayType: string; shiftId: string | null }[] }).pattern;
    expect(pattern.map((r) => r.dayType)).toEqual(['SHIFT', 'SHIFT', 'SHIFT', 'SHIFT', 'SHIFT', 'SHIFT', 'OFF']);
    expect(pattern.slice(0, 5).every((r) => r.shiftId === 's-hc')).toBe(true);
    expect(pattern[5].shiftId).toBe('s-half');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân ca' }));
    await screen.findByTestId('assign-result');
    expect((applyBodies[0] as { pattern: unknown[] }).pattern).toEqual(pattern);
  });

  it('blocks saving while a recurring schedule already exists under REPORT and unblocks after choosing a conflict mode', async () => {
    const previewBodies: Record<string, unknown>[] = [];
    const applyBodies: Record<string, unknown>[] = [];
    route({
      '/work-schedules/preview': (_p, init) => {
        previewBodies.push(JSON.parse(String(init?.body)));
        return { data: { ...rulePreview, conflictTotal: 1 } };
      },
      '/work-schedules': (_p, init) => {
        applyBodies.push(JSON.parse(String(init?.body)));
        return { data: ruleResult };
      },
    });
    render(<WorkScheduleScreen />);
    await walkToPreview();
    await screen.findByText('Lịch định kỳ sẽ tạo');
    expect((screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement).disabled).toBe(true);
    // Lịch định kỳ không có ghi đè tất cả.
    expect(screen.queryByRole('radio', { name: /Ghi đè tất cả/ })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Bỏ qua phạm vi đã có lịch định kỳ' }));
    await waitFor(() => expect(previewBodies).toHaveLength(2));
    expect(previewBodies[1]).toMatchObject({ conflictMode: 'SKIP_EXISTING' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân ca' }));
    await screen.findByTestId('assign-result');
    expect(applyBodies[0]).toMatchObject({ conflictMode: 'SKIP_EXISTING' });
  });

  it('shows the rules in conflict when apply returns HRM_SCHEDULE_RULE_CONFLICT', async () => {
    route({
      '/work-schedules/preview': () => ({ data: rulePreview }),
      '/work-schedules': () => {
        throw new HrmApiError('Có 1 phạm vi đã có lịch định kỳ', 409, 'HRM_SCHEDULE_RULE_CONFLICT', {
          code: 'HRM_SCHEDULE_RULE_CONFLICT',
          rules: rulePreview.rules,
          conflictTotal: 1,
        });
      },
    });
    render(<WorkScheduleScreen />);
    await walkToPreview();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân ca' }));
    expect(await screen.findByText('Có phạm vi đã có lịch định kỳ còn hiệu lực')).toBeTruthy();
    expect(screen.getAllByTestId('rule-changes').length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('radio', { name: 'Ghi đè theo thời gian: lịch mới thay lịch định kỳ và lịch từng ngày cũ' })).toBeTruthy();
  });

  it('requires the explicit confirmation for an open-ended schedule when asked', async () => {
    const applyBodies: Record<string, unknown>[] = [];
    route({
      '/work-schedules/preview': () => ({
        data: { ...rulePreview, requiresConfirmation: true, confirmReasons: ['Kết thúc sớm 1 lịch định kỳ đang có'] },
      }),
      '/work-schedules': (_p, init) => {
        applyBodies.push(JSON.parse(String(init?.body)));
        return { data: ruleResult };
      },
    });
    render(<WorkScheduleScreen />);
    await walkToPreview();
    expect(await screen.findByText('Kết thúc sớm 1 lịch định kỳ đang có')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /đồng ý áp dụng/ }));
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await screen.findByTestId('assign-result');
    expect(applyBodies[0].confirm).toBe(true);
  });

  it('renders RULE days with their own style, tooltip and legend entry', async () => {
    const ruleDay = {
      employeeId: 'e1',
      date: addDays(month, 7),
      dayType: 'SHIFT',
      shiftId: 's-hc',
      shiftCode: 'HC',
      shiftName: 'Hành chính',
      startTime: '08:00',
      endTime: '17:00',
      source: 'RULE',
      holidayId: null,
      note: null,
    };
    route({ '/work-schedules/grid': () => ({ ...grid, days: [...grid.days, ruleDay] }) });
    renderCalendar();
    const cell = await screen.findByTitle(/Hành chính 08:00-17:00 \(Lịch định kỳ\)/);
    expect(cell.getAttribute('data-source')).toBe('RULE');
    expect(cell.className).toContain('sky');
    expect(cell.textContent).toContain('HC');
    expect(within(screen.getByRole('list', { name: 'Chú giải màu' })).getByText('Ca định kỳ (không kết thúc)')).toBeTruthy();
  });

  it('hints on the list tab that recurring schedules are elsewhere', async () => {
    renderCalendar();
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('tab', { name: 'Danh sách phân ca' }));
    expect(await screen.findByText(/Lịch định kỳ \(không có ngày kết thúc\) xem trong/)).toBeTruthy();
  });

  it('keeps month navigation open to the future', async () => {
    renderCalendar();
    await screen.findByText('NV001');
    const next = screen.getByRole('button', { name: 'Tháng sau' });
    for (let i = 0; i < 30; i++) fireEvent.click(next);
    expect((next as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => {
      const last = fetchMock.mock.calls.map(([p]) => p).filter((p) => p.startsWith('/work-schedules/grid')).pop() ?? '';
      expect(last).toContain(`from=${addMonthsIso(month, 30)}`);
    });
  });
});

function addMonthsIso(iso: string, n: number) {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

const employeeRule = {
  id: 'r1',
  scopeType: 'EMPLOYEE',
  scopeLabel: 'NV001 - Nguyễn Văn An',
  employeeId: 'e1',
  unitId: null,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  templateName: 'Hành chính T2-T6',
  status: 'ACTIVE',
  days: [
    { weekday: 1, dayType: 'SHIFT', shiftId: 's-hc', shiftCode: 'HC' },
    { weekday: 7, dayType: 'OFF', shiftId: null, shiftCode: null },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
};
const unitRule = { ...employeeRule, id: 'r2', scopeType: 'UNIT', scopeLabel: 'Sản xuất', employeeId: null, unitId: 'u1' };

describe('Rules manager (Lịch định kỳ)', () => {
  async function openManager() {
    await openTool('Lịch định kỳ');
    return screen.findByRole('dialog', { name: 'Lịch định kỳ' });
  }

  it('lists recurring schedules with the weekday summary and the open end', async () => {
    const calls: string[] = [];
    route({
      '/work-schedules/rules': (path) => {
        calls.push(path);
        return { data: [employeeRule, unitRule] };
      },
    });
    grant('hrm.schedule.read');
    render(<WorkScheduleScreen />);
    const dialog = await openManager();
    expect(await within(dialog).findByText('NV001 - Nguyễn Văn An')).toBeTruthy();
    expect(within(dialog).getAllByText('Không kết thúc')).toHaveLength(2);
    expect(within(dialog).getAllByText('T2: HC; CN: OFF')).toHaveLength(2);
    expect(calls[0]).toContain('status=ACTIVE');
    // Chỉ có quyền xem: không có thao tác.
    expect(within(dialog).queryByRole('button', { name: 'Kết thúc' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Hủy lịch' })).toBeNull();
  });

  it('shows actions by scope: manage for employee rules, bulk for unit and company rules', async () => {
    route({ '/work-schedules/rules': () => ({ data: [employeeRule, unitRule] }) });
    grant('hrm.schedule.read', 'hrm.schedule.manage');
    const first = render(<WorkScheduleScreen />);
    let dialog = await openManager();
    await within(dialog).findByText('Sản xuất');
    expect(within(dialog).getAllByRole('button', { name: 'Kết thúc' })).toHaveLength(1);
    expect(within(dialog).getAllByRole('button', { name: 'Hủy lịch' })).toHaveLength(1);
    first.unmount();

    grant('hrm.schedule.read', 'hrm.schedule.manage', 'hrm.schedule.bulk');
    render(<WorkScheduleScreen />);
    dialog = await openManager();
    await within(dialog).findByText('Sản xuất');
    expect(within(dialog).getAllByRole('button', { name: 'Kết thúc' })).toHaveLength(2);
  });

  it('ends a recurring schedule through POST rules/:id/end', async () => {
    const bodies: Record<string, unknown>[] = [];
    route({
      '/work-schedules/rules': () => ({ data: [employeeRule] }),
      '/work-schedules/rules/r1/end': (_p, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { data: { id: 'r1', effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' } };
      },
    });
    grant('hrm.schedule.read', 'hrm.schedule.manage');
    render(<WorkScheduleScreen />);
    const dialog = await openManager();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Kết thúc' }));
    expect(await within(dialog).findByLabelText('Ngày kết thúc')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kết thúc lịch' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Quay lại danh sách sau khi kết thúc.
    expect(await within(dialog).findByText('NV001 - Nguyễn Văn An')).toBeTruthy();
  });

  it('cancels a recurring schedule through POST rules/:id/cancel after the popconfirm', async () => {
    const cancelled: string[] = [];
    route({
      '/work-schedules/rules': () => ({ data: [employeeRule] }),
      '/work-schedules/rules/r1/cancel': (path) => {
        cancelled.push(path);
        return { data: { id: 'r1' } };
      },
    });
    grant('hrm.schedule.read', 'hrm.schedule.manage');
    render(<WorkScheduleScreen />);
    const dialog = await openManager();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Hủy lịch' }));
    const confirmButtons = await within(dialog).findAllByRole('button', { name: 'Hủy lịch' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(cancelled).toEqual(['/work-schedules/rules/r1/cancel']));
  });
});

describe('HRM_SCHEDULE_RULES_NOT_MIGRATED stays a local error', () => {
  const rulesMissing = () => {
    throw new HrmApiError(
      'Chưa khởi tạo dữ liệu lịch định kỳ (thiếu migration 0036).',
      409,
      'HRM_SCHEDULE_RULES_NOT_MIGRATED',
      { code: 'HRM_SCHEDULE_RULES_NOT_MIGRATED' },
    );
  };

  it('keeps the calendar working and shows the message inside the rules manager only', async () => {
    route({ '/work-schedules/rules': rulesMissing });
    grant('hrm.schedule.read', 'hrm.schedule.manage');
    renderCalendar();
    expect(await screen.findByText('NV001')).toBeTruthy();
    await openTool('Lịch định kỳ');
    const dialog = await screen.findByRole('dialog', { name: 'Lịch định kỳ' });
    expect(await within(dialog).findByText(/thiếu migration 0036/)).toBeTruthy();
    // Màn hình không bị thay bằng thông báo toàn trang; lưới và các tab vẫn còn.
    expect(screen.queryByText('Chưa khởi tạo dữ liệu phân ca')).toBeNull();
    // Nền phía sau dialog bị ẩn khỏi cây truy cập nên truy vấn kèm hidden.
    expect(screen.getByRole('tab', { name: 'Lịch tháng', hidden: true })).toBeTruthy();
    expect(screen.getByTitle(/Hành chính 08:00-17:00 \(Mẫu\)/)).toBeTruthy();
  });

  it('shows the message in the assign dialog, suggests a date range and lets the user switch', async () => {
    route({ '/work-schedules/preview': rulesMissing });
    render(<WorkScheduleScreen />);
    await walkToPreview();
    const notice = await screen.findByTestId('rules-not-migrated');
    expect(notice.textContent).toContain('thiếu migration 0036');
    expect(notice.textContent).toContain('Bỏ chọn Không có ngày kết thúc');
    expect(screen.queryByText('Chưa khởi tạo dữ liệu phân ca')).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Chế độ phân ca' })).toBeTruthy();

    fireEvent.click(within(notice).getByRole('button', { name: 'Phân ca theo khoảng ngày' }));
    const toggle = (await screen.findByRole('checkbox', { name: /Không có ngày kết thúc/ })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByLabelText('Đến ngày')).toBeTruthy();
  });

  it('does not replace the screen when the grid itself reports the rules table is missing', async () => {
    route({ '/work-schedules/grid': rulesMissing });
    renderCalendar();
    expect(await screen.findByText(/thiếu migration 0036/)).toBeTruthy();
    expect(screen.queryByText('Chưa khởi tạo dữ liệu phân ca')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Lịch tháng' })).toBeTruthy();
  });

  it('still replaces the whole screen for the base tables (HRM_SCHEDULE_NOT_MIGRATED)', async () => {
    route({
      '/work-schedules/grid': () => {
        throw new HrmApiError('x', 409, 'HRM_SCHEDULE_NOT_MIGRATED', { code: 'HRM_SCHEDULE_NOT_MIGRATED' });
      },
    });
    renderCalendar();
    expect(await screen.findByText('Chưa khởi tạo dữ liệu phân ca')).toBeTruthy();
  });
});

describe('WorkScheduleScreen: tab Phân ca | Nhả ca | Lịch làm việc, lịch sử gần đây', () => {
  const urlTab = () => new URLSearchParams(window.location.search).get('tab');

  it('mặc định mở tab Phân ca (biểu mẫu trong trang); bấm tab ghi ?tab= lên URL; mở thẳng bằng URL và nghe popstate', async () => {
    render(<WorkScheduleScreen />);
    expect(await screen.findByText('Thông tin phân ca')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Phân ca' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Phân ca$/ }).getAttribute('aria-selected')).toBe('true');
    // Chưa tải lưới khi chưa ở tab Lịch làm việc.
    expect(fetchMock.mock.calls.some(([p]) => String(p).startsWith('/work-schedules/grid'))).toBe(false);

    fireEvent.click(screen.getByRole('tab', { name: 'Nhả ca' }));
    expect(urlTab()).toBe('release');
    expect(await screen.findByText('Thông tin nhả ca')).toBeTruthy();
    expect(screen.queryByText('Thông tin phân ca')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Lịch làm việc' }));
    expect(urlTab()).toBe('calendar');
    expect(await screen.findByText('NV001')).toBeTruthy();

    act(() => {
      window.history.replaceState(null, '', '/?tab=assign');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByText('Thông tin phân ca')).toBeTruthy();
  });

  it('tab không hợp lệ rơi về Phân ca và được sửa lại; không có quyền quản lý thì chỉ có Lịch làm việc', async () => {
    setTab('khong-co');
    const first = render(<WorkScheduleScreen />);
    await screen.findByText('Thông tin phân ca');
    await waitFor(() => expect(urlTab()).toBe('assign'));
    first.unmount();

    grant('hrm.schedule.read');
    setTab('assign');
    render(<WorkScheduleScreen />);
    expect(await screen.findByText('NV001')).toBeTruthy();
    await waitFor(() => expect(urlTab()).toBe('calendar'));
    expect(screen.queryByText('Thông tin phân ca')).toBeNull();
  });

  it('Nhả ca: xem phạm vi ảnh hưởng (dry-run) rồi mới xác nhận nhả bằng Popconfirm, gửi đúng /work-schedules/cancel', async () => {
    const bodies: Record<string, unknown>[] = [];
    route({
      '/work-schedules/cancel': (_p, init) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        return { data: { employeeCount: 1, dayCount: 7, keptProtected: 1, batchId: body.dryRun ? null : 'batch-x' } };
      },
    });
    setTab('release');
    render(<WorkScheduleScreen />);
    await screen.findByText('Thông tin nhả ca');
    // Chưa xem phạm vi thì chưa nhả được.
    expect((screen.getByRole('button', { name: 'Xác nhận nhả ca' }) as HTMLButtonElement).disabled).toBe(true);
    // Chưa chọn nhân viên: báo lỗi, chưa gọi API.
    fireEvent.click(screen.getByRole('button', { name: 'Xem phạm vi ảnh hưởng' }));
    expect(bodies).toHaveLength(0);
    await pickOption(/Tìm theo mã hoặc tên nhân viên/, /NV001/);
    fireEvent.click(screen.getByRole('button', { name: 'Xem phạm vi ảnh hưởng' }));
    expect(await screen.findByText('Phạm vi ảnh hưởng')).toBeTruthy();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ dryRun: true, scope: { type: 'EMPLOYEE', employeeIds: ['e1'] } });

    await waitFor(() => expect((screen.getByRole('button', { name: 'Xác nhận nhả ca' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận nhả ca' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nhả ca' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({ confirm: true, dryRun: false });
    expect(await screen.findByText('Đã nhả 7 ngày lịch của 1 nhân viên.')).toBeTruthy();
  });

  it('Lịch sử phân ca gần đây: các đợt phân ca/nhả ca với người thực hiện và nhãn thao tác; Xem tất cả mở ngăn kéo lịch sử', async () => {
    auditRows.splice(
      0,
      auditRows.length,
      {
        id: 'au1', batchId: 'b2', action: 'SCHEDULE_ASSIGN', actorId: 'a1', actorName: 'Hà Nguyên Hoàng',
        employeeId: 'e1', employeeCode: 'NV001', employeeName: 'Nguyễn Văn An', fromDate: d5, toDate: d7,
        before: null, after: [{ from: d5, to: d7, shiftId: 's-hc', shiftCode: 'HC', dayType: 'SHIFT' }], reason: null,
        createdAt: '2026-10-10T08:00:00.000Z',
      },
      {
        id: 'au2', batchId: 'b1', action: 'SCHEDULE_CANCEL', actorId: 'a1', actorName: 'Lê Thị Quản Lý',
        employeeId: 'e1', employeeCode: 'NV001', employeeName: 'Nguyễn Văn An', fromDate: d5, toDate: d6,
        before: null, after: null, reason: null, createdAt: '2026-10-08T08:00:00.000Z',
      },
    );
    try {
      render(<WorkScheduleScreen />);
      const card = (await screen.findByText('Lịch sử phân ca gần đây')).closest('section') as HTMLElement;
      expect(await within(card).findByText('Hà Nguyên Hoàng')).toBeTruthy();
      expect(within(card).getByText('Lê Thị Quản Lý')).toBeTruthy();
      expect(within(card).getAllByRole('row').length).toBeGreaterThanOrEqual(3);
      fireEvent.click(within(card).getByRole('button', { name: /Xem tất cả/ }));
      expect(await screen.findByRole('dialog', { name: 'Lịch sử thay đổi phân ca' })).toBeTruthy();
    } finally {
      auditRows.splice(0, auditRows.length);
    }
  });

  it('nút Lịch sử thao tác ở đầu trang mở ngăn kéo lịch sử và có menu Công cụ', async () => {
    render(<WorkScheduleScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lịch sử thao tác' }));
    expect(await screen.findByRole('dialog', { name: 'Lịch sử thay đổi phân ca' })).toBeTruthy();
  });
});
