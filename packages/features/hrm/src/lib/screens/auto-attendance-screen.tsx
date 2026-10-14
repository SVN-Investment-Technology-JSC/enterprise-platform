'use client';
import { useCallback, useEffect, useState } from 'react';
import type { HrmAutoAttendanceSettings } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { formatDateVn } from '../hrm-timesheet-format';
import { Button } from '../ui/button';
import { PageTitle } from '../ui/page-title';
import { InfoNote } from '../ui/settings-kit';
import { toast } from '../ui/toast';
import { Checkbox } from '../ui/work-schedule/common';

/** Thứ hai đến Chủ nhật; giá trị 0 = Chủ nhật ... 6 = thứ Bảy (khớp máy chủ). */
export const AUTO_ATTENDANCE_WEEKDAYS: readonly { value: number; short: string; full: string }[] = [
  { value: 1, short: 'T2', full: 'Thứ Hai' },
  { value: 2, short: 'T3', full: 'Thứ Ba' },
  { value: 3, short: 'T4', full: 'Thứ Tư' },
  { value: 4, short: 'T5', full: 'Thứ Năm' },
  { value: 5, short: 'T6', full: 'Thứ Sáu' },
  { value: 6, short: 'T7', full: 'Thứ Bảy' },
  { value: 0, short: 'CN', full: 'Chủ nhật' },
];

/** Thông báo lỗi nếu cấu hình chưa hợp lệ để lưu (khớp máy chủ), ngược lại null. */
export function autoAttendanceError(enabled: boolean, weekdays: readonly number[]): string | null {
  if (enabled && weekdays.length === 0) return 'Chọn ít nhất một thứ trong tuần để bật chấm công tự động';
  return null;
}

const sameDays = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/**
 * Chấm công tự động: bật/tắt và chọn các thứ áp dụng, độc lập với phân ca. Ngày làm việc có ca rơi vào thứ đã chọn thì
 * tới khi ca kết thúc, hệ thống tự sinh giờ vào/ra đúng giờ ca cho người chưa chấm công. Không cần phân ca lại.
 */
export default function AutoAttendanceScreen() {
  const [saved, setSaved] = useState<HrmAutoAttendanceSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = useCallback((settings: HrmAutoAttendanceSettings) => {
    setSaved(settings);
    setEnabled(settings.enabled);
    setWeekdays([...settings.weekdays]);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      apply((await hrmFetch<{ data: HrmAutoAttendanceSettings }>('/auto-attendance-settings')).data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được cấu hình chấm công tự động');
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleDay = (value: number, checked: boolean) =>
    setWeekdays((current) => (checked ? [...new Set([...current, value])] : current.filter((v) => v !== value)));

  const invalid = autoAttendanceError(enabled, weekdays);
  const dirty = saved !== null && (saved.enabled !== enabled || !sameDays(saved.weekdays, weekdays));

  async function save() {
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setBusy(true);
    try {
      const res = await hrmFetch<{ data: HrmAutoAttendanceSettings }>('/auto-attendance-settings', {
        method: 'PUT',
        body: JSON.stringify({ enabled, weekdays }),
      });
      apply(res.data);
      toast.success(enabled ? 'Đã bật chấm công tự động' : 'Đã tắt chấm công tự động');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không lưu được cấu hình chấm công tự động');
    } finally {
      setBusy(false);
    }
  }

  const notReady = saved !== null && !saved.ready;

  return (
    <div className="space-y-4" data-testid="auto-attendance">
      <PageTitle
        title="Chấm công tự động"
        description="Bật hoặc tắt chấm công tự động cho cả đơn vị mà không cần phân ca lại."
      />

      <InfoNote>
        Với những ngày làm việc có ca nằm trong các thứ được chọn, khi ca kết thúc hệ thống tự ghi giờ vào và giờ ra đúng
        giờ bắt đầu, kết thúc ca cho nhân viên chưa chấm công. Không áp dụng cho ngày đã có chấm công, ngày có đơn nghỉ hoặc
        công tác đã duyệt, và kỳ công đã khóa. Cấu hình chỉ có hiệu lực từ ngày bật trở đi, không đổi dữ liệu đã qua.
      </InfoNote>

      {error ? (
        <InfoNote tone="red" role="alert">
          {error}{' '}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Tải lại
          </button>
        </InfoNote>
      ) : null}

      {notReady ? (
        <InfoNote tone="amber" role="alert">
          Cơ sở dữ liệu HRM chưa được cập nhật cho tính năng này (migration 0055-hrm-auto-attendance-settings). Quản trị cần
          chạy migration trước khi bật.
        </InfoNote>
      ) : null}

      <section aria-label="Cấu hình chấm công tự động" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <Checkbox
          id="auto-attendance-enabled"
          checked={enabled}
          disabled={loading || busy || notReady}
          onChange={setEnabled}
          label={<span className="text-sm font-semibold text-slate-900">Bật chấm công tự động</span>}
        />

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700">Áp dụng cho các thứ</div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Các thứ áp dụng">
            {AUTO_ATTENDANCE_WEEKDAYS.map((day) => (
              <li key={day.value}>
                <Checkbox
                  checked={weekdays.includes(day.value)}
                  disabled={loading || busy || notReady || !enabled}
                  onChange={(checked) => toggleDay(day.value, checked)}
                  label={
                    <span title={day.full} className={day.value === 0 ? 'text-rose-600' : day.value === 6 ? 'text-amber-700' : ''}>
                      {day.short}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
          {!enabled ? <p className="text-[11px] text-slate-500">Bật chấm công tự động để chọn các thứ áp dụng.</p> : null}
        </div>

        {saved?.enabled && saved.enabledFrom ? (
          <p data-testid="auto-attendance-since" className="text-xs text-emerald-700">
            Đang bật, áp dụng cho các ngày từ {formatDateVn(saved.enabledFrom)}.
          </p>
        ) : (
          <p className="text-xs text-slate-500">Hiện đang tắt.</p>
        )}

        <div className="flex items-center gap-2">
          <Button type="button" disabled={busy || loading || notReady || !dirty} onClick={() => void save()}>
            Lưu cấu hình
          </Button>
          {invalid && dirty ? <span className="text-xs text-rose-600">{invalid}</span> : null}
        </div>
      </section>
    </div>
  );
}
