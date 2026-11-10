/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  HrmCompOffBalanceRow,
  HrmCompOffConversionPreview,
  HrmCompOffConversionRow,
  HrmOvertimeBlock,
  HrmOvertimeCompSettings,
} from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../hrm-comp-off-api';
import { OvertimeClassifyHint } from '../ui/comp-off/comp-off-hints';
import { CompOffBalancesPanel } from '../ui/comp-off/comp-off-balances-panel';
import { CompOffConversionPanel } from '../ui/comp-off/comp-off-conversion-panel';
import { OvertimeClassifyPanel } from '../ui/comp-off/overtime-classify-panel';
import OvertimeCompSettingsScreen from './overtime-comp-settings-screen';

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
  return { ...actual, hrmFetch: jest.fn(), hrmEmployeeOptions: jest.fn().mockResolvedValue([{ value: 'e1', label: 'NV1 - Nhân viên 1' }]) };
});
jest.mock('../hrm-comp-off-api', () => ({
  compOffApi: {
    settings: jest.fn(),
    saveSettings: jest.fn(),
    classifyPreview: jest.fn(),
    blocks: jest.fn(),
    overrideBlock: jest.fn(),
    monthSummary: jest.fn(),
    balances: jest.fn(),
    detail: jest.fn(),
    conversionPreview: jest.fn(),
    convert: jest.fn(),
    adjust: jest.fn(),
    expire: jest.fn(),
    availability: jest.fn(),
  },
}));

const api = compOffApi as jest.Mocked<typeof compOffApi>;

const conversionRow = (over: Partial<HrmCompOffConversionRow> = {}): HrmCompOffConversionRow => ({
  employeeId: 'e1',
  employeeCode: 'NV1',
  employeeName: 'Nhân viên 1',
  month: '2026-10',
  actualOtHours: 63,
  countedOtHours: 40,
  nightHours: 60,
  excessOtHours: 23,
  compDays: 4.3,
  payrollHours: 100,
  nightRestDays: 4,
  blockCount: 9,
  status: 'READY',
  convertedDays: null,
  accrualOn: '2026-11-01',
  expiresOn: null,
  note: null,
  ...over,
});
const preview = (over: Partial<HrmCompOffConversionPreview> = {}): HrmCompOffConversionPreview => ({
  month: '2026-10',
  locked: true,
  enabled: true,
  rows: [conversionRow()],
  ...over,
});

beforeEach(() => {
  mockActions.clear();
  jest.clearAllMocks();
});

describe('Quỹ nghỉ bù: số dư', () => {
  const balance: HrmCompOffBalanceRow = {
    employeeId: 'e1',
    employeeCode: 'NV1',
    employeeName: 'Nhân viên 1',
    accrued: 4.3,
    used: 1,
    reserved: 0.5,
    expired: 0,
    adjusted: 0,
    available: 2.8,
    nextExpiry: { days: 2.8, on: '2027-01-31' },
  };

  it('hiện số dư, hạn gần nhất; nút điều chỉnh và hết hạn chỉ có khi có quyền điều chỉnh', async () => {
    mockActions.add('hrm.comp_off.view');
    api.balances.mockResolvedValue([balance]);
    const { unmount } = render(<CompOffBalancesPanel />);
    expect(await screen.findByText('Nhân viên 1')).toBeTruthy();
    expect(screen.getByText('2,8 ngày, hạn 31/01/2027')).toBeTruthy();
    expect(screen.queryByText('Điều chỉnh quỹ')).toBeNull();
    unmount();

    mockActions.add('hrm.comp_off.adjust');
    api.balances.mockResolvedValue([balance]);
    render(<CompOffBalancesPanel />);
    expect(await screen.findByText('Điều chỉnh quỹ')).toBeTruthy();
    expect(screen.getByText('Chạy hết hạn lô')).toBeTruthy();
  });

  it('báo lỗi của máy chủ', async () => {
    mockActions.add('hrm.comp_off.view');
    api.balances.mockRejectedValue(new Error('Không có quyền'));
    render(<CompOffBalancesPanel />);
    expect(await screen.findByText('Không có quyền')).toBeTruthy();
  });
});

describe('Quỹ nghỉ bù: chuyển đổi tháng', () => {
  it('tháng chưa chốt công: chỉ xem, không có nút chuyển đổi', async () => {
    mockActions.add('hrm.comp_off.convert');
    api.conversionPreview.mockResolvedValue(preview({ locked: false }));
    render(<CompOffConversionPanel />);
    expect(await screen.findByText(/chưa chốt công/)).toBeTruthy();
    expect(screen.queryByText(/Chuyển đổi \d+ nhân viên/)).toBeNull();
    expect((screen.getByLabelText('Chọn Nhân viên 1') as HTMLInputElement).disabled).toBe(true);
  });

  it('không có quyền chuyển đổi: không có nút dù tháng đã chốt', async () => {
    mockActions.add('hrm.comp_off.view');
    api.conversionPreview.mockResolvedValue(preview());
    render(<CompOffConversionPanel />);
    await screen.findByText('Chờ chuyển đổi');
    expect(screen.queryByText(/Chuyển đổi \d+ nhân viên/)).toBeNull();
  });

  it('chọn dòng, chỉnh số ngày bắt buộc có lý do rồi mới gửi; gửi đúng nội dung', async () => {
    mockActions.add('hrm.comp_off.convert');
    api.conversionPreview.mockResolvedValue(preview());
    api.convert.mockResolvedValue({ month: '2026-10', created: 1, skipped: [] });
    render(<CompOffConversionPanel />);
    fireEvent.click(await screen.findByLabelText('Chọn Nhân viên 1'));
    const button = screen.getByText('Chuyển đổi 1 nhân viên').closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('Số ngày nghỉ bù của Nhân viên 1'), { target: { value: '4' } });
    expect(screen.getByText('Cần nhập lý do khi khác số đề xuất')).toBeTruthy();
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Lý do chỉnh số ngày của Nhân viên 1'), { target: { value: 'HR xác nhận' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() =>
      expect(api.convert).toHaveBeenCalledWith({ month: expect.stringMatching(/^\d{4}-\d{2}$/), rows: [{ employeeId: 'e1', days: 4, reason: 'HR xác nhận' }] }),
    );
  });

  it('dòng đã chuyển đổi không chọn được và hiện số ngày đã ghi', async () => {
    mockActions.add('hrm.comp_off.convert');
    api.conversionPreview.mockResolvedValue(preview({ rows: [conversionRow({ status: 'CONVERTED', convertedDays: 4.3 })] }));
    render(<CompOffConversionPanel />);
    expect(await screen.findByText('Đã chuyển đổi')).toBeTruthy();
    expect((screen.getByLabelText('Chọn Nhân viên 1') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('Phân loại làm thêm', () => {
  const block: HrmOvertimeBlock = {
    id: 'b1',
    otRequestId: 'o1',
    employeeId: 'e1',
    employeeCode: 'NV1',
    employeeName: 'Nhân viên 1',
    periodMonth: '2026-10',
    start: '2026-10-05T18:00',
    end: '2026-10-06T04:00',
    hours: 10,
    crossesMidnight: true,
    ruleSet: 'NIGHT_REST',
    restFractionSuggested: 1,
    otHoursSuggested: 2,
    nightHoursSuggested: 8,
    otHoursFinal: 2,
    nightHoursFinal: 8,
    source: 'RULE',
    overrideReason: null,
    overriddenAt: null,
    locked: false,
  };

  it('sửa ca cần lý do; ca của tháng đã chốt chỉ đọc', async () => {
    mockActions.add('hrm.comp_off.view');
    mockActions.add('hrm.overtime.classify');
    api.monthSummary.mockResolvedValue({ month: '2026-10', enabled: true, rows: [] });
    api.blocks.mockResolvedValue([block, { ...block, id: 'b2', locked: true }]);
    api.overrideBlock.mockResolvedValue({ ...block, source: 'MANUAL' });
    render(<OvertimeClassifyPanel />);
    const edit = await screen.findAllByText('Sửa');
    expect(edit).toHaveLength(1);
    expect(screen.getByText('Đã chốt công')).toBeTruthy();
    fireEvent.click(edit[0] as HTMLElement);
    const save = (await screen.findByText('Lưu')).closest('button') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Giờ làm thêm chính thức/), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Lý do sửa'), { target: { value: 'Nhập sai ngày nghỉ' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.overrideBlock).toHaveBeenCalledWith('b1', { otHours: 6, reason: 'Nhập sai ngày nghỉ' }));
  });
});

describe('Cấu hình làm thêm và nghỉ bù', () => {
  const config = {
    enabled: true,
    ruleSet: 'NIGHT_REST' as const,
    normalHoursPerDay: 8,
    monthlyCapHours: 40,
    yearlyCapHours: 200,
    nightCapped: false,
    nightStartMinute: 1320,
    nightEndMinute: 360,
    nightRestHoursPerDay: 8,
    allowHalfDay: true,
    compFactor: 1.5,
    dayBasisHours: null,
    decimals: 1,
    rounding: 'HALF_UP' as const,
    usageStepDays: 0.5,
    accrualMonthOffset: 1 as const,
    expiryMonths: 0,
    accumulationCapDays: null,
  };
  const version = { id: 'v2', versionNo: 2, effectiveFrom: '2026-09-01', effectiveTo: null, status: 'ACTIVE', config };
  const settings: HrmOvertimeCompSettings = { policyId: 'p1', current: version, versions: [version], legalWarnings: ['Chưa đặt trần làm thêm theo năm'] };

  it('chỉ xem: không có nút lưu, vẫn thấy cảnh báo luật và lịch sử phiên bản', async () => {
    mockActions.add('hrm.policy.view');
    api.settings.mockResolvedValue(settings);
    render(<OvertimeCompSettingsScreen />);
    expect(await screen.findByText('Chưa đặt trần làm thêm theo năm')).toBeTruthy();
    expect(screen.getByText('Bạn chỉ có quyền xem cấu hình này.')).toBeTruthy();
    expect(screen.queryByText('Lưu phiên bản mới')).toBeNull();
    expect(screen.getByText('Phiên bản 2')).toBeTruthy();
  });

  it('chế độ NIGHT_REST ẩn khung giờ đêm; lưu cần lý do và gửi ngày hiệu lực mùng 1 chưa có phiên bản', async () => {
    mockActions.add('hrm.policy.manage');
    api.settings.mockResolvedValue(settings);
    api.saveSettings.mockResolvedValue(settings);
    render(<OvertimeCompSettingsScreen />);
    await screen.findByText('Số giờ ca đêm bù cho mỗi ngày nghỉ sau ca đêm');
    expect(screen.queryByText('Khung giờ đêm: từ')).toBeNull();
    const save = screen.getByText('Lưu phiên bản mới').closest('button') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Bắt buộc'), { target: { value: 'Đổi trần tháng' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalled());
    const body = api.saveSettings.mock.calls[0]?.[0];
    expect(body?.effectiveFrom).toMatch(/^\d{4}-\d{2}-01$/);
    expect(body?.reason).toBe('Đổi trần tháng');
    expect(body?.config).toMatchObject({ enabled: true, ruleSet: 'NIGHT_REST', monthlyCapHours: 40, nightRestHoursPerDay: 8 });
    expect(body?.config).not.toHaveProperty('nightStartMinute');
  });

  it('hiện lỗi của máy chủ khi lưu', async () => {
    mockActions.add('hrm.policy.manage');
    api.settings.mockResolvedValue(settings);
    api.saveSettings.mockRejectedValue(new Error('Khoảng hiệu lực giao với phiên bản đã có'));
    render(<OvertimeCompSettingsScreen />);
    await screen.findByText('Phiên bản mới');
    fireEvent.change(screen.getByPlaceholderText('Bắt buộc'), { target: { value: 'Thử' } });
    fireEvent.click(screen.getByText('Lưu phiên bản mới'));
    expect(await screen.findByText('Khoảng hiệu lực giao với phiên bản đã có')).toBeTruthy();
  });
});

describe('Gợi ý phân loại trên form đơn làm thêm', () => {
  const basePreview = { enabled: true, ruleSet: 'NIGHT_REST' as const, parts: [], otHours: 2, nightHours: 8, askNextDayRest: true };

  it('ca xuyên đêm: hiện lựa chọn hôm sau nghỉ và số giờ gợi ý', async () => {
    api.classifyPreview.mockResolvedValue(basePreview);
    render(<OvertimeClassifyHint employeeId="e1" fromAt="2026-10-05T18:00" toAt="2026-10-06T04:00" value="FULL" onChange={jest.fn()} />);
    expect(await screen.findByText('Hôm sau nghỉ')).toBeTruthy();
    expect(screen.getByText('2 giờ')).toBeTruthy();
    expect(screen.getByText('8 giờ')).toBeTruthy();
    expect(api.classifyPreview).toHaveBeenCalledWith({ employeeId: 'e1', fromAt: '2026-10-05T18:00', toAt: '2026-10-06T04:00', nextDayRest: 'FULL' });
  });

  it('ca không xuyên đêm: không hỏi và đưa lựa chọn nghỉ về Không nghỉ', async () => {
    api.classifyPreview.mockResolvedValue({ ...basePreview, askNextDayRest: false, otHours: 5, nightHours: 0 });
    const onChange = jest.fn();
    render(<OvertimeClassifyHint employeeId="e1" fromAt="2026-10-07T18:00" toAt="2026-10-07T23:00" value="HALF" onChange={onChange} />);
    await screen.findByTestId('overtime-classify-hint');
    expect(screen.queryByText('Hôm sau nghỉ')).toBeNull();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('NONE'));
  });

  it('quy tắc chưa bật hoặc không xem trước được: không hiện gì', async () => {
    api.classifyPreview.mockResolvedValue({ ...basePreview, enabled: false });
    const { container, rerender } = render(<OvertimeClassifyHint employeeId="e1" fromAt="2026-10-07T18:00" toAt="2026-10-07T23:00" value="NONE" onChange={jest.fn()} />);
    await waitFor(() => expect(api.classifyPreview).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    api.classifyPreview.mockRejectedValue(new Error('403'));
    rerender(<OvertimeClassifyHint employeeId="e1" fromAt="2026-10-08T18:00" toAt="2026-10-08T23:00" value="NONE" onChange={jest.fn()} />);
    await waitFor(() => expect(api.classifyPreview).toHaveBeenCalledTimes(2));
    expect(container.textContent).toBe('');
  });
});
