'use client';
import { useMemo, useState } from 'react';
import type { HrmTripDayWindow } from '@enterprise-platform/contracts-hrm';
import { tripDayLabel, tripWindowProblem } from '../comp-off-model';
import { Button } from './button';
import { TimeComboInput } from './time-combo-input';

const DEFAULT_WINDOW: HrmTripDayWindow = { from: '07:30', to: '17:00' };
const MAX_DAYS = 62;
const STEP_MINUTES = 15;

/** Làm tròn giờ HH:mm về bội số 15 phút gần nhất (23:53 thành 23:45 để không sang ngày khác). */
export function snapToStep(time: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return time;
  const total = Math.min(24 * 60 - STEP_MINUTES, Math.round((Number(m[1]) * 60 + Number(m[2])) / STEP_MINUTES) * STEP_MINUTES);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export type TripDayPlans = Record<string, HrmTripDayWindow[]>;

/** Các ngày từ `fromDate` đến `toDate` (YYYY-MM-DD), tối đa 62 ngày. */
export function tripDatesBetween(fromDate: string, toDate: string): string[] {
  if (!fromDate || !toDate || toDate < fromDate) return [];
  const out: string[] = [];
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`).getTime();
  while (cursor.getTime() <= end && out.length < MAX_DAYS) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Lỗi khung giờ của các ngày đã khai; chuỗi rỗng nếu hợp lệ. Chỉ xét các ngày nằm trong đơn. */
export function tripDayPlansProblem(plans: TripDayPlans, dates: readonly string[]): string {
  for (const date of dates) {
    const problem = tripWindowProblem(plans[date] ?? []);
    if (problem) return `${tripDayLabel(date)}: ${problem}`;
  }
  return '';
}

/** Danh sách ngày khai giờ khác mặc định, theo đúng thứ tự ngày của đơn, để gửi lên sau khi tạo đơn. */
export function tripDayPlanLines(plans: TripDayPlans, dates: readonly string[]) {
  const isDefault = (w: HrmTripDayWindow[]) => w.length === 1 && w[0].from === DEFAULT_WINDOW.from && w[0].to === DEFAULT_WINDOW.to;
  return dates.filter((d) => (plans[d] ?? []).length > 0 && !isDefault(plans[d])).map((date) => ({ date, windows: plans[date] }));
}

/**
 * Khai giờ làm dự kiến theo ngày ngay trong form tạo đơn công tác (tùy chọn). Ngày để trống tính theo ca của nhân viên;
 * giờ thực tế khai sau chuyến đi ở chi tiết đơn và do quản lý trực tiếp xác nhận.
 */
export function TripDayPlanFields({
  fromDate,
  toDate,
  value,
  onChange,
  disabled,
}: {
  fromDate: string;
  toDate: string;
  value: TripDayPlans;
  onChange: (next: TripDayPlans) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dates = useMemo(() => tripDatesBetween(fromDate, toDate), [fromDate, toDate]);
  if (dates.length === 0) return null;
  const declared = tripDayPlanLines(value, dates).length;
  const setDay = (date: string, windows: HrmTripDayWindow[]) => onChange({ ...value, [date]: windows });
  return (
    <section aria-label="Giờ làm theo ngày" className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-xs font-bold text-slate-800">Giờ làm theo ngày (tùy chọn)</span>
          <p className="text-[12px] text-slate-500">
            {declared ? `Đã sửa giờ ${declared}/${dates.length} ngày; ngày còn lại giữ mặc định.` : 'Mặc định giờ hành chính; chỉ sửa ngày làm khác giờ.'}
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen((v) => !v)}>
          {open ? 'Thu gọn' : declared ? 'Sửa giờ làm' : 'Khai giờ dự kiến'}
        </Button>
      </div>
      {open ? (
        <div className="space-y-2">
          <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-white">
            {dates.map((date) => {
              const windows = value[date] ?? [{ ...DEFAULT_WINDOW }];
              return (
                <div key={date} className="grid grid-cols-1 items-start gap-1.5 px-2 py-1.5 sm:grid-cols-[8.5rem_1fr_auto]">
                  <div className="pt-1.5 text-xs font-medium text-slate-800">{tripDayLabel(date)}</div>
                  <div className="space-y-1">
                    {windows.map((w, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <TimeComboInput
                          aria-label={`Từ giờ, ${tripDayLabel(date)}`}
                          className="w-28"
                          stepMinutes={STEP_MINUTES}
                          value={w.from}
                          disabled={disabled}
                          onChange={(t) => setDay(date, windows.map((x, j) => (j === i ? { ...x, from: snapToStep(t) } : x)))}
                        />
                        <span className="text-slate-400">đến</span>
                        <TimeComboInput
                          aria-label={`Đến giờ, ${tripDayLabel(date)}`}
                          className="w-28"
                          stepMinutes={STEP_MINUTES}
                          value={w.to}
                          disabled={disabled}
                          onChange={(t) => setDay(date, windows.map((x, j) => (j === i ? { ...x, to: snapToStep(t) } : x)))}
                        />
                        {windows.length > 1 ? (
                          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setDay(date, windows.filter((_, j) => j !== i))}>
                            Xóa
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" disabled={disabled} onClick={() => setDay(date, [...windows, { ...DEFAULT_WINDOW }])}>
                      Thêm khung giờ
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[12px] text-slate-500">
            Giờ vượt ca là làm thêm. Sau chuyến đi, khai giờ thực tế ở chi tiết đơn để quản lý trực tiếp xác nhận.
          </p>
        </div>
      ) : null}
    </section>
  );
}
