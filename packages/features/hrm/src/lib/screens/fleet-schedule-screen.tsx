'use client';

import { CalendarDays, ChevronLeft, ChevronRight, Car } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HrmFleetBooking, HrmFleetSourceType, HrmFleetVehicle } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { cn } from '../utils';
import { Button } from '../ui/button';
import { PageTitle } from '../ui/page-title';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { EmptyPanel, InfoNote, StatusPill } from '../ui/settings-kit';

const SPANS = [7, 14, 30] as const;
type Span = (typeof SPANS)[number];
/** Bề rộng tối thiểu mỗi ngày (px): bảng tự cuộn ngang trong khung khi tháng dài. */
const DAY_MIN_WIDTH = 56;

const SOURCE_LABEL: Record<HrmFleetSourceType, string> = {
  BUSINESS_TRIP: 'Đơn công tác',
  CUSTOM_REQUEST: 'Đơn từ',
  WORK_ITEM: 'Công việc',
  CALENDAR_EVENT: 'Lịch họp',
  INCIDENT: 'Phiếu sự cố',
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const timeText = (iso: string) =>
  new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateTimeText = (iso: string) =>
  `${new Date(iso).toLocaleDateString('vi-VN')} ${timeText(iso)}`;

/** Vị trí và bề rộng của thanh lịch (phần trăm của khung thời gian đang xem). */
export function barGeometry(booking: Pick<HrmFleetBooking, 'startAt' | 'endAt'>, from: Date, to: Date) {
  const total = to.getTime() - from.getTime();
  const start = Math.max(Date.parse(booking.startAt), from.getTime());
  const end = Math.min(Date.parse(booking.endAt), to.getTime());
  return { left: ((start - from.getTime()) / total) * 100, width: Math.max(((end - start) / total) * 100, 0.8) };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Không tải được lịch xe.';
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-slate-100 px-5 py-2.5 text-sm">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900">{children || '—'}</dd>
    </div>
  );
}

/** Lịch xe công ty: mỗi hàng là một xe, mỗi thanh là một lịch đặt. Chỉ xem; lịch sinh ra từ đơn hoặc công việc gốc. */
export default function FleetScheduleScreen() {
  const [from, setFrom] = useState(() => startOfDay(new Date()));
  const [span, setSpan] = useState<Span>(14);
  const [vehicles, setVehicles] = useState<HrmFleetVehicle[]>([]);
  const [bookings, setBookings] = useState<HrmFleetBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<HrmFleetBooking | null>(null);

  const to = useMemo(() => addDays(from, span), [from, span]);
  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(from, i)), [from, span]);
  const today = startOfDay(new Date()).getTime();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const query = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
      const [v, b] = await Promise.all([
        hrmFetch<{ data: HrmFleetVehicle[] }>('/fleet/vehicles'),
        hrmFetch<{ data: HrmFleetBooking[] }>(`/fleet/bookings?${query}`),
      ]);
      setVehicles(v.data);
      setBookings(b.data);
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const used = new Set(bookings.map((b) => b.vehicleId));
    return vehicles.filter((v) => v.status === 'ACTIVE' || used.has(v.id));
  }, [vehicles, bookings]);

  const byVehicle = useMemo(() => {
    const map = new Map<string, HrmFleetBooking[]>();
    for (const b of bookings) map.set(b.vehicleId, [...(map.get(b.vehicleId) ?? []), b]);
    return map;
  }, [bookings]);

  const shift = (direction: -1 | 1) => setFrom((current) => addDays(current, direction * span));

  return (
    <div className="@container mx-auto max-w-[1400px] space-y-4">
      <PageTitle
        title="Lịch xe"
        description="Xe công ty đang được đặt cho đơn công tác, công việc, lịch họp và sự cố. Chọn xe và tài xế ngay trên đơn hoặc công việc."
        withTabs
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Khoảng xem" className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5 text-xs">
              {SPANS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={span === value}
                  onClick={() => setSpan(value)}
                  className={cn(
                    'h-8 cursor-pointer rounded-md px-3 font-medium whitespace-nowrap transition-all',
                    span === value ? 'bg-white font-bold text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900',
                  )}
                >
                  {value} ngày
                </button>
              ))}
            </div>
            <Button variant="outline" aria-label="Khoảng trước" className="h-9 px-2" onClick={() => shift(-1)}>
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              className="h-9 gap-1.5 px-3 text-xs font-semibold"
              onClick={() => setFrom(startOfDay(new Date()))}
            >
              <CalendarDays className="size-4" aria-hidden />
              Hôm nay
            </Button>
            <Button variant="outline" aria-label="Khoảng sau" className="h-9 px-2" onClick={() => shift(1)}>
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        }
      />

      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">
            {from.toLocaleDateString('vi-VN')} - {addDays(to, -1).toLocaleDateString('vi-VN')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded-sm border border-dashed border-amber-500 bg-amber-100" aria-hidden />
            Chờ đơn gốc duyệt (đang giữ chỗ)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded-sm bg-blue-600" aria-hidden />
            Đã xác nhận
          </span>
        </div>

        {loadError ? (
          <div className="p-3">
            <InfoNote tone="red" role="alert">
              {loadError}
            </InfoNote>
          </div>
        ) : loading && !vehicles.length ? (
          <div role="status" className="p-6 text-sm text-slate-500">
            Đang tải lịch xe…
          </div>
        ) : !rows.length ? (
          <EmptyPanel icon={Car} title="Chưa có xe nào trong danh mục." />
        ) : (
          <div className="max-h-[calc(100dvh-280px)] overflow-auto">
            <div style={{ minWidth: 200 + span * DAY_MIN_WIDTH }}>
              <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-slate-50">
                <div className="sticky left-0 z-30 w-[200px] shrink-0 border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                  Xe
                </div>
                <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))` }}>
                  {days.map((day) => (
                    <div
                      key={day.getTime()}
                      className={cn(
                        'border-r border-slate-100 py-1.5 text-center text-[11px] leading-tight text-slate-500',
                        day.getTime() === today && 'bg-blue-50 font-bold text-blue-700',
                      )}
                    >
                      <div>{day.toLocaleDateString('vi-VN', { weekday: 'short' })}</div>
                      <div className="font-semibold">{`${day.getDate()}/${day.getMonth() + 1}`}</div>
                    </div>
                  ))}
                </div>
              </div>

              {rows.map((vehicle) => (
                <div key={vehicle.id} className="flex border-b border-slate-100">
                  <div className="sticky left-0 z-10 w-[200px] shrink-0 border-r border-slate-200 bg-white px-3 py-2">
                    <div className="truncate font-mono text-xs font-bold text-slate-900">{vehicle.plateNo}</div>
                    <div className="truncate text-[11px] text-slate-500">
                      {vehicle.name} · {vehicle.seats} chỗ
                    </div>
                  </div>
                  <div className="relative h-[52px] flex-1">
                    <div
                      className="absolute inset-0 grid"
                      style={{ gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))` }}
                      aria-hidden
                    >
                      {days.map((day) => (
                        <div
                          key={day.getTime()}
                          className={cn('border-r border-slate-100', day.getTime() === today && 'bg-blue-50/60')}
                        />
                      ))}
                    </div>
                    {(byVehicle.get(vehicle.id) ?? []).map((booking) => {
                      const { left, width } = barGeometry(booking, from, to);
                      return (
                        <button
                          key={booking.id}
                          type="button"
                          onClick={() => setSelected(booking)}
                          title={`${timeText(booking.startAt)} - ${timeText(booking.endAt)} · ${booking.driverName ?? ''}`}
                          className={cn(
                            'absolute top-1.5 bottom-1.5 min-w-0 cursor-pointer overflow-hidden rounded-md px-2 text-left text-[11px] leading-tight font-semibold transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none',
                            booking.status === 'CONFIRMED'
                              ? 'bg-blue-600 text-white'
                              : 'border border-dashed border-amber-500 bg-amber-100 text-amber-900',
                          )}
                          style={{ left: `${left}%`, width: `${width}%` }}
                        >
                          <span className="block truncate">{booking.sourceLabel ?? SOURCE_LABEL[booking.sourceType]}</span>
                          <span className="block truncate font-normal opacity-90">
                            {timeText(booking.startAt)}-{timeText(booking.endAt)} · {booking.driverName ?? ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-white p-0 sm:max-w-[640px]">
          <SheetHeader className="shrink-0 border-b border-slate-200">
            <SheetTitle>{selected ? `${selected.vehiclePlateNo} · ${selected.vehicleName}` : 'Chi tiết lịch xe'}</SheetTitle>
            <SheetDescription>
              Lịch xe sinh ra từ đơn hoặc công việc gốc; đổi hay huỷ lịch thực hiện ngay trên nguồn đó.
            </SheetDescription>
          </SheetHeader>
          {selected ? (
            <dl className="min-h-0 flex-1 overflow-y-auto">
              <DetailRow label="Trạng thái">
                <StatusPill tone={selected.status === 'CONFIRMED' ? 'blue' : 'amber'}>
                  {selected.status === 'CONFIRMED' ? 'Đã xác nhận' : 'Chờ đơn gốc duyệt'}
                </StatusPill>
              </DetailRow>
              <DetailRow label="Thời gian">
                {dateTimeText(selected.startAt)} - {dateTimeText(selected.endAt)}
              </DetailRow>
              <DetailRow label="Xe">{`${selected.vehiclePlateNo} · ${selected.vehicleName}`}</DetailRow>
              <DetailRow label="Tài xế">{selected.driverName}</DetailRow>
              <DetailRow label="Điểm đến">{selected.destination}</DetailRow>
              <DetailRow label="Mục đích">{selected.purpose}</DetailRow>
              <DetailRow label="Người yêu cầu">{selected.requesterName}</DetailRow>
              <DetailRow label="Loại nguồn">{SOURCE_LABEL[selected.sourceType]}</DetailRow>
              <DetailRow label="Nguồn">{selected.sourceLabel}</DetailRow>
            </dl>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
