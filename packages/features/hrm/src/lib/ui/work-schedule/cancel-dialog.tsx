'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HrmOrgUnitOption } from '@enterprise-platform/contracts-hrm';
import { Popconfirm, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import {
  allowedScopeTypes,
  buildScope,
  classifyScheduleError,
  emptyScopeDraft,
  formatVnDate,
  todayIso,
  addDays,
  validateDateRange,
  validateScopeDraft,
  type ScopeDraft,
} from '../../hrm-work-schedule-model';
import {
  cancelSchedule,
  type CancelScheduleResult,
} from '../../hrm-work-schedule-api';
import { Button } from '../button';
import { DatePickerInput } from '../date-picker-input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { toast } from '../toast';
import { Checkbox, Field, Notice, Spinner, textareaClass } from './common';
import { ScopePicker } from './scope-picker';

/** Hủy lịch trong một khoảng ngày: luôn xem phạm vi ảnh hưởng (dry-run) rồi mới xác nhận. */
export function CancelScheduleDialog({
  open,
  onOpenChange,
  units,
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
  units: readonly HrmOrgUnitOption[];
  employeeOptions: readonly SearchableSelectOption[];
  employeesLoading: boolean;
  employeesError: string;
  canBulk: boolean;
  canCalendar: boolean;
  initial?: { employeeId?: string };
  onDone: () => void;
}) {
  const [scope, setScope] = useState<ScopeDraft>(emptyScopeDraft('EMPLOYEE'));
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(addDays(todayIso(), 6));
  const [includeExceptions, setIncludeExceptions] = useState(false);
  const [reason, setReason] = useState('');
  const [impact, setImpact] = useState<{ key: string; data: CancelScheduleResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const next = emptyScopeDraft('EMPLOYEE');
    if (initial?.employeeId) next.employeeIds = [initial.employeeId];
    setScope(next);
    setFromDate(todayIso());
    setToDate(addDays(todayIso(), 6));
    setIncludeExceptions(false);
    setReason('');
    setImpact(null);
    setError('');
    // Chỉ khởi tạo lại khi mở hộp thoại.
  }, [open]);

  const body = useMemo(
    () => ({
      scope: buildScope(scope),
      fromDate,
      toDate,
      includeExceptions: canCalendar && includeExceptions,
      reason: reason.trim() || null,
    }),
    [scope, fromDate, toDate, includeExceptions, reason, canCalendar],
  );
  const key = JSON.stringify(body);
  const current = impact && impact.key === key ? impact.data : null;

  async function inspect() {
    const invalid = validateScopeDraft(scope) ?? validateDateRange(fromDate, toDate);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await cancelSchedule({ ...body, dryRun: true });
      setImpact({ key, data: res.data });
    } catch (e) {
      setImpact(null);
      setError(classifyScheduleError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    setBusy(true);
    setError('');
    try {
      const res = await cancelSchedule({ ...body, confirm: true, dryRun: false });
      toast.success(
        `Đã hủy ${res.data.dayCount} ngày lịch của ${res.data.employeeCount} nhân viên.`,
      );
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(classifyScheduleError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(88dvh,720px)] max-w-3xl" aria-label="Hủy lịch">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-4">
          <DialogTitle className="text-lg">Hủy lịch</DialogTitle>
          <DialogDescription>
            Gỡ lịch đã phân trong khoảng ngày. Hệ thống luôn cho xem phạm vi ảnh hưởng trước khi hủy.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
          <ScopePicker
            value={scope}
            onChange={(next) => setScope(next)}
            allowedTypes={allowedScopeTypes(canBulk)}
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
          {canCalendar ? (
            <Checkbox
              checked={includeExceptions}
              onChange={setIncludeExceptions}
              label="Hủy cả ngày ngoại lệ (mặc định giữ lại ngoại lệ)"
            />
          ) : null}
          <Field label="Lý do (tuỳ chọn)" className="max-w-xl">
            <textarea
              className={textareaClass}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {busy && !current ? <Spinner label="Đang kiểm tra phạm vi…" /> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {current ? (
            <Notice tone="warn" title="Phạm vi ảnh hưởng">
              Sẽ hủy <strong>{current.dayCount}</strong> ngày lịch của <strong>{current.employeeCount}</strong> nhân
              viên trong khoảng {formatVnDate(fromDate)} - {formatVnDate(toDate)}.
              {current.keptProtected > 0
                ? ` ${current.keptProtected} ngày ngoại lệ hoặc ngày lễ được giữ lại.`
                : ''}
            </Notice>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void inspect()}>
              Xem phạm vi ảnh hưởng
            </Button>
            <Popconfirm
              title="Hủy lịch đã chọn?"
              description="Lịch trong phạm vi vừa xem sẽ bị gỡ và ghi vào lịch sử thay đổi."
              okText="Hủy lịch"
              cancelText="Không hủy"
              okType="danger"
              placement="top-end"
              disabled={!current || busy || current.dayCount === 0}
              onConfirm={confirmCancel}
            >
              <Button variant="destructive" disabled={!current || busy || current.dayCount === 0}>
                Hủy lịch
              </Button>
            </Popconfirm>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
