/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    if (path.startsWith('/work-schedules/audit')) return { data: [] };
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

/**
 * Đi từ nút "Phân ca mới" tới bước xem trước bằng mẫu lịch đã lưu.
 * Mặc định giữ tùy chọn "Không có ngày kết thúc" (bật sẵn); fixedRange=true tắt tùy chọn để dùng khoảng ngày.
 */
async function walkToPreview(fixedRange = false) {
  fireEvent.click(await screen.findByRole('button', { name: 'Phân ca mới' }));
  await pickOption(/Tìm theo mã hoặc tên nhân viên/, /NV001/);
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Dùng mẫu lịch đã lưu' }));
  await pickOption(/Tìm mẫu lịch/, /Hành chính T2-T6/);
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  const openEndedSwitch = await screen.findByRole('checkbox', { name: /Không có ngày kết thúc/ });
  if (fixedRange) fireEvent.click(openEndedSwitch);
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
}

beforeEach(() => {
  fetchMock.mockReset();
  employeesMock.mockReset();
  employeesMock.mockResolvedValue([{ value: 'e1', label: 'NV001 · Nguyễn Văn An' }]);
  grant('hrm.schedule.read', 'hrm.schedule.manage');
  route();
});

describe('WorkScheduleScreen', () => {
  it('renders employees, shift codes, OFF and holiday cells on the month grid', async () => {
    render(<WorkScheduleScreen />);
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

  it('shows the not-initialised notice instead of the screen when the schedule tables are missing', async () => {
    route({
      '/work-schedules/grid': () => {
        throw new HrmApiError('x', 409, 'HRM_SCHEDULE_NOT_MIGRATED', { code: 'HRM_SCHEDULE_NOT_MIGRATED' });
      },
    });
    render(<WorkScheduleScreen />);
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

    const save = await screen.findByRole('button', { name: 'Lưu phân ca' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save);
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
    await screen.findByText('NV001');
    expect(screen.queryByRole('button', { name: 'Phân ca hàng loạt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sao chép lịch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thiết lập ngoại lệ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lịch lễ/Tết' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Phân ca mới' }));
    await screen.findByText('Một nhân viên');
    expect(screen.queryByRole('radio', { name: 'Toàn công ty' })).toBeNull();
    expect(screen.queryByText('Nhiều nhân viên')).toBeNull();
    unmount();

    grant('hrm.schedule.read', 'hrm.schedule.manage', 'hrm.schedule.bulk');
    render(<WorkScheduleScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Phân ca hàng loạt' }));
    expect(await screen.findByRole('radio', { name: 'Toàn công ty' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Theo đơn vị' })).toBeTruthy();
  });

  it('shows only read-only controls to a user with hrm.schedule.read', async () => {
    grant('hrm.schedule.read');
    render(<WorkScheduleScreen />);
    await screen.findByText('NV001');
    for (const name of ['Phân ca mới', 'Phân ca hàng loạt', 'Hủy lịch', 'Sao chép lịch', 'Thiết lập ngoại lệ', 'Lịch lễ/Tết'])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lịch sử thay đổi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mẫu lịch tuần' })).toBeTruthy();
  });

  it('switches to the list view and calls the list endpoint', async () => {
    render(<WorkScheduleScreen />);
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
    await walkToStep3();
    const toggle = screen.getByRole('checkbox', { name: /Không có ngày kết thúc/ }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.queryByLabelText('Đến ngày')).toBeNull();
    expect(screen.getByText(/tự chạy đến khi bạn kết thúc; không cần gán lại theo tháng/)).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Đến ngày')).toBeTruthy();
  });

  it('hides the switch for exceptions, which always need an end date', async () => {
    grant('hrm.schedule.read', 'hrm.schedule.manage', 'hrm.schedule.calendar');
    render(<WorkScheduleScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Thiết lập ngoại lệ' }));
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

    const save = await screen.findByRole('button', { name: 'Lưu phân ca' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(previewBodies).toHaveLength(1);
    expect(previewBodies[0]).not.toHaveProperty('toDate');
    expect(previewBodies[0]).toMatchObject({ kind: 'ASSIGN', templateId: 't1', scope: { type: 'EMPLOYEE', employeeIds: ['e1'] } });

    resolvePreview({ data: rulePreview });
    expect(await screen.findByText('Lịch định kỳ sẽ tạo')).toBeTruthy();
    expect(screen.getByText('Nhân viên đang được áp dụng')).toBeTruthy();
    const changes = screen.getByTestId('rule-changes');
    expect(within(changes).getByText('Hành chính cũ')).toBeTruthy();
    expect(within(changes).getByText(/Kết thúc sớm/)).toBeTruthy();
    expect(within(changes).getByText(/Không kết thúc/)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'Lưu phân ca' }));
    const done = await screen.findByTestId('assign-result');
    expect(done.textContent).toContain('Đã lưu lịch định kỳ');
    expect(done.textContent).toContain('batch-rule-1');
    expect(applyBodies).toHaveLength(1);
    expect(applyBodies[0]).not.toHaveProperty('toDate');
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
    expect(screen.getByRole('radio', { name: 'Ghi đè lịch định kỳ đang có (kết thúc hoặc hủy)' })).toBeTruthy();
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
    render(<WorkScheduleScreen />);
    const cell = await screen.findByTitle(/Hành chính 08:00-17:00 \(Lịch định kỳ\)/);
    expect(cell.getAttribute('data-source')).toBe('RULE');
    expect(cell.className).toContain('sky');
    expect(cell.textContent).toContain('HC');
    expect(within(screen.getByRole('list', { name: 'Chú giải màu' })).getByText('Ca định kỳ (không kết thúc)')).toBeTruthy();
  });

  it('hints on the list tab that recurring schedules are elsewhere', async () => {
    render(<WorkScheduleScreen />);
    await screen.findByText('NV001');
    fireEvent.click(screen.getByRole('tab', { name: 'Danh sách phân ca' }));
    expect(await screen.findByText(/Lịch định kỳ \(không có ngày kết thúc\) xem trong/)).toBeTruthy();
  });

  it('keeps month navigation open to the future', async () => {
    render(<WorkScheduleScreen />);
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

async function walkToStep3() {
  fireEvent.click(await screen.findByRole('button', { name: 'Phân ca mới' }));
  await pickOption(/Tìm theo mã hoặc tên nhân viên/, /NV001/);
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Dùng mẫu lịch đã lưu' }));
  await pickOption(/Tìm mẫu lịch/, /Hành chính T2-T6/);
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
  await screen.findByRole('checkbox', { name: /Không có ngày kết thúc/ });
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
    fireEvent.click(await screen.findByRole('button', { name: 'Lịch định kỳ' }));
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
    render(<WorkScheduleScreen />);
    expect(await screen.findByText('NV001')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lịch định kỳ' }));
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
    expect(screen.getByRole('tab', { name: 'Lịch tuần', hidden: true })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Lưu phân ca' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(notice).getByRole('button', { name: 'Phân ca theo khoảng ngày' }));
    const toggle = (await screen.findByRole('checkbox', { name: /Không có ngày kết thúc/ })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByLabelText('Đến ngày')).toBeTruthy();
  });

  it('does not replace the screen when the grid itself reports the rules table is missing', async () => {
    route({ '/work-schedules/grid': rulesMissing });
    render(<WorkScheduleScreen />);
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
    render(<WorkScheduleScreen />);
    expect(await screen.findByText('Chưa khởi tạo dữ liệu phân ca')).toBeTruthy();
  });
});
