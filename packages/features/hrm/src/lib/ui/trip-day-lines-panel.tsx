'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import type { HrmTripDayLine, HrmTripDayLines, HrmTripDayWindow } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../hrm-comp-off-api';
import {
  formatTripMinutes,
  TRIP_DAY_STATUS_LABELS,
  tripDayChanges,
  tripDayLabel,
  tripWindowProblem,
} from '../comp-off-model';
import { Badge } from './badge';
import { Button } from './button';
import { TimeComboInput } from './time-combo-input';
import { snapToStep } from './trip-day-plan-fields';
import { toast } from './toast';
import { errorText, Notice } from './comp-off/comp-off-kit';

const NIGHT_SHIFT: HrmTripDayWindow = { from: '18:00', to: '05:00' };
const DEFAULT_WINDOW: HrmTripDayWindow = { from: '07:30', to: '17:00' };

type Mode = 'PLANNED' | 'ACTUAL';

/** Tạm ẩn nút "Khai giờ dự kiến": chỉ còn khai giờ thực tế sau chuyến đi. Đặt true để bật lại. */
const ALLOW_PLANNED_DECLARATION = false;

/**
 * Giờ làm theo ngày của đơn công tác (tùy chọn). Nhân viên khai giờ dự kiến khi đăng ký trước, giờ thực tế sau chuyến đi;
 * hệ thống tự tách giờ trong ca và giờ làm thêm. Chỉ quản lý trực tiếp hoặc người duyệt dự phòng xác nhận giờ thực tế.
 * Ngày để trống tính theo ca của nhân viên.
 */
export function TripDayLinesPanel({ tripId }: { tripId: string }) {
  const [data, setData] = useState<HrmTripDayLines | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode | null>(null);
  const [drafts, setDrafts] = useState<Record<string, HrmTripDayWindow[]>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await compOffApi.tripDayLines(tripId));
    } catch (e) {
      setData(null);
      setError(errorText(e, 'Không tải được giờ làm theo ngày của đơn công tác'));
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = new Date().toLocaleDateString('en-CA');
  const lines = data?.lines ?? [];
  const pending = lines.filter((l) => l.status === 'ACTUAL_PENDING');
  const editable = Boolean(data?.canEdit) && (data?.tripStatus === 'PENDING' || data?.tripStatus === 'APPROVED');
  const windowsOf = (l: HrmTripDayLine): HrmTripDayWindow[] =>
    drafts[l.date] ?? [...(mode === 'ACTUAL' ? (l.actualWindows.length ? l.actualWindows : l.plannedWindows) : l.plannedWindows)];

  const totals = useMemo(
    () =>
      lines.reduce(
        (sum, l) => ({ normal: sum.normal + l.normalMinutes, ot: sum.ot + l.otMinutes, night: sum.night + l.nightMinutes }),
        { normal: 0, ot: 0, night: 0 },
      ),
    [lines],
  );

  const start = (next: Mode) => {
    setMode(next);
    setDrafts({});
    setFormError('');
  };
  const setDay = (date: string, windows: HrmTripDayWindow[]) => setDrafts((d) => ({ ...d, [date]: windows }));

  async function save() {
    if (!data || !mode || busy) return;
    // Giờ thực tế điền sẵn từ giờ dự kiến; chỉ gửi các ngày đã qua và chưa được xác nhận.
    const sendable = lines.filter((l) => l.date <= today && l.status !== 'ACTUAL_APPROVED');
    const edited = Object.fromEntries(sendable.map((l) => [l.date, windowsOf(l)]));
    const changes = tripDayChanges(sendable, mode === 'ACTUAL' ? edited : { ...drafts }, mode);
    const problem = changes.map((c) => tripWindowProblem(c.windows)).find(Boolean);
    if (problem) return setFormError(problem);
    if (changes.length === 0) return setFormError('Chưa có thay đổi nào để lưu');
    setBusy(true);
    setFormError('');
    try {
      setData(await compOffApi.saveTripDayLines(tripId, { mode, lines: changes }));
      toast.success(mode === 'ACTUAL' ? 'Đã gửi giờ thực tế chờ người duyệt xác nhận.' : 'Đã lưu giờ dự kiến.');
      setMode(null);
      setDrafts({});
    } catch (e) {
      const message = errorText(e, 'Không lưu được giờ làm theo ngày');
      setFormError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: 'APPROVE' | 'REJECT', note?: string) {
    try {
      setData(await compOffApi.decideTripDayLines(tripId, { decision, note: note ?? '' }));
      toast.success(decision === 'APPROVE' ? 'Đã xác nhận giờ thực tế.' : 'Đã từ chối giờ thực tế.');
    } catch (e) {
      const message = errorText(e, 'Không xử lý được giờ thực tế');
      setFormError(message);
      toast.error(message);
    }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return null;
  const canActual = editable && data.tripStatus === 'APPROVED' && lines.some((l) => l.date <= today);

  return (
    <section aria-label="Giờ làm theo ngày" className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-[12px] font-bold uppercase tracking-wide text-slate-800">Giờ làm theo ngày</h4>
          <p className="text-[12px] text-slate-500">
            Không khai thì tính theo ca của nhân viên. Giờ vượt ca là làm thêm; chỉ giờ thực tế đã xác nhận mới tính vào quỹ nghỉ bù.
          </p>
        </div>
        {mode === null && editable ? (
          <div className="flex gap-2">
            {ALLOW_PLANNED_DECLARATION ? (
              <Button size="sm" variant="outline" onClick={() => start('PLANNED')}>
                Khai giờ dự kiến
              </Button>
            ) : null}
            {canActual ? (
              <Button size="sm" onClick={() => start('ACTUAL')}>
                Khai giờ thực tế
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table aria-label="Giờ làm theo ngày" className="w-full min-w-[560px] border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 text-left text-slate-600">
              <th className="px-2 py-1.5 font-semibold">Ngày</th>
              <th className="px-2 py-1.5 font-semibold">Khung giờ làm</th>
              <th className="px-2 py-1.5 font-semibold">Trong ca</th>
              <th className="px-2 py-1.5 font-semibold">Làm thêm</th>
              <th className="px-2 py-1.5 font-semibold">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => {
              const windows = windowsOf(l);
              const editing = mode !== null && (mode === 'PLANNED' || l.date <= today) && l.status !== 'ACTUAL_APPROVED';
              const shown = l.actualWindows.length ? l.actualWindows : l.plannedWindows;
              return (
                <tr key={l.date}>
                  <td className="px-2 py-1.5 align-top font-medium text-slate-800">{tripDayLabel(l.date)}</td>
                  <td className="px-2 py-1.5 align-top">
                    {editing ? (
                      <div className="space-y-1">
                        {windows.map((w, i) => (
                          <div key={i} className="flex items-center gap-1">
                            <TimeComboInput
                              aria-label={`Từ giờ, ${tripDayLabel(l.date)}`}
                              className="w-28"
                              stepMinutes={15}
                              value={w.from}
                              onChange={(t) => setDay(l.date, windows.map((x, j) => (j === i ? { ...x, from: snapToStep(t) } : x)))}
                            />
                            <span className="text-slate-400">đến</span>
                            <TimeComboInput
                              aria-label={`Đến giờ, ${tripDayLabel(l.date)}`}
                              className="w-28"
                              stepMinutes={15}
                              value={w.to}
                              onChange={(t) => setDay(l.date, windows.map((x, j) => (j === i ? { ...x, to: snapToStep(t) } : x)))}
                            />
                            <Button size="sm" variant="ghost" onClick={() => setDay(l.date, windows.filter((_, j) => j !== i))}>
                              Xóa
                            </Button>
                          </div>
                        ))}
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="outline" onClick={() => setDay(l.date, [...windows, { ...DEFAULT_WINDOW }])}>
                            Thêm khung giờ
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setDay(l.date, [{ ...NIGHT_SHIFT }])}>
                            Ca đêm 18:00 đến 05:00
                          </Button>
                        </div>
                      </div>
                    ) : shown.length ? (
                      <span className="font-mono">{shown.map((w) => `${w.from} - ${w.to}`).join(', ')}</span>
                    ) : (
                      <span className="text-slate-400">Theo ca</span>
                    )}
                    {l.restsNextMorning ? <span className="mt-0.5 block text-[12px] text-slate-500">Sáng hôm sau nghỉ</span> : null}
                    {l.status === 'ACTUAL_REJECTED' && l.decisionNote ? (
                      <span className="mt-0.5 block text-[12px] text-red-600">Lý do từ chối: {l.decisionNote}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 align-top tabular-nums">{formatTripMinutes(l.normalMinutes)}</td>
                  <td className="px-2 py-1.5 align-top tabular-nums">
                    {formatTripMinutes(l.otMinutes)}
                    {l.nightMinutes > 0 ? <span className="block text-[12px] text-slate-500">trong đó {formatTripMinutes(l.nightMinutes)} đêm</span> : null}
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <Badge variant={l.status === 'ACTUAL_APPROVED' ? 'default' : 'outline'}>{TRIP_DAY_STATUS_LABELS[l.status]}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold text-slate-800">
              <td className="px-2 py-1.5" colSpan={2}>
                Cộng
              </td>
              <td className="px-2 py-1.5 tabular-nums">{formatTripMinutes(totals.normal)}</td>
              <td className="px-2 py-1.5 tabular-nums">{formatTripMinutes(totals.ot)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {formError ? <Notice tone="error">{formError}</Notice> : null}

      {mode !== null ? (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode(null)}>
            Hủy
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Đang lưu...' : mode === 'ACTUAL' ? 'Gửi xác nhận giờ thực tế' : 'Lưu giờ dự kiến'}
          </Button>
        </div>
      ) : null}

      {mode === null && data.canDecide && pending.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 p-2">
          <span className="text-[12px] text-amber-900">{pending.length} ngày đang chờ bạn xác nhận giờ thực tế.</span>
          <div className="flex gap-2">
            <Popconfirm
              title="Từ chối giờ thực tế?"
              description="Các ngày đang chờ sẽ về trạng thái bị từ chối, nhân viên khai lại. Cần nhập lý do."
              okText="Từ chối"
              cancelText="Quay lại"
              okType="danger"
              placement="left"
              reasonRequired
              reasonLabel="Lý do từ chối"
              onConfirm={(note) => decide('REJECT', note ?? '')}
            >
              <Button size="sm" variant="destructive">
                Từ chối
              </Button>
            </Popconfirm>
            <Button size="sm" onClick={() => void decide('APPROVE')}>
              Xác nhận giờ thực tế
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
