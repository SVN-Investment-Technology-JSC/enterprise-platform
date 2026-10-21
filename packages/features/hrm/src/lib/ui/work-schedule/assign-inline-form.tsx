'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, Users, X } from 'lucide-react';
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
  SCOPE_TYPE_LABELS,
  allowedScopeTypes,
  emptyAssignDraft,
  formatVnDate,
  patternFromRules,
  summarizePattern,
  validateDraftStep,
  type AnyApplyResult,
  type ScopeDraft,
} from '../../hrm-work-schedule-model';
import { Button } from '../button';
import { DatePickerInput } from '../date-picker-input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { Input } from '../input';
import { InfoNote, SettingsSection } from '../settings-kit';
import { AssignPreviewSection, AssignResultSection, useAssignFlow } from './assign-flow';
import { Checkbox, Field, Notice } from './common';
import { ConflictModePicker } from './conflict-mode-picker';
import { ScopeSelect } from './scope-cards';
import { WeeklyPatternEditor } from './weekly-pattern-editor';

const REASON_MAX = 500;

const SOURCE_OPTIONS = [
  { value: 'PATTERN', label: 'Cấu hình lịch tuần' },
  { value: 'TEMPLATE', label: 'Dùng mẫu lịch đã lưu' },
] as const;

/** Mô tả đối tượng áp dụng cho hộp thoại tổng quan (Phân ca và Nhả ca). */
export function describeScope(
  scope: ScopeDraft,
  openEnded: boolean,
  employeeOptions: readonly SearchableSelectOption[],
  units: readonly HrmOrgUnitOption[],
): string {
  const employeeName = (id: string) => employeeOptions.find((o) => o.value === id)?.label ?? id;
  const unitName = (id: string) => {
    const unit = units.find((u) => u.id === id);
    return unit ? `${unit.name} (${unit.code})` : id;
  };
  const excluded = openEnded ? 0 : scope.excludeEmployeeIds.length;
  const excludedText = excluded > 0 ? `; loại trừ ${excluded} nhân viên` : '';
  switch (scope.type) {
    case 'EMPLOYEE':
      return scope.employeeIds.map(employeeName).join(', ') || SCOPE_TYPE_LABELS.EMPLOYEE;
    case 'EMPLOYEES':
      return `${scope.employeeIds.length} nhân viên: ${scope.employeeIds.map(employeeName).join(', ')}`;
    case 'UNIT':
      return `${scope.unitIds.map(unitName).join(', ')}${
        scope.includeChildUnits && !openEnded ? ' (gồm các đơn vị con)' : ''
      }${excludedText}`;
    default:
      return `Toàn bộ nhân viên đang làm việc${excludedText}`;
  }
}

export function OverviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 @lg:grid-cols-[9rem_1fr] @lg:gap-3">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="min-w-0 text-xs break-words text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * Biểu mẫu Phân ca trong trang: đối tượng (ô chọn), ngày hiệu lực, ghi chú và "Tuỳ chọn nâng cao" (ca làm việc từng thứ,
 * ngày kết thúc). Bấm "Xác nhận phân ca" để kiểm tra bản nháp rồi mở hộp thoại tổng quan: kết quả xem trước, cách xử lý
 * "Khi ngày đã có lịch khác" và xác nhận (đánh dấu đã xem lại) trước khi "Lưu phân ca". Dùng chung
 * luồng xem trước và lưu với hộp thoại 4 bước (`useAssignFlow`).
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
  const { draft, patch, previewing, applying } = flow;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState<AnyApplyResult | null>(null);

  // Lưu xong: đóng hộp thoại, giữ kết quả để hiển thị và trả biểu mẫu về bản nháp sạch (tránh bấm lưu hai lần).
  useEffect(() => {
    if (!flow.result) return;
    setDone(flow.result);
    setConfirmOpen(false);
    flow.reset();
  }, [flow.result]);

  const activeTemplates = useMemo(() => templates.filter((t) => t.status === 'ACTIVE'), [templates]);
  const selectedTemplate = activeTemplates.find((t) => t.id === draft.templateId);
  const templateOptions: SearchableSelectOption[] = useMemo(
    () => activeTemplates.map((t) => ({ value: t.id, label: `${t.name} (${t.code})`, badge: t.code })),
    [activeTemplates],
  );
  const sourceOptions: SearchableSelectOption[] = SOURCE_OPTIONS.map((o) => ({ ...o }));

  function chooseSource(value: string) {
    if (value === 'TEMPLATE') patch({ source: 'TEMPLATE' });
    else if (value === 'PATTERN') {
      patch({
        source: 'PATTERN',
        pattern: draft.source === 'TEMPLATE' && selectedTemplate ? patternFromRules(selectedTemplate.days) : draft.pattern,
      });
    }
  }

  function cancel() {
    flow.reset();
    setConfirmOpen(false);
    setDone(null);
  }

  function closeConfirm() {
    if (applying) return;
    setConfirmOpen(false);
    flow.setConfirmed(false);
    flow.setServerReasons([]);
  }

  async function openConfirm() {
    const error = validateDraftStep(draft, 1) ?? validateDraftStep(draft, 2) ?? validateDraftStep(draft, 3);
    if (error) {
      flow.setStepError(error);
      return;
    }
    flow.setStepError('');
    flow.setConfirmed(false);
    flow.setServerReasons([]);
    setDone(null);
    setConfirmOpen(true);
    await flow.runPreview(draft);
  }

  const canConfirmSave = flow.canSave && flow.confirmed;
  const timeText = flow.openEnded
    ? `Từ ${formatVnDate(draft.fromDate)}, không có ngày kết thúc (lịch định kỳ)`
    : `Từ ${formatVnDate(draft.fromDate)} đến ${formatVnDate(draft.toDate)}`;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SettingsSection
        icon={Users}
        tone="blue"
        title="Thông tin phân ca"
        description="Chọn đối tượng, ca làm việc và ngày hiệu lực áp dụng."
      >
        <div className="flex flex-col gap-4">
          <ScopeSelect
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
            <div className="flex min-w-0 flex-col gap-3">
              <Field label="Ngày hiệu lực" required>
                <DatePickerInput
                  aria-label="Ngày hiệu lực"
                  height={36}
                  value={draft.fromDate}
                  onChange={(fromDate) => patch({ fromDate })}
                />
              </Field>
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
              {draft.openEnded ? null : (
                <Field label="Đến ngày" hint="Tối đa 366 ngày mỗi lần áp dụng.">
                  <DatePickerInput
                    aria-label="Đến ngày"
                    value={draft.toDate}
                    onChange={(toDate) => patch({ toDate })}
                    height={36}
                  />
                </Field>
              )}
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
          </div>

          {draft.openEnded ? <InfoNote tone="blue">{OPEN_ENDED_HINT}</InfoNote> : null}

          <div className="rounded-lg border border-slate-200">
            <div className="px-3 py-2.5 text-xs font-semibold text-slate-700">
              Tuỳ chọn nâng cao
              <span className="ml-2 font-normal text-slate-500">Ca làm việc từng thứ hoặc theo mẫu lịch tuần</span>
            </div>
            <div id="assign-advanced" className="flex flex-col gap-5 border-t border-slate-200 p-3 @xl:p-4">
              <div className="flex flex-col gap-3">
                <Field
                  label="Ca làm việc"
                  required
                  hint="Ca lấy từ Danh mục ca; chọn ca cho từng thứ hoặc dùng một mẫu lịch tuần đã lưu."
                  className="max-w-sm"
                >
                  <SearchableSelect
                    height={36}
                    options={sourceOptions}
                    value={draft.source}
                    placeholder="Chọn cách thiết lập ca…"
                    emptyText="Không có lựa chọn phù hợp"
                    onChange={chooseSource}
                    clearable={false}
                  />
                </Field>
                {draft.source === 'TEMPLATE' ? (
                  <div className="flex max-w-xl flex-col gap-2">
                    <Field label="Mẫu lịch tuần">
                      <SearchableSelect
                        height={36}
                        options={templateOptions}
                        value={draft.templateId}
                        placeholder="Tìm mẫu lịch theo tên hoặc mã…"
                        emptyText="Chưa có mẫu lịch nào đang hoạt động"
                        onChange={(templateId) => patch({ templateId })}
                      />
                    </Field>
                    {selectedTemplate ? (
                      <InfoNote tone="slate">{summarizePattern(selectedTemplate.days, shifts)}</InfoNote>
                    ) : null}
                  </div>
                ) : (
                  <WeeklyPatternEditor pattern={draft.pattern} onChange={(pattern) => patch({ pattern })} shifts={shifts} />
                )}
              </div>
            </div>
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
              <Button size="lg" className="px-4 font-semibold" disabled={previewing || applying} onClick={() => void openConfirm()}>
                Xác nhận phân ca
              </Button>
            </div>
          </div>
        </div>
      </SettingsSection>

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

      <Dialog open={confirmOpen} onOpenChange={(open) => (open ? setConfirmOpen(true) : closeConfirm())}>
        <DialogContent className="@container h-[min(88dvh,780px)] max-w-3xl" aria-label="Tổng quan phân ca">
          <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-4 pr-12 @lg:px-6">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <CalendarClock className="size-5 text-blue-600" aria-hidden />
              Tổng quan phân ca
            </DialogTitle>
            <DialogDescription>
              Kiểm tra lại phạm vi, kết quả xem trước và cách xử lý ngày đã có lịch trước khi lưu.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 @lg:px-6">
            <dl className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3" data-testid="assign-overview">
              <OverviewRow label="Đối tượng">{describeScope(draft.scope, draft.openEnded, employeeOptions, units)}</OverviewRow>
              <OverviewRow label="Thời gian">{timeText}</OverviewRow>
              {draft.reason.trim() ? <OverviewRow label="Ghi chú">{draft.reason.trim()}</OverviewRow> : null}
            </dl>

            <AssignPreviewSection
              flow={flow}
              shifts={shifts}
              selectedTemplate={selectedTemplate}
              canCalendar={canCalendar}
              hideConflictMode
              hideConfirm
              onUseFixedRange={() => {
                patch({ openEnded: false });
                closeConfirm();
              }}
            />

            <div className="rounded-lg border border-slate-200 p-3">
              <ConflictModePicker
                value={draft.conflictMode}
                onChange={flow.changeConflictMode}
                canCalendar={canCalendar}
                openEnded={flow.openEnded}
              />
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <div className="text-xs font-semibold text-amber-800">Xác nhận trước khi lưu</div>
              {flow.reasons.length > 0 ? (
                <ul className="list-disc pl-5 text-xs text-amber-800">
                  {flow.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
              <Checkbox
                checked={flow.confirmed}
                onChange={flow.setConfirmed}
                label="Tôi đã xem lại phạm vi và đồng ý áp dụng"
              />
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 @lg:px-6">
            <Button variant="outline" onClick={closeConfirm} disabled={applying}>
              Quay lại chỉnh sửa
            </Button>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" disabled={previewing || applying} onClick={() => void flow.runPreview(draft)}>
                Xem trước lại
              </Button>
              <Button disabled={!canConfirmSave} onClick={() => void flow.save()}>
                {applying ? 'Đang lưu…' : previewing ? 'Đang kiểm tra…' : 'Lưu phân ca'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
