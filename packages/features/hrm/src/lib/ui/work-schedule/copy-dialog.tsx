'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HrmOrgUnitOption, HrmScheduleConflictMode } from '@enterprise-platform/contracts-hrm';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import {
  addDays,
  buildScope,
  classifyScheduleError,
  emptyScopeDraft,
  todayIso,
  validateDateRange,
  validateScopeDraft,
  type ScopeDraft,
} from '../../hrm-work-schedule-model';
import { copySchedule, type CopyScheduleResult } from '../../hrm-work-schedule-api';
import { Button } from '../button';
import { DatePickerInput } from '../date-picker-input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { toast } from '../toast';
import { ConflictModePicker } from './conflict-mode-picker';
import { Checkbox, Field, Notice, Spinner, textareaClass } from './common';
import { SummaryStats } from './preview-panel';
import { ScopePicker } from './scope-picker';

/** Sao chép lịch từ một nhân viên sang nhóm khác (cần quyền phân ca hàng loạt). */
export function CopyScheduleDialog({
  open,
  onOpenChange,
  units,
  employeeOptions,
  employeesLoading,
  employeesError,
  canCalendar,
  initial,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  units: readonly HrmOrgUnitOption[];
  employeeOptions: readonly SearchableSelectOption[];
  employeesLoading: boolean;
  employeesError: string;
  canCalendar: boolean;
  initial?: { employeeId?: string };
  onDone: () => void;
}) {
  const [sourceId, setSourceId] = useState('');
  const [scope, setScope] = useState<ScopeDraft>(emptyScopeDraft('EMPLOYEES'));
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(addDays(todayIso(), 29));
  const [conflictMode, setConflictMode] = useState<HrmScheduleConflictMode>('REPORT');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ key: string; data: CopyScheduleResult } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSourceId(initial?.employeeId ?? '');
    setScope(emptyScopeDraft('EMPLOYEES'));
    setFromDate(todayIso());
    setToDate(addDays(todayIso(), 29));
    setConflictMode('REPORT');
    setReason('');
    setPreview(null);
    setConfirmed(false);
    setError('');
    // Chỉ khởi tạo lại khi mở hộp thoại.
  }, [open]);

  const body = useMemo(
    () => ({
      sourceEmployeeId: sourceId,
      scope: buildScope(scope),
      fromDate,
      toDate,
      conflictMode,
      reason: reason.trim() || null,
    }),
    [sourceId, scope, fromDate, toDate, conflictMode, reason],
  );
  const key = JSON.stringify(body);
  const current = preview && preview.key === key ? preview.data : null;

  async function inspect() {
    const invalid =
      (sourceId ? null : 'Chọn nhân viên nguồn.') ??
      validateScopeDraft(scope) ??
      validateDateRange(fromDate, toDate);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError('');
    setConfirmed(false);
    try {
      const res = await copySchedule({ ...body, dryRun: true });
      setPreview({ key, data: res.data });
    } catch (e) {
      setPreview(null);
      setError(classifyScheduleError(e).message);
    } finally {
      setBusy(false);
    }
  }

  const conflicts = current?.summary.conflicts ?? 0;
  const canSave =
    !!current &&
    !busy &&
    conflicts === 0 &&
    current.summary.insert + current.summary.replace > 0 &&
    (!current.requiresConfirmation || confirmed);

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError('');
    try {
      const res = await copySchedule({
        ...body,
        dryRun: false,
        ...(current?.requiresConfirmation ? { confirm: true } : {}),
      });
      toast.success(
        `Đã sao chép lịch cho ${res.data.summary.employees} nhân viên (${res.data.summary.insert + res.data.summary.replace} ngày).`,
      );
      onDone();
      onOpenChange(false);
    } catch (e) {
      const info = classifyScheduleError(e);
      setError(info.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(88dvh,780px)] max-w-3xl" aria-label="Sao chép lịch">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-4">
          <DialogTitle className="text-lg">Sao chép lịch</DialogTitle>
          <DialogDescription>
            Lấy lịch của một nhân viên trong khoảng ngày và áp dụng cho nhóm nhân viên khác.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
          <Field label="Nhân viên nguồn">
            <SearchableSelect
              options={employeeOptions}
              value={sourceId}
              placeholder={employeesLoading ? 'Đang tải danh sách nhân viên…' : 'Tìm nhân viên có lịch cần sao chép…'}
              disabled={employeesLoading}
              onChange={setSourceId}
            />
          </Field>
          <div className="text-xs font-semibold text-slate-700">Sao chép tới</div>
          <ScopePicker
            value={scope}
            onChange={setScope}
            allowedTypes={['EMPLOYEES', 'UNIT', 'COMPANY']}
            employeeOptions={employeeOptions}
            employeesLoading={employeesLoading}
            employeesError={employeesError}
            units={units}
          />
          <div className="grid max-w-xl grid-cols-2 gap-4">
            <Field label="Từ ngày">
              <DatePickerInput aria-label="Từ ngày" value={fromDate} onChange={setFromDate} />
            </Field>
            <Field label="Đến ngày">
              <DatePickerInput aria-label="Đến ngày" value={toDate} onChange={setToDate} />
            </Field>
          </div>
          <ConflictModePicker value={conflictMode} onChange={setConflictMode} canCalendar={canCalendar} />
          <Field label="Lý do (tuỳ chọn)" className="max-w-xl">
            <textarea className={textareaClass} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {busy && !current ? <Spinner label="Đang kiểm tra…" /> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {current ? (
            <div className="flex flex-col gap-2">
              <SummaryStats summary={current.summary} employeeCount={current.summary.employees} />
              {conflicts > 0 ? (
                <Notice tone="warn">
                  Có {conflicts} ngày đã có lịch khác. Chọn cách xử lý ở trên rồi bấm Xem trước lại.
                </Notice>
              ) : null}
              {current.requiresConfirmation ? (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <ul className="list-disc pl-5 text-xs text-amber-800">
                    {current.confirmReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <Checkbox checked={confirmed} onChange={setConfirmed} label="Tôi đã xem lại phạm vi và đồng ý áp dụng" />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void inspect()}>
              {current ? 'Xem trước lại' : 'Xem trước'}
            </Button>
            <Button disabled={!canSave} onClick={() => void save()}>
              Sao chép lịch
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
