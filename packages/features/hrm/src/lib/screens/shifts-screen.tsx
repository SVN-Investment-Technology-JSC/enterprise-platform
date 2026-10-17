'use client';

import Link from 'next/link';
import {
  CalendarRange,
  Clock,
  Coffee,
  History,
  Info,
  Loader2,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HrmShiftDefinition } from '@enterprise-platform/contracts-hrm';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { HrmApiError, hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import {
  addMinutesToTime,
  computeShiftStandardHours,
  normalizeShiftTime,
  shiftStatusLabel,
} from '../hrm-shift-metrics';
import { cn } from '../utils';
import { Button } from '../ui/button';
import { ConfigHistoryDrawer } from '../ui/config-history-drawer';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { PageTitle } from '../ui/page-title';
import { EmptyPanel, InfoNote, SettingsField, SettingsSection, SettingsSwitch, StatusPill } from '../ui/settings-kit';
import { TimeTextInput } from '../ui/time-text-input';
import { toast } from '../ui/toast';

interface ShiftForm {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  /** Ca có nghỉ giữa ca hay không (ca nửa ngày thường không có giờ nghỉ). */
  hasBreak: boolean;
  breakMinutes: number;
  breakStartTime: string;
  breakEndTime: string;
  crossMidnight: boolean;
  graceLateMinutes: number;
  graceEarlyMinutes: number;
  status: 'ACTIVE' | 'INACTIVE';
}

const EMPTY_FORM: ShiftForm = {
  code: '',
  name: '',
  startTime: '08:00',
  endTime: '17:30',
  hasBreak: true,
  breakMinutes: 60,
  breakStartTime: '12:00',
  breakEndTime: '13:00',
  crossMidnight: false,
  graceLateMinutes: 10,
  graceEarlyMinutes: 5,
  status: 'ACTIVE',
};

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

function formFromShift(shift: HrmShiftDefinition): ShiftForm {
  const breakStart = normalizeShiftTime(shift.breakStartTime) || '12:00';
  const breakMinutes = shift.breakMinutes ?? 0;
  return {
    code: shift.code,
    name: shift.name,
    startTime: normalizeShiftTime(shift.startTime) || '08:00',
    endTime: normalizeShiftTime(shift.endTime) || '17:30',
    hasBreak: breakMinutes > 0,
    breakMinutes,
    breakStartTime: breakStart,
    breakEndTime: normalizeShiftTime(shift.breakEndTime) || addMinutesToTime(breakStart, breakMinutes),
    crossMidnight: shift.crossMidnight ?? false,
    graceLateMinutes: shift.graceLateMinutes ?? 10,
    graceEarlyMinutes: shift.graceEarlyMinutes ?? 5,
    status: shift.status ?? 'ACTIVE',
  };
}

function errorText(error: unknown): string {
  if (error instanceof HrmApiError && error.code === 'HRM_STALE_VERSION')
    return 'Ca đã được người khác cập nhật. Danh sách đã được tải lại; hãy mở lại ca để sửa trên bản mới nhất.';
  return error instanceof Error ? error.message : 'Không thực hiện được thao tác.';
}

const toMinutes = (value?: string | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

type BarSegments = { work: [number, number][]; rest: [number, number][] };

/**
 * Đoạn giờ làm và giờ nghỉ của một ca trên thanh 24 giờ, tính theo % (0 đến 100). Ca qua đêm được cắt làm hai đoạn
 * (đến hết 24:00 và từ 00:00). Thiếu giờ thì không có đoạn nào.
 */
export function shiftBarSegments(shift: {
  startTime?: string | null;
  endTime?: string | null;
  crossMidnight?: boolean | null;
  breakMinutes?: number | null;
  breakStartTime?: string | null;
  breakEndTime?: string | null;
}): BarSegments {
  const start = toMinutes(shift.startTime);
  const end = toMinutes(shift.endTime);
  const out: BarSegments = { work: [], rest: [] };
  if (start === null || end === null) return out;
  const pct = (a: number, b: number): [number, number][] => {
    const cut = (x: number, y: number): [number, number] => [(x / 1440) * 100, (y / 1440) * 100];
    return b <= 1440 ? [cut(a, b)] : [cut(a, 1440), cut(0, b - 1440)];
  };
  const finish = shift.crossMidnight || end <= start ? end + 1440 : end;
  out.work = pct(start, finish);
  const bs = toMinutes(shift.breakStartTime);
  const be = toMinutes(shift.breakEndTime);
  if ((shift.breakMinutes ?? 0) > 0 && bs !== null && be !== null) {
    const from = bs < start ? bs + 1440 : bs;
    const to = from + (be > bs ? be - bs : be + 1440 - bs);
    out.rest = pct(from, to);
  }
  return out;
}

/** Thanh 24 giờ thu nhỏ: đoạn giờ làm tô xanh, đoạn nghỉ giữa ca tô vàng cam. Chỉ để nhìn, không có chữ. */
function ShiftTimeBar({ shift }: { shift: Parameters<typeof shiftBarSegments>[0] }) {
  const { work, rest } = shiftBarSegments(shift);
  const seg = (range: [number, number], cls: string, key: string) => (
    <span
      key={key}
      className={`absolute inset-y-0 rounded-full ${cls}`}
      style={{ left: `${range[0]}%`, width: `${Math.max(range[1] - range[0], 1)}%` }}
    />
  );
  return (
    <span aria-hidden="true" className="relative block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      {work.map((r, i) => seg(r, 'bg-blue-500', `w${i}`))}
      {rest.map((r, i) => seg(r, 'bg-amber-400', `r${i}`))}
    </span>
  );
}

const formatHours = (hours: number | null) => (hours === null ? '-' : String(hours).replace('.', ','));

/** Lưới của một dòng ca: thẻ dọc khi hẹp, từ @3xl là năm cột thẳng hàng với dòng tiêu đề. */
const ROW_GRID =
  'grid grid-cols-1 items-start gap-x-3 gap-y-3 @xl:grid-cols-2 @3xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_17.5rem]';

function Caption({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-[11px] font-medium text-slate-500 @3xl:sr-only">{children}</span>;
}

/** Nút chọn một trong hai/ba trạng thái dạng phân đoạn gọn (dùng aria-pressed). */
function Segmented<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (next: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex w-full gap-0.5 rounded-lg bg-slate-100 p-0.5">
      {options.map(([key, text]) => (
        <button
          key={String(key)}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'h-8 min-w-0 flex-1 cursor-pointer truncate rounded-md px-2 text-xs transition-colors',
            value === key ? 'bg-white font-bold text-slate-900 shadow-xs' : 'font-medium text-slate-500 hover:text-slate-900',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Danh mục ca làm việc. Việc phân ca cho nhân viên thực hiện ở màn Phân ca làm việc. */
export default function ShiftsPage() {
  const { can } = useHrmPermissions();
  const canAudit = can('hrm.audit.read');
  const [shifts, setShifts] = useState<HrmShiftDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HrmShiftDefinition | null>(null);
  const [form, setForm] = useState<ShiftForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrmFetch<{ data: HrmShiftDefinition[] }>('/shifts');
      setShifts(res.data);
      setLoadError('');
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return shifts.filter(
      (s) =>
        (statusFilter === 'ALL' || s.status === statusFilter) &&
        (!needle || s.code.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle)),
    );
  }, [shifts, searchTerm, statusFilter]);

  const activeCount = shifts.filter((s) => s.status === 'ACTIVE').length;

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setDialogOpen(true);
  }

  function openEdit(shift: HrmShiftDefinition) {
    setEditing(shift);
    setForm(formFromShift(shift));
    setFormError('');
    setDialogOpen(true);
  }

  async function save() {
    if (!form.code.trim() || !form.name.trim()) {
      setFormError('Nhập mã ca và tên ca làm việc.');
      return;
    }
    const { hasBreak, ...fields } = form;
    if (hasBreak) {
      const start = toMinutes(form.startTime) ?? 0;
      const end = (toMinutes(form.endTime) ?? 0) + (form.crossMidnight ? 1440 : 0);
      let breakStart = toMinutes(form.breakStartTime) ?? 0;
      let breakEnd = toMinutes(form.breakEndTime) ?? 0;
      if (form.crossMidnight && breakStart < start) breakStart += 1440;
      if (form.crossMidnight && breakEnd <= start) breakEnd += 1440;
      if (!(form.breakMinutes > 0)) {
        setFormError('Nhập số phút nghỉ lớn hơn 0, hoặc chọn "Không nghỉ giữa ca".');
        return;
      }
      if (breakStart < start || breakEnd > end || breakEnd <= breakStart || breakEnd - breakStart !== form.breakMinutes) {
        setFormError('Giờ nghỉ phải nằm trong ca và khớp số phút nghỉ, hoặc chọn "Không nghỉ giữa ca".');
        return;
      }
    }
    const payload = {
      ...fields,
      code: form.code.trim(),
      name: form.name.trim(),
      breakMinutes: hasBreak ? form.breakMinutes : 0,
      breakStartTime: hasBreak ? form.breakStartTime : null,
      breakEndTime: hasBreak ? form.breakEndTime : null,
    };
    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        // Backend yêu cầu expectedUpdatedAt của bản ghi vừa tải để chống ghi đè.
        await hrmFetch(`/shifts/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, expectedUpdatedAt: editing.updatedAt }),
        });
        toast.success(`Đã cập nhật ca ${payload.code}.`);
      } else {
        await hrmFetch('/shifts', { method: 'POST', body: JSON.stringify(payload) });
        toast.success(`Đã tạo ca ${payload.code}.`);
      }
      setDialogOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      setFormError(errorText(error));
      if (error instanceof HrmApiError && error.code === 'HRM_STALE_VERSION') await load();
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(shift: HrmShiftDefinition, status: 'ACTIVE' | 'INACTIVE') {
    try {
      await hrmFetch(`/shifts/${shift.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, expectedUpdatedAt: shift.updatedAt }),
      });
      toast.success(status === 'ACTIVE' ? `Đã kích hoạt lại ca ${shift.code}.` : `Đã ngừng dùng ca ${shift.code}.`);
    } catch (error) {
      toast.error(errorText(error));
    }
    await load();
  }

  async function removeShift(shift: HrmShiftDefinition) {
    try {
      const res = await hrmFetch<{ data: { id: string; deleted: boolean }; message?: string }>(
        `/shifts/${shift.id}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ expectedUpdatedAt: shift.updatedAt }),
        },
      );
      if (res.message) {
        if (res.data?.deleted) {
          toast.success(res.message);
        } else {
          toast.warning(res.message);
        }
      } else {
        toast.success(`Đã xóa ca ${shift.code}.`);
      }
    } catch (error) {
      toast.error(errorText(error));
    }
    await load();
  }

  const numberField = (key: 'graceLateMinutes' | 'graceEarlyMinutes') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: Number(e.target.value) || 0 });

  const previewHours = computeShiftStandardHours({
    startTime: form.startTime,
    endTime: form.endTime,
    crossMidnight: form.crossMidnight,
    breakMinutes: form.hasBreak ? form.breakMinutes : 0,
  });

  return (
    <div className="@container mx-auto max-w-[1400px] space-y-4">
      <PageTitle
        title="Danh mục ca"
        description="Quản lý danh mục ca, mẫu ca và quy tắc tính."
        actions={
          <>
            {canAudit ? (
              <Button variant="outline" className="h-9 gap-1.5 px-3 text-xs font-semibold" onClick={() => setHistoryOpen(true)}>
                <History className="size-4" aria-hidden />
                Lịch sử thay đổi
              </Button>
            ) : null}
            <Button permission="hrm.shift.manage" className="h-9 gap-1.5 px-4 text-xs font-semibold" onClick={openCreate}>
              <Plus className="size-4" aria-hidden />
              Thêm ca
            </Button>
          </>
        }
      />

      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              aria-label="Tìm mã ca hoặc tên ca"
              placeholder="Tìm mã ca, tên ca làm việc..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 pl-9 text-xs"
            />
          </div>
          <div role="group" aria-label="Lọc trạng thái" className="flex w-full gap-0.5 rounded-lg bg-slate-100 p-0.5 text-xs @xl:w-auto">
            {(
              [
                ['ALL', `Tất cả (${shifts.length})`],
                ['ACTIVE', `Đang dùng (${activeCount})`],
                ['INACTIVE', `Tạm dừng (${shifts.length - activeCount})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={statusFilter === key}
                onClick={() => setStatusFilter(key)}
                className={cn(
                  'h-8 min-w-0 flex-1 cursor-pointer truncate rounded-md px-3 font-medium whitespace-nowrap transition-all @xl:flex-none',
                  statusFilter === key ? 'bg-white font-bold text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loadError ? (
          <div className="p-3">
            <InfoNote tone="red" role="alert">
              {loadError}
            </InfoNote>
          </div>
        ) : loading ? (
          <p role="status" className="py-12 text-center text-xs text-slate-500">
            <Loader2 className="mx-auto mb-2 size-6 animate-spin text-blue-700" aria-hidden />
            Đang tải danh mục ca…
          </p>
        ) : filtered.length === 0 ? (
          <div className="p-3">
            <EmptyPanel icon={CalendarRange} title="Không tìm thấy ca làm việc nào phù hợp." />
          </div>
        ) : (
          <div>
            <div
              aria-hidden="true"
              className={`${ROW_GRID} hidden items-center border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-600 @3xl:grid`}
            >
              <span>Ca làm việc</span>
              <span>Khung giờ</span>
              <span>Nghỉ giữa ca</span>
              <span>Dung sai (trễ / sớm)</span>
              <span className="text-right">Thao tác</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {filtered.map((shift) => {
                const hasBreak = shift.breakMinutes > 0;
                return (
                  <li key={shift.id} data-testid={`shift-row-${shift.code}`} className={`${ROW_GRID} px-3 py-3 @xl:px-4 hover:bg-slate-50/60`}>
                    <div className="min-w-0 @xl:col-span-2 @3xl:col-span-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-bold text-blue-700">
                          {shift.code}
                        </span>
                        <StatusPill tone={shift.status === 'ACTIVE' ? 'green' : 'slate'}>{shiftStatusLabel(shift.status)}</StatusPill>
                      </div>
                      <p className="mt-1 text-sm font-bold break-words text-slate-900">{shift.name}</p>
                    </div>

                    <div className="min-w-0">
                      <Caption>Khung giờ</Caption>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-slate-800">
                          <Clock className="size-3.5 text-blue-700" aria-hidden />
                          {normalizeShiftTime(shift.startTime)} - {normalizeShiftTime(shift.endTime)}
                          {shift.crossMidnight ? ' (+1)' : ''}
                        </span>
                        {shift.crossMidnight ? <StatusPill tone="violet">Qua đêm</StatusPill> : null}
                      </div>
                      <div className="mt-1.5">
                        <ShiftTimeBar shift={shift} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Công chuẩn: <strong className="font-semibold text-slate-700">{formatHours(computeShiftStandardHours(shift))} giờ</strong>
                      </p>
                    </div>

                    <div className="min-w-0">
                      <Caption>Nghỉ giữa ca</Caption>
                      {hasBreak ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 font-mono text-xs font-semibold text-amber-800">
                            <Coffee className="size-3.5" aria-hidden />
                            {normalizeShiftTime(shift.breakStartTime)} - {normalizeShiftTime(shift.breakEndTime)}
                          </span>
                          <p className="mt-1 text-[11px] text-slate-500">{shift.breakMinutes} phút</p>
                        </>
                      ) : (
                        <span className="text-xs text-slate-500">Không nghỉ</span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <Caption>Dung sai (trễ / sớm)</Caption>
                      <span className="font-mono text-xs text-slate-700">
                        {shift.graceLateMinutes}p / {shift.graceEarlyMinutes}p
                      </span>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-1.5 @3xl:justify-end">
                      <Button
                        variant="outline"
                        permission="hrm.shift.manage"
                        aria-label="Sửa"
                        title="Sửa ca"
                        className="h-9 gap-1.5 px-3 text-xs"
                        onClick={() => openEdit(shift)}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        <span>Sửa</span>
                      </Button>
                      {shift.status === 'ACTIVE' ? (
                        <Popconfirm
                          title={`Ngừng dùng ca ${shift.code}?`}
                          description="Ca sẽ không còn xuất hiện khi phân ca. Lịch đã phân trước đó giữ nguyên."
                          okText="Ngừng dùng"
                          cancelText="Không"
                          okType="danger"
                          placement="top-end"
                          onConfirm={() => setStatus(shift, 'INACTIVE')}
                        >
                          <Button variant="outline" permission="hrm.shift.manage" className="h-9 px-3 text-xs text-amber-700 border-amber-300 hover:bg-amber-50">
                            Ngừng dùng
                          </Button>
                        </Popconfirm>
                      ) : (
                        <Button variant="outline" permission="hrm.shift.manage" className="h-9 px-3 text-xs text-blue-700 border-blue-200 hover:bg-blue-50" onClick={() => void setStatus(shift, 'ACTIVE')}>
                          Kích hoạt lại
                        </Button>
                      )}
                      <Popconfirm
                        title={`Xóa ca ${shift.code}?`}
                        description="Nếu ca chưa phát sinh dữ liệu, ca sẽ được xóa vĩnh viễn. Nếu ca đã có dữ liệu (lịch phân ca / chấm công), ca sẽ được lưu trữ và ẩn khỏi danh mục ca để bảo toàn lịch sử."
                        okText="Xóa ca"
                        cancelText="Quay lại"
                        okType="danger"
                        placement="top-end"
                        onConfirm={() => removeShift(shift)}
                      >
                        <Button
                          variant="destructive"
                          permission="hrm.shift.manage"
                          aria-label="Xóa ca"
                          title="Xóa ca"
                          className="h-9 gap-1.5 px-3 text-xs"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                          <span>Xóa</span>
                        </Button>
                      </Popconfirm>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="border-t border-slate-100 p-3">
          <InfoNote tone="blue" role="status" icon={Info}>
            Phân ca cho nhân viên thực hiện tại{' '}
            <Link href="/settings?view=schedules" className="font-semibold text-blue-700 underline underline-offset-2">
              Phân ca làm việc
            </Link>
            . Ca đã được phân công thì không đổi khung giờ được; hãy tạo mã ca mới.
          </InfoNote>
        </div>
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className="max-h-[90dvh] max-w-4xl gap-0 bg-white p-0"
          aria-label={editing ? 'Cập nhật ca làm việc' : 'Thêm ca làm việc'}
        >
          <DialogHeader className="shrink-0 border-b border-slate-200 px-5 py-4 pr-12">
            <DialogTitle>{editing ? `Cập nhật ca: ${editing.code}` : 'Thêm ca làm việc mới'}</DialogTitle>
            <DialogDescription>Cấu hình giờ bắt đầu, kết thúc, nghỉ giữa ca và dung sai chấm công.</DialogDescription>
          </DialogHeader>

          <div className="@container min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3 @xl:p-4">
            <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
              <SettingsSection icon={Tag} tone="blue" title="Thông tin ca" description="Mã ca không đổi được sau khi tạo." bodyClassName="space-y-3">
                <SettingsField label="Mã ca làm việc" required htmlFor="shift-code" hint="Ví dụ: HC, CA-SANG.">
                  <Input
                    id="shift-code"
                    aria-label="Mã ca làm việc"
                    placeholder="Ví dụ: HC, CA-SANG"
                    value={form.code}
                    disabled={!!editing}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    className="h-9 font-mono text-xs font-bold"
                  />
                </SettingsField>
                <SettingsField label="Tên ca làm việc" required htmlFor="shift-name">
                  <Input
                    id="shift-name"
                    aria-label="Tên ca làm việc"
                    placeholder="Ví dụ: Hành chính tiêu chuẩn"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="h-9 text-xs"
                  />
                </SettingsField>
              </SettingsSection>

              <SettingsSection icon={Clock} tone="green" title="Khung giờ" description="Giờ vào và giờ ra của ca." bodyClassName="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <SettingsField label="Giờ bắt đầu" required htmlFor="shift-start">
                    <TimeTextInput id="shift-start" value={form.startTime} onChange={(v: string) => setForm({ ...form, startTime: v })} className="h-9 font-mono text-xs" />
                  </SettingsField>
                  <SettingsField label="Giờ kết thúc" required htmlFor="shift-end">
                    <TimeTextInput id="shift-end" value={form.endTime} onChange={(v: string) => setForm({ ...form, endTime: v })} className="h-9 font-mono text-xs" />
                  </SettingsField>
                </div>
                <div className="flex items-center gap-3">
                  <SettingsSwitch label="Ca qua đêm (+1 ngày)" checked={form.crossMidnight} onChange={(next) => setForm({ ...form, crossMidnight: next })} />
                  <span className="min-w-0 text-xs font-semibold text-slate-700">
                    Ca qua đêm (+1 ngày)
                    <span className="block text-[11px] font-normal text-slate-500">Giờ kết thúc thuộc ngày hôm sau.</span>
                  </span>
                </div>
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Công chuẩn: <strong className="font-semibold text-slate-800">{formatHours(previewHours)} giờ</strong>
                </p>
              </SettingsSection>

              <SettingsSection icon={Coffee} tone="orange" title="Nghỉ giữa ca" description="Giờ nghỉ được trừ khỏi công chuẩn." bodyClassName="space-y-3">
                <Segmented
                  label="Nghỉ giữa ca"
                  value={form.hasBreak}
                  options={[
                    [true, 'Có giờ nghỉ'],
                    [false, 'Không nghỉ giữa ca'],
                  ]}
                  onChange={(value) =>
                    setForm(
                      value
                        ? {
                            ...form,
                            hasBreak: true,
                            breakMinutes: form.breakMinutes > 0 ? form.breakMinutes : 60,
                            breakEndTime: addMinutesToTime(form.breakStartTime, form.breakMinutes > 0 ? form.breakMinutes : 60),
                          }
                        : { ...form, hasBreak: false },
                    )
                  }
                />
                {form.hasBreak ? (
                  <div className="grid grid-cols-2 gap-3">
                    <SettingsField label="Thời gian nghỉ (phút)" required htmlFor="shift-break-minutes" className="col-span-2">
                      <Input
                        id="shift-break-minutes"
                        aria-label="Thời gian nghỉ (phút)"
                        type="number"
                        min={1}
                        value={form.breakMinutes}
                        onChange={(e) => {
                          const breakMinutes = Number(e.target.value) || 0;
                          setForm({ ...form, breakMinutes, breakEndTime: addMinutesToTime(form.breakStartTime, breakMinutes) });
                        }}
                        className="h-9 font-mono text-xs"
                      />
                    </SettingsField>
                    <SettingsField label="Giờ bắt đầu nghỉ" required htmlFor="shift-break-start">
                      <TimeTextInput
                        id="shift-break-start"
                        value={form.breakStartTime}
                        onChange={(v: string) => setForm({ ...form, breakStartTime: v, breakEndTime: addMinutesToTime(v, form.breakMinutes) })}
                        className="h-9 font-mono text-xs"
                      />
                    </SettingsField>
                    <SettingsField label="Giờ kết thúc nghỉ" required htmlFor="shift-break-end">
                      <TimeTextInput id="shift-break-end" value={form.breakEndTime} onChange={(v: string) => setForm({ ...form, breakEndTime: v })} className="h-9 font-mono text-xs" />
                    </SettingsField>
                  </div>
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Ca làm liên tục, không trừ giờ nghỉ (ví dụ ca nửa ngày).</p>
                )}
              </SettingsSection>

              <SettingsSection icon={SlidersHorizontal} tone="violet" title="Dung sai và trạng thái" description="Số phút được châm chước và trạng thái áp dụng." bodyClassName="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <SettingsField label="Dung sai đi muộn (phút)" htmlFor="shift-grace-late">
                    <Input id="shift-grace-late" aria-label="Dung sai đi muộn (phút)" type="number" min={0} value={form.graceLateMinutes} onChange={numberField('graceLateMinutes')} className="h-9 font-mono text-xs" />
                  </SettingsField>
                  <SettingsField label="Dung sai về sớm (phút)" htmlFor="shift-grace-early">
                    <Input id="shift-grace-early" aria-label="Dung sai về sớm (phút)" type="number" min={0} value={form.graceEarlyMinutes} onChange={numberField('graceEarlyMinutes')} className="h-9 font-mono text-xs" />
                  </SettingsField>
                </div>
                <SettingsField label="Trạng thái áp dụng">
                  <Segmented
                    label="Trạng thái áp dụng"
                    value={form.status}
                    options={[
                      ['ACTIVE', 'Đang dùng'],
                      ['INACTIVE', 'Tạm dừng'],
                    ]}
                    onChange={(value) => setForm({ ...form, status: value })}
                  />
                </SettingsField>
              </SettingsSection>
            </div>

            {formError ? (
              <InfoNote tone="red" role="alert">
                {formError}
              </InfoNote>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
            <Button variant="outline" className="h-9 px-4 text-xs" onClick={() => setDialogOpen(false)}>
              Hủy
            </Button>
            <Button className="h-9 gap-1.5 px-4 text-xs font-semibold" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {editing ? 'Cập nhật thay đổi' : 'Lưu ca làm việc'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {canAudit ? (
        <ConfigHistoryDrawer
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          description="Các lần tạo và cập nhật ca làm việc, mới nhất ở trên."
          actionPrefixes={['SHIFT_CREATED', 'SHIFT_UPDATED']}
        />
      ) : null}
    </div>
  );
}
