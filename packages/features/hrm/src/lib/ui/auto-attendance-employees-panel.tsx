'use client';
import { useCallback, useEffect, useState } from 'react';
import { SearchableSelect, type SearchableSelectOption } from '@enterprise-platform/shared-ui';
import type {
  HrmAutoAttendanceEmployee,
  HrmAutoAttendanceEmployeesResponse,
  SaveAutoAttendanceEmployeeRequest,
} from '@enterprise-platform/contracts-hrm';
import { hrmEmployeeOptions, hrmFetch } from '../hrm-api';
import { formatDateVn } from '../hrm-timesheet-format';
import { Button } from './button';
import { DatePickerInput } from './date-picker-input';
import { Input } from './input';
import { InfoNote } from './settings-kit';
import { toast } from './toast';
import { Checkbox, Field } from './work-schedule/common';

const WEEKDAYS: readonly { value: number; short: string }[] = [
  { value: 1, short: 'T2' },
  { value: 2, short: 'T3' },
  { value: 3, short: 'T4' },
  { value: 4, short: 'T5' },
  { value: 5, short: 'T6' },
  { value: 6, short: 'T7' },
  { value: 0, short: 'CN' },
];

const REASON_MAX = 500;

export const weekdaysLabel = (weekdays: readonly number[] | null) =>
  weekdays?.length
    ? WEEKDAYS.filter((d) => weekdays.includes(d.value))
        .map((d) => d.short)
        .join(', ')
    : 'Mọi ngày có ca';

export const rangeLabel = (row: Pick<HrmAutoAttendanceEmployee, 'fromDate' | 'toDate'>) =>
  `${formatDateVn(row.fromDate)} - ${row.toDate ? formatDateVn(row.toDate) : 'chưa kết thúc'}`;

/** Lỗi nếu biểu mẫu chưa hợp lệ để lưu (khớp máy chủ), ngược lại null. */
export function autoAttendanceEmployeeError(draft: {
  employeeId: string;
  reason: string;
  fromDate: string;
  toDate: string;
}): string | null {
  if (!draft.employeeId) return 'Chưa chọn nhân viên';
  if (!draft.reason.trim()) return 'Cần nhập lý do chấm công tự động';
  if (draft.toDate && draft.fromDate && draft.toDate < draft.fromDate)
    return 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu';
  return null;
}

const EMPTY_DRAFT = { employeeId: '', weekdays: [] as number[], fromDate: '', toDate: '', reason: '' };

/**
 * Chấm công tự động cho từng nhân viên (người không chấm công ngoài đời), ngoài cấu hình chung của đơn vị.
 * Lưu lịch sử cấu hình kèm lý do; giờ công sinh ra được xem như chấm công hằng ngày.
 */
export function AutoAttendanceEmployeesPanel() {
  const [active, setActive] = useState<readonly HrmAutoAttendanceEmployee[]>([]);
  const [history, setHistory] = useState<readonly HrmAutoAttendanceEmployee[]>([]);
  const [ready, setReady] = useState(true);
  const [options, setOptions] = useState<SearchableSelectOption[]>([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await hrmFetch<HrmAutoAttendanceEmployeesResponse>('/auto-attendance-employees');
      setActive(Array.isArray(res.data?.active) ? res.data.active : []);
      setHistory(Array.isArray(res.data?.history) ? res.data.history : []);
      setReady(res.ready !== false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được danh sách chấm công tự động theo nhân viên');
    }
  }, []);

  useEffect(() => {
    void load();
    hrmEmployeeOptions()
      .then(setOptions)
      .catch(() => setOptions([]));
  }, [load]);

  const patch = (change: Partial<typeof EMPTY_DRAFT>) => setDraft((current) => ({ ...current, ...change }));
  const toggleDay = (value: number, checked: boolean) =>
    patch({ weekdays: checked ? [...new Set([...draft.weekdays, value])] : draft.weekdays.filter((v) => v !== value) });
  const invalid = autoAttendanceEmployeeError(draft);

  async function save() {
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setBusy(true);
    try {
      const body: SaveAutoAttendanceEmployeeRequest = {
        employeeId: draft.employeeId,
        weekdays: draft.weekdays.length ? draft.weekdays : null,
        fromDate: draft.fromDate || undefined,
        toDate: draft.toDate || null,
        reason: draft.reason.trim(),
      };
      await hrmFetch('/auto-attendance-employees', { method: 'PUT', body: JSON.stringify(body) });
      toast.success('Đã lưu cấu hình chấm công tự động cho nhân viên');
      setDraft(EMPTY_DRAFT);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không lưu được cấu hình');
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: HrmAutoAttendanceEmployee) {
    setBusy(true);
    try {
      await hrmFetch(`/auto-attendance-employees/${row.id}`, { method: 'DELETE' });
      toast.success('Đã gỡ chấm công tự động của nhân viên');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không gỡ được cấu hình');
    } finally {
      setBusy(false);
    }
  }

  const edit = (row: HrmAutoAttendanceEmployee) =>
    setDraft({
      employeeId: row.employeeId,
      weekdays: [...(row.weekdays ?? [])],
      fromDate: row.fromDate,
      toDate: row.toDate ?? '',
      reason: row.reason,
    });

  const name = (row: HrmAutoAttendanceEmployee) =>
    [row.employeeCode, row.fullName].filter(Boolean).join(' · ') || row.employeeId;

  return (
    <section
      aria-label="Chấm công tự động theo nhân viên"
      data-testid="auto-attendance-employees"
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Theo nhân viên</h2>
        <p className="text-xs text-slate-500">
          Dành cho người không chấm công ngoài đời. Hệ thống ghi giờ vào/ra theo ca của họ như chấm công hằng ngày, kể cả
          khi cấu hình chung của đơn vị đang tắt.
        </p>
      </div>

      {error ? (
        <InfoNote tone="red" role="alert">
          {error}
        </InfoNote>
      ) : null}
      {!ready ? (
        <InfoNote tone="amber" role="alert">
          Cơ sở dữ liệu HRM chưa được cập nhật cho tính năng này (migration 0066-hrm-auto-attendance-employees).
        </InfoNote>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nhân viên" required>
          <SearchableSelect
            height={36}
            options={options}
            value={draft.employeeId}
            placeholder="Chọn nhân viên"
            emptyText="Không tìm thấy nhân viên"
            onChange={(employeeId) => patch({ employeeId: employeeId ?? '' })}
            clearable={false}
            disabled={!ready || busy}
          />
        </Field>
        <Field label="Lý do" required>
          <Input
            aria-label="Lý do"
            maxLength={REASON_MAX}
            placeholder="Ví dụ: không chấm vân tay"
            value={draft.reason}
            onChange={(e) => patch({ reason: e.target.value })}
            disabled={!ready || busy}
          />
        </Field>
        <Field label="Từ ngày" hint="Để trống để tính từ hôm nay.">
          <DatePickerInput
            aria-label="Từ ngày"
            height={36}
            value={draft.fromDate}
            onChange={(fromDate) => patch({ fromDate })}
          />
        </Field>
        <Field label="Đến ngày" hint="Để trống nếu chưa có ngày kết thúc.">
          <DatePickerInput
            aria-label="Đến ngày"
            height={36}
            value={draft.toDate}
            onChange={(toDate) => patch({ toDate })}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-700">Áp dụng cho các thứ</div>
        <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Các thứ áp dụng cho nhân viên">
          {WEEKDAYS.map((day) => (
            <li key={day.value}>
              <Checkbox
                checked={draft.weekdays.includes(day.value)}
                disabled={!ready || busy}
                onChange={(checked) => toggleDay(day.value, checked)}
                label={<span>{day.short}</span>}
              />
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-slate-500">Không chọn thứ nào nghĩa là mọi ngày có ca trong lịch.</p>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" disabled={!ready || busy || Boolean(invalid)} onClick={() => void save()}>
          Lưu cho nhân viên
        </Button>
        {draft.employeeId ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(EMPTY_DRAFT)}>
            Bỏ chọn
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-700">Đang áp dụng ({active.length})</div>
        {active.length === 0 ? (
          <p className="text-xs text-slate-500">Chưa có nhân viên nào.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Nhân viên đang áp dụng">
            {active.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">{name(row)}</div>
                  <div className="text-xs text-slate-500">
                    {rangeLabel(row)} · {weekdaysLabel(row.weekdays)} · {row.reason}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" disabled={busy} onClick={() => edit(row)}>
                    Sửa
                  </Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => void remove(row)}>
                    Gỡ
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <button
          type="button"
          className="text-xs font-semibold text-blue-700 underline"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((v) => !v)}
        >
          Lịch sử đã gỡ ({history.length})
        </button>
        {showHistory ? (
          history.length === 0 ? (
            <p className="text-xs text-slate-500">Chưa có cấu hình nào bị gỡ.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Lịch sử đã gỡ">
              {history.map((row) => (
                <li key={row.id} className="px-3 py-2 text-sm">
                  <div className="font-medium text-slate-900">{name(row)}</div>
                  <div className="text-xs text-slate-500">
                    {rangeLabel(row)} · {weekdaysLabel(row.weekdays)} · {row.reason}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </section>
  );
}
