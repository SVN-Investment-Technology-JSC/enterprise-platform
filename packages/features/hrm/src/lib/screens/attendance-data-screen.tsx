'use client';

import { PageTitle } from '../ui/page-title';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Download, Loader2, Search } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hrmFetch } from '../hrm-api';
import {
  ATTENDANCE_EXPORT_MAX_ROWS,
  ATTENDANCE_PAGE_SIZE,
  ATTENDANCE_STATUS_OPTIONS,
  attendanceStatusLabel,
  buildAttendanceRows,
  buildAttendanceDaysQuery,
  buildAttendanceEventsQuery,
  buildAttendancePeopleQuery,
  buildAttendanceQuery,
  eventKindLabel,
  extractEventEvidence,
  validateAttendanceRange,
  type AttendanceDataRow,
  type AttendanceFilters,
  type AttendancePersonRow,
  type AttendanceRawEvent,
} from '../hrm-attendance-data';
import { downloadXlsx } from '../hrm-xlsx';
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

/** Lượt quẹt gốc của một ngày công; chỉ gọi API khi được mở. */
function DayEvents({ employeeId, workDate }: { employeeId: string; workDate: string }) {
  const [events, setEvents] = useState<AttendanceRawEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    setEvents([]);
    hrmFetch<{ data: AttendanceRawEvent[] }>(
      `/attendance-events?${buildAttendanceEventsQuery(employeeId, workDate)}`,
    )
      .then((result) => {
        if (!live) return;
        // Hiển thị theo thứ tự thời gian tăng dần trong ngày.
        setEvents([...(result.data ?? [])].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)));
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'Không tải được lượt quẹt.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [employeeId, workDate]);

  if (loading)
    return (
      <div role="status" className="flex items-center gap-2 text-slate-500">
        <Loader2 className="size-4 animate-spin" />
        <span>Đang tải lượt quẹt...</span>
      </div>
    );
  if (error)
    return (
      <p role="alert" className="text-red-700">
        {error}
      </p>
    );
  if (events.length === 0) return <p className="text-slate-500">Không có lượt quẹt nào trong ngày này.</p>;
  return (
    <div className="space-y-2">
      {events.map((event) => {
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
                <span className="font-mono text-base font-bold text-slate-900">{formatTimeVn(event.occurred_at)}</span>
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  {eventKindLabel(event.event_kind)}
                </span>
              </div>
              {voided && <span className="text-[11px] font-semibold text-slate-600">đã hủy bởi giải trình</span>}
            </div>
            <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
              <dt className="text-slate-500">Nguồn</dt>
              <dd className="flex items-center gap-1.5">
                <span>{event.source || '—'}</span>
                {event.source === 'AUTO' ? (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                    Tự động
                  </span>
                ) : event.source ? (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    Tự chấm
                  </span>
                ) : null}
              </dd>
              <dt className="text-slate-500">Địa chỉ IP</dt>
              <dd>{evidence.ip ?? '—'}</dd>
              <dt className="text-slate-500">Địa điểm</dt>
              <dd>{evidence.site ?? '—'}</dd>
              <dt className="text-slate-500">Tọa độ GPS</dt>
              <dd>{evidence.gps ?? '—'}</dd>
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function PersonDrawer({
  person,
  filters,
  onClose,
}: {
  person: AttendancePersonRow | null;
  filters: AttendanceFilters;
  onClose: () => void;
}) {
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [days, setDays] = useState<AttendanceDataRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const employeeId = person?.employeeId;
  // Các ngày công chỉ được tải khi mở drawer của một nhân viên (mới nhất trước, do máy chủ sắp xếp).
  useEffect(() => {
    setOpenDay(null);
    setDays([]);
    setError('');
    if (!employeeId) return;
    let live = true;
    setLoading(true);
    hrmFetch<AttendanceDataResponse>(`/attendance-data?${buildAttendanceDaysQuery(filters, employeeId)}`)
      .then((result) => {
        if (live) setDays(result.data ?? []);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'Không tải được các ngày công.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [employeeId, filters]);
  return (
    <Sheet open={!!person} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-white p-0 sm:max-w-[720px]">
        {person && (
          <>
            <SheetHeader className="shrink-0">
              <SheetTitle>{person.employeeName}</SheetTitle>
              <SheetDescription>
                {person.departmentName ? `${person.departmentName} · ` : ''}
                {person.days} ngày công
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-4 text-xs">
              {loading ? (
                <div role="status" className="flex items-center gap-2 text-slate-500">
                  <Loader2 className="size-4 animate-spin" />
                  <span>Đang tải các ngày công...</span>
                </div>
              ) : null}
              {error ? (
                <p role="alert" className="text-red-700">
                  {error}
                </p>
              ) : null}
              <table className="w-full border-collapse text-left" data-testid="person-days">
                <thead className="bg-slate-100 text-[11px] font-bold text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5">Ngày công</th>
                    <th className="px-2 py-1.5">Vào</th>
                    <th className="px-2 py-1.5">Ra</th>
                    <th className="px-2 py-1.5 text-right">Thực tế</th>
                    <th className="px-2 py-1.5 text-right">Muộn</th>
                    <th className="px-2 py-1.5 text-right">Sớm</th>
                    <th className="px-2 py-1.5">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {days.flatMap((d) => {
                    const open = openDay === d.id;
                    return [
                      <tr
                        key={d.id}
                        tabIndex={0}
                        aria-expanded={open}
                        aria-label={`Xem lượt quẹt ngày ${formatDateVn(d.workDate)}`}
                        className={`cursor-pointer hover:bg-blue-50/40 focus:outline-none ${open ? 'bg-blue-50/60' : ''}`}
                        onClick={() => setOpenDay(open ? null : d.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setOpenDay(open ? null : d.id);
                          }
                        }}
                      >
                        <td className="px-2 py-1.5 font-mono">
                          {formatDateVn(d.workDate)} <span className="text-slate-500">{weekdayVn(d.workDate)}</span>
                        </td>
                        <td className="px-2 py-1.5 font-mono">{formatTimeVn(d.checkInAt)}</td>
                        <td className="px-2 py-1.5 font-mono">{formatTimeVn(d.checkOutAt)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatMinutes(d.workedMinutes)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatMinutes(d.lateMinutes)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{formatMinutes(d.earlyMinutes)}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[d.status] ?? 'border-slate-200 bg-slate-100 text-slate-600'}`}
                          >
                            {attendanceStatusLabel(d.status)}
                          </span>
                        </td>
                      </tr>,
                      ...(open
                        ? [
                            <tr key={`${d.id}:events`}>
                              <td colSpan={7} className="bg-slate-50 px-2 py-2">
                                <DayEvents employeeId={d.employeeId} workDate={d.workDate} />
                              </td>
                            </tr>,
                          ]
                        : []),
                    ];
                  })}
                </tbody>
              </table>
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
  const [people, setPeople] = useState<AttendancePersonRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const rangeError = useMemo(
    () => validateAttendanceRange(draft.from, draft.to),
    [draft.from, draft.to],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    // Máy chủ gom theo nhân viên và phân trang theo nhân viên; các ngày công chỉ tải khi mở drawer.
    hrmFetch<{ data: AttendancePersonRow[]; meta?: { total?: number } }>(
      `/attendance-data?${buildAttendancePeopleQuery(applied, page)}`,
    )
      .then((result) => {
        if (!live) return;
        setPeople(result.data ?? []);
        setTotal(result.meta?.total ?? result.data?.length ?? 0);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setPeople([]);
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
  const to = Math.min(total, (page - 1) * ATTENDANCE_PAGE_SIZE + people.length);
  const lastPage = Math.max(1, Math.ceil(total / ATTENDANCE_PAGE_SIZE));
  const selectedPerson = people.find((p) => p.employeeId === selectedId) ?? null;

  async function exportCsv() {
    if (exporting || total === 0) return;
    setExporting(true);
    try {
      const collected: AttendanceDataRow[] = [];
      const pageSize = 200;
      let dayTotal = 0;
      for (let p = 1; collected.length < ATTENDANCE_EXPORT_MAX_ROWS; p += 1) {
        const result = await hrmFetch<AttendanceDataResponse>(
          `/attendance-data?${buildAttendanceQuery(applied, p, pageSize)}`,
        );
        const chunk = result.data ?? [];
        dayTotal = result.meta?.total ?? dayTotal;
        collected.push(...chunk);
        if (chunk.length < pageSize) break;
      }
      const limited = collected.slice(0, ATTENDANCE_EXPORT_MAX_ROWS);
      downloadXlsx(
        `du-lieu-cham-cong_${applied.from}_${applied.to}`,
        buildAttendanceRows(limited),
        'Du lieu cham cong',
      );
      if (dayTotal > limited.length) {
        toast.warning({
          title: 'Đã xuất một phần dữ liệu',
          description: `Chỉ xuất ${limited.length} / ${dayTotal} dòng đầu tiên. Hãy thu hẹp bộ lọc để xuất đủ.`,
        });
      }
    } catch (e: unknown) {
      toast.error({
        title: 'Không xuất được Excel',
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[520px] flex-col gap-3">
      <PageTitle
        withTabs
        title="Dữ liệu chấm công"
      />
      <form
        onSubmit={submit}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs"
      >
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
            height={32}
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
          title={`Tối đa ${ATTENDANCE_EXPORT_MAX_ROWS.toLocaleString('vi-VN')} dòng`}
        >
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          <span>Xuất Excel kết quả đã lọc</span>
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
        ) : people.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            Không có dữ liệu chấm công phù hợp với bộ lọc.
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-[11px] font-bold text-slate-600">
                <tr>
                  <th className="px-3 py-2">Nhân viên</th>
                  <th className="px-3 py-2 text-right">Số ngày công</th>
                  <th className="px-3 py-2 text-right">Thực tế</th>
                  <th className="px-3 py-2 text-right">Theo ca</th>
                  <th className="px-3 py-2 text-right">Ngày đi muộn</th>
                  <th className="px-3 py-2 text-right">Phút muộn</th>
                  <th className="px-3 py-2 text-right">Phút về sớm</th>
                  <th className="px-3 py-2 text-right">Ngày bất thường</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {people.map((g) => (
                  <tr
                    key={g.employeeId}
                    tabIndex={0}
                    aria-label={`Xem chi tiết chấm công của ${g.employeeName}`}
                    className="cursor-pointer hover:bg-blue-50/40 focus:bg-blue-50/60 focus:outline-none"
                    onClick={() => setSelectedId(g.employeeId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(g.employeeId);
                      }
                    }}
                  >
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900">{g.employeeName}</div>
                      <div className="text-[11px] text-slate-500">{g.departmentName || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{g.days}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMinutes(g.workedMinutes)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMinutes(g.scheduledMinutes)}</td>
                    <td className="px-3 py-2 text-right font-mono">{g.lateDays}</td>
                    <td className="px-3 py-2 text-right font-mono">{g.lateMinutes}</td>
                    <td className="px-3 py-2 text-right font-mono">{g.earlyMinutes}</td>
                    <td className={`px-3 py-2 text-right font-mono ${g.abnormalDays > 0 ? 'font-bold text-rose-700' : ''}`}>
                      {g.abnormalDays}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          <span>
            Hiển thị {from}-{to} / {total} nhân viên
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

      <PersonDrawer person={selectedPerson} filters={applied} onClose={() => setSelectedId(null)} />
    </div>
  );
}
