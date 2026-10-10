'use client';

import Link from 'next/link';
import { Clock, Loader2, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HrmShiftDefinition } from '@enterprise-platform/contracts-hrm';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { HrmApiError, hrmFetch } from '../hrm-api';
import {
  addMinutesToTime,
  computeShiftStandardHours,
  normalizeShiftTime,
  shiftStatusLabel,
} from '../hrm-shift-metrics';
import { cn } from '../utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { TimeTextInput } from '../ui/time-text-input';
import { toast } from '../ui/toast';

interface ShiftForm {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
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

/** Danh mục ca làm việc. Việc phân ca cho nhân viên thực hiện ở màn Phân ca làm việc. */
export default function ShiftsPage() {
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
    const hasBreak = form.breakMinutes > 0;
    const payload = {
      ...form,
      code: form.code.trim(),
      name: form.name.trim(),
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

  const numberField = (key: 'graceLateMinutes' | 'graceEarlyMinutes') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: Number(e.target.value) || 0 });

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[520px] flex-col gap-3">
      <div
        role="status"
        className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800"
      >
        Phân ca cho nhân viên thực hiện tại{' '}
        <Link href="/timekeeping?view=schedules" className="font-semibold underline underline-offset-2">
          Phân ca làm việc
        </Link>
        .
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="absolute top-2.5 left-3 size-3.5 text-slate-400" aria-hidden />
            <Input
              aria-label="Tìm mã ca hoặc tên ca"
              placeholder="Tìm mã ca, tên ca làm việc..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div role="group" aria-label="Lọc trạng thái" className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 text-xs">
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
                  'cursor-pointer rounded-md px-3 py-1 font-medium transition-all',
                  statusFilter === key ? 'bg-white font-bold text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Button size="sm" permission="hrm.shift.manage" onClick={openCreate}>
          <Plus className="size-3.5" aria-hidden />
          Thêm ca làm việc
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="min-h-0 flex-1 overflow-auto">
          {loadError ? (
            <div className="p-4">
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {loadError}
              </div>
            </div>
          ) : (
            <table className="w-full border-separate border-spacing-0 text-left text-xs">
              <thead>
                <tr className="text-[11px] font-bold tracking-wider text-slate-600 uppercase">
                  {['Mã ca', 'Tên ca làm việc', 'Khung giờ', 'Nghỉ giữa ca', 'Công chuẩn (giờ)', 'Dung sai trễ / sớm', 'Qua đêm', 'Trạng thái', 'Thao tác'].map(
                    (h) => (
                      <th key={h} scope="col" className="sticky top-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      <Loader2 className="mx-auto mb-2 size-6 animate-spin text-blue-700" aria-hidden />
                      Đang tải danh mục ca…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      Không tìm thấy ca làm việc nào phù hợp.
                    </td>
                  </tr>
                ) : (
                  filtered.map((shift) => (
                    <tr key={shift.id} className="hover:bg-slate-50/80">
                      <td className="border-b border-slate-100 px-4 py-3">
                        <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-bold text-blue-700">
                          {shift.code}
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 font-bold text-slate-900">{shift.name}</td>
                      <td className="border-b border-slate-100 px-4 py-3 font-mono font-semibold text-slate-800">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="size-3.5 text-blue-700" aria-hidden />
                          {normalizeShiftTime(shift.startTime)} - {normalizeShiftTime(shift.endTime)}
                          {shift.crossMidnight ? ' (+1)' : ''}
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 font-mono text-slate-700">
                        {shift.breakMinutes > 0
                          ? `${normalizeShiftTime(shift.breakStartTime)} - ${normalizeShiftTime(shift.breakEndTime)} (${shift.breakMinutes} phút)`
                          : 'Không nghỉ'}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 font-mono font-semibold text-slate-700">
                        {computeShiftStandardHours(shift) ?? '-'}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3 font-mono text-slate-600">
                        {shift.graceLateMinutes}p / {shift.graceEarlyMinutes}p
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        {shift.crossMidnight ? (
                          <Badge className="border-purple-200 bg-purple-100 text-[10px] text-purple-800">Qua đêm (+1)</Badge>
                        ) : (
                          <span className="text-[11px] text-slate-400">Không</span>
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        <Badge
                          className={cn(
                            'text-[10px]',
                            shift.status === 'ACTIVE'
                              ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
                              : 'border-slate-200 bg-slate-100 text-slate-600',
                          )}
                        >
                          {shiftStatusLabel(shift.status)}
                        </Badge>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="outline" permission="hrm.shift.manage" onClick={() => openEdit(shift)}>
                            Sửa
                          </Button>
                          {shift.status === 'ACTIVE' ? (
                            <Popconfirm
                              title={`Ngừng dùng ca ${shift.code}?`}
                              description="Ca sẽ không còn xuất hiện khi phân ca. Lịch đã phân trước đó giữ nguyên."
                              okText="Ngừng dùng"
                              cancelText="Không"
                              okType="danger"
                              placement="left"
                              onConfirm={() => setStatus(shift, 'INACTIVE')}
                            >
                              <Button size="sm" variant="destructive" permission="hrm.shift.manage">
                                Ngừng dùng
                              </Button>
                            </Popconfirm>
                          ) : (
                            <Button size="sm" variant="outline" permission="hrm.shift.manage" onClick={() => void setStatus(shift, 'ACTIVE')}>
                              Kích hoạt lại
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg space-y-4 bg-white p-6" aria-label={editing ? 'Cập nhật ca làm việc' : 'Thêm ca làm việc'}>
          <DialogHeader className="border-b pb-3">
            <DialogTitle>{editing ? `Cập nhật ca: ${editing.code}` : 'Thêm ca làm việc mới'}</DialogTitle>
            <DialogDescription>
              Cấu hình giờ bắt đầu, kết thúc, nghỉ giữa ca và dung sai chấm công.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block font-semibold text-slate-600">Mã ca làm việc *</span>
                <Input
                  aria-label="Mã ca làm việc"
                  placeholder="Ví dụ: HC, CA-SANG"
                  value={form.code}
                  disabled={!!editing}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  className="h-8 font-mono text-xs font-bold"
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold text-slate-600">Tên ca làm việc *</span>
                <Input
                  aria-label="Tên ca làm việc"
                  placeholder="Ví dụ: Hành chính tiêu chuẩn"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="h-8 text-xs"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1 block font-semibold text-slate-600">Giờ bắt đầu *</span>
                <TimeTextInput value={form.startTime} onChange={(v: string) => setForm({ ...form, startTime: v })} className="h-8 font-mono text-xs" />
              </div>
              <div>
                <span className="mb-1 block font-semibold text-slate-600">Giờ kết thúc *</span>
                <TimeTextInput value={form.endTime} onChange={(v: string) => setForm({ ...form, endTime: v })} className="h-8 font-mono text-xs" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block font-semibold text-slate-600">Thời gian nghỉ (phút)</span>
                <Input
                  aria-label="Thời gian nghỉ (phút)"
                  type="number"
                  min={0}
                  value={form.breakMinutes}
                  onChange={(e) => {
                    const breakMinutes = Number(e.target.value) || 0;
                    setForm({ ...form, breakMinutes, breakEndTime: addMinutesToTime(form.breakStartTime, breakMinutes) });
                  }}
                  className="h-8 font-mono text-xs"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 pt-5 font-semibold text-slate-700 select-none">
                <input
                  type="checkbox"
                  checked={form.crossMidnight}
                  onChange={(e) => setForm({ ...form, crossMidnight: e.target.checked })}
                  className="size-4 rounded border-slate-300 accent-blue-700"
                />
                Ca qua đêm (+1 ngày)
              </label>
            </div>

            {form.breakMinutes > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="mb-1 block font-semibold text-slate-600">Giờ bắt đầu nghỉ *</span>
                  <TimeTextInput
                    value={form.breakStartTime}
                    onChange={(v: string) =>
                      setForm({ ...form, breakStartTime: v, breakEndTime: addMinutesToTime(v, form.breakMinutes) })
                    }
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <div>
                  <span className="mb-1 block font-semibold text-slate-600">Giờ kết thúc nghỉ *</span>
                  <TimeTextInput value={form.breakEndTime} onChange={(v: string) => setForm({ ...form, breakEndTime: v })} className="h-8 font-mono text-xs" />
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block font-semibold text-slate-600">Dung sai đi muộn (phút)</span>
                <Input aria-label="Dung sai đi muộn (phút)" type="number" min={0} value={form.graceLateMinutes} onChange={numberField('graceLateMinutes')} className="h-8 font-mono text-xs" />
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold text-slate-600">Dung sai về sớm (phút)</span>
                <Input aria-label="Dung sai về sớm (phút)" type="number" min={0} value={form.graceEarlyMinutes} onChange={numberField('graceEarlyMinutes')} className="h-8 font-mono text-xs" />
              </label>
            </div>

            <div role="group" aria-label="Trạng thái áp dụng" className="flex items-center gap-2">
              <span className="font-semibold text-slate-600">Trạng thái:</span>
              {(
                [
                  ['ACTIVE', 'Đang dùng'],
                  ['INACTIVE', 'Tạm dừng'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={form.status === value ? 'default' : 'outline'}
                  aria-pressed={form.status === value}
                  onClick={() => setForm({ ...form, status: value })}
                >
                  {label}
                </Button>
              ))}
            </div>

            {formError ? (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {formError}
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(false)}>
              Hủy
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {editing ? 'Cập nhật thay đổi' : 'Lưu ca làm việc'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
