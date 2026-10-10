import { HrmApiError } from './hrm-api';
import {
  addDays,
  applySaturdayShortcut,
  applyShortcut,
  applySundayShortcut,
  buildApplyRequest,
  buildExceptionPattern,
  buildScheduleCsv,
  buildScheduleCsvRows,
  buildScope,
  cellVisual,
  classifyScheduleError,
  csvCell,
  daysInclusive,
  emptyAssignDraft,
  emptyPattern,
  formatRangeLabel,
  formatVnDate,
  groupEmployeeRuns,
  isoWeekday,
  patternFromRules,
  rangeFor,
  shiftAnchor,
  summarizePattern,
  validateDateRange,
  validateDraftStep,
  validatePattern,
  allowedScopeTypes,
  availableConflictModes,
  emptyScopeDraft,
  isOpenEnded,
  isRulePreview,
  isRuleApplyResult,
  blockingConflicts,
  writableCount,
  summarizeRuleDays,
  ruleRangeText,
  canChangeRule,
  SOURCE_LABELS,
} from './hrm-work-schedule-model';
import type { HrmHoliday, HrmScheduleDay } from '@enterprise-platform/contracts-hrm';

const SHIFTS = [
  { id: 's-hc', code: 'HC' },
  { id: 's-half', code: 'HC4' },
];

describe('date and week navigation', () => {
  it('computes ISO weekdays and week ranges starting on Monday', () => {
    expect(isoWeekday('2026-10-05')).toBe(1);
    expect(isoWeekday('2026-10-11')).toBe(7);
    expect(rangeFor('week', '2026-10-09')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
    expect(rangeFor('week', '2026-10-11')).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });

  it('computes month ranges including leap February', () => {
    expect(rangeFor('month', '2026-10-09')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(rangeFor('month', '2028-02-15')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(rangeFor('month', '2026-02-28').to).toBe('2026-02-28');
  });

  it('moves the anchor by a month or a week without skipping across year ends', () => {
    expect(shiftAnchor('month', '2026-01-31', -1)).toBe('2025-12-01');
    expect(shiftAnchor('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftAnchor('week', '2026-10-09', 1)).toBe('2026-10-12');
    expect(shiftAnchor('week', '2026-10-09', -1)).toBe('2026-09-28');
  });

  it('formats dates as dd/MM/yyyy and labels the period in Vietnamese', () => {
    expect(formatVnDate('2026-02-09')).toBe('09/02/2026');
    expect(formatVnDate('bad')).toBe('');
    expect(formatRangeLabel('month', '2026-10-09')).toBe('Tháng 10/2026');
    expect(formatRangeLabel('week', '2026-10-09')).toBe('05/10/2026 - 11/10/2026');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(daysInclusive('2026-10-01', '2026-10-31')).toBe(31);
  });

  it('validates the apply date range (order and 366-day cap)', () => {
    expect(validateDateRange('2026-10-02', '2026-10-01')).toMatch(/trước hoặc bằng/);
    expect(validateDateRange('2026-01-01', '2027-01-02')).toMatch(/366/);
    expect(validateDateRange('2026-01-01', '2027-01-01')).toBeNull();
    expect(validateDateRange('', '2026-12-31')).toMatch(/Nhập/);
  });
});

describe('weekly pattern shortcuts', () => {
  it('starts with seven SKIP rows', () => {
    const p = emptyPattern();
    expect(p).toHaveLength(7);
    expect(p.every((r) => r.dayType === 'SKIP' && r.shiftId === null)).toBe(true);
    expect(validatePattern(p)).toMatch(/ít nhất một ngày/);
  });

  it('fills Monday to Friday and Saturday options from whichever shifts the user chose', () => {
    let p = applyShortcut(emptyPattern(), [1, 2, 3, 4, 5], { kind: 'SHIFT', shiftId: 's-hc' });
    p = applySaturdayShortcut(p, { kind: 'HALF', shiftId: 's-half' });
    p = applySundayShortcut(p, { kind: 'OFF' });
    expect(p.map((r) => [r.weekday, r.dayType, r.shiftId])).toEqual([
      [1, 'SHIFT', 's-hc'],
      [2, 'SHIFT', 's-hc'],
      [3, 'SHIFT', 's-hc'],
      [4, 'SHIFT', 's-hc'],
      [5, 'SHIFT', 's-hc'],
      [6, 'SHIFT', 's-half'],
      [7, 'OFF', null],
    ]);
    expect(validatePattern(p)).toBeNull();
    expect(summarizePattern(p, SHIFTS)).toBe('T2-T6: HC; T7: HC4; CN: Nghỉ');
  });

  it('supports Saturday full day, Saturday off and Sunday working with a chosen shift', () => {
    const base = applyShortcut(emptyPattern(), [1], { kind: 'SHIFT', shiftId: 's-hc' });
    const full = applySaturdayShortcut(base, { kind: 'FULL', shiftId: 's-hc' });
    expect(full[5]).toEqual({ weekday: 6, dayType: 'SHIFT', shiftId: 's-hc' });
    const off = applySaturdayShortcut(full, { kind: 'OFF' });
    expect(off[5]).toEqual({ weekday: 6, dayType: 'OFF', shiftId: null });
    const sunday = applySundayShortcut(off, { kind: 'WORK', shiftId: 's-half' });
    expect(sunday[6]).toEqual({ weekday: 7, dayType: 'SHIFT', shiftId: 's-half' });
    // Không đổi dữ liệu gốc (bất biến).
    expect(base[5].dayType).toBe('SKIP');
  });

  it('flags a SHIFT row without a shift', () => {
    const p = applyShortcut(emptyPattern(), [3], { kind: 'SHIFT', shiftId: '' });
    expect(validatePattern(p)).toMatch(/Thứ tư/);
  });

  it('restores a template into seven rows', () => {
    const p = patternFromRules([
      { weekday: 1, dayType: 'SHIFT', shiftId: 's-hc' },
      { weekday: 7, dayType: 'OFF' },
    ]);
    expect(p).toHaveLength(7);
    expect(p[0].shiftId).toBe('s-hc');
    expect(p[6].dayType).toBe('OFF');
    expect(p[2].dayType).toBe('SKIP');
  });

  it('builds an exception as seven identical rules', () => {
    const off = buildExceptionPattern({ dayType: 'OFF' });
    expect(off).toHaveLength(7);
    expect(new Set(off.map((r) => `${r.dayType}|${r.shiftId}`)).size).toBe(1);
    expect(off.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const shift = buildExceptionPattern({ dayType: 'SHIFT', shiftId: 's-hc' });
    expect(shift.every((r) => r.dayType === 'SHIFT' && r.shiftId === 's-hc')).toBe(true);
  });
});

describe('apply request building', () => {
  it('builds a pattern request without a templateId and gates steps', () => {
    const draft = emptyAssignDraft('ASSIGN', { employeeId: 'e1' });
    draft.pattern = applyShortcut(draft.pattern, [1, 2, 3, 4, 5], { kind: 'SHIFT', shiftId: 's-hc' });
    draft.fromDate = '2026-11-01';
    draft.toDate = '2026-11-30';
    expect(validateDraftStep(draft, 1)).toBeNull();
    expect(validateDraftStep(draft, 2)).toBeNull();
    expect(validateDraftStep(draft, 3)).toBeNull();
    const request = buildApplyRequest(draft);
    expect(request.kind).toBe('ASSIGN');
    expect(request.scope).toEqual({ type: 'EMPLOYEE', employeeIds: ['e1'] });
    expect(request.templateId).toBeUndefined();
    expect(request.pattern).toHaveLength(7);
    expect(request.conflictMode).toBe('REPORT');
    expect(request.confirm).toBeUndefined();
    expect(buildApplyRequest(draft, true).confirm).toBe(true);
  });

  it('builds a template request and an EXCEPTION request', () => {
    const draft = emptyAssignDraft('ASSIGN', { employeeId: 'e1' });
    draft.source = 'TEMPLATE';
    expect(validateDraftStep(draft, 2)).toMatch(/mẫu/);
    draft.templateId = 't1';
    expect(buildApplyRequest(draft)).toMatchObject({ templateId: 't1' });
    expect(buildApplyRequest(draft).pattern).toBeUndefined();

    const exception = emptyAssignDraft('EXCEPTION', { employeeId: 'e1', date: '2026-10-20' });
    exception.exception = { dayType: 'SHIFT', shiftId: 's-hc' };
    const request = buildApplyRequest(exception);
    expect(request.kind).toBe('EXCEPTION');
    expect(request.fromDate).toBe('2026-10-20');
    expect(request.pattern).toHaveLength(7);
    expect(request.conflictMode).toBe('OVERWRITE_KEEP_EXCEPTIONS');
    exception.exception = { dayType: 'SHIFT', shiftId: '' };
    expect(validateDraftStep(exception, 2)).toMatch(/Chọn ca/);
  });

  it('builds scopes for every type and enforces required selections', () => {
    const base = emptyScopeDraft('UNIT');
    expect(buildScope({ ...base, unitIds: ['u1'], excludeEmployeeIds: ['e9'] })).toEqual({
      type: 'UNIT',
      unitIds: ['u1'],
      includeChildUnits: true,
      excludeEmployeeIds: ['e9'],
    });
    expect(buildScope({ ...base, type: 'COMPANY' })).toEqual({ type: 'COMPANY', excludeEmployeeIds: [] });
    expect(buildScope({ ...base, type: 'EMPLOYEE', employeeIds: ['a', 'b'] })).toEqual({
      type: 'EMPLOYEE',
      employeeIds: ['a'],
    });
  });

  it('limits scope and conflict options by permission', () => {
    expect(allowedScopeTypes(false)).toEqual(['EMPLOYEE']);
    expect(allowedScopeTypes(true)).toContain('COMPANY');
    expect(availableConflictModes(false)).not.toContain('OVERWRITE_ALL');
    expect(availableConflictModes(true)).toContain('OVERWRITE_ALL');
  });
});

describe('API error mapping', () => {
  const conflict = {
    employeeId: 'e1',
    employeeCode: 'NV001',
    employeeName: 'An',
    date: '2026-10-20',
    existing: { dayType: 'SHIFT', shiftCode: 'HC', source: 'TEMPLATE' },
    incoming: { dayType: 'OFF', shiftCode: null },
  };

  it('maps HRM_SCHEDULE_CONFLICT with the conflict rows', () => {
    const info = classifyScheduleError(
      new HrmApiError('Có 2 ngày đã có lịch', 409, 'HRM_SCHEDULE_CONFLICT', {
        code: 'HRM_SCHEDULE_CONFLICT',
        conflicts: [conflict],
        summary: { conflicts: 2 },
      }),
    );
    expect(info).toMatchObject({ kind: 'CONFLICT', conflictCount: 2 });
    expect(info.kind === 'CONFLICT' && info.conflicts).toHaveLength(1);
  });

  it('maps confirmation, locked period and not-migrated responses', () => {
    expect(
      classifyScheduleError(
        new HrmApiError('Cần xác nhận', 409, 'HRM_SCHEDULE_CONFIRM_REQUIRED', {
          confirmReasons: ['Ghi đè 3 ngày'],
        }),
      ),
    ).toEqual({ kind: 'CONFIRM_REQUIRED', message: 'Cần xác nhận', reasons: ['Ghi đè 3 ngày'] });
    expect(
      classifyScheduleError(new HrmApiError('Kỳ công đã khóa; cần mở lại kỳ trước khi thay đổi dữ liệu', 409)),
    ).toMatchObject({ kind: 'LOCKED' });
    expect(
      classifyScheduleError(new HrmApiError('x', 409, 'HRM_SCHEDULE_NOT_MIGRATED')),
    ).toMatchObject({ kind: 'NOT_MIGRATED' });
  });

  it('falls back to a generic message for other errors', () => {
    expect(classifyScheduleError(new HrmApiError('Sai dữ liệu', 400))).toEqual({
      kind: 'OTHER',
      message: 'Sai dữ liệu',
    });
    expect(classifyScheduleError(new Error('mạng lỗi')).kind).toBe('OTHER');
    expect(classifyScheduleError('weird').kind).toBe('OTHER');
  });
});

describe('cell visuals', () => {
  const base: HrmScheduleDay = {
    employeeId: 'e1',
    date: '2026-10-05',
    dayType: 'SHIFT',
    shiftId: 's-hc',
    shiftCode: 'HC',
    shiftName: 'Hành chính',
    startTime: '08:00',
    endTime: '17:00',
    source: 'TEMPLATE',
    holidayId: null,
    note: null,
  };
  const holiday: HrmHoliday = {
    id: 'h1',
    name: 'Quốc khánh',
    kind: 'HOLIDAY',
    fromDate: '2026-09-02',
    toDate: '2026-09-02',
    scopeType: 'COMPANY',
    treatment: 'OFF',
  };

  it('classifies shift, off, holiday, holiday-with-shift and exception cells', () => {
    expect(cellVisual(base, base.date, [])).toMatchObject({ kind: 'SHIFT', label: 'HC', exception: false });
    expect(cellVisual({ ...base, source: 'EXCEPTION' }, base.date, [])).toMatchObject({ kind: 'SHIFT', exception: true });
    expect(cellVisual({ ...base, dayType: 'OFF', shiftCode: null }, base.date, [])).toMatchObject({ kind: 'OFF', label: 'OFF' });
    expect(
      cellVisual({ ...base, date: '2026-09-02', dayType: 'HOLIDAY', shiftCode: null, holidayId: 'h1', source: 'HOLIDAY' }, '2026-09-02', [holiday]),
    ).toMatchObject({ kind: 'HOLIDAY' });
    expect(
      cellVisual({ ...base, date: '2026-09-02', source: 'HOLIDAY', holidayId: 'h1' }, '2026-09-02', [holiday]),
    ).toMatchObject({ kind: 'HOLIDAY_SHIFT', label: 'HC' });
    expect(cellVisual(undefined, '2026-10-05', [])).toMatchObject({ kind: 'EMPTY' });
    expect(cellVisual(undefined, '2026-09-02', [holiday])).toMatchObject({ kind: 'HOLIDAY' });
  });

  it('groups consecutive identical days into runs', () => {
    const mk = (date: string, shiftCode: string): HrmScheduleDay => ({ ...base, date, shiftCode });
    expect(
      groupEmployeeRuns([mk('2026-10-07', 'HC'), mk('2026-10-05', 'HC'), mk('2026-10-06', 'HC'), mk('2026-10-08', 'CA2')]),
    ).toEqual([
      { from: '2026-10-05', to: '2026-10-07', dayType: 'SHIFT', shiftCode: 'HC', source: 'TEMPLATE' },
      { from: '2026-10-08', to: '2026-10-08', dayType: 'SHIFT', shiftCode: 'CA2', source: 'TEMPLATE' },
    ]);
  });
});

describe('CSV export', () => {
  const rows = [
    {
      employeeCode: 'NV001',
      employeeName: 'Nguyễn "Văn" An, Jr',
      unitName: 'Sản xuất',
      date: '2026-10-05',
      weekday: 1,
      dayType: 'SHIFT',
      shiftCode: 'HC',
      shiftName: 'Hành chính',
      startTime: '08:00',
      endTime: '17:00',
      source: 'TEMPLATE',
    },
    {
      employeeCode: 'NV002',
      employeeName: '=HYPERLINK("x")',
      unitName: '',
      date: '2026-10-11',
      weekday: 7,
      dayType: 'OFF',
      shiftCode: '',
      shiftName: '',
      startTime: '',
      endTime: '',
      source: 'EXCEPTION',
    },
  ];

  it('maps rows to Vietnamese labels with dd/MM/yyyy dates', () => {
    const matrix = buildScheduleCsvRows(rows);
    expect(matrix[0][0]).toBe('Mã nhân viên');
    expect(matrix[1]).toEqual([
      'NV001',
      'Nguyễn "Văn" An, Jr',
      'Sản xuất',
      '05/10/2026',
      'T2',
      'Ca làm việc',
      'HC',
      'Hành chính',
      '08:00',
      '17:00',
      'Mẫu',
    ]);
    expect(matrix[2].slice(3, 6)).toEqual(['11/10/2026', 'CN', 'Nghỉ']);
    expect(matrix[2][10]).toBe('Ngoại lệ');
  });

  it('escapes quotes and commas and neutralises spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(null)).toBe('');
    const csv = buildScheduleCsv(rows);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Nguyễn ""Văn"" An, Jr"');
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('open-ended recurring schedules', () => {
  const baseDraft = () => {
    const draft = emptyAssignDraft('ASSIGN', { employeeId: 'e1' });
    draft.source = 'TEMPLATE';
    draft.templateId = 't1';
    draft.fromDate = '2026-11-01';
    return draft;
  };

  it('defaults to open-ended for assignments and never for exceptions', () => {
    expect(emptyAssignDraft('ASSIGN').openEnded).toBe(true);
    const exception = emptyAssignDraft('EXCEPTION');
    expect(exception.openEnded).toBe(false);
    exception.openEnded = true; // dù bị bật nhầm, ngoại lệ vẫn cần ngày kết thúc
    expect(isOpenEnded(exception)).toBe(false);
    expect(buildApplyRequest(exception).toDate).toBe(exception.toDate);
  });

  it('omits toDate when open-ended and keeps it for a fixed range', () => {
    const draft = baseDraft();
    const request = buildApplyRequest(draft);
    expect('toDate' in request).toBe(false);
    expect(request).toMatchObject({ kind: 'ASSIGN', templateId: 't1', fromDate: '2026-11-01' });
    draft.openEnded = false;
    draft.toDate = '2026-11-30';
    expect(buildApplyRequest(draft).toDate).toBe('2026-11-30');
  });

  it('drops exclude and child-unit options from the scope when open-ended', () => {
    const scope = {
      ...emptyScopeDraft('UNIT'),
      unitIds: ['u1'],
      excludeEmployeeIds: ['e9'],
      includeChildUnits: false,
    };
    expect(buildScope(scope, true)).toEqual({ type: 'UNIT', unitIds: ['u1'] });
    expect(buildScope({ ...scope, type: 'COMPANY' }, true)).toEqual({ type: 'COMPANY' });
    const draft = baseDraft();
    draft.scope = scope;
    expect(buildApplyRequest(draft).scope).toEqual({ type: 'UNIT', unitIds: ['u1'] });
    expect(validateDraftStep(draft, 3)).toMatch(/không hỗ trợ loại trừ/);
    draft.openEnded = false;
    expect(validateDraftStep(draft, 3)).toBeNull();
  });

  it('applies the 366-day check only when an end date is used', () => {
    const draft = baseDraft();
    draft.toDate = '2030-01-01';
    expect(validateDraftStep(draft, 3)).toBeNull();
    draft.fromDate = '';
    expect(validateDraftStep(draft, 3)).toMatch(/từ ngày/i);
    draft.openEnded = false;
    draft.fromDate = '2026-11-01';
    expect(validateDraftStep(draft, 3)).toMatch(/366/);
  });

  const rulePreview = {
    rules: [
      {
        scopeType: 'UNIT' as const,
        scopeLabel: 'Sản xuất',
        changes: [
          { id: 'r1', from: '2026-01-01', to: null, templateName: 'HC', action: 'TRUNCATE' as const, newTo: '2026-10-31' },
        ],
      },
    ],
    ruleCount: 1,
    changedRules: 1,
    employeeCount: 12,
    conflictTotal: 1,
    skippedTargets: 0,
    requiresConfirmation: false,
    confirmReasons: [],
    lockedPeriods: [],
  };

  it('tells rule previews from day-by-day previews and computes blocking conflicts', () => {
    const fixed = {
      summary: { insert: 5, replace: 2, same: 0, skipped: 0, conflicts: 3, employees: 1 },
      employeeCount: 1,
      dayCount: 7,
      conflictTotal: 3,
      conflicts: [],
      employees: [],
      requiresConfirmation: false,
      confirmReasons: [],
      lockedPeriods: [],
    };
    expect(isRulePreview(rulePreview)).toBe(true);
    expect(isRulePreview(fixed)).toBe(false);
    expect(blockingConflicts(rulePreview, 'REPORT')).toBe(1);
    expect(blockingConflicts(rulePreview, 'SKIP_EXISTING')).toBe(0);
    expect(blockingConflicts(rulePreview, 'OVERWRITE_KEEP_EXCEPTIONS')).toBe(0);
    expect(blockingConflicts(fixed, 'SKIP_EXISTING')).toBe(3);
    expect(writableCount(rulePreview)).toBe(1);
    expect(writableCount(fixed)).toBe(7);
    expect(isRuleApplyResult({ batchId: 'b', ruleCount: 1, changedRules: 0, skippedTargets: 0, employeeCount: 3 })).toBe(true);
  });

  it('maps HRM_SCHEDULE_RULE_CONFLICT with the rules in conflict', () => {
    const info = classifyScheduleError(
      new HrmApiError('Có 1 phạm vi đã có lịch định kỳ', 409, 'HRM_SCHEDULE_RULE_CONFLICT', {
        code: 'HRM_SCHEDULE_RULE_CONFLICT',
        rules: rulePreview.rules,
        conflictTotal: 1,
      }),
    );
    expect(info).toMatchObject({ kind: 'RULE_CONFLICT', conflictTotal: 1 });
    expect(info.kind === 'RULE_CONFLICT' && info.rules[0].scopeLabel).toBe('Sản xuất');
  });

  it('labels and styles the RULE source consistently', () => {
    expect(SOURCE_LABELS.RULE).toBe('Lịch định kỳ');
    const day: HrmScheduleDay = {
      employeeId: 'e1',
      date: '2026-10-05',
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
    expect(cellVisual(day, day.date, [])).toMatchObject({ kind: 'SHIFT', label: 'HC', exception: false });
    expect(cellVisual(day, day.date, []).title).toContain('Lịch định kỳ');
    const csv = buildScheduleCsvRows([
      {
        employeeCode: 'NV1',
        employeeName: 'An',
        unitName: '',
        date: day.date,
        weekday: 1,
        dayType: 'SHIFT',
        shiftCode: 'HC',
        shiftName: '',
        startTime: '',
        endTime: '',
        source: 'RULE',
      },
    ]);
    expect(csv[1][10]).toBe('Lịch định kỳ');
  });

  it('summarises recurring rule days and decides who may end or cancel them', () => {
    expect(
      summarizeRuleDays([
        { weekday: 1, dayType: 'SHIFT', shiftId: 'a', shiftCode: 'HC' },
        { weekday: 2, dayType: 'SHIFT', shiftId: 'a', shiftCode: 'HC' },
        { weekday: 6, dayType: 'SHIFT', shiftId: 'b', shiftCode: 'S' },
        { weekday: 7, dayType: 'OFF', shiftId: null, shiftCode: null },
      ]),
    ).toBe('T2-T3: HC; T7: S; CN: OFF');
    expect(ruleRangeText('2026-11-01', null)).toBe('01/11/2026 - Không kết thúc');
    expect(canChangeRule('EMPLOYEE', { manage: true, bulk: false })).toBe(true);
    expect(canChangeRule('UNIT', { manage: true, bulk: false })).toBe(false);
    expect(canChangeRule('COMPANY', { manage: false, bulk: true })).toBe(true);
  });

  it('lets month navigation run forward indefinitely', () => {
    let anchor = '2026-10-09';
    for (let i = 0; i < 240; i++) anchor = shiftAnchor('month', anchor, 1);
    expect(anchor).toBe('2046-10-01');
    expect(rangeFor('month', anchor)).toEqual({ from: '2046-10-01', to: '2046-10-31' });
  });
});

describe('rules-table-missing error', () => {
  it('maps HRM_SCHEDULE_RULES_NOT_MIGRATED to a local error that is not the base NOT_MIGRATED', () => {
    const info = classifyScheduleError(
      new HrmApiError('Thiếu bảng lịch định kỳ', 409, 'HRM_SCHEDULE_RULES_NOT_MIGRATED'),
    );
    expect(info).toEqual({ kind: 'RULES_NOT_MIGRATED', message: 'Thiếu bảng lịch định kỳ' });
    expect(classifyScheduleError(new HrmApiError('x', 409, 'HRM_SCHEDULE_RULES_NOT_MIGRATED')).kind).not.toBe('NOT_MIGRATED');
  });
});
