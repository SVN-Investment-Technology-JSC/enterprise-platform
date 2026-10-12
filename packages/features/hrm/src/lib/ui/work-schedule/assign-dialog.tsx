'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  HrmOrgUnitOption,
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
  emptyAssignDraft,
  summarizePattern,
  validateDraftStep,
  type AssignDraft,
  type ScopeDraft,
} from '../../hrm-work-schedule-model';
import { Button } from '../button';
import { DatePickerInput } from '../date-picker-input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { AssignPreviewSection, AssignResultSection, useAssignFlow } from './assign-flow';
import { Checkbox, Field, Notice, SectionTitle, textareaClass } from './common';
import { ConflictModePicker } from './conflict-mode-picker';
import { ScopePicker } from './scope-picker';
import { WeeklyPatternEditor, useShiftOptions } from './weekly-pattern-editor';

export type AssignDialogMode = 'single' | 'bulk' | 'exception';

const STEP_TITLES = ['Phạm vi', 'Lịch', 'Thời gian', 'Xem trước'] as const;

function scopeTypesFor(mode: AssignDialogMode, canBulk: boolean): ScopeDraft['type'][] {
  const allowed = allowedScopeTypes(canBulk);
  if (mode === 'single') return ['EMPLOYEE'];
  if (mode === 'bulk') return allowed.filter((t) => t !== 'EMPLOYEE').length ? allowed : ['EMPLOYEE'];
  return allowed;
}

/**
 * Hộp thoại 4 bước (Phạm vi, Lịch, Thời gian, Xem trước). Trang Phân ca dùng biểu mẫu trong trang (`AssignInlineForm`)
 * cho thao tác thường dùng; hộp thoại này dùng cho "Thiết lập ngoại lệ" (bấm ô lịch hoặc từ chi tiết nhân viên).
 * Cả hai dùng chung `useAssignFlow` nên cùng một luồng xem trước và lưu.
 */
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

  const flow = useAssignFlow(makeDraft, onDone);
  const { draft, patch, previewing, applying, result } = flow;
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Mở lại hộp thoại luôn bắt đầu từ bản nháp sạch.
  useEffect(() => {
    if (!open) return;
    flow.reset();
    setStep(1);
    // Chỉ khởi tạo lại khi mở hộp thoại.
  }, [open]);

  const shiftOptions = useShiftOptions(shifts);
  const activeTemplates = useMemo(() => templates.filter((t) => t.status === 'ACTIVE'), [templates]);
  const templateOptions: SearchableSelectOption[] = useMemo(
    () => activeTemplates.map((t) => ({ value: t.id, label: `${t.name} (${t.code})`, badge: t.code })),
    [activeTemplates],
  );
  const selectedTemplate = activeTemplates.find((t) => t.id === draft.templateId);

  const goTo = (next: 1 | 2 | 3 | 4) => {
    flow.setStepError('');
    setStep(next);
    if (next === 4) {
      flow.setConfirmed(false);
      flow.setServerReasons([]);
      void flow.runPreview(draft);
    }
  };

  const goNext = () => {
    if (step >= 4) return;
    const error = validateDraftStep(draft, step as 1 | 2 | 3);
    if (error) {
      flow.setStepError(error);
      return;
    }
    goTo((step + 1) as 2 | 3 | 4);
  };

  const canSave = step === 4 && flow.canSave;
  const openEnded = flow.openEnded;

  const title =
    mode === 'exception' ? 'Thiết lập ngoại lệ' : mode === 'bulk' ? 'Phân ca hàng loạt' : 'Phân ca mới';
  const description =
    mode === 'exception'
      ? 'Đặt ca hoặc ngày nghỉ riêng cho từng ngày hoặc khoảng ngày, ưu tiên hơn lịch tuần.'
      : 'Gán ca làm việc theo lịch tuần cho nhân viên trong một khoảng thời gian. Ca lấy từ danh mục ca hiện có.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="@container h-[min(88dvh,780px)] max-w-4xl" aria-label={title}>
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-4 pr-12 @lg:px-6">
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 @lg:px-6">
          {result ? (
            <AssignResultSection result={result} />
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
                  <div role="radiogroup" aria-label="Loại ngoại lệ" className="flex flex-wrap gap-2">
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
                          'h-9 cursor-pointer rounded-lg border px-3 text-xs font-semibold',
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
                  <div role="radiogroup" aria-label="Nguồn lịch" className="flex flex-wrap gap-2">
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
                          'h-9 cursor-pointer rounded-lg border px-3 text-xs font-semibold',
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
                      {selectedTemplate ? <Notice tone="info">{summarizePattern(selectedTemplate.days, shifts)}</Notice> : null}
                    </div>
                  ) : (
                    <WeeklyPatternEditor pattern={draft.pattern} onChange={(pattern) => patch({ pattern })} shifts={shifts} />
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
                          on && draft.conflictMode === 'OVERWRITE_ALL' ? 'OVERWRITE_KEEP_EXCEPTIONS' : draft.conflictMode,
                      })
                    }
                    label="Không có ngày kết thúc (lịch định kỳ)"
                  />
                  {draft.openEnded ? <Notice tone="info">{OPEN_ENDED_HINT}</Notice> : null}
                </div>
              ) : null}
              <div className="grid max-w-xl grid-cols-1 gap-4 @lg:grid-cols-2">
                <Field label="Từ ngày">
                  <DatePickerInput aria-label="Từ ngày" value={draft.fromDate} onChange={(fromDate) => patch({ fromDate })} />
                </Field>
                {openEnded ? null : (
                  <Field label="Đến ngày" hint="Tối đa 366 ngày mỗi lần áp dụng.">
                    <DatePickerInput aria-label="Đến ngày" value={draft.toDate} onChange={(toDate) => patch({ toDate })} />
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
              <AssignPreviewSection
                flow={flow}
                shifts={shifts}
                selectedTemplate={selectedTemplate}
                canCalendar={canCalendar}
                onUseFixedRange={() => {
                  patch({ openEnded: false });
                  goTo(3);
                }}
              />
            </div>
          )}
          {flow.stepError && !result ? <Notice tone="error" className="mt-3">{flow.stepError}</Notice> : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 @lg:px-6">
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
              <div className="flex flex-wrap items-center justify-end gap-2">
                {step > 1 ? (
                  <Button variant="outline" onClick={() => goTo((step - 1) as 1 | 2 | 3)}>
                    Quay lại
                  </Button>
                ) : null}
                {step < 4 ? (
                  <Button onClick={goNext}>Tiếp tục</Button>
                ) : (
                  <>
                    <Button variant="outline" disabled={previewing || applying} onClick={() => void flow.runPreview(draft)}>
                      Xem trước lại
                    </Button>
                    <Button disabled={!canSave} onClick={() => void flow.save()}>
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
