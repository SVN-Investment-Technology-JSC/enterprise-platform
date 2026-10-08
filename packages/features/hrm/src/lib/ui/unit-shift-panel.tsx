'use client';

import type {
  HrmOrgUnitOption,
  HrmShiftDefinition,
  HrmUnitShiftAssignment,
  HrmUnitShiftResolution,
} from '@enterprise-platform/contracts-hrm';
import {
  Popconfirm,
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { hrmFetch } from '../hrm-api';
import { Button } from './button';
import { DatePickerInput } from './date-picker-input';
import { toast } from './toast';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Gán ca chuẩn theo đơn vị (kế thừa). Thứ tự ưu tiên khi tra ca của nhân viên:
 * ngoại lệ cá nhân > ca đơn vị trực tiếp > ca đơn vị cha. Không sao chép bản ghi cho từng nhân viên.
 */
export function UnitShiftPanel({
  shifts,
  canManage = true,
}: {
  shifts: readonly HrmShiftDefinition[];
  canManage?: boolean;
}) {
  const [units, setUnits] = useState<HrmOrgUnitOption[]>([]);
  const [rows, setRows] = useState<HrmUnitShiftAssignment[]>([]);
  const [unitId, setUnitId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState('');
  const [resolution, setResolution] = useState<HrmUnitShiftResolution | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [u, a] = await Promise.all([
        hrmFetch<{ data: HrmOrgUnitOption[] }>('/shift-units'),
        hrmFetch<{ data: HrmUnitShiftAssignment[] }>('/unit-shift-assignments'),
      ]);
      setUnits(u.data);
      setRows(a.data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được ca theo đơn vị');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!unitId) {
      setResolution(null);
      return;
    }
    let active = true;
    hrmFetch<{ data: HrmUnitShiftResolution }>(
      `/unit-shift-assignments/resolve?unitId=${encodeURIComponent(unitId)}&date=${today()}`,
    )
      .then((res) => active && setResolution(res.data))
      .catch(() => active && setResolution(null));
    return () => {
      active = false;
    };
  }, [unitId, rows]);

  const unitOptions: SearchableSelectOption[] = useMemo(
    () => units.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` })),
    [units],
  );
  const shiftOptions: SearchableSelectOption[] = useMemo(
    () =>
      shifts
        .filter((s) => s.status === 'ACTIVE')
        .map((s) => ({
          value: s.id,
          label: `${s.name} (${s.startTime}-${s.endTime})`,
        })),
    [shifts],
  );
  const selectedRows = rows.filter((r) => !unitId || r.unitId === unitId);

  async function assign() {
    if (!unitId || !shiftId || !from) {
      setError('Chọn đơn vị, ca và ngày bắt đầu hiệu lực.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await hrmFetch('/unit-shift-assignments', {
        method: 'POST',
        body: JSON.stringify({
          unitId,
          shiftId,
          effectiveFrom: from,
          effectiveTo: to || null,
        }),
      });
      toast.success('Đã gán ca cho đơn vị');
      setShiftId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không gán được ca');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      await hrmFetch(`/unit-shift-assignments/${id}`, { method: 'DELETE' });
      toast.success('Đã huỷ gán ca đơn vị');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không huỷ được');
    } finally {
      setBusy(false);
    }
  }

  const sourceText = !resolution
    ? ''
    : resolution.source === 'UNIT'
      ? 'Ca của chính đơn vị này'
      : resolution.source === 'PARENT_UNIT'
        ? `Kế thừa từ đơn vị cha: ${resolution.inheritedFromUnitName ?? ''}`
        : 'Chưa có ca chuẩn (kể cả từ đơn vị cha)';

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Ca chuẩn theo đơn vị</h3>
        <p className="text-[11px] text-slate-500">
          Gán một lần cho cả đơn vị; nhân viên tự theo ca đơn vị hiện tại. Ưu tiên: ngoại lệ cá nhân,
          rồi ca đơn vị trực tiếp, rồi ca đơn vị cha.
        </p>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-4 text-xs">
        <div>
          <label className="mb-1 block font-semibold text-slate-600">Đơn vị</label>
          <SearchableSelect
            placeholder="Chọn đơn vị..."
            options={unitOptions}
            value={unitId}
            onChange={(v) => setUnitId(v || '')}
          />
        </div>
        <div>
          <label className="mb-1 block font-semibold text-slate-600">Ca chuẩn</label>
          <SearchableSelect
            placeholder="Chọn ca..."
            options={shiftOptions}
            value={shiftId}
            onChange={(v) => setShiftId(v || '')}
          />
        </div>
        <div>
          <label className="mb-1 block font-semibold text-slate-600">Hiệu lực từ</label>
          <DatePickerInput value={from} onChange={setFrom} />
        </div>
        <div>
          <label className="mb-1 block font-semibold text-slate-600">Đến (tuỳ chọn)</label>
          <DatePickerInput value={to} onChange={setTo} />
        </div>
      </div>
      {unitId && (
        <p className="text-xs text-slate-600">
          Ca hiệu lực hôm nay của đơn vị:{' '}
          <b>{resolution?.shiftName ?? 'chưa có'}</b>
          {sourceText && <span className="text-slate-500"> ({sourceText})</span>}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={busy || !canManage}
          onClick={() => void assign()}
        >
          Gán ca cho đơn vị
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="p-2">Đơn vị</th>
              <th className="p-2">Ca</th>
              <th className="p-2">Hiệu lực</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {selectedRows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-2 font-semibold">{r.unitName}</td>
                <td className="p-2">
                  {r.shiftName} ({r.startTime}-{r.endTime})
                </td>
                <td className="p-2 font-mono">
                  {r.effectiveFrom} - {r.effectiveTo ?? 'chưa kết thúc'}
                </td>
                <td className="p-2 text-right">
                  {canManage && (
                    <Popconfirm
                      title="Huỷ gán ca của đơn vị?"
                      description="Nhân viên không có ngoại lệ cá nhân sẽ không còn ca từ đơn vị này."
                      onConfirm={() => void cancel(r.id)}
                    >
                      <Button size="sm" variant="outline" className="h-7 text-xs">
                        Huỷ gán
                      </Button>
                    </Popconfirm>
                  )}
                </td>
              </tr>
            ))}
            {!selectedRows.length && (
              <tr>
                <td colSpan={4} className="p-3 text-center text-slate-500">
                  Chưa có ca chuẩn nào được gán cho đơn vị.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
