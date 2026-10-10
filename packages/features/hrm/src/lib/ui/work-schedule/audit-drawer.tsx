'use client';

import { useEffect, useState } from 'react';
import type { HrmScheduleAuditEntry } from '@enterprise-platform/contracts-hrm';
import {
  auditActionLabel,
  classifyScheduleError,
  formatAuditRuns,
  formatVnDate,
} from '../../hrm-work-schedule-model';
import { fetchScheduleAudit } from '../../hrm-work-schedule-api';
import { Button } from '../button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../sheet';
import { EmptyState, Notice, Spinner } from './common';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AuditEntries({
  employeeId,
  active = true,
  limit = 100,
}: {
  employeeId?: string;
  active?: boolean;
  limit?: number;
}) {
  const [rows, setRows] = useState<HrmScheduleAuditEntry[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    setError('');
    setRows(null);
    fetchScheduleAudit({ employeeId, limit })
      .then((res) => alive && setRows(res.data))
      .catch((e) => alive && setError(classifyScheduleError(e).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [active, employeeId, limit]);

  if (loading && !rows)
    return (
      <EmptyState>
        <Spinner label="Đang tải lịch sử thay đổi…" />
      </EmptyState>
    );
  if (error) return <Notice tone="error">{error}</Notice>;
  if (rows && rows.length === 0) return <EmptyState>Chưa có thay đổi nào được ghi nhận.</EmptyState>;
  return (
    <ol className="flex flex-col gap-3">
      {(rows ?? []).map((entry) => {
        const before = formatAuditRuns(entry.before);
        const after = formatAuditRuns(entry.after);
        return (
          <li key={entry.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold text-slate-900">{auditActionLabel(entry.action)}</span>
              <span className="text-[11px] text-slate-500">{formatDateTime(entry.createdAt)}</span>
            </div>
            <div className="mt-0.5 text-slate-600">
              {entry.employeeCode ? (
                <>
                  <span className="font-mono text-blue-700">{entry.employeeCode}</span> {entry.employeeName}
                  {' | '}
                </>
              ) : null}
              {entry.fromDate ? `${formatVnDate(entry.fromDate)} - ${formatVnDate(entry.toDate)}` : ''}
            </div>
            <div className="text-[11px] text-slate-500">Người thực hiện: {entry.actorName ?? 'Không xác định'}</div>
            {entry.reason ? <div className="mt-1 text-slate-700">Lý do: {entry.reason}</div> : null}
            {before.length || after.length ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] font-semibold text-slate-500">Trước</div>
                  <ul className="mt-0.5 space-y-0.5 text-slate-700">
                    {before.length ? before.map((l, i) => <li key={i}>{l}</li>) : <li className="text-slate-400">Không có</li>}
                  </ul>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-slate-500">Sau</div>
                  <ul className="mt-0.5 space-y-0.5 text-slate-700">
                    {after.length ? after.map((l, i) => <li key={i}>{l}</li>) : <li className="text-slate-400">Không có</li>}
                  </ul>
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Ngăn kéo phải 640px: lịch sử thay đổi phân ca (toàn bộ hoặc theo một nhân viên). */
export function AuditDrawer({
  open,
  onOpenChange,
  employeeId,
  subtitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId?: string;
  subtitle?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[640px] max-w-full sm:max-w-[640px]" aria-label="Lịch sử thay đổi phân ca">
        <SheetHeader>
          <SheetTitle>Lịch sử thay đổi phân ca</SheetTitle>
          <SheetDescription>{subtitle ?? 'Các đợt phân ca, hủy và sao chép gần đây (tối đa 100 bản ghi).'}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
          <AuditEntries employeeId={employeeId} active={open} />
        </div>
        <div className="flex shrink-0 justify-end border-t border-slate-200 bg-white px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
