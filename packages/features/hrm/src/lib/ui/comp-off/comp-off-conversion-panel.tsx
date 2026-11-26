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
  proposedDays,
} from '../../comp-off-model';
import { formatMonthVn, shiftMonth } from '../../hrm-timesheet-format';
import { useHrmPermissions } from '../../hrm-permissions';
import { Badge } from '../badge';
import { Button } from '../button';
import { Input } from '../input';
import { MonthStepper } from '../month-stepper';
import { toast } from '../toast';
import { EmptyRow, errorText, Notice, TableShell, td, tdRight, th, thRight } from './comp-off-kit';

const NOT_CONVERTIBLE_HINT: Record<string, string> = {
  CONVERTED: 'Nhân viên này đã được chuyển đổi trong tháng',
  NOTHING: '',
  CAP_REACHED: 'Đã đạt trần tích lũy',
};

function rowSelectHint(status: string, canConfirm: boolean): string | undefined {
  if (!canConfirm) return 'Chỉ chọn được khi tháng đã chốt công, quy tắc đang bật và bạn có quyền chuyển đổi';
  return NOT_CONVERTIBLE_HINT[status];
}

/**
 * Chuyển đổi giờ làm thêm vượt trần của một tháng thành ngày nghỉ bù. Chỉ xác nhận được khi tháng đã chốt công và quy tắc
 * đang bật. Số ngày đề xuất làm tròn 1 chữ số thập phân; HR sửa được số ngày của mọi dòng chưa chuyển đổi (kể cả người chưa
 * có giờ dư). Lý do do hệ thống tự ghi: "Cộng quỹ bù tháng MM/YYYY".
 */
export interface CompOffDraft {
  readonly rows: { employeeId: string; days?: number }[];
  readonly hasProblem: boolean;
}

export function CompOffConversionPanel({
  month: fixedMonth,
  beforeLock = false,
  onDraftChange,
}: {
  month?: string;
  /** Xem trước và chỉnh trước khi chốt công: chọn sẵn các dòng chờ chuyển đổi, không có nút xác nhận riêng (xác nhận cùng lúc chốt công). */
  beforeLock?: boolean;
  onDraftChange?: (draft: CompOffDraft) => void;
} = {}) {
  const { can } = useHrmPermissions();
  const canConvert = can('hrm.comp_off.convert');
  const [pickedMonth, setMonth] = useState(() => shiftMonth(currentMonthKey(), -1));
  const month = fixedMonth ?? pickedMonth;
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
      const loaded = await compOffApi.conversionPreview(target);
      setPreview(loaded);
      if (beforeLock) setSelected(new Set(loaded.rows.filter((r) => r.status === 'READY').map((r) => r.employeeId)));
    } catch (e) {
      setError(errorText(e, 'Không tải được dữ liệu chuyển đổi'));
    }
  }, [beforeLock]);

  useEffect(() => {
    void load(month);
  }, [month, load]);

  const rows = useMemo(() => preview?.rows ?? [], [preview]);
  const canConfirm = canConvert && (beforeLock || Boolean(preview?.locked)) && Boolean(preview?.enabled);
  const problems = useMemo(
    () => new Map(rows.filter((r) => selected.has(r.employeeId)).map((r) => [r.employeeId, conversionRowProblem(r, edits[r.employeeId])])),
    [rows, selected, edits],
  );
  const hasProblem = [...problems.values()].some(Boolean);
  const convertible = rows.filter(isConvertible);
  // "Chọn tất cả" chỉ chọn người có giờ dư; người chưa có giờ dư tick riêng rồi tự nhập số ngày.
  const selectable = rows.filter((r) => r.status === 'READY');
  useEffect(() => {
    onDraftChange?.({ rows: conversionPayload(rows, selected, edits), hasProblem });
  }, [rows, selected, edits, hasProblem, onDraftChange]);
  const selectAllHint = !canConfirm
    ? 'Chỉ chọn được khi tháng đã chốt công, quy tắc đang bật và bạn có quyền chuyển đổi'
    : convertible.length === 0
      ? 'Không có nhân viên nào đang chờ chuyển đổi'
      : undefined;

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
        {fixedMonth ? <span className="text-sm font-semibold text-slate-700">Tháng {formatMonthVn(fixedMonth)}</span> : <MonthStepper month={month} onChange={setMonth} />}
        {canConfirm && !beforeLock ? (
          <Button className="ml-auto" onClick={() => void confirm()} disabled={busy || selected.size === 0 || hasProblem}>
            {busy ? 'Đang chuyển đổi…' : `Chuyển đổi ${selected.size} nhân viên`}
          </Button>
        ) : null}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {preview && !preview.enabled ? (
        <Notice tone="warn">Quy tắc làm thêm và nghỉ bù chưa được bật cho tháng này nên không có giờ dư để chuyển đổi.</Notice>
      ) : null}
      {preview && preview.enabled && preview.locked && rows.length > 0 && convertible.length === 0 ? (
        <Notice tone="info">
          Không còn nhân viên nào chờ chuyển đổi trong tháng này (đã chuyển đổi hoặc không có giờ dư), nên không có dòng nào để chọn.
        </Notice>
      ) : null}
      {preview && preview.enabled && !preview.locked && !beforeLock ? (
        <Notice tone="warn">Tháng này chưa chốt công. Số liệu dưới đây chỉ để xem; chuyển đổi sau khi chốt công.</Notice>
      ) : null}
      <TableShell label="Chuyển đổi giờ dư thành nghỉ bù">
        <thead className="bg-slate-50">
          <tr>
            <th className={th}>
              <input
                type="checkbox"
                aria-label="Chọn tất cả"
                title={selectAllHint}
                disabled={!canConfirm || selectable.length === 0}
                checked={selectable.length > 0 && selectable.every((r) => selected.has(r.employeeId))}
                onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.employeeId)) : new Set())}
              />
            </th>
            <th className={th}>Nhân viên</th>
            <th className={thRight}>Làm thêm thực tế (giờ)</th>
            <th className={thRight}>Tính lương (giờ)</th>
            <th className={thRight}>Giờ dư</th>
            <th className={thRight}>Ngày nghỉ bù</th>
            <th className={th} title="Ngày số ngày nghỉ bù được cộng vào quỹ của nhân viên, và ngày hết hạn sử dụng của số ngày đó.">
              Ngày cộng / hạn dùng
            </th>
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
                    title={rowSelectHint(r.status, canConfirm)}
                    disabled={!canConfirm || !isConvertible(r)}
                    checked={isSelected}
                    onChange={() => toggle(r.employeeId)}
                  />
                </td>
                <td className={td}>
                  <div className="font-medium">{r.employeeName ?? r.employeeId}</div>
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
                        value={edit?.days ?? String(proposedDays(r))}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [r.employeeId]: { days: e.target.value, reason: '' } }))}
                      />
                      {problem ? <span className="text-[11px] text-red-600">{problem}</span> : null}
                    </div>
                  ) : (
                    formatCompNumber(r.status === 'CONVERTED' ? r.convertedDays : proposedDays(r))
                  )}
                </td>
                <td className={`${td} text-xs text-slate-600`}>
                  <div>Cộng quỹ: {formatCompDate(r.accrualOn)}</div>
                  <div>Hạn dùng: {r.expiresOn ? formatCompDate(r.expiresOn) : 'Không hạn'}</div>
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
      <p className="max-w-[90ch] text-[11px] text-slate-500">
        Cộng quỹ: ngày số ngày nghỉ bù vào quỹ của nhân viên, theo chính sách (thường là đầu tháng sau). Hạn dùng: sau ngày này số ngày nghỉ bù chưa dùng sẽ hết hiệu lực; &quot;Không hạn&quot; nghĩa là chính sách không giới hạn thời gian dùng.
      </p>
    </div>
  );
}
