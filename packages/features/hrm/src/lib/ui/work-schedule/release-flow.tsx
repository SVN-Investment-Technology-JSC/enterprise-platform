'use client';

import { useCallback, useMemo, useState } from 'react';
import { UserMinus } from 'lucide-react';
import type { HrmOrgUnitOption } from '@enterprise-platform/contracts-hrm';
import { Popconfirm, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import {
  addDays,
  allowedScopeTypes,
  buildScope,
  classifyScheduleError,
  emptyScopeDraft,
  formatVnDate,
  todayIso,
  validateDateRange,
  validateScopeDraft,
  type ScopeDraft,
} from '../../hrm-work-schedule-model';
import { cancelSchedule, type CancelScheduleResult } from '../../hrm-work-schedule-api';
import { Button } from '../button';
import { DatePickerInput } from '../date-picker-input';
import { Input } from '../input';
import { InfoNote, SettingsSection } from '../settings-kit';
import { toast } from '../toast';
import { Checkbox, Field, Notice, Spinner } from './common';
import { ScopeCards } from './scope-cards';

const REASON_MAX = 500;

/**
 * Luồng "Nhả ca" (hủy lịch trong một khoảng ngày) dùng chung cho hộp thoại và biểu mẫu trong trang:
 * luôn xem phạm vi ảnh hưởng (dry-run) rồi mới xác nhận hủy.
 */
export function useReleaseFlow({
  canCalendar,
  initial,
  onDone,
}: {
  canCalendar: boolean;
  initial?: { employeeId?: string };
  onDone: () => void;
}) {
  const initialEmployeeId = initial?.employeeId;
  const freshScope = useCallback(() => {
    const next = emptyScopeDraft('EMPLOYEE');
    if (initialEmployeeId) next.employeeIds = [initialEmployeeId];
    return next;
  }, [initialEmployeeId]);
  const [scope, setScope] = useState<ScopeDraft>(freshScope);
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(addDays(todayIso(), 6));
  const [includeExceptions, setIncludeExceptions] = useState(false);
  const [reason, setReason] = useState('');
  const [impact, setImpact] = useState<{ key: string; data: CancelScheduleResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setScope(freshScope());
    setFromDate(todayIso());
    setToDate(addDays(todayIso(), 6));
    setIncludeExceptions(false);
    setReason('');
    setImpact(null);
    setError('');
  }, [freshScope]);

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

  /** Trả về true khi đã nhả ca thành công. */
  async function confirm(): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      const res = await cancelSchedule({ ...body, confirm: true, dryRun: false });
      toast.success(`Đã hủy ${res.data.dayCount} ngày lịch của ${res.data.employeeCount} nhân viên.`);
      onDone();
      return true;
    } catch (e) {
      setError(classifyScheduleError(e).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    scope,
    setScope,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    includeExceptions,
    setIncludeExceptions,
    reason,
    setReason,
    current,
    busy,
    error,
    inspect,
    confirm,
    reset,
    canConfirm: !!current && !busy && current.dayCount > 0,
  };
}

export type ReleaseFlow = ReturnType<typeof useReleaseFlow>;

export interface ReleaseCatalog {
  units: readonly HrmOrgUnitOption[];
  employeeOptions: readonly SearchableSelectOption[];
  employeesLoading: boolean;
  employeesError: string;
  canBulk: boolean;
  canCalendar: boolean;
}

/** Các ô nhập của Nhả ca: phạm vi, khoảng ngày, ngoại lệ, lý do. */
export function ReleaseFields({ flow, catalog }: { flow: ReleaseFlow; catalog: ReleaseCatalog }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ScopeCards
        value={flow.scope}
        onChange={flow.setScope}
        allowedTypes={allowedScopeTypes(catalog.canBulk)}
        employeeOptions={catalog.employeeOptions}
        employeesLoading={catalog.employeesLoading}
        employeesError={catalog.employeesError}
        units={catalog.units}
        openEnded
      />
      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2">
        <Field label="Từ ngày" required>
          <DatePickerInput
            aria-label="Từ ngày"
            className="[&_input[type=text]]:h-9"
            value={flow.fromDate}
            onChange={flow.setFromDate}
          />
        </Field>
        <Field label="Đến ngày" required>
          <DatePickerInput
            aria-label="Đến ngày"
            className="[&_input[type=text]]:h-9"
            value={flow.toDate}
            onChange={flow.setToDate}
          />
        </Field>
      </div>
      {catalog.canCalendar ? (
        <Checkbox
          checked={flow.includeExceptions}
          onChange={flow.setIncludeExceptions}
          label="Hủy cả ngày ngoại lệ (mặc định giữ lại ngoại lệ)"
        />
      ) : null}
      <Field label="Lý do">
        <div className="relative">
          <Input
            aria-label="Lý do"
            className="h-9 pr-16"
            maxLength={REASON_MAX}
            placeholder="Nhập lý do (không bắt buộc)"
            value={flow.reason}
            onChange={(e) => flow.setReason(e.target.value)}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-slate-400"
          >
            {flow.reason.length}/{REASON_MAX}
          </span>
        </div>
      </Field>
    </div>
  );
}

/** Đang kiểm tra, lỗi và phạm vi ảnh hưởng của lần xem trước hiện tại. */
export function ReleaseStatus({ flow }: { flow: ReleaseFlow }) {
  const { current } = flow;
  return (
    <>
      {flow.busy && !current ? <Spinner label="Đang kiểm tra phạm vi…" /> : null}
      {flow.error ? <Notice tone="error">{flow.error}</Notice> : null}
      {current ? (
        <Notice tone="warn" title="Phạm vi ảnh hưởng">
          Sẽ hủy <strong>{current.dayCount}</strong> ngày lịch của <strong>{current.employeeCount}</strong> nhân viên
          trong khoảng {formatVnDate(flow.fromDate)} - {formatVnDate(flow.toDate)}.
          {current.keptProtected > 0 ? ` ${current.keptProtected} ngày ngoại lệ hoặc ngày lễ được giữ lại.` : ''}
        </Notice>
      ) : null}
    </>
  );
}

/** Nút xác nhận nhả ca (có hỏi lại tại chỗ bằng Popconfirm, như luồng hủy lịch cũ). */
export function ReleaseConfirmButton({
  flow,
  onConfirmed,
  label = 'Xác nhận nhả ca',
}: {
  flow: ReleaseFlow;
  onConfirmed: () => void;
  label?: string;
}) {
  return (
    <Popconfirm
      title="Nhả ca đã chọn?"
      description="Lịch trong phạm vi vừa xem sẽ bị gỡ và ghi vào lịch sử thay đổi."
      okText="Nhả ca"
      cancelText="Không"
      okType="danger"
      placement="top-end"
      disabled={!flow.canConfirm}
      onConfirm={async () => {
        if (await flow.confirm()) onConfirmed();
      }}
    >
      <Button variant="destructive" size="lg" className="px-4 font-semibold" disabled={!flow.canConfirm}>
        {label}
      </Button>
    </Popconfirm>
  );
}

/** Biểu mẫu Nhả ca trong trang (tab "Nhả ca"). */
export function ReleaseInlineForm({ catalog, onDone }: { catalog: ReleaseCatalog; onDone: () => void }) {
  const flow = useReleaseFlow({ canCalendar: catalog.canCalendar, onDone });
  const [doneText, setDoneText] = useState('');
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SettingsSection
        icon={UserMinus}
        tone="orange"
        title="Thông tin nhả ca"
        description="Gỡ lịch đã phân (hủy lịch) cho nhân viên trong một khoảng ngày."
      >
        <div className="flex flex-col gap-4">
          <ReleaseFields flow={flow} catalog={catalog} />
          <ReleaseStatus flow={flow} />
          {doneText ? <Notice tone="success">{doneText}</Notice> : null}
          <div className="flex flex-wrap items-stretch gap-3">
            <InfoNote tone="amber" className="min-w-0 flex-1 basis-64 items-center">
              Luôn xem phạm vi ảnh hưởng trước khi nhả ca; ngày ngoại lệ và ngày lễ được giữ lại theo mặc định.
            </InfoNote>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="outline"
                size="lg"
                className="px-4"
                disabled={flow.busy}
                onClick={() => {
                  flow.reset();
                  setDoneText('');
                }}
              >
                Hủy
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="px-4"
                disabled={flow.busy}
                onClick={() => {
                  setDoneText('');
                  void flow.inspect();
                }}
              >
                Xem phạm vi ảnh hưởng
              </Button>
              <ReleaseConfirmButton
                flow={flow}
                onConfirmed={() => {
                  const text = flow.current
                    ? `Đã nhả ${flow.current.dayCount} ngày lịch của ${flow.current.employeeCount} nhân viên.`
                    : 'Đã nhả ca.';
                  flow.reset();
                  setDoneText(text);
                }}
              />
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
