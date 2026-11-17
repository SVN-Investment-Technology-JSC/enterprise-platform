'use client';
import { useCallback, useEffect, useState } from 'react';
import type { HrmOvertimeBlock, HrmOvertimeMonthSummary } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../../hrm-comp-off-api';
import { BLOCK_SOURCE_LABEL, currentMonthKey, formatCompNumber, shortLocal } from '../../comp-off-model';
import { shiftMonth } from '../../hrm-timesheet-format';
import { useHrmPermissions } from '../../hrm-permissions';
import { Badge } from '../badge';
import { Button } from '../button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { Input } from '../input';
import { MonthStepper } from '../month-stepper';
import { toast } from '../toast';
import { EmptyRow, errorText, Field, Notice, TableShell, td, tdRight, th, thRight } from './comp-off-kit';

/** Sửa phân loại một ca: nhập giờ làm thêm chính thức (phần còn lại là ca đêm) và lý do bắt buộc. */
function EditBlockDialog({ block, onClose, onDone }: { block: HrmOvertimeBlock; onClose: () => void; onDone: () => void }) {
  const [otHours, setOtHours] = useState(String(block.otHoursFinal));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ot = Number(otHours.replace(',', '.'));
  const problem =
    !Number.isFinite(ot) || ot < 0 || ot > block.hours
      ? `Giờ làm thêm phải từ 0 đến ${formatCompNumber(block.hours)} giờ`
      : !reason.trim()
        ? 'Cần nhập lý do sửa'
        : '';

  async function run(body: { otHours?: number; reason?: string; revert?: boolean }) {
    setBusy(true);
    setError('');
    try {
      await compOffApi.overrideBlock(block.id, body);
      toast.success(body.revert ? 'Đã trả về phân loại theo quy tắc.' : 'Đã lưu phân loại.');
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e, 'Không lưu được phân loại'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-md gap-4 p-5">
        <DialogHeader>
          <DialogTitle>Sửa phân loại ca làm thêm</DialogTitle>
          <DialogDescription>
            {block.employeeName} · {shortLocal(block.start)} - {shortLocal(block.end)} · {formatCompNumber(block.hours)} giờ
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-slate-600">
          Gợi ý theo quy tắc: làm thêm {formatCompNumber(block.otHoursSuggested)} giờ, ca đêm {formatCompNumber(block.nightHoursSuggested)} giờ.
        </p>
        <Field label="Giờ làm thêm chính thức" hint={`Ca đêm = ${formatCompNumber(block.hours - (Number.isFinite(ot) ? ot : 0))} giờ (phần còn lại của ca)`}>
          <Input inputMode="decimal" value={otHours} onChange={(e) => setOtHours(e.target.value)} />
        </Field>
        <Field label="Lý do sửa">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} placeholder="Bắt buộc" />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {block.source === 'MANUAL' ? (
            <Button variant="outline" className="mr-auto" disabled={busy} onClick={() => void run({ revert: true })}>
              Bỏ sửa tay
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Hủy
          </Button>
          <Button disabled={Boolean(problem) || busy} title={problem || undefined} onClick={() => void run({ otHours: ot, reason: reason.trim() })}>
            {busy ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryTable({ rows }: { rows: HrmOvertimeMonthSummary[] }) {
  return (
    <TableShell label="Tổng hợp làm thêm theo nhân viên">
      <thead className="bg-slate-50">
        <tr>
          <th className={th}>Nhân viên</th>
          <th className={thRight}>Làm thêm thực tế</th>
          <th className={thRight}>Tính lương</th>
          <th className={thRight}>Ca đêm</th>
          <th className={thRight}>Giờ dư</th>
          <th className={thRight}>Ngày nghỉ bù đề xuất</th>
          <th className={thRight}>Nghỉ sau ca đêm (ngày)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.length === 0 ? <EmptyRow colSpan={7}>Chưa có dữ liệu làm thêm của tháng.</EmptyRow> : null}
        {rows.map((r) => (
          <tr key={r.employeeId}>
            <td className={td}>
              <div className="font-medium">{r.employeeName ?? r.employeeId}</div>
              <div className="text-xs text-slate-500">{r.employeeCode}</div>
            </td>
            <td className={tdRight}>{formatCompNumber(r.actualOtHours)}</td>
            <td className={tdRight}>{formatCompNumber(r.countedOtHours)}</td>
            <td className={tdRight}>{formatCompNumber(r.nightHours)}</td>
            <td className={tdRight}>{formatCompNumber(r.excessOtHours)}</td>
            <td className={`${tdRight} font-bold text-[#021E73]`}>{formatCompNumber(r.compDays)}</td>
            <td className={tdRight}>{formatCompNumber(r.nightRestDays)}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/** Phân loại làm thêm / ca đêm theo từng ca của một tháng và tổng hợp theo nhân viên. */
export function OvertimeClassifyPanel() {
  const { can } = useHrmPermissions();
  const canClassify = can('hrm.overtime.classify');
  const [month, setMonth] = useState(() => currentMonthKey());
  const [blocks, setBlocks] = useState<HrmOvertimeBlock[] | null>(null);
  const [summary, setSummary] = useState<{ enabled: boolean; rows: HrmOvertimeMonthSummary[] } | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<HrmOvertimeBlock | null>(null);

  const load = useCallback(
    async (target: string) => {
      setError('');
      setBlocks(null);
      setSummary(null);
      try {
        const [s, b] = await Promise.all([compOffApi.monthSummary(target), canClassify ? compOffApi.blocks(target) : Promise.resolve([])]);
        setSummary(s);
        setBlocks(b);
      } catch (e) {
        setError(errorText(e, 'Không tải được dữ liệu làm thêm'));
      }
    },
    [canClassify],
  );

  useEffect(() => {
    void load(month);
  }, [month, load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthStepper month={month} onChange={setMonth} />
        <Button variant="ghost" size="sm" onClick={() => setMonth(shiftMonth(currentMonthKey(), 0))}>
          Tháng này
        </Button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {summary && !summary.enabled ? (
        <Notice tone="warn">Quy tắc làm thêm và nghỉ bù chưa được bật cho tháng này, nên chưa có phân loại theo ca.</Notice>
      ) : null}
      <section className="space-y-2">
        <h3 className="text-sm font-bold text-slate-900">Tổng hợp theo nhân viên (giờ)</h3>
        <SummaryTable rows={summary?.rows ?? []} />
      </section>
      {canClassify ? (
        <section className="space-y-2">
          <h3 className="text-sm font-bold text-slate-900">Phân loại từng ca</h3>
          <TableShell label="Phân loại làm thêm và ca đêm theo ca">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Nhân viên</th>
                <th className={th}>Ca làm thêm</th>
                <th className={thRight}>Số giờ</th>
                <th className={thRight}>Gợi ý (làm thêm / ca đêm)</th>
                <th className={thRight}>Chính thức (làm thêm / ca đêm)</th>
                <th className={th}>Nguồn</th>
                <th className={th}>Lý do sửa</th>
                <th className={th}>
                  <span className="sr-only">Thao tác</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {blocks === null && !error ? <EmptyRow colSpan={8}>Đang tải…</EmptyRow> : null}
              {blocks !== null && blocks.length === 0 ? <EmptyRow colSpan={8}>Không có ca làm thêm đã phân loại trong tháng.</EmptyRow> : null}
              {(blocks ?? []).map((b) => (
                <tr key={b.id}>
                  <td className={td}>
                    <div className="font-medium">{b.employeeName ?? b.employeeId}</div>
                    <div className="text-xs text-slate-500">{b.employeeCode}</div>
                  </td>
                  <td className={td}>
                    {shortLocal(b.start)} - {shortLocal(b.end)}
                    {b.crossesMidnight ? <span className="ml-1 text-[11px] text-slate-500">(xuyên đêm)</span> : null}
                  </td>
                  <td className={tdRight}>{formatCompNumber(b.hours)}</td>
                  <td className={tdRight}>
                    {formatCompNumber(b.otHoursSuggested)} / {formatCompNumber(b.nightHoursSuggested)}
                  </td>
                  <td className={`${tdRight} font-semibold`}>
                    {formatCompNumber(b.otHoursFinal)} / {formatCompNumber(b.nightHoursFinal)}
                  </td>
                  <td className={td}>
                    <Badge variant={b.source === 'MANUAL' ? 'secondary' : 'outline'}>{BLOCK_SOURCE_LABEL[b.source] ?? b.source}</Badge>
                  </td>
                  <td className={`${td} max-w-56 text-xs text-slate-600`}>{b.overrideReason ?? ''}</td>
                  <td className={`${td} text-right`}>
                    {b.locked ? (
                      <span className="text-xs text-slate-500">Đã chốt công</span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setEditing(b)}>
                        Sửa
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </section>
      ) : null}
      {editing ? <EditBlockDialog block={editing} onClose={() => setEditing(null)} onDone={() => void load(month)} /> : null}
    </div>
  );
}
