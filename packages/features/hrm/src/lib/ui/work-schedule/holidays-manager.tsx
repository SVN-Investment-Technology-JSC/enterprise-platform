'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CreateHolidayRequest,
  HrmHolidayKind,
  HrmOrgUnitOption,
  HrmShiftDefinition,
} from '@enterprise-platform/contracts-hrm';
import {
  Popconfirm,
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import {
  HOLIDAY_KIND_LABELS,
  buildScope,
  classifyScheduleError,
  emptyScopeDraft,
  formatVnDate,
  todayIso,
  validateDateRange,
  validateScopeDraft,
  type ScopeDraft,
} from '../../hrm-work-schedule-model';
import {
  cancelHoliday,
  createHoliday,
  fetchHolidays,
  type HrmHolidayRow,
} from '../../hrm-work-schedule-api';
import { cn } from '../../utils';
import { Button } from '../button';
import { DatePickerInput } from '../date-picker-input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { Input } from '../input';
import { toast } from '../toast';
import { Checkbox, EmptyState, Field, Notice, Spinner, textareaClass } from './common';
import { ScopePicker } from './scope-picker';
import { useShiftOptions } from './weekly-pattern-editor';

const KIND_OPTIONS: SearchableSelectOption[] = (
  Object.keys(HOLIDAY_KIND_LABELS) as HrmHolidayKind[]
).map((k) => ({ value: k, label: HOLIDAY_KIND_LABELS[k] }));

const STATUS_OPTIONS: SearchableSelectOption[] = [
  { value: 'ALL', label: 'Tất cả trạng thái' },
  { value: 'ACTIVE', label: 'Đang áp dụng' },
  { value: 'CANCELLED', label: 'Đã hủy' },
];

const SCOPE_TEXT: Record<string, string> = {
  COMPANY: 'Toàn công ty',
  UNIT: 'Theo đơn vị',
  EMPLOYEES: 'Nhân viên chỉ định',
};

function HolidayForm({
  shifts,
  units,
  employeeOptions,
  employeesLoading,
  employeesError,
  onSaved,
  onCancel,
}: {
  shifts: readonly HrmShiftDefinition[];
  units: readonly HrmOrgUnitOption[];
  employeeOptions: readonly SearchableSelectOption[];
  employeesLoading: boolean;
  employeesError: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<HrmHolidayKind>('HOLIDAY');
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());
  const [scope, setScope] = useState<ScopeDraft>(emptyScopeDraft('COMPANY'));
  const [treatment, setTreatment] = useState<'OFF' | 'SHIFT'>('OFF');
  const [shiftId, setShiftId] = useState('');
  const [paid, setPaid] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shiftOptions = useShiftOptions(shifts);

  async function save() {
    const invalid =
      (name.trim() ? null : 'Nhập tên ngày lễ.') ??
      validateDateRange(fromDate, toDate) ??
      validateScopeDraft(scope) ??
      (treatment === 'SHIFT' && !shiftId ? 'Chọn ca sẽ bố trí trong ngày lễ.' : null);
    if (invalid) {
      setError(invalid);
      return;
    }
    const body: CreateHolidayRequest = {
      name: name.trim(),
      kind,
      fromDate,
      toDate,
      scope: buildScope(scope),
      treatment,
      shiftId: treatment === 'SHIFT' ? shiftId : null,
      paid,
      note: note.trim() || null,
    };
    setBusy(true);
    setError('');
    try {
      await createHoliday(body);
      toast.success('Đã tạo ngày lễ và cập nhật lịch của nhân viên liên quan.');
      onSaved();
    } catch (e) {
      setError(classifyScheduleError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        <div className="grid max-w-3xl grid-cols-2 gap-4">
          <Field label="Tên ngày lễ">
            <Input aria-label="Tên ngày lễ" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Loại">
            <SearchableSelect
              options={KIND_OPTIONS}
              value={kind}
              clearable={false}
              onChange={(v) => v && setKind(v as HrmHolidayKind)}
            />
          </Field>
          <Field label="Từ ngày">
            <DatePickerInput aria-label="Từ ngày" value={fromDate} onChange={setFromDate} />
          </Field>
          <Field label="Đến ngày">
            <DatePickerInput aria-label="Đến ngày" value={toDate} onChange={setToDate} />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-slate-700">Phạm vi áp dụng</div>
          <ScopePicker
            value={scope}
            onChange={setScope}
            allowedTypes={['COMPANY', 'UNIT', 'EMPLOYEES']}
            employeeOptions={employeeOptions}
            employeesLoading={employeesLoading}
            employeesError={employeesError}
            units={units}
          />
        </div>
        <div className="flex max-w-3xl flex-col gap-2">
          <div className="text-xs font-semibold text-slate-700">Cách xử lý trong ngày lễ</div>
          <div role="radiogroup" aria-label="Cách xử lý ngày lễ" className="flex gap-2">
            {(
              [
                ['OFF', 'Nghỉ lễ'],
                ['SHIFT', 'Vẫn bố trí ca'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={treatment === value}
                onClick={() => setTreatment(value)}
                className={cn(
                  'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold',
                  treatment === value
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-blue-400',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {treatment === 'SHIFT' ? (
            <Field label="Ca bố trí trong ngày lễ">
              <SearchableSelect
                options={shiftOptions}
                value={shiftId}
                placeholder="Chọn ca từ danh mục ca…"
                emptyText="Không tìm thấy ca phù hợp"
                onChange={setShiftId}
              />
            </Field>
          ) : null}
          <Checkbox checked={paid} onChange={setPaid} label="Hưởng lương ngày lễ" />
          <Field label="Ghi chú (tuỳ chọn)">
            <textarea className={textareaClass} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <Notice tone="info">
          Ngày lễ trên lịch không đồng nghĩa nhân viên đã đi làm. Công thực tế vẫn dựa trên chấm công; lịch lễ chỉ xác
          định ngày đó nghỉ lễ hay vẫn bố trí ca.
        </Notice>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
        <Button variant="outline" onClick={onCancel}>
          Quay lại danh sách
        </Button>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? 'Đang lưu…' : 'Lưu ngày lễ'}
        </Button>
      </div>
    </div>
  );
}

export function HolidaysManager({
  open,
  onOpenChange,
  shifts,
  units,
  employeeOptions,
  employeesLoading,
  employeesError,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shifts: readonly HrmShiftDefinition[];
  units: readonly HrmOrgUnitOption[];
  employeeOptions: readonly SearchableSelectOption[];
  employeesLoading: boolean;
  employeesError: string;
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [year, setYear] = useState(() => Number(todayIso().slice(0, 4)));
  const [status, setStatus] = useState('ALL');
  const [rows, setRows] = useState<HrmHolidayRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchHolidays(year, status === 'ALL' ? undefined : (status as 'ACTIVE' | 'CANCELLED'));
      setRows(res.data);
    } catch (e) {
      setRows(null);
      setError(classifyScheduleError(e).message);
    } finally {
      setLoading(false);
    }
  }, [year, status]);

  useEffect(() => {
    if (open) {
      setCreating(false);
    }
  }, [open]);
  useEffect(() => {
    if (open && !creating) void load();
  }, [open, creating, load]);

  const shiftCodeOf = useMemo(() => new Map(shifts.map((s) => [s.id, s.code])), [shifts]);

  async function cancel(row: HrmHolidayRow, reason?: string) {
    try {
      await cancelHoliday(row.id, reason ?? '');
      toast.success(`Đã hủy ngày lễ ${row.name}.`);
      onChanged();
      await load();
    } catch (e) {
      setError(classifyScheduleError(e).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(88dvh,760px)] max-w-5xl" aria-label="Lịch lễ và Tết">
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-4">
          <DialogTitle className="text-lg">{creating ? 'Tạo ngày lễ, Tết' : 'Lịch lễ và Tết'}</DialogTitle>
          <DialogDescription>
            Khai báo ngày lễ, Tết, nghỉ bù hoặc ngày đặc biệt theo công ty, đơn vị hoặc nhân viên chỉ định.
          </DialogDescription>
        </DialogHeader>
        {creating ? (
          <HolidayForm
            shifts={shifts}
            units={units}
            employeeOptions={employeeOptions}
            employeesLoading={employeesLoading}
            employeesError={employeesError}
            onCancel={() => setCreating(false)}
            onSaved={() => {
              onChanged();
              setCreating(false);
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-4">
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" aria-label="Năm trước" onClick={() => setYear((y) => y - 1)}>
                  Năm trước
                </Button>
                <span className="min-w-14 text-center text-sm font-bold text-slate-900">{year}</span>
                <Button variant="outline" size="sm" aria-label="Năm sau" onClick={() => setYear((y) => y + 1)}>
                  Năm sau
                </Button>
              </div>
              <div className="w-52">
                <SearchableSelect
                  options={STATUS_OPTIONS}
                  value={status}
                  clearable={false}
                  onChange={(v) => setStatus(v || 'ALL')}
                />
              </div>
              <Notice tone="info" className="min-w-0 flex-1">
                Ngày lễ trên lịch không đồng nghĩa nhân viên đã đi làm; công thực tế dựa trên chấm công.
              </Notice>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-3">
              {error ? <Notice tone="error">{error}</Notice> : null}
              {loading && !rows ? (
                <EmptyState>
                  <Spinner label="Đang tải lịch lễ…" />
                </EmptyState>
              ) : rows && rows.length === 0 ? (
                <EmptyState>Chưa có ngày lễ nào trong năm {year}.</EmptyState>
              ) : rows ? (
                <table className={cn('w-full border-separate border-spacing-0 text-xs', loading && 'opacity-60')}>
                  <thead>
                    <tr className="text-left text-[11px] font-bold tracking-wide text-slate-600 uppercase">
                      {['Ngày lễ', 'Loại', 'Thời gian', 'Phạm vi', 'Xử lý', 'Trạng thái', 'Thao tác'].map((h) => (
                        <th key={h} scope="col" className="sticky top-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((h) => (
                      <tr key={h.id} className="hover:bg-slate-50">
                        <td className="border-b border-slate-100 px-3 py-2">
                          <div className="font-semibold text-slate-900">{h.name}</div>
                          {h.note ? <div className="text-[11px] text-slate-500">{h.note}</div> : null}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2">{HOLIDAY_KIND_LABELS[h.kind]}</td>
                        <td className="border-b border-slate-100 px-3 py-2 whitespace-nowrap">
                          {formatVnDate(h.fromDate)}
                          {h.toDate !== h.fromDate ? ` - ${formatVnDate(h.toDate)}` : ''}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2">{SCOPE_TEXT[h.scopeType] ?? h.scopeType}</td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          {h.treatment === 'OFF'
                            ? 'Nghỉ lễ'
                            : `Vẫn bố trí ca ${h.shiftCode ?? (h.shiftId ? shiftCodeOf.get(h.shiftId) : '') ?? ''}`.trim()}
                          <span className="ml-1 text-slate-400">{h.paid === false ? '(không lương)' : '(hưởng lương)'}</span>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <span
                            className={cn(
                              'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium',
                              h.status === 'CANCELLED'
                                ? 'border-slate-200 bg-slate-100 text-slate-500'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                            )}
                          >
                            {h.status === 'CANCELLED' ? 'Đã hủy' : 'Đang áp dụng'}
                          </span>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          {h.status !== 'CANCELLED' ? (
                            <Popconfirm
                              title={`Hủy ngày lễ ${h.name}?`}
                              description="Lịch ngày lễ của nhân viên liên quan sẽ được gỡ. Nhập lý do hủy."
                              okText="Hủy ngày lễ"
                              cancelText="Không"
                              okType="danger"
                              placement="left"
                              reasonRequired
                              reasonLabel="Lý do hủy"
                              onConfirm={(reason) => cancel(h, reason)}
                            >
                              <Button size="sm" variant="destructive">
                                Hủy
                              </Button>
                            </Popconfirm>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-3">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
              <Button onClick={() => setCreating(true)}>Thêm ngày lễ</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
