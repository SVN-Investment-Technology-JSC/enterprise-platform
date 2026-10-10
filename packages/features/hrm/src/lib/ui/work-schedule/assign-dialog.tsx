'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  HrmOrgUnitOption,
  HrmScheduleConflictMode,
  HrmScheduleTemplate,
  HrmShiftDefinition,
} from '@enterprise-platform/contracts-hrm';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import { cn } from '../../utils';
import {
  OPEN_ENDED_HINT,
  allowedScopeTypes,
  blockingConflicts,
  buildApplyRequest,
  classifyScheduleError,
  emptyAssignDraft,
  isOpenEnded,
  isRuleApplyResult,
  isRulePreview,
  summarizePattern,
  writableCount,
  validateDraftStep,
  type AnyApplyResult,
  type AnySchedulePreview,
  type AssignDraft,
  type ScheduleErrorInfo,
  type ScopeDraft,
} from '../../hrm-work-schedule-model';
import { applySchedule, previewSchedule } from '../../hrm-work-schedule-api';
import { Button } from '../button';
import { DatePickerInput } from '../date-picker-input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { toast } from '../toast';
import { Checkbox, Field, Notice, SectionTitle, Spinner, textareaClass } from './common';
import {
  ConflictTable,
  PreviewPanel,
  RuleChangesList,
  RulePreviewPanel,
  SummaryStats,
} from './preview-panel';
import { ScopePicker } from './scope-picker';
import { WeeklyPatternEditor, useShiftOptions } from './weekly-pattern-editor';
import { ConflictModePicker } from './conflict-mode-picker';

export type AssignDialogMode = 'single' | 'bulk' | 'exception';

const STEP_TITLES = ['Phạm vi', 'Lịch', 'Thời gian', 'Xem trước'] as const;

function scopeTypesFor(mode: AssignDialogMode, canBulk: boolean): ScopeDraft['type'][] {
  const allowed = allowedScopeTypes(canBulk);
  if (mode === 'single') return ['EMPLOYEE'];
  if (mode === 'bulk') return allowed.filter((t) => t !== 'EMPLOYEE').length ? allowed : ['EMPLOYEE'];
  return allowed;
}

export function AssignDialog({
  open,
  onOpenChange,
  mode,
  shifts,
  units,
  templates,
  employeeOptions,
  employeesLoading,
  employeesError,
  canBulk,
  canCalendar,
  initial,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: AssignDialogMode;
  shifts: readonly HrmShiftDefinition[];
  units: readonly HrmOrgUnitOption[];
  templates: readonly HrmScheduleTemplate[];
  employeeOptions: readonly SearchableSelectOption[];
  employeesLoading: boolean;
  employeesError: string;
  canBulk: boolean;
  canCalendar: boolean;
  initial?: { employeeId?: string; date?: string };
  onDone: () => void;
}) {
  const kind: AssignDraft['kind'] = mode === 'exception' ? 'EXCEPTION' : 'ASSIGN';
  const scopeTypes = useMemo(() => scopeTypesFor(mode, canBulk), [mode, canBulk]);
  const makeDraft = useCallback(() => {
    const draft = emptyAssignDraft(kind, initial);
    if (!scopeTypes.includes(draft.scope.type)) draft.scope.type = scopeTypes[0];
    if (mode === 'bulk' && scopeTypes.includes('EMPLOYEES')) draft.scope.type = 'EMPLOYEES';
    return draft;
  }, [kind, initial, mode, scopeTypes]);

  const [draft, setDraft] = useState<AssignDraft>(makeDraft);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [stepError, setStepError] = useState('');
  const [preview, setPreview] = useState<{ key: string; data: AnySchedulePreview } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [problem, setProblem] = useState<ScheduleErrorInfo | null>(null);
  const [serverReasons, setServerReasons] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [conflictSeen, setConflictSeen] = useState(false);
  const [result, setResult] = useState<AnyApplyResult | null>(null);
  const requestSeq = useRef(0);

  // Mở lại hộp thoại luôn bắt đầu từ bản nháp sạch.
  useEffect(() => {
    if (!open) return;
    setDraft(makeDraft());
    setStep(1);
    setStepError('');
    setPreview(null);
    setProblem(null);
    setServerReasons([]);
    setConfirmed(false);
    setResult(null);
    setConflictSeen(false);
    // makeDraft phụ thuộc initial; chỉ khởi tạo lại khi mở hộp thoại.
  }, [open]);

  const shiftOptions = useShiftOptions(shifts);
  const activeTemplates = useMemo(() => templates.filter((t) => t.status === 'ACTIVE'), [templates]);
  const templateOptions: SearchableSelectOption[] = useMemo(
    () => activeTemplates.map((t) => ({ value: t.id, label: `${t.name} (${t.code})`, badge: t.code })),
    [activeTemplates],
  );
  const selectedTemplate = activeTemplates.find((t) => t.id === draft.templateId);

  const requestKey = useMemo(() => JSON.stringify(buildApplyRequest(draft)), [draft]);
  const patch = (next: Partial<AssignDraft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setProblem(null);
    setServerReasons([]);
    setConfirmed(false);
  };

  const runPreview = useCallback(
    async (target: AssignDraft) => {
      const seq = ++requestSeq.current;
      setPreviewing(true);
      setProblem(null);
      try {
        const res = await previewSchedule(buildApplyRequest(target));
        if (seq !== requestSeq.current) return;
        setPreview({ key: JSON.stringify(buildApplyRequest(target)), data: res.data });
        if (blockingConflicts(res.data, 'REPORT') > 0) setConflictSeen(true);
      } catch (error) {
        if (seq !== requestSeq.current) return;
        setPreview(null);
        setProblem(classifyScheduleError(error));
      } finally {
        if (seq === requestSeq.current) setPreviewing(false);
      }
    },
    [],
  );

  const goTo = (next: 1 | 2 | 3 | 4) => {
    setStepError('');
    setStep(next);
    if (next === 4) {
      setConfirmed(false);
      setServerReasons([]);
      void runPreview(draft);
    }
  };

  const goNext = () => {
    if (step >= 4) return;
    const error = validateDraftStep(draft, step as 1 | 2 | 3);
    if (error) {
      setStepError(error);
      return;
    }
    goTo((step + 1) as 2 | 3 | 4);
  };

  const previewData = preview && preview.key === requestKey ? preview.data : null;
  const isCompany = draft.scope.type === 'COMPANY';
  const reasons = useMemo(() => {
    const list = [...(previewData?.confirmReasons ?? []), ...serverReasons];
    if (isCompany && !list.some((r) => /toàn công ty/i.test(r)))
      list.push('Áp dụng cho toàn công ty');
    return [...new Set(list)];
  }, [previewData, serverReasons, isCompany]);
  const needsConfirm = Boolean(previewData?.requiresConfirmation) || serverReasons.length > 0 || isCompany;
  const openEnded = isOpenEnded(draft);
  const writable = previewData ? writableCount(previewData) : 0;
  const hasConflicts =
    (previewData ? blockingConflicts(previewData, draft.conflictMode) > 0 : false) ||
    problem?.kind === 'CONFLICT' ||
    problem?.kind === 'RULE_CONFLICT';
  const locked = (previewData?.lockedPeriods.length ?? 0) > 0 || problem?.kind === 'LOCKED';
  const canSave =
    step === 4 &&
    !!previewData &&
    !previewing &&
    !applying &&
    !hasConflicts &&
    !locked &&
    writable > 0 &&
    (!needsConfirm || confirmed);

  async function save() {
    if (!canSave) return;
    setApplying(true);
    setProblem(null);
    try {
      const res = await applySchedule(buildApplyRequest(draft, needsConfirm));
      setResult(res.data);
      toast.success(
        isRuleApplyResult(res.data)
          ? `Đã lưu ${res.data.ruleCount} lịch định kỳ cho ${res.data.employeeCount} nhân viên.`
          : `Đã lưu phân ca cho ${res.data.employeeCount} nhân viên (${res.data.appliedDays} ngày).`,
      );
      onDone();
    } catch (error) {
      const info = classifyScheduleError(error);
      if (info.kind === 'CONFIRM_REQUIRED') {
        setServerReasons(info.reasons);
        setConfirmed(false);
      } else {
        if (info.kind === 'CONFLICT' || info.kind === 'RULE_CONFLICT') setConflictSeen(true);
        setProblem(info);
      }
    } finally {
      setApplying(false);
    }
  }

  function changeConflictMode(conflictMode: HrmScheduleConflictMode) {
    const next = { ...draft, conflictMode };
    patch({ conflictMode });
    void runPreview(next);
  }

  const title =
    mode === 'exception' ? 'Thiết lập ngoại lệ' : mode === 'bulk' ? 'Phân ca hàng loạt' : 'Phân ca mới';
  const description =
    mode === 'exception'
      ? 'Đặt ca hoặc ngày nghỉ riêng cho từng ngày hoặc khoảng ngày, ưu tiên hơn lịch tuần.'
      : 'Gán ca làm việc theo lịch tuần cho nhân viên trong một khoảng thời gian. Ca lấy từ danh mục ca hiện có.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(88dvh,780px)] max-w-4xl" aria-label={title}>
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-4">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {!result ? (
            <ol className="mt-2 flex flex-wrap items-center gap-2 text-[11px]" aria-label="Các bước">
              {STEP_TITLES.map((label, index) => {
                const n = index + 1;
                return (
                  <li
                    key={label}
                    aria-current={step === n ? 'step' : undefined}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-semibold',
                      step === n
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : n < step
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-500',
                    )}
                  >
                    {n}. {label}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {result ? (
            <div className="flex flex-col gap-3" data-testid="assign-result">
              {isRuleApplyResult(result) ? (
                <Notice tone="success" title="Đã lưu lịch định kỳ">
                  Đợt phân ca <span className="font-mono">{result.batchId}</span>: {result.ruleCount} lịch định kỳ
                  mới cho {result.employeeCount} nhân viên đang được áp dụng; {result.changedRules} lịch cũ bị kết
                  thúc hoặc hủy, {result.skippedTargets} phạm vi bỏ qua. Lịch tự chạy đến khi bạn kết thúc.
                </Notice>
              ) : (
                <>
                  <Notice tone="success" title="Đã lưu phân ca">
                    Đợt phân ca <span className="font-mono">{result.batchId}</span>: {result.employeeCount} nhân
                    viên, {result.appliedDays} ngày được ghi.
                  </Notice>
                  <SummaryStats summary={result.summary} employeeCount={result.employeeCount} />
                </>
              )}
              <p className="text-xs text-slate-500">
                Mọi thay đổi được ghi vào Lịch sử thay đổi. Lưới lịch đã được làm mới.
              </p>
            </div>
          ) : step === 1 ? (
            <div className="flex flex-col gap-3">
              <SectionTitle step={1}>Áp dụng cho ai</SectionTitle>
              <ScopePicker
                value={draft.scope}
                onChange={(scope) => patch({ scope })}
                allowedTypes={scopeTypes}
                employeeOptions={employeeOptions}
                employeesLoading={employeesLoading}
                employeesError={employeesError}
                units={units}
                openEnded={openEnded}
              />
            </div>
          ) : step === 2 ? (
            <div className="flex flex-col gap-3">
              <SectionTitle step={2}>{kind === 'EXCEPTION' ? 'Ca ngoại lệ' : 'Lịch làm việc'}</SectionTitle>
              {kind === 'EXCEPTION' ? (
                <div className="flex max-w-xl flex-col gap-3">
                  <div role="radiogroup" aria-label="Loại ngoại lệ" className="flex gap-2">
                    {(
                      [
                        ['OFF', 'Nghỉ'],
                        ['SHIFT', 'Làm theo ca'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={draft.exception.dayType === value}
                        onClick={() => patch({ exception: { ...draft.exception, dayType: value } })}
                        className={cn(
                          'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold',
                          draft.exception.dayType === value
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-blue-400',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {draft.exception.dayType === 'SHIFT' ? (
                    <Field label="Ca làm việc">
                      <SearchableSelect
                        options={shiftOptions}
                        value={draft.exception.shiftId}
                        placeholder="Chọn ca từ danh mục ca…"
                        emptyText="Không tìm thấy ca phù hợp"
                        onChange={(shiftId) => patch({ exception: { ...draft.exception, shiftId } })}
                      />
                    </Field>
                  ) : null}
                  <p className="text-[11px] text-slate-500">
                    Ngoại lệ áp dụng như nhau cho mọi ngày trong khoảng đã chọn (T2 đến CN).
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div role="radiogroup" aria-label="Nguồn lịch" className="flex gap-2">
                    {(
                      [
                        ['PATTERN', 'Cấu hình lịch tuần'],
                        ['TEMPLATE', 'Dùng mẫu lịch đã lưu'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={draft.source === value}
                        onClick={() => patch({ source: value })}
                        className={cn(
                          'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold',
                          draft.source === value
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-blue-400',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {draft.source === 'TEMPLATE' ? (
                    <div className="flex max-w-xl flex-col gap-2">
                      <Field label="Mẫu lịch tuần">
                        <SearchableSelect
                          options={templateOptions}
                          value={draft.templateId}
                          placeholder="Tìm mẫu lịch theo tên hoặc mã…"
                          emptyText="Chưa có mẫu lịch nào đang hoạt động"
                          onChange={(templateId) => patch({ templateId })}
                        />
                      </Field>
                      {selectedTemplate ? (
                        <Notice tone="info">
                          {summarizePattern(selectedTemplate.days, shifts)}
                        </Notice>
                      ) : null}
                    </div>
                  ) : (
                    <WeeklyPatternEditor
                      pattern={draft.pattern}
                      onChange={(pattern) => patch({ pattern })}
                      shifts={shifts}
                    />
                  )}
                </div>
              )}
            </div>
          ) : step === 3 ? (
            <div className="flex flex-col gap-4">
              <SectionTitle step={3}>Thời gian và xử lý xung đột</SectionTitle>
              {kind === 'ASSIGN' ? (
                <div className="flex max-w-xl flex-col gap-1.5">
                  <Checkbox
                    checked={draft.openEnded}
                    onChange={(on) =>
                      patch({
                        openEnded: on,
                        conflictMode:
                          on && draft.conflictMode === 'OVERWRITE_ALL'
                            ? 'OVERWRITE_KEEP_EXCEPTIONS'
                            : draft.conflictMode,
                      })
                    }
                    label="Không có ngày kết thúc (lịch định kỳ)"
                  />
                  {draft.openEnded ? <Notice tone="info">{OPEN_ENDED_HINT}</Notice> : null}
                </div>
              ) : null}
              <div className="grid max-w-xl grid-cols-2 gap-4">
                <Field label="Từ ngày">
                  <DatePickerInput
                    aria-label="Từ ngày"
                    value={draft.fromDate}
                    onChange={(fromDate) => patch({ fromDate })}
                  />
                </Field>
                {openEnded ? null : (
                  <Field label="Đến ngày" hint="Tối đa 366 ngày mỗi lần áp dụng.">
                    <DatePickerInput
                      aria-label="Đến ngày"
                      value={draft.toDate}
                      onChange={(toDate) => patch({ toDate })}
                    />
                  </Field>
                )}
              </div>
              <Field label="Lý do (tuỳ chọn)" className="max-w-xl">
                <textarea
                  className={textareaClass}
                  maxLength={500}
                  placeholder="Ví dụ: Chuyển ca theo kế hoạch sản xuất quý IV"
                  value={draft.reason}
                  onChange={(e) => patch({ reason: e.target.value })}
                />
              </Field>
              <ConflictModePicker
                value={draft.conflictMode}
                onChange={(conflictMode) => patch({ conflictMode })}
                canCalendar={canCalendar}
                openEnded={openEnded}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <SectionTitle step={4}>Xem trước kết quả</SectionTitle>
              {previewing ? (
                <Spinner label="Đang tính toán xem trước…" />
              ) : null}
              {problem &&
              problem.kind !== 'CONFLICT' &&
              problem.kind !== 'RULE_CONFLICT' &&
              problem.kind !== 'RULES_NOT_MIGRATED' ? (
                <Notice tone="error">{problem.message}</Notice>
              ) : null}
              {problem?.kind === 'RULES_NOT_MIGRATED' ? (
                <div className="flex flex-col gap-2" data-testid="rules-not-migrated">
                  <Notice tone="error" title="Chưa dùng được lịch định kỳ">
                    {problem.message} Bỏ chọn Không có ngày kết thúc để phân ca theo khoảng ngày; lịch theo khoảng ngày
                    vẫn hoạt động bình thường.
                  </Notice>
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        patch({ openEnded: false });
                        goTo(3);
                      }}
                    >
                      Phân ca theo khoảng ngày
                    </Button>
                  </div>
                </div>
              ) : null}
              {problem?.kind === 'CONFLICT' ? (
                <Notice tone="warn" title="Có ngày đã có lịch khác">
                  {problem.message}
                </Notice>
              ) : null}
              {problem?.kind === 'CONFLICT' && problem.conflicts.length > 0 ? (
                <ConflictTable conflicts={problem.conflicts} total={problem.conflictCount} />
              ) : null}
              {problem?.kind === 'RULE_CONFLICT' ? (
                <>
                  <Notice tone="warn" title="Có phạm vi đã có lịch định kỳ còn hiệu lực">
                    {problem.message}
                  </Notice>
                  <RuleChangesList rules={problem.rules} />
                </>
              ) : null}
              {previewData ? (
                isRulePreview(previewData) ? (
                  <RulePreviewPanel preview={previewData} />
                ) : (
                  <PreviewPanel preview={previewData} />
                )
              ) : null}
              {conflictSeen ? (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xs font-semibold text-amber-800">
                    {openEnded
                      ? 'Chọn cách xử lý lịch định kỳ đang có, hệ thống sẽ xem trước lại'
                      : 'Chọn cách xử lý ngày đã có lịch, hệ thống sẽ xem trước lại'}
                  </div>
                  <ConflictModePicker
                    value={draft.conflictMode}
                    onChange={changeConflictMode}
                    canCalendar={canCalendar}
                    openEnded={openEnded}
                    compact
                  />
                </div>
              ) : null}
              {previewData && !hasConflicts && !locked && writable === 0 ? (
                <Notice tone="info">
                  Không có ngày nào cần ghi (lịch hiện có đã trùng hoặc bị bỏ qua).
                </Notice>
              ) : null}
              {previewData && needsConfirm ? (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <div className="text-xs font-semibold text-amber-800">Cần xác nhận trước khi lưu</div>
                  <ul className="list-disc pl-5 text-xs text-amber-800">
                    {reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <Checkbox
                    checked={confirmed}
                    onChange={setConfirmed}
                    label="Tôi đã xem lại phạm vi và đồng ý áp dụng"
                  />
                </div>
              ) : null}
            </div>
          )}
          {stepError && !result ? <Notice tone="error" className="mt-3">{stepError}</Notice> : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
          {result ? (
            <>
              <span />
              <Button onClick={() => onOpenChange(false)}>Đóng</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Hủy
              </Button>
              <div className="flex items-center gap-2">
                {step > 1 ? (
                  <Button variant="outline" onClick={() => goTo((step - 1) as 1 | 2 | 3)}>
                    Quay lại
                  </Button>
                ) : null}
                {step < 4 ? (
                  <Button onClick={goNext}>Tiếp tục</Button>
                ) : (
                  <>
                    <Button variant="outline" disabled={previewing || applying} onClick={() => void runPreview(draft)}>
                      Xem trước lại
                    </Button>
                    <Button disabled={!canSave} onClick={() => void save()}>
                      {applying ? 'Đang lưu…' : 'Lưu phân ca'}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
