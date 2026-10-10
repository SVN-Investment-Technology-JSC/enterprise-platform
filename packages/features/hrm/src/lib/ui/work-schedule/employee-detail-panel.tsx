'use client';

import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  HrmScheduleDay,
  HrmScheduleEmployee,
  HrmScheduleRule,
} from '@enterprise-platform/contracts-hrm';
import {
  DAY_TYPE_LABELS,
  SOURCE_LABELS,
  formatVnDate,
  groupEmployeeRuns,
  ruleRangeText,
  summarizeRuleDays,
  todayIso,
} from '../../hrm-work-schedule-model';
import { fetchRules } from '../../hrm-work-schedule-api';
import { Button } from '../button';
import { AuditEntries } from './audit-drawer';

/** Cột chi tiết bên phải (master-detail): lịch trong kỳ đang xem và lịch sử của một nhân viên. */
export function EmployeeDetailPanel({
  employee,
  days,
  rangeText,
  canException,
  canCancel,
  canCopy,
  onClose,
  onException,
  onCancel,
  onCopy,
}: {
  employee: HrmScheduleEmployee;
  days: readonly HrmScheduleDay[];
  rangeText: string;
  canException: boolean;
  canCancel: boolean;
  canCopy: boolean;
  onClose: () => void;
  onException: () => void;
  onCancel: () => void;
  onCopy: () => void;
}) {
  const runs = useMemo(() => groupEmployeeRuns(days), [days]);
  // Lịch định kỳ riêng của nhân viên đang có hiệu lực hôm nay (lịch của đơn vị/công ty hiện qua các ngày trên lưới).
  const [rules, setRules] = useState<HrmScheduleRule[]>([]);
  useEffect(() => {
    let alive = true;
    setRules([]);
    fetchRules({ employeeId: employee.employeeId, status: 'ACTIVE', activeOn: todayIso() })
      .then((res) => alive && setRules(res.data))
      .catch(() => alive && setRules([]));
    return () => {
      alive = false;
    };
  }, [employee.employeeId]);
  return (
    <aside
      aria-label={`Chi tiết lịch của ${employee.name}`}
      className="flex min-h-0 w-[380px] shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white 2xl:w-[420px]"
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="min-w-0">
          <div className="font-mono text-[11px] font-semibold text-blue-700">{employee.code}</div>
          <div className="truncate text-sm font-bold text-slate-900">{employee.name}</div>
          <div className="truncate text-[11px] text-slate-500">{employee.unitName ?? 'Chưa gán đơn vị'}</div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Đóng chi tiết nhân viên" onClick={onClose}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2">
        {canException ? (
          <Button size="sm" variant="outline" onClick={onException}>
            Thiết lập ngoại lệ
          </Button>
        ) : null}
        {canCancel ? (
          <Button size="sm" variant="outline" onClick={onCancel}>
            Hủy lịch
          </Button>
        ) : null}
        {canCopy ? (
          <Button size="sm" variant="outline" onClick={onCopy}>
            Sao chép lịch
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {rules.length > 0 ? (
          <div className="mb-4" data-testid="employee-rules">
            <div className="text-xs font-bold text-slate-900">Lịch định kỳ đang áp dụng</div>
            <ul className="mt-2 flex flex-col gap-1">
              {rules.map((rule) => (
                <li key={rule.id} className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-900">
                  <div className="font-semibold">{summarizeRuleDays(rule.days)}</div>
                  <div className="text-[11px] text-sky-700">
                    {ruleRangeText(rule.effectiveFrom, rule.effectiveTo)}
                    {rule.templateName ? ` | ${rule.templateName}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="text-xs font-bold text-slate-900">Lịch trong kỳ ({rangeText})</div>
        {runs.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">Chưa có lịch trong kỳ đang xem.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {runs.map((run) => (
              <li
                key={`${run.from}-${run.dayType}-${run.shiftCode}-${run.source}`}
                className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1 text-xs"
              >
                <span className="whitespace-nowrap">
                  {formatVnDate(run.from)}
                  {run.to !== run.from ? ` - ${formatVnDate(run.to)}` : ''}
                </span>
                <span className="truncate font-semibold">
                  {run.dayType === 'SHIFT' ? run.shiftCode : DAY_TYPE_LABELS[run.dayType]}
                </span>
                <span className="text-[11px] text-slate-500">{SOURCE_LABELS[run.source]}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 text-xs font-bold text-slate-900">Lịch sử thay đổi</div>
        <div className="mt-2">
          <AuditEntries employeeId={employee.employeeId} limit={30} />
        </div>
      </div>
    </aside>
  );
}
