import {
  analyzeTimeline,
  buildPayrollTemplate,
  minutesToTime,
  otReferenceWarnings,
  timeToMinutes,
  unfilledTemplateInputs,
} from './hrm-payroll-config';

describe('giờ HH:mm', () => {
  it('chuyển qua lại', () => {
    expect(minutesToTime(1320)).toBe('22:00');
    expect(minutesToTime(360)).toBe('06:00');
    expect(minutesToTime(0)).toBe('00:00');
    expect(timeToMinutes('22:00')).toBe(1320);
    expect(timeToMinutes('06:30')).toBe(390);
  });
  it('giá trị không hợp lệ', () => {
    expect(minutesToTime(1440)).toBe('');
    expect(minutesToTime('')).toBe('');
    expect(timeToMinutes('24:00')).toBeNull();
    expect(timeToMinutes('6:00')).toBeNull();
    expect(timeToMinutes('')).toBeNull();
  });
});

describe('otReferenceWarnings', () => {
  it('cảnh báo hệ số thấp hơn tham chiếu và trần giờ vượt tham chiếu', () => {
    const w = otReferenceWarnings({ weekdayRate: 1.2, offRate: 2, monthlyLimitMinutes: 3000 });
    expect(w.map((x) => x.key).sort()).toEqual(['monthlyLimitMinutes', 'weekdayRate']);
  });
  it('không cảnh báo khi đạt tham chiếu hoặc để trống', () => {
    expect(otReferenceWarnings({ weekdayRate: 1.5, holidayRate: 3, dailyLimitMinutes: 240, nightRate: '' })).toEqual([]);
  });
  it('khung đêm không qua 00:00', () => {
    expect(otReferenceWarnings({ nightStartMinute: 300, nightEndMinute: 1320 })).toHaveLength(1);
  });
});

describe('mẫu công thức', () => {
  const template = buildPayrollTemplate();
  const codes = template.components.map((c) => c.code);
  it('có đủ nhóm khoản và đúng một NET_PAY', () => {
    expect(template.components.filter((c) => c.type === 'NET_PAY')).toHaveLength(1);
    for (const c of ['SALARY', 'OT_PAY', 'BHXH', 'BHYT', 'BHTN', 'PIT', 'ADVANCE', 'NET']) expect(codes).toContain(c);
  });
  it('không hard-code mức/tỷ lệ: mọi tham số mẫu bằng 0 và cần nhập', () => {
    expect(Object.values(template.inputs).every((v) => v === 0)).toBe(true);
    expect(unfilledTemplateInputs({})).toHaveLength(Object.keys(template.inputs).length);
    expect(unfilledTemplateInputs({ ...template.inputs, BHXH_RATE: 0.08 })).not.toContain('BHXH_RATE');
  });
  it('mỗi công thức nằm trong giới hạn của bộ tính (2000 ký tự, 500 ký hiệu)', () => {
    for (const c of template.components) {
      const tokens = c.formula.match(/\d+(?:\.\d+)?|[A-Z][A-Z0-9_]*|<=|>=|==|!=|[+\-*/(),<>]/g) || [];
      expect(c.formula.length).toBeLessThanOrEqual(2000);
      expect(tokens.length).toBeLessThanOrEqual(500);
      expect(tokens.join('')).toBe(c.formula.replace(/\s/g, ''));
    }
  });
  it('mã khoản hợp lệ và không trùng tham số', () => {
    for (const c of codes) expect(c).toMatch(/^[A-Z][A-Z0-9_]{0,49}$/);
    for (const k of Object.keys(template.inputs)) expect(codes).not.toContain(k);
  });
});

describe('analyzeTimeline', () => {
  const v = (n: number, from: string, to: string | null) => ({ id: `v${n}`, version_no: n, effective_from: from, effective_to: to });
  it('chuỗi liền mạch không có vấn đề', () => {
    expect(analyzeTimeline([v(1, '2026-01-01', '2026-06-30'), v(2, '2026-07-01', null)])).toEqual([]);
  });
  it('phát hiện khoảng trống', () => {
    const r = analyzeTimeline([v(1, '2026-01-01', '2026-06-30'), v(2, '2026-07-10', null)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'GAP', from: '2026-07-01', to: '2026-07-09' });
  });
  it('phát hiện chồng lấn và phiên bản trước còn mở', () => {
    expect(analyzeTimeline([v(1, '2026-01-01', '2026-07-31'), v(2, '2026-07-01', null)])[0].kind).toBe('OVERLAP');
    expect(analyzeTimeline([v(1, '2026-01-01', null), v(2, '2026-07-01', null)])[0].kind).toBe('OVERLAP');
  });
});
