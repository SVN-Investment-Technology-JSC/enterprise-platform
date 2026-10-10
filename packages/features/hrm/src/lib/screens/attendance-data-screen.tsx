'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Download, Loader2, Search } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import {
  ATTENDANCE_EXPORT_MAX_ROWS,
  ATTENDANCE_PAGE_SIZE,
  ATTENDANCE_STATUS_OPTIONS,
  attendanceStatusLabel,
  buildAttendanceCsv,
  buildAttendanceEventsQuery,
  buildAttendanceQuery,
  eventKindLabel,
  extractEventEvidence,
  validateAttendanceRange,
  type AttendanceDataRow,
  type AttendanceFilters,
  type AttendanceRawEvent,
} from '../hrm-attendance-data';
import { downloadCsv } from '../hrm-csv';
import {
  currentMonthVn,
  formatDateVn,
  formatMinutes,
  formatTimeVn,
  monthRange,
  weekdayVn,
} from '../hrm-timesheet-format';
import { Button } from '../ui/button';
import { DatePickerInput } from '../ui/date-picker-input';
import { Input } from '../ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet';
import { toast } from '../ui/toast';

interface AttendanceDataResponse {
  data: AttendanceDataRow[];
  meta?: { total?: number; page?: number; pageSize?: number };
}

const STATUS_CLASS: Record<string, string> = {
  VALID: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  LATE: 'border-amber-200 bg-amber-50 text-amber-700',
  EARLY_LEAVE: 'border-amber-200 bg-amber-50 text-amber-700',
  ABNORMAL: 'border-rose-200 bg-rose-50 text-rose-700',
  MISSING_PUNCH: 'border-rose-200 bg-rose-50 text-rose-700',
  APPROVED_CORRECTION: 'border-indigo-200 bg-indigo-50 text-indigo-700',
};

function defaultFilters(): AttendanceFilters {
  const { from, to } = monthRange(currentMonthVn());
  return { from, to, q: '', status: '' };
}

function EventsDrawer({
  row,
  onClose,
}: {
  row: AttendanceDataRow | null;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<AttendanceRawEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!row) return;
    let live = true;
    setLoading(true);
    setError('');
    setEvents([]);
    hrmFetch<{ data: AttendanceRawEvent[] }>(
      `/attendance-events?${buildAttendanceEventsQuery(row.employeeId, row.workDate)}`,
    )
      .then((result) => {
        if (!live) return;
        // Hiển thị theo thứ tự thời gian tăng dần trong ngày.
        setEvents(
          [...(result.data ?? [])].sort((a, b) =>
            a.occurred_at.localeCompare(b.occurred_at),
          ),
        );
      })
      .catch((e: unknown) => {
        if (live)
          setError(e instanceof Error ? e.message : 'Không tải được lượt quẹt.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [row]);

  return (
    <Sheet open={!!row} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-white p-0 sm:max-w-[640px]">
        {row && (
          <>
            <SheetHeader className="shrink-0">
              <SheetTitle>Lượt quẹt gốc</SheetTitle>
              <SheetDescription>
                {row.employeeCode ? `${row.employeeCode} - ` : ''}
                {row.employeeName ?? ''} · {formatDateVn(row.workDate)} (
                {weekdayVn(row.workDate)})
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-3 overflow-y-auto p-5 text-xs">
              {loading ? (
                <div role="status" className="flex items-center gap-2 text-slate-500">
                  <Loader2 className="size-4 animate-spin" />
                  <span>Đang tải lượt quẹt...</span>
                </div>
              ) : error ? (
                <p role="alert" className="text-red-700">
                  {error}
                </p>
              ) : events.length === 0 ? (
                <p className="text-slate-500">Không có lượt quẹt nào trong ngày này.</p>
              ) : (
                events.map((event) => {
                  const evidence = extractEventEvidence(event);
                  const voided = !!event.voided_by_correction_id;
                  return (
                    <div
                      key={event.id}
                      data-testid="attendance-event"
                      className={`rounded-lg border p-3 ${voided ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-200 bg-white'}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold text-slate-900">
                            {formatTimeVn(event.occurred_at)}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                            {eventKindLabel(event.event_kind)}
                          </span>
                        </div>
                        {voided && (
                          <span className="text-[11px] font-semibold text-slate-600">
                            đã hủy bởi giải trình
                          </span>
                        )}
                      </div>
                      <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
                        <dt className="text-slate-500">Nguồn</dt>
                        <dd>{event.source || '—'}</dd>
                        <dt className="text-slate-500">Thiết bị</dt>
                        <dd className="break-all">{event.device_id || '—'}</dd>
                        <dt className="text-slate-500">Địa chỉ IP</dt>
                        <dd>{evidence.ip ?? '—'}</dd>
                        <dt className="text-slate-500">Địa điểm</dt>
                        <dd>{evidence.site ?? '—'}</dd>
                        <dt className="text-slate-500">Tọa độ GPS</dt>
                        <dd>{evidence.gps ?? '—'}</dd>
                      </dl>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function AttendanceDataScreen() {
  const [draft, setDraft] = useState<AttendanceFilters>(defaultFilters);
  const [applied, setApplied] = useState<AttendanceFilters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AttendanceDataRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<AttendanceDataRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const rangeError = useMemo(
    () => validateAttendanceRange(draft.from, draft.to),
    [draft.from, draft.to],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    hrmFetch<AttendanceDataResponse>(
      `/attendance-data?${buildAttendanceQuery(applied, page)}`,
    )
      .then((result) => {
        if (!live) return;
        setRows(result.data ?? []);
        setTotal(result.meta?.total ?? result.data?.length ?? 0);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setRows([]);
        setTotal(0);
        setError(
          e instanceof Error ? e.message : 'Không tải được dữ liệu chấm công.',
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [applied, page, reloadKey]);

  const submit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      if (rangeError) return;
      setPage(1);
      setApplied({ ...draft });
      setReloadKey((k) => k + 1);
    },
    [draft, rangeError],
  );

  const from = total === 0 ? 0 : (page - 1) * ATTENDANCE_PAGE_SIZE + 1;
  const to = Math.min(total, (page - 1) * ATTENDANCE_PAGE_SIZE + rows.length);
  const lastPage = Math.max(1, Math.ceil(total / ATTENDANCE_PAGE_SIZE));

  async function exportCsv() {
    if (exporting || total === 0) return;
    setExporting(true);
    try {
      const collected: AttendanceDataRow[] = [];
      const pageSize = 200;
      for (
        let p = 1;
        collected.length < Math.min(total, ATTENDANCE_EXPORT_MAX_ROWS);
        p += 1
      ) {
        const result = await hrmFetch<AttendanceDataResponse>(
          `/attendance-data?${buildAttendanceQuery(applied, p, pageSize)}`,
        );
        const chunk = result.data ?? [];
        collected.push(...chunk);
        if (chunk.length < pageSize) break;
      }
      const limited = collected.slice(0, ATTENDANCE_EXPORT_MAX_ROWS);
      downloadCsv(
        `du-lieu-cham-cong_${applied.from}_${applied.to}`,
        buildAttendanceCsv(limited),
      );
      if (total > limited.length) {
        toast.warning({
          title: 'Đã xuất một phần dữ liệu',
          description: `Chỉ xuất ${limited.length} / ${total} dòng đầu tiên. Hãy thu hẹp bộ lọc để xuất đủ.`,
        });
      }
    } catch (e: unknown) {
      toast.error({
        title: 'Không xuất được CSV',
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[520px] flex-col gap-3">
      <form
        onSubmit={submit}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs"
      >
        <div className="mr-2">
          <h1 className="text-lg font-bold tracking-tight text-slate-900">
            Dữ liệu chấm công
          </h1>
          <p className="text-xs text-slate-500">
            Kết quả chấm công theo ngày, tối đa 93 ngày mỗi lần xem.
          </p>
        </div>
        <div className="flex w-40 flex-col gap-1 text-[11px] font-semibold text-slate-600">
          <span>Từ ngày</span>
          <DatePickerInput
            aria-label="Từ ngày"
            value={draft.from}
            onChange={(v) => setDraft((d) => ({ ...d, from: v }))}
          />
        </div>
        <div className="flex w-40 flex-col gap-1 text-[11px] font-semibold text-slate-600">
          <span>Đến ngày</span>
          <DatePickerInput
            aria-label="Đến ngày"
            value={draft.to}
            onChange={(v) => setDraft((d) => ({ ...d, to: v }))}
          />
        </div>
        <div className="flex w-64 flex-col gap-1 text-[11px] font-semibold text-slate-600">
          <span>Tìm nhân viên</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              aria-label="Tìm nhân viên"
              className="pl-7"
              placeholder="Mã hoặc họ tên"
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex w-48 flex-col gap-1 text-[11px] font-semibold text-slate-600">
          <span>Trạng thái</span>
          <SearchableSelect
            placeholder="Tất cả trạng thái"
            options={ATTENDANCE_STATUS_OPTIONS}
            value={draft.status}
            onChange={(v) => setDraft((d) => ({ ...d, status: v || '' }))}
            clearable
          />
        </div>
        <Button type="submit" disabled={!!rangeError}>
          Lọc
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={exporting || total === 0}
          onClick={() => void exportCsv()}
          title={`Xuất toàn bộ kết quả đã lọc (tối đa ${ATTENDANCE_EXPORT_MAX_ROWS.toLocaleString('vi-VN')} dòng), không chỉ trang đang xem`}
        >
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          <span>Xuất CSV kết quả đã lọc</span>
        </Button>
        {rangeError && (
          <p role="alert" className="basis-full text-xs font-semibold text-red-600">
            {rangeError}
          </p>
        )}
      </form>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        {error ? (
          <div role="alert" className="flex flex-col items-start gap-2 p-4 text-sm text-red-700">
            <p>{error}</p>
            <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              Tải lại
            </Button>
          </div>
        ) : loading ? (
          <div role="status" className="flex items-center gap-2 p-6 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" />
            <span>Đang tải dữ liệu chấm công...</span>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            Không có dữ liệu chấm công phù hợp với bộ lọc.
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-[11px] font-bold text-slate-600">
                <tr>
                  <th className="px-3 py-2">Nhân viên</th>
                  <th className="px-3 py-2">Ngày công</th>
                  <th className="px-3 py-2">Giờ vào</th>
                  <th className="px-3 py-2">Giờ ra</th>
                  <th className="px-3 py-2 text-right">Thực tế</th>
                  <th className="px-3 py-2 text-right">Theo ca</th>
                  <th className="px-3 py-2 text-right">Muộn</th>
                  <th className="px-3 py-2 text-right">Sớm</th>
                  <th className="px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2">Nguồn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    aria-label={`Xem lượt quẹt của ${r.employeeName ?? r.employeeCode ?? ''} ngày ${formatDateVn(r.workDate)}`}
                    className="cursor-pointer hover:bg-blue-50/40 focus:bg-blue-50/60 focus:outline-none"
                    onClick={() => setSelected(r)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(r);
                      }
                    }}
                  >
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900">
                        <span className="font-mono">{r.employeeCode ?? ''}</span>{' '}
                        {r.employeeName ?? ''}
                      </div>
                      <div className="text-[11px] text-slate-500">{r.departmentName || '—'}</div>
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatDateVn(r.workDate)} <span className="text-slate-500">{weekdayVn(r.workDate)}</span>
                    </td>
                    <td className="px-3 py-2 font-mono">{formatTimeVn(r.checkInAt)}</td>
                    <td className="px-3 py-2 font-mono">{formatTimeVn(r.checkOutAt)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMinutes(r.workedMinutes)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMinutes(r.scheduledMinutes)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMinutes(r.lateMinutes)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMinutes(r.earlyMinutes)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[r.status] ?? 'border-slate-200 bg-slate-100 text-slate-600'}`}
                      >
                        {attendanceStatusLabel(r.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.source || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          <span>
            Hiển thị {from}-{to} / {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Trước
            </Button>
            <span className="font-mono">
              {page} / {lastPage}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= lastPage || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Sau
            </Button>
          </div>
        </div>
      </div>

      <EventsDrawer row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
