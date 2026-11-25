'use client';
import { useEffect, useMemo, useState } from 'react';
import type { HrmReportOptions } from '@enterprise-platform/contracts-hrm';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../../hrm-api';
import { currentMonthVn } from '../../hrm-timesheet-format';
import { monthBounds } from '../../report-model';
import { DatePickerInput } from '../date-picker-input';
import { MonthStepper } from '../month-stepper';
import { MultiPicker } from './multi-picker';

/** Phạm vi của báo cáo: thời gian (cả tháng hoặc khoảng ngày) và đối tượng (phòng ban, nhân viên). */
export interface ReportScope {
  mode: 'month' | 'range';
  month: string;
  from: string;
  to: string;
  departmentIds: string[];
  employeeIds: string[];
}

export function initialScope(): ReportScope {
  const month = currentMonthVn();
  const { from, to } = monthBounds(month);
  return { mode: 'month', month, from, to, departmentIds: [], employeeIds: [] };
}

/** Khoảng ngày đang áp dụng: theo tháng hoặc theo hai ô ngày. */
export function scopeRange(scope: ReportScope): { from: string; to: string } {
  return scope.mode === 'month' ? monthBounds(scope.month) : { from: scope.from, to: scope.to };
}

/** Tải một lần danh sách phòng ban, nhân viên, loại phép cho bộ lọc. */
export function useReportOptions(): { options: HrmReportOptions | null; error: string } {
  const [options, setOptions] = useState<HrmReportOptions | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    hrmFetch<{ data: HrmReportOptions }>('/reports/filter-options')
      .then((r) => live && setOptions(r.data))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Không tải được danh sách lọc'));
    return () => {
      live = false;
    };
  }, []);
  return { options, error };
}

const MODE_OPTIONS = [
  { value: 'month', label: 'Theo tháng' },
  { value: 'range', label: 'Khoảng ngày' },
];

export function ReportScopeBar({
  scope,
  onChange,
  options,
  hideRange = false,
}: {
  scope: ReportScope;
  onChange: (next: ReportScope) => void;
  options: HrmReportOptions | null;
  /** Bảng chấm công luôn theo tháng nên ẩn lựa chọn khoảng ngày. */
  hideRange?: boolean;
}) {
  const departmentOptions = useMemo(() => (options?.departments ?? []).map((d) => ({ value: d.id, label: d.name })), [options]);
  // Chọn phòng ban thì danh sách nhân viên thu gọn theo các phòng ban đó.
  const employeeOptions = useMemo(() => {
    const scoped = (options?.employees ?? []).filter(
      (e) => scope.departmentIds.length === 0 || (e.departmentId !== null && scope.departmentIds.includes(e.departmentId)),
    );
    return scoped.map((e) => ({ value: e.id, label: e.name, hint: e.code }));
  }, [options, scope.departmentIds]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      {hideRange ? null : (
        <div className="flex w-36 flex-col gap-1 text-[11px] font-semibold text-slate-600">
          <span>Phạm vi thời gian</span>
          <SearchableSelect
            options={MODE_OPTIONS}
            value={scope.mode}
            height={36}
            searchInDropdown
            hideDropdownSearch
            onChange={(v) => onChange({ ...scope, mode: v === 'range' ? 'range' : 'month' })}
          />
        </div>
      )}
      {scope.mode === 'month' || hideRange ? (
        <div className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
          <span>Tháng</span>
          <MonthStepper month={scope.month} onChange={(month) => onChange({ ...scope, month })} />
        </div>
      ) : (
        <>
          <div className="flex w-40 flex-col gap-1 text-[11px] font-semibold text-slate-600">
            <span>Từ ngày</span>
            <DatePickerInput aria-label="Từ ngày" value={scope.from} onChange={(from) => onChange({ ...scope, from })} />
          </div>
          <div className="flex w-40 flex-col gap-1 text-[11px] font-semibold text-slate-600">
            <span>Đến ngày</span>
            <DatePickerInput aria-label="Đến ngày" value={scope.to} onChange={(to) => onChange({ ...scope, to })} />
          </div>
        </>
      )}
      <MultiPicker
        label="Phòng ban"
        options={departmentOptions}
        selected={scope.departmentIds}
        searchable
        onChange={(departmentIds) => {
          const allowed = new Set(
            (options?.employees ?? [])
              .filter((e) => departmentIds.length === 0 || (e.departmentId !== null && departmentIds.includes(e.departmentId)))
              .map((e) => e.id),
          );
          onChange({ ...scope, departmentIds, employeeIds: scope.employeeIds.filter((id) => allowed.has(id)) });
        }}
      />
      <MultiPicker
        label="Nhân viên"
        options={employeeOptions}
        selected={scope.employeeIds}
        searchable
        onChange={(employeeIds) => onChange({ ...scope, employeeIds })}
      />
    </div>
  );
}
