import type { HrmCompOffConversionRow, HrmOvertimeCompConfig } from '@enterprise-platform/contracts-hrm';
import {
  compOffUsageProblem,
  configToForm,
  conversionPayload,
  conversionRowProblem,
  formatCompNumber,
  formToConfig,
  nextFreeEffectiveFrom,
  overtimeCompFormProblem,
} from './comp-off-model';

const config: HrmOvertimeCompConfig = {
  enabled: true,
  ruleSet: 'NIGHT_REST',
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
  rounding: 'HALF_UP',
  usageStepDays: 0.5,
  accrualMonthOffset: 1,
  expiryMonths: 0,
  accumulationCapDays: null,
};

const row = (over: Partial<HrmCompOffConversionRow> = {}): HrmCompOffConversionRow => ({
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

describe('formatCompNumber', () => {
  it('dùng dấu phẩy, bỏ số 0 thừa và chịu được giá trị rỗng', () => {
    expect(formatCompNumber(4.3)).toBe('4,3');
    expect(formatCompNumber(2)).toBe('2');
    expect(formatCompNumber(null)).toBe('—');
  });
});

describe('nextFreeEffectiveFrom', () => {
  it('chọn mùng 1 tháng kế tiếp, bỏ qua tháng đã có phiên bản bắt đầu đúng ngày đó, qua ranh giới năm', () => {
    expect(nextFreeEffectiveFrom([], '2026-11-10')).toBe('2026-12-01');
    expect(nextFreeEffectiveFrom([{ effectiveFrom: '2026-12-01' }], '2026-11-10')).toBe('2027-01-01');
    expect(nextFreeEffectiveFrom([{ effectiveFrom: '2026-12-01' }, { effectiveFrom: '2027-01-01' }], '2026-12-31')).toBe('2027-02-01');
  });
});

describe('compOffUsageProblem', () => {
  const available = { enabled: true, available: 1.5, usageStepDays: 0.5 };
  it('chặn số ngày không là bội số của bước và số vượt số dư', () => {
    expect(compOffUsageProblem(1, available)).toBe('');
    expect(compOffUsageProblem(0.3, available)).toContain('bội số của 0,5');
    expect(compOffUsageProblem(2, available)).toContain('vượt số dư khả dụng (1,5 ngày)');
  });
  it('chưa bật quy tắc thì chặn; chưa có thông tin hoặc 0 ngày thì không báo lỗi', () => {
    expect(compOffUsageProblem(1, { ...available, enabled: false })).toContain('chưa được bật');
    expect(compOffUsageProblem(1, null)).toBe('');
    expect(compOffUsageProblem(0, available)).toBe('');
  });
});

describe('chuyển đổi tháng', () => {
  it('chỉnh số ngày khác đề xuất bắt buộc có lý do; số ngày phải dương và tối đa 1 chữ số thập phân', () => {
    expect(conversionRowProblem(row())).toBe('');
    expect(conversionRowProblem(row(), { days: '4,3', reason: '' })).toBe('');
    expect(conversionRowProblem(row(), { days: '4', reason: '' })).toContain('lý do');
    expect(conversionRowProblem(row(), { days: '4', reason: 'HR xác nhận' })).toBe('');
    expect(conversionRowProblem(row(), { days: '0', reason: 'x' })).toContain('lớn hơn 0');
    expect(conversionRowProblem(row(), { days: '4,25', reason: 'x' })).toContain('1 chữ số');
  });

  it('chỉ gửi các dòng đã chọn và còn chuyển đổi được; chỉ kèm số ngày và lý do khi HR có chỉnh', () => {
    const rows = [row(), row({ employeeId: 'e2', status: 'CONVERTED' }), row({ employeeId: 'e3', compDays: 1 })];
    const payload = conversionPayload(rows, new Set(['e1', 'e2', 'e3']), { e3: { days: '0,5', reason: ' Nghỉ ít hơn ' } });
    expect(payload).toEqual([{ employeeId: 'e1' }, { employeeId: 'e3', days: 0.5, reason: 'Nghỉ ít hơn' }]);
  });
});

describe('biểu mẫu cấu hình', () => {
  it('đổi qua lại giữa cấu hình và biểu mẫu không làm mất giá trị', () => {
    expect(formToConfig(configToForm(config))).toMatchObject({
      enabled: true,
      ruleSet: 'NIGHT_REST',
      monthlyCapHours: 40,
      yearlyCapHours: 200,
      compFactor: 1.5,
      dayBasisHours: null,
      accrualMonthOffset: 1,
      nightRestHoursPerDay: 8,
      allowHalfDay: true,
    });
  });

  it('chỉ gửi tham số của chế độ đang chọn', () => {
    const nightRest = formToConfig(configToForm(config));
    expect(nightRest).not.toHaveProperty('nightStartMinute');
    const clock = formToConfig(configToForm({ ...config, ruleSet: 'CLOCK_WINDOW' }));
    expect(clock).toMatchObject({ nightStartMinute: 1320, nightEndMinute: 360 });
    expect(clock).not.toHaveProperty('nightRestHoursPerDay');
  });

  it('ngày hiệu lực phải là mùng 1, cần lý do, số nhập sai và giờ đêm sai định dạng bị báo', () => {
    const form = configToForm(config);
    expect(overtimeCompFormProblem(form, '2026-12-01', 'Bật quy tắc')).toBe('');
    expect(overtimeCompFormProblem(form, '2026-12-15', 'x')).toContain('mùng 1');
    expect(overtimeCompFormProblem(form, '2026-12-01', ' ')).toContain('lý do');
    expect(overtimeCompFormProblem({ ...form, monthlyCapHours: 'abc' }, '2026-12-01', 'x')).toContain('không phải số');
    expect(overtimeCompFormProblem({ ...form, ruleSet: 'CLOCK_WINDOW', nightStart: '25' }, '2026-12-01', 'x')).toContain('HH:mm');
  });
});
