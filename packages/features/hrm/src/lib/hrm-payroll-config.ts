/**
 * FIX-C-11: logic thuần cho cấu hình lương / OT (mẫu công thức, giờ HH:mm, cảnh báo tham chiếu, dòng thời gian).
 * Mọi mức, trần, tỷ lệ, biểu thuế trong mẫu là THAM SỐ do HR/kế toán nhập và xác nhận; không hard-code theo năm.
 */

export interface PayrollComponentDraft {
  code: string;
  name: string;
  type: string;
  formula: string;
}

// ---------------------------------------------------------------------------
// Biến hệ thống dùng trong công thức lương
// ---------------------------------------------------------------------------

/**
 * Bản sao phía giao diện của `payrollSystemInputs` (module-hrm, hrm-payroll-calculation.ts).
 * Giao diện không import được mã backend: khi backend thêm/bớt biến phải cập nhật danh sách này.
 */
export const PAYROLL_SYSTEM_INPUTS: readonly { code: string; label: string }[] = [
  { code: 'BASE_SALARY', label: 'Lương tháng theo hồ sơ lương (bình quân theo ngày trong kỳ)' },
  { code: 'PRORATED_BASE_PAY', label: 'Lương theo công (đã tính theo phút được trả)' },
  { code: 'SCHEDULED_MINUTES', label: 'Tổng phút theo phân ca trong kỳ' },
  { code: 'STANDARD_PERIOD_MINUTES', label: 'Định mức phút chuẩn của kỳ' },
  { code: 'PAID_MINUTES', label: 'Phút được trả lương' },
  { code: 'WORKED_MINUTES', label: 'Phút làm việc thực tế' },
  { code: 'OT_MINUTES', label: 'Phút tăng ca' },
  { code: 'WEIGHTED_OT_MINUTES', label: 'Phút tăng ca đã nhân hệ số' },
  { code: 'LATE_MINUTES', label: 'Phút đi muộn' },
  { code: 'EARLY_MINUTES', label: 'Phút về sớm' },
  { code: 'WORKDAY_UNITS', label: 'Số công trong kỳ' },
  { code: 'ADVANCE_DUE', label: 'Số tiền tạm ứng cần thu hồi' },
  { code: 'LEAVE_RECOVERY_DUE', label: 'Thu hồi phép dùng vượt khi nghỉ việc (đã gồm trong MANUAL_DEDUCTIONS)' },
  { code: 'MANUAL_EARNINGS', label: 'Khoản cộng điều chỉnh tay trong kỳ' },
  { code: 'MANUAL_DEDUCTIONS', label: 'Khoản trừ điều chỉnh tay trong kỳ (gồm thu hồi phép)' },
  { code: 'REGISTERED_DEPENDENT_COUNT', label: 'Số người phụ thuộc đã đăng ký' },
];

// ---------------------------------------------------------------------------
// Giờ HH:mm <-> phút từ 00:00
// ---------------------------------------------------------------------------

export function minutesToTime(minutes: number | string | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes === '') return '';
  const n = Number(minutes);
  if (!Number.isInteger(n) || n < 0 || n > 1439) return '';
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

export function timeToMinutes(time: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((time ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// ---------------------------------------------------------------------------
// OT: hệ số / trần tham chiếu (cần HR/pháp chế xác nhận theo văn bản hiện hành)
// ---------------------------------------------------------------------------

export interface OtReference {
  key: string;
  label: string;
  kind: 'rate' | 'limit';
  value: number;
  note: string;
}

export const OT_REFERENCES: OtReference[] = [
  { key: 'weekdayRate', label: 'Hệ số ngày thường', kind: 'rate', value: 1.5, note: '150% đơn giá giờ ngày thường' },
  { key: 'offRate', label: 'Hệ số ngày OFF', kind: 'rate', value: 2, note: '200% đơn giá giờ ngày nghỉ hằng tuần' },
  { key: 'holidayRate', label: 'Hệ số lễ / Tết', kind: 'rate', value: 3, note: '300% (chưa gồm lương ngày lễ được hưởng)' },
  { key: 'nightRate', label: 'Hệ số ban đêm', kind: 'rate', value: 2.1, note: '150% + 30% + 20% x 150%' },
  { key: 'nightOffRate', label: 'Hệ số ban đêm ngày OFF', kind: 'rate', value: 2.7, note: '200% + 30% + 20% x 200%' },
  { key: 'nightHolidayRate', label: 'Hệ số ban đêm lễ / Tết', kind: 'rate', value: 3.9, note: '300% + 30% + 20% x 300%' },
  { key: 'dailyLimitMinutes', label: 'Giới hạn OT / ngày', kind: 'limit', value: 240, note: 'Không quá 50% số giờ chuẩn của ngày (8 giờ => 4 giờ)' },
  { key: 'monthlyLimitMinutes', label: 'Giới hạn OT / tháng', kind: 'limit', value: 40 * 60, note: 'Không quá 40 giờ / tháng' },
  { key: 'yearlyLimitMinutes', label: 'Giới hạn OT / năm', kind: 'limit', value: 200 * 60, note: 'Không quá 200 giờ / năm (một số ngành tới 300 giờ)' },
];

export interface OtWarning {
  key: string;
  message: string;
}

/** Cảnh báo (không chặn): hệ số thấp hơn tham chiếu, trần giờ vượt mức tham chiếu. */
export function otReferenceWarnings(values: Record<string, string | number | undefined>): OtWarning[] {
  const warnings: OtWarning[] = [];
  for (const ref of OT_REFERENCES) {
    const raw = values[ref.key];
    if (raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    if (ref.kind === 'rate' && n < ref.value)
      warnings.push({
        key: ref.key,
        message: `${ref.label} ${n} thấp hơn mức tham chiếu ${ref.value} (${ref.note}). Cần HR/pháp chế xác nhận.`,
      });
    if (ref.kind === 'limit' && n > ref.value)
      warnings.push({
        key: ref.key,
        message: `${ref.label} ${n} phút vượt mức tham chiếu ${ref.value} phút (${ref.note}). Cần HR/pháp chế xác nhận.`,
      });
  }
  const start = values['nightStartMinute'], end = values['nightEndMinute'];
  if (start !== undefined && end !== undefined && start !== '' && end !== '' && Number(start) <= Number(end))
    warnings.push({ key: 'nightStartMinute', message: 'Khung giờ đêm phải qua 00:00 (giờ bắt đầu sau giờ kết thúc).' });
  return warnings;
}

// ---------------------------------------------------------------------------
// Mẫu công thức lương
// ---------------------------------------------------------------------------

export interface PayrollTemplate {
  components: PayrollComponentDraft[];
  /** Tham số do HR/kế toán nhập; mẫu để 0 và đánh dấu cần xác nhận. */
  inputs: Record<string, number>;
  /** Mô tả tham số để hiển thị. */
  inputNotes: Record<string, string>;
}

const BRACKETS = 5;

export function payrollTemplate(): PayrollTemplate {
  const inputNotes: Record<string, string> = {
    INSURANCE_BASE: 'Mức lương đóng bảo hiểm (nhập theo từng nhân viên hoặc dùng mức chung)',
    INSURANCE_CAP: 'Trần mức đóng bảo hiểm (0 = chưa nhập)',
    BHXH_RATE: 'Tỷ lệ BHXH người lao động (ví dụ 0.08)',
    BHYT_RATE: 'Tỷ lệ BHYT người lao động (ví dụ 0.015)',
    BHTN_RATE: 'Tỷ lệ BHTN người lao động (ví dụ 0.01)',
    PERSONAL_DEDUCTION: 'Giảm trừ gia cảnh bản thân / tháng',
    DEPENDENT_DEDUCTION: 'Giảm trừ mỗi người phụ thuộc / tháng',
    ALLOWANCE_FIXED: 'Phụ cấp cố định / tháng',
  };
  const inputs: Record<string, number> = {
    INSURANCE_BASE: 0,
    INSURANCE_CAP: 0,
    BHXH_RATE: 0,
    BHYT_RATE: 0,
    BHTN_RATE: 0,
    PERSONAL_DEDUCTION: 0,
    DEPENDENT_DEDUCTION: 0,
    ALLOWANCE_FIXED: 0,
  };
  for (let i = 1; i < BRACKETS; i++) {
    inputs[`TAX_LIMIT_${i}`] = 0;
    inputNotes[`TAX_LIMIT_${i}`] = `Cận trên bậc thuế ${i} (thu nhập tính thuế / tháng)`;
  }
  for (let i = 1; i <= BRACKETS; i++) {
    inputs[`TAX_RATE_${i}`] = 0;
    inputNotes[`TAX_RATE_${i}`] = `Thuế suất bậc ${i} (ví dụ 0.05)`;
  }
  // Thuế lũy tiến: tổng của MAX(0, MIN(thu nhập, cận trên) - cận dưới) x thuế suất từng bậc.
  const taxTerms: string[] = [];
  for (let i = 1; i <= BRACKETS; i++) {
    const lower = i === 1 ? '0' : `TAX_LIMIT_${i - 1}`;
    const upper = i === BRACKETS ? null : `TAX_LIMIT_${i}`;
    const top = upper ? `MIN(TAXABLE_INCOME, ${upper})` : 'TAXABLE_INCOME';
    taxTerms.push(`MAX(0, ${top} - ${lower}) * TAX_RATE_${i}`);
  }
  const components: PayrollComponentDraft[] = [
    { code: 'SALARY', name: 'Lương theo công', type: 'EARNING', formula: 'PRORATED_BASE_PAY' },
    {
      code: 'OT_PAY',
      name: 'Tiền tăng ca',
      type: 'OVERTIME',
      formula: 'ROUND(BASE_SALARY / STANDARD_PERIOD_MINUTES * WEIGHTED_OT_MINUTES, 0)',
    },
    { code: 'ALLOWANCE_PAY', name: 'Phụ cấp', type: 'ALLOWANCE', formula: 'ALLOWANCE_FIXED' },
    {
      code: 'INSURANCE_BASE_USED',
      name: 'Mức đóng bảo hiểm tính toán',
      type: 'OTHER_DEDUCTION',
      formula: 'IF(INSURANCE_CAP > 0, MIN(INSURANCE_BASE, INSURANCE_CAP), INSURANCE_BASE)',
    },
    { code: 'BHXH', name: 'BHXH người lao động', type: 'STATUTORY_DEDUCTION', formula: 'ROUND(INSURANCE_BASE_USED * BHXH_RATE, 0)' },
    { code: 'BHYT', name: 'BHYT người lao động', type: 'STATUTORY_DEDUCTION', formula: 'ROUND(INSURANCE_BASE_USED * BHYT_RATE, 0)' },
    { code: 'BHTN', name: 'BHTN người lao động', type: 'STATUTORY_DEDUCTION', formula: 'ROUND(INSURANCE_BASE_USED * BHTN_RATE, 0)' },
    {
      code: 'FAMILY_DEDUCTION',
      name: 'Giảm trừ gia cảnh',
      type: 'OTHER_DEDUCTION',
      formula: 'PERSONAL_DEDUCTION + DEPENDENT_DEDUCTION * REGISTERED_DEPENDENT_COUNT',
    },
    {
      code: 'TAXABLE_INCOME',
      name: 'Thu nhập tính thuế',
      type: 'OTHER_DEDUCTION',
      formula: 'MAX(0, SALARY + OT_PAY + ALLOWANCE_PAY + MANUAL_EARNINGS - BHXH - BHYT - BHTN - FAMILY_DEDUCTION)',
    },
    { code: 'PIT', name: 'Thuế TNCN', type: 'TAX_DEDUCTION', formula: `ROUND(${taxTerms.join(' + ')}, 0)` },
    { code: 'ADVANCE', name: 'Thu hồi ứng lương', type: 'ADVANCE_DEDUCTION', formula: 'ADVANCE_DUE' },
    {
      code: 'NET',
      name: 'Thực lĩnh',
      type: 'NET_PAY',
      formula: 'SALARY + OT_PAY + ALLOWANCE_PAY + MANUAL_EARNINGS - BHXH - BHYT - BHTN - PIT - ADVANCE - MANUAL_DEDUCTIONS',
    },
  ];
  return { components, inputs, inputNotes };
}

/** Nội tuyến các khoản trung gian vào công thức khác (mọi khoản đều tính vào tổng thu/khấu trừ nên không để khoản trung gian riêng, tránh lệch NET_PAY). */
export function inlineIntermediates(components: PayrollComponentDraft[], codes: string[]): PayrollComponentDraft[] {
  const defs = new Map(components.map((c) => [c.code, c.formula]));
  const expand = (formula: string, depth = 0): string => {
    if (depth > 10) return formula;
    return formula.replace(/[A-Z][A-Z0-9_]*/g, (name, offset: number, whole: string) => {
      if (!codes.includes(name) || whole.slice(offset + name.length).trimStart().startsWith('(')) return name;
      return `(${expand(defs.get(name) ?? name, depth + 1)})`;
    });
  };
  return components
    .filter((c) => !codes.includes(c.code))
    .map((c) => ({ ...c, formula: expand(c.formula) }));
}

/** Mẫu cuối cùng dùng cho UI: khoản trung gian được nội tuyến để NET_PAY luôn khớp tổng thu - khấu trừ. */
export function buildPayrollTemplate(): PayrollTemplate {
  const base = payrollTemplate();
  return {
    ...base,
    components: inlineIntermediates(base.components, [
      'INSURANCE_BASE_USED',
      'FAMILY_DEDUCTION',
      'TAXABLE_INCOME',
    ]),
  };
}

/** Tên tham số trong mẫu còn bằng 0 (HR/kế toán phải nhập và xác nhận trước khi dùng). */
export function unfilledTemplateInputs(inputs: Record<string, number>, template = buildPayrollTemplate()): string[] {
  return Object.keys(template.inputs).filter((k) => !inputs[k]);
}

export function formatInputs(inputs: Record<string, number>): string {
  return Object.entries(inputs)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ---------------------------------------------------------------------------
// Dòng thời gian phiên bản
// ---------------------------------------------------------------------------

export interface TimelineVersion {
  id: string;
  version_no: number;
  effective_from: string;
  effective_to: string | null;
}
export interface TimelineIssue {
  kind: 'GAP' | 'OVERLAP';
  from: string;
  to: string;
  message: string;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Tìm khoảng trống / chồng lấn giữa các phiên bản của cùng một loại chính sách (sắp theo ngày hiệu lực). */
export function analyzeTimeline(versions: TimelineVersion[]): TimelineIssue[] {
  const sorted = [...versions].sort(
    (a, b) => a.effective_from.localeCompare(b.effective_from) || a.version_no - b.version_no,
  );
  const issues: TimelineIssue[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (a.effective_to === null) {
      issues.push({
        kind: 'OVERLAP',
        from: b.effective_from,
        to: b.effective_from,
        message: `v${a.version_no} vẫn mở nhưng v${b.version_no} đã bắt đầu từ ${b.effective_from}`,
      });
      continue;
    }
    const expectedNext = addDays(a.effective_to, 1);
    if (b.effective_from > expectedNext)
      issues.push({
        kind: 'GAP',
        from: expectedNext,
        to: addDays(b.effective_from, -1),
        message: `Khoảng trống ${expectedNext} đến ${addDays(b.effective_from, -1)} giữa v${a.version_no} và v${b.version_no}`,
      });
    else if (b.effective_from < expectedNext)
      issues.push({
        kind: 'OVERLAP',
        from: b.effective_from,
        to: a.effective_to,
        message: `v${a.version_no} và v${b.version_no} chồng lấn từ ${b.effective_from} đến ${a.effective_to}`,
      });
  }
  return issues;
}
