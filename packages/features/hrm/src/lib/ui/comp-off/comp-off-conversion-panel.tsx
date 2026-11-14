'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HrmCompOffConversionPreview } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../../hrm-comp-off-api';
import {
  CONVERSION_STATUS_LABEL,
  ConversionEdit,
  conversionPayload,
  conversionRowProblem,
  currentMonthKey,
  formatCompDate,
  formatCompNumber,
  isConvertible,
} from '../../comp-off-model';
import { shiftMonth } from '../../hrm-timesheet-format';
import { useHrmPermissions } from '../../hrm-permissions';
import { Badge } from '../badge';
import { Button } from '../button';
import { Input } from '../input';
import { MonthStepper } from '../month-stepper';
import { toast } from '../toast';
import { EmptyRow, errorText, Notice, TableShell, td, tdRight, th, thRight } from './comp-off-kit';

/**
 * Chuyển đổi giờ làm thêm vượt trần của một tháng thành ngày nghỉ bù. Chỉ xác nhận được khi tháng đã chốt công và quy tắc
 * đang bật; HR chỉnh số ngày của từng dòng thì bắt buộc nhập lý do.
 */
export function CompOffConversionPanel() {
  const { can } = useHrmPermissions();
  const canConvert = can('hrm.comp_off.convert');
  const [month, setMonth] = useState(() => shiftMonth(currentMonthKey(), -1));
  const [preview, setPreview] = useState<HrmCompOffConversionPreview | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, ConversionEdit>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (target: string) => {
    setError('');
    setPreview(null);
    setSelected(new Set());
    setEdits({});
    try {
      setPreview(await compOffApi.conversionPreview(target));
    } catch (e) {
      setError(errorText(e, 'Không tải được dữ liệu chuyển đổi'));
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [month, load]);

  const rows = preview?.rows ?? [];
  const canConfirm = canConvert && Boolean(preview?.locked) && Boolean(preview?.enabled);
  const problems = useMemo(
    () => new Map(rows.filter((r) => selected.has(r.employeeId)).map((r) => [r.employeeId, conversionRowProblem(r, edits[r.employeeId])])),
    [rows, selected, edits],
  );
  const hasProblem = [...problems.values()].some(Boolean);
  const convertible = rows.filter(isConvertible);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirm() {
    if (!preview || busy || hasProblem || selected.size === 0) return;
    setBusy(true);
    try {
      const result = await compOffApi.convert({ month, rows: conversionPayload(rows, selected, edits) });
      const skipped = result.skipped.length ? ` Bỏ qua ${result.skipped.length} dòng: ${result.skipped[0]?.reason}.` : '';
      toast.success(`Đã chuyển đổi ${result.created} nhân viên.${skipped}`);
      await load(month);
    } catch (e) {
      toast.error(errorText(e, 'Không chuyển đổi được'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <MonthStepper month={month} onChange={setMonth} />
        {canConfirm ? (
          <Button className="ml-auto" onClick={() => void confirm()} disabled={busy || selected.size === 0 || hasProblem}>
            {busy ? 'Đang chuyển đổi…' : `Chuyển đổi ${selected.size} nhân viên`}
          </Button>
        ) : null}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {preview && !preview.enabled ? (
        <Notice tone="warn">Quy tắc làm thêm và nghỉ bù chưa được bật cho tháng này nên không có giờ dư để chuyển đổi.</Notice>
      ) : null}
      {preview && preview.enabled && !preview.locked ? (
        <Notice tone="warn">Tháng này chưa chốt công. Số liệu dưới đây chỉ để xem; chuyển đổi sau khi chốt công.</Notice>
      ) : null}
      <TableShell label="Chuyển đổi giờ dư thành nghỉ bù">
        <thead className="bg-slate-50">
          <tr>
            <th className={th}>
              <input
                type="checkbox"
                aria-label="Chọn tất cả"
                disabled={!canConfirm || convertible.length === 0}
                checked={convertible.length > 0 && convertible.every((r) => selected.has(r.employeeId))}
                onChange={(e) => setSelected(e.target.checked ? new Set(convertible.map((r) => r.employeeId)) : new Set())}
              />
            </th>
            <th className={th}>Nhân viên</th>
            <th className={thRight}>Làm thêm thực tế (giờ)</th>
            <th className={thRight}>Tính lương (giờ)</th>
            <th className={thRight}>Giờ dư</th>
            <th className={thRight}>Ngày nghỉ bù</th>
            <th className={th}>Cộng quỹ / hạn dùng</th>
            <th className={th}>Trạng thái</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {!preview && !error ? <EmptyRow colSpan={8}>Đang tải…</EmptyRow> : null}
          {preview && rows.length === 0 ? <EmptyRow colSpan={8}>Không có nhân viên nào có giờ làm thêm trong tháng.</EmptyRow> : null}
          {rows.map((r) => {
            const isSelected = selected.has(r.employeeId);
            const edit = edits[r.employeeId];
            const problem = problems.get(r.employeeId) ?? '';
            return (
              <tr key={r.employeeId} className={isSelected ? 'bg-blue-50/40' : undefined}>
                <td className={td}>
                  <input
                    type="checkbox"
                    aria-label={`Chọn ${r.employeeName ?? r.employeeId}`}
                    disabled={!canConfirm || !isConvertible(r)}
                    checked={isSelected}
                    onChange={() => toggle(r.employeeId)}
                  />
                </td>
                <td className={td}>
                  <div className="font-medium">{r.employeeName ?? r.employeeId}</div>
                  <div className="text-xs text-slate-500">{r.employeeCode}</div>
                </td>
                <td className={tdRight}>{formatCompNumber(r.actualOtHours)}</td>
                <td className={tdRight}>{formatCompNumber(r.countedOtHours)}</td>
                <td className={tdRight}>{formatCompNumber(r.excessOtHours)}</td>
                <td className={tdRight}>
                  {isSelected ? (
                    <div className="flex flex-col items-end gap-1">
                      <Input
                        aria-label={`Số ngày nghỉ bù của ${r.employeeName ?? r.employeeId}`}
                        className="h-8 w-24 text-right tabular-nums"
                        inputMode="decimal"
                        value={edit?.days ?? String(r.compDays)}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [r.employeeId]: { days: e.target.value, reason: prev[r.employeeId]?.reason ?? '' } }))}
                      />
                      {edit && edit.days !== String(r.compDays) ? (
                        <Input
                          aria-label={`Lý do chỉnh số ngày của ${r.employeeName ?? r.employeeId}`}
                          className="h-8 w-48 text-xs"
                          placeholder="Lý do chỉnh (bắt buộc)"
                          value={edit.reason}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [r.employeeId]: { days: edit.days, reason: e.target.value } }))}
                        />
                      ) : null}
                      {problem ? <span className="text-[11px] text-red-600">{problem}</span> : null}
                    </div>
                  ) : (
                    formatCompNumber(r.status === 'CONVERTED' ? r.convertedDays : r.compDays)
                  )}
                </td>
                <td className={`${td} text-xs text-slate-600`}>
                  {formatCompDate(r.accrualOn)} · {r.expiresOn ? formatCompDate(r.expiresOn) : 'Không hạn'}
                </td>
                <td className={td}>
                  <Badge variant={r.status === 'CONVERTED' ? 'secondary' : 'outline'}>{CONVERSION_STATUS_LABEL[r.status] ?? r.status}</Badge>
                  {r.note ? <div className="mt-1 text-[11px] text-amber-700">{r.note}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>
    </div>
  );
}
