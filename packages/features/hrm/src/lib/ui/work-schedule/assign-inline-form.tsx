'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, Users, X } from 'lucide-react';
import type {
  HrmOrgUnitOption,
  HrmScheduleTemplate,
  HrmShiftDefinition,
} from '@enterprise-platform/contracts-hrm';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import {
  OPEN_ENDED_HINT,
  allowedScopeTypes,
  applyShortcut,
  emptyAssignDraft,
  emptyPattern,
  patternFromRules,
  summarizePattern,
  validateDraftStep,
  type AnyApplyResult,
  type PatternRow,
} from '../../hrm-work-schedule-model';
import { Button } from '../button';
import { DatePickerInput } from '../date-picker-input';
import { Input } from '../input';
import { InfoNote, SettingsSection } from '../settings-kit';
import { AssignPreviewSection, AssignResultSection, useAssignFlow } from './assign-flow';
import { Checkbox, Field, Notice } from './common';
import { ConflictModePicker } from './conflict-mode-picker';
import { ScopeCards } from './scope-cards';
import { WeeklyPatternEditor, useShiftOptions } from './weekly-pattern-editor';

const SHIFT_PREFIX = 'shift:';
const TEMPLATE_PREFIX = 'template:';
const CUSTOM = '__custom__';
/** Ca chọn ở ô chính áp dụng cho Thứ hai đến Thứ sáu; Thứ bảy, Chủ nhật chỉnh ở "Tuỳ chọn nâng cao". */
const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];
const REASON_MAX = 500;

/** Lịch tuần "một ca cho T2-T6" nếu đúng như vậy, ngược lại null. */
function singleShiftOf(pattern: readonly PatternRow[]): string | null {
  const weekdays = pattern.filter((r) => WEEKDAYS_MON_FRI.includes(r.weekday));
  const first = weekdays[0];
  if (!first || first.dayType !== 'SHIFT' || !first.shiftId) return null;
  if (!weekdays.every((r) => r.dayType === 'SHIFT' && r.shiftId === first.shiftId)) return null;
  return first.shiftId;
}

/**
 * Biểu mẫu Phân ca trong trang (theo mẫu: phạm vi, ca làm việc, ngày hiệu lực, ghi chú). Dùng chung luồng xem trước và lưu
 * với hộp thoại (`useAssignFlow`): bấm "Xác nhận phân ca" để kiểm tra bản nháp và xem trước ngay dưới biểu mẫu,
 * xử lý xung đột/xác nhận nếu có, rồi "Lưu phân ca".
 */
export function AssignInlineForm({
  shifts,
  units,
  templates,
  employeeOptions,
  employeesLoading,
  employeesError,
  canBulk,
  canCalendar,
  onDone,
}: {
  shifts: readonly HrmShiftDefinition[];
  units: readonly HrmOrgUnitOption[];
  templates: readonly HrmScheduleTemplate[];
  employeeOptions: readonly SearchableSelectOption[];
  employeesLoading: boolean;
  employeesError: string;
  canBulk: boolean;
  canCalendar: boolean;
  onDone: () => void;
}) {
  const scopeTypes = useMemo(() => allowedScopeTypes(canBulk), [canBulk]);
  const makeDraft = useCallback(() => {
    const draft = emptyAssignDraft('ASSIGN');
    if (!scopeTypes.includes(draft.scope.type)) draft.scope.type = scopeTypes[0];
    return draft;
  }, [scopeTypes]);
  const flow = useAssignFlow(makeDraft, onDone);
  const { draft, patch, previewData, previewing, applying } = flow;
  const [requested, setRequested] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [done, setDone] = useState<AnyApplyResult | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Lưu xong: giữ kết quả để hiển thị và trả biểu mẫu về bản nháp sạch (tránh bấm lưu hai lần).
  useEffect(() => {
    if (!flow.result) return;
    setDone(flow.result);
    setRequested(false);
    flow.reset();
  }, [flow.result]);

  useEffect(() => {
    if (previewData) previewRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [previewData]);

  const shiftOptions = useShiftOptions(shifts);
  const activeTemplates = useMemo(() => templates.filter((t) => t.status === 'ACTIVE'), [templates]);
  const selectedTemplate = activeTemplates.find((t) => t.id === draft.templateId);

  const scheduleOptions: SearchableSelectOption[] = useMemo(() => {
    const list: SearchableSelectOption[] = shiftOptions.map((o) => ({ ...o, value: `${SHIFT_PREFIX}${o.value}` }));
    for (const t of activeTemplates)
      list.push({ value: `${TEMPLATE_PREFIX}${t.id}`, label: `Mẫu lịch tuần: ${t.name} (${t.code})`, badge: 'Mẫu' });
    return list;
  }, [shiftOptions, activeTemplates]);

  const singleShift = singleShiftOf(draft.pattern);
  const hasAnyDay = draft.pattern.some((r) => r.dayType !== 'SKIP');
  const scheduleValue =
    draft.source === 'TEMPLATE'
      ? draft.templateId
        ? `${TEMPLATE_PREFIX}${draft.templateId}`
        : ''
      : singleShift
        ? `${SHIFT_PREFIX}${singleShift}`
        : hasAnyDay
          ? CUSTOM
          : '';
  const selectOptions = scheduleValue === CUSTOM
    ? [{ value: CUSTOM, label: 'Lịch tuần tuỳ chỉnh (theo từng thứ)' }, ...scheduleOptions]
    : scheduleOptions;

  const chooseSchedule = (value: string) => {
    if (value.startsWith(TEMPLATE_PREFIX)) {
      patch({ source: 'TEMPLATE', templateId: value.slice(TEMPLATE_PREFIX.length) });
    } else if (value.startsWith(SHIFT_PREFIX)) {
      const shiftId = value.slice(SHIFT_PREFIX.length);
      // Giữ thứ bảy, chủ nhật đã chỉnh ở phần nâng cao; từ mẫu chuyển sang thì bắt đầu từ lịch trống.
      const base = draft.source === 'PATTERN' ? draft.pattern : emptyPattern();
      patch({ source: 'PATTERN', templateId: '', pattern: applyShortcut(base, WEEKDAYS_MON_FRI, { kind: 'SHIFT', shiftId }) });
    } else if (!value) {
      patch(draft.source === 'TEMPLATE' ? { templateId: '' } : { pattern: emptyPattern() });
    }
  };

  const scheduleHint =
    draft.source === 'TEMPLATE'
      ? selectedTemplate
        ? `Lịch tuần của mẫu: ${summarizePattern(selectedTemplate.days, shifts)}.`
        : 'Chọn một ca đã khai báo trong Danh mục ca hoặc một mẫu lịch tuần đã lưu.'
      : hasAnyDay
        ? `Lịch tuần sẽ lưu: ${summarizePattern(draft.pattern, shifts)}. Ca chọn ở đây áp dụng cho Thứ hai đến Thứ sáu; thứ bảy, chủ nhật chỉnh ở Tuỳ chọn nâng cao.`
        : 'Có thể chọn ca đã khai báo trong Danh mục ca (áp dụng Thứ hai đến Thứ sáu) hoặc một mẫu lịch tuần.';

  function cancel() {
    flow.reset();
    setRequested(false);
    setDone(null);
  }

  async function primary() {
    if (previewData) {
      await flow.save();
      return;
    }
    const error = validateDraftStep(draft, 1) ?? validateDraftStep(draft, 2) ?? validateDraftStep(draft, 3);
    if (error) {
      flow.setStepError(error);
      return;
    }
    flow.setStepError('');
    flow.setConfirmed(false);
    flow.setServerReasons([]);
    setDone(null);
    setRequested(true);
    await flow.runPreview(draft);
  }

  const showPreview = requested && (previewing || previewData || flow.problem);
  const primaryLabel = applying ? 'Đang lưu…' : previewing ? 'Đang kiểm tra…' : previewData ? 'Lưu phân ca' : 'Xác nhận phân ca';
  const primaryDisabled = previewing || applying || (previewData ? !flow.canSave : false);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SettingsSection
        icon={Users}
        tone="blue"
        title="Thông tin phân ca"
        description="Thiết lập phạm vi, ca làm việc và ngày hiệu lực áp dụng."
      >
        <div className="flex flex-col gap-4">
          <ScopeCards
            value={draft.scope}
            onChange={(scope) => patch({ scope })}
            allowedTypes={scopeTypes}
            employeeOptions={employeeOptions}
            employeesLoading={employeesLoading}
            employeesError={employeesError}
            units={units}
            openEnded={flow.openEnded}
          />

          <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
            <Field label="Ca làm việc" required hint={scheduleHint}>
              <SearchableSelect
                height={36}
                options={selectOptions}
                value={scheduleValue}
                placeholder="Chọn ca làm việc…"
                emptyText="Không tìm thấy ca phù hợp"
                onChange={chooseSchedule}
                clearable={false}
              />
            </Field>
            <Field label="Ngày hiệu lực" required>
              <DatePickerInput
                aria-label="Ngày hiệu lực"
                height={36}
                value={draft.fromDate}
                onChange={(fromDate) => patch({ fromDate })}
              />
            </Field>
          </div>

          <Field label="Ghi chú">
            <div className="relative">
              <Input
                aria-label="Ghi chú"
                className="h-9 pr-16"
                maxLength={REASON_MAX}
                placeholder="Nhập ghi chú (không bắt buộc)"
                value={draft.reason}
                onChange={(e) => patch({ reason: e.target.value })}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-slate-400"
              >
                {draft.reason.length}/{REASON_MAX}
              </span>
            </div>
          </Field>

          <div className="rounded-lg border border-slate-200">
            <button
              type="button"
              aria-expanded={advancedOpen}
              aria-controls="assign-advanced"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-full cursor-pointer items-start gap-2 px-3 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {advancedOpen ? (
                <ChevronDown className="mt-0.5 size-4 shrink-0" aria-hidden />
              ) : (
                <ChevronRight className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                Tuỳ chọn nâng cao
                <span className="ml-2 font-normal text-slate-500">
                  Lịch tuần từng thứ, ngày kết thúc, cách xử lý ngày đã có lịch
                </span>
              </span>
            </button>
            {advancedOpen ? (
              <div id="assign-advanced" className="flex flex-col gap-5 border-t border-slate-200 p-3 @xl:p-4">
                {draft.source === 'TEMPLATE' ? (
                  <div className="flex flex-col gap-2">
                    <div className="text-xs font-semibold text-slate-700">Lịch tuần từng thứ</div>
                    <InfoNote tone="slate">
                      Đang dùng mẫu lịch tuần{selectedTemplate ? ` ${selectedTemplate.name}` : ''}. Muốn đặt ca cho từng thứ,
                      chuyển sang chỉnh tay.
                    </InfoNote>
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          patch({ source: 'PATTERN', pattern: patternFromRules(selectedTemplate?.days), templateId: '' })
                        }
                      >
                        Chỉnh từng thứ
                      </Button>
                    </div>
                  </div>
                ) : (
                  <WeeklyPatternEditor pattern={draft.pattern} onChange={(pattern) => patch({ pattern })} shifts={shifts} />
                )}

                <div className="flex flex-col gap-3">
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
                  {draft.openEnded ? (
                    <InfoNote tone="blue">{OPEN_ENDED_HINT}</InfoNote>
                  ) : (
                    <Field label="Đến ngày" hint="Tối đa 366 ngày mỗi lần áp dụng." className="max-w-xs">
                      <DatePickerInput
                        aria-label="Đến ngày"
                        value={draft.toDate}
                        onChange={(toDate) => patch({ toDate })}
                        height={36}
                      />
                    </Field>
                  )}
                </div>

                <ConflictModePicker
                  value={draft.conflictMode}
                  onChange={(conflictMode) => patch({ conflictMode })}
                  canCalendar={canCalendar}
                  openEnded={flow.openEnded}
                />
              </div>
            ) : null}
          </div>

          {flow.stepError ? <Notice tone="error">{flow.stepError}</Notice> : null}

          <div className="flex flex-wrap items-stretch gap-3">
            <InfoNote tone="blue" className="min-w-0 flex-1 basis-64 items-center">
              Ca mới sẽ áp dụng từ ngày hiệu lực đã chọn; lịch sử phân ca trước đó được lưu lại.
            </InfoNote>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" size="lg" className="px-4" onClick={cancel} disabled={applying}>
                Hủy
              </Button>
              <Button size="lg" className="px-4 font-semibold" disabled={primaryDisabled} onClick={() => void primary()}>
                {primaryLabel}
              </Button>
            </div>
          </div>
        </div>
      </SettingsSection>

      {showPreview ? (
        <div ref={previewRef}>
          <SettingsSection
            icon={Eye}
            tone="amber"
            title="Xem trước kết quả"
            description="Kiểm tra phạm vi ảnh hưởng, xung đột và xác nhận trước khi lưu."
            actions={
              <Button variant="outline" size="sm" disabled={previewing || applying} onClick={() => void flow.runPreview(draft)}>
                Xem trước lại
              </Button>
            }
          >
            <AssignPreviewSection
              flow={flow}
              shifts={shifts}
              selectedTemplate={selectedTemplate}
              canCalendar={canCalendar}
              onUseFixedRange={() => {
                patch({ openEnded: false });
                setAdvancedOpen(true);
                setRequested(false);
              }}
            />
          </SettingsSection>
        </div>
      ) : null}

      {done ? (
        <SettingsSection
          icon={Users}
          tone="green"
          title="Kết quả phân ca"
          actions={
            <Button variant="ghost" size="icon-sm" aria-label="Đóng kết quả" onClick={() => setDone(null)}>
              <X className="size-4" aria-hidden />
            </Button>
          }
        >
          <AssignResultSection result={done} />
        </SettingsSection>
      ) : null}
    </div>
  );
}
