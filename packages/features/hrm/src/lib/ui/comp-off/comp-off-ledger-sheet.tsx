'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import type { HrmCompOffBalanceDetail, HrmCompOffLedgerEntry } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../../hrm-comp-off-api';
import { formatCompDate, formatCompNumber, LEDGER_KIND_LABEL } from '../../comp-off-model';
import { useHrmPermissions } from '../../hrm-permissions';
import { Badge } from '../badge';
import { Button } from '../button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../sheet';
import { EmptyRow, errorText, Notice, TableShell, td, tdRight, th, thRight } from './comp-off-kit';

/** Nội dung ghi chú của một dòng sổ: lý do, hoặc mô tả giờ vượt trần với dòng chuyển đổi tháng. */
function entryNote(entry: HrmCompOffLedgerEntry): string {
  if (entry.reason) return entry.reason;
  if (entry.periodMonth)
    return `Giờ làm thêm tháng ${entry.periodMonth.slice(5)}/${entry.periodMonth.slice(0, 4)}: ${formatCompNumber(entry.excessHours)} giờ vượt trần`;
  return '';
}

/**
 * Chi tiết quỹ của một nhân viên: các lô còn số dư và sổ giao dịch (mới nhất trước), kèm người thực hiện và nguồn
 * (bấm tay hoặc import Excel). Dòng điều chỉnh đảo được bằng dòng đối ứng, dòng gốc giữ nguyên, giống quỹ phép năm.
 */
export function CompOffLedgerSheet({
  employee,
  onClose,
  onChanged,
}: {
  employee: { id: string; label: string };
  onClose: () => void;
  /** Gọi sau khi đảo điều chỉnh để màn hình chính tải lại số dư. */
  onChanged?: () => void | Promise<void>;
}) {
  const { can } = useHrmPermissions();
  const canAdjust = can('hrm.comp_off.adjust');
  const [detail, setDetail] = useState<HrmCompOffBalanceDetail | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setDetail(await compOffApi.detail(employee.id));
    } catch (e) {
      setError(errorText(e, 'Không tải được sổ quỹ nghỉ bù'));
    }
  }, [employee.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const reversalOf = useMemo(() => new Map((detail?.entries ?? []).map((e) => [e.id, e])), [detail]);

  async function reverse(entry: HrmCompOffLedgerEntry, reason?: string) {
    setError('');
    try {
      await compOffApi.reverseAdjustment(entry.id, reason ?? '');
      await Promise.all([load(), onChanged?.()]);
    } catch (e) {
      setError(errorText(e, 'Không đảo được điều chỉnh'));
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full max-w-[920px] gap-0 overflow-y-auto p-0">
        <SheetHeader className="shrink-0 border-b border-slate-200 bg-slate-50/80 p-5">
          <SheetTitle className="text-base font-bold">Sổ quỹ nghỉ bù</SheetTitle>
          <SheetDescription>
            {employee.label}
            {detail ? ` · Còn dùng được ${formatCompNumber(detail.available)} ngày, giữ chỗ ${formatCompNumber(detail.reserved)} ngày` : ''}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-5">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {!detail && !error ? <p className="text-sm text-slate-500">Đang tải…</p> : null}
          {detail ? (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-bold text-slate-900">Các lô</h3>
                <TableShell label="Các lô quỹ nghỉ bù">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={th}>Ngày phát sinh</th>
                      <th className={th}>Hạn dùng</th>
                      <th className={thRight}>Đã cộng</th>
                      <th className={thRight}>Còn lại</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.lots.length === 0 ? <EmptyRow colSpan={4}>Chưa có lô nào.</EmptyRow> : null}
                    {detail.lots.map((lot) => (
                      <tr key={lot.lotId}>
                        <td className={td}>{formatCompDate(lot.openedOn)}</td>
                        <td className={td}>{lot.expiresOn ? formatCompDate(lot.expiresOn) : 'Không hạn'}</td>
                        <td className={tdRight}>{formatCompNumber(lot.granted)}</td>
                        <td className={tdRight}>{formatCompNumber(lot.remaining)}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-bold text-slate-900">Giao dịch</h3>
                <TableShell label="Sổ giao dịch quỹ nghỉ bù">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={th}>Ngày</th>
                      <th className={th}>Loại</th>
                      <th className={thRight}>Ngày nghỉ</th>
                      <th className={th}>Ghi chú</th>
                      <th className={th}>Người thực hiện</th>
                      {canAdjust ? <th className={th}>Thao tác</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.entries.length === 0 ? <EmptyRow colSpan={canAdjust ? 6 : 5}>Chưa có giao dịch.</EmptyRow> : null}
                    {detail.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className={td}>{formatCompDate(entry.occurredOn)}</td>
                        <td className={td}>
                          <Badge variant="outline">{LEDGER_KIND_LABEL[entry.kind] ?? entry.kind}</Badge>
                        </td>
                        <td className={`${tdRight} ${entry.days < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                          {entry.days > 0 ? '+' : ''}
                          {formatCompNumber(entry.days)}
                        </td>
                        <td className={`${td} text-xs text-slate-600`}>
                          {entryNote(entry)}
                          {entry.reversesId ? (
                            <Badge variant="outline" className="ml-1.5 border-amber-200 bg-amber-50 text-[11px] text-amber-700">
                              Đảo điều chỉnh
                            </Badge>
                          ) : null}
                        </td>
                        <td className={`${td} text-xs`}>
                          <span className="block">{entry.actorLabel || 'Hệ thống'}</span>
                          {entry.source === 'IMPORT' ? (
                            <Badge variant="outline" className="mt-0.5 border-violet-200 bg-violet-50 text-[11px] text-violet-700">
                              Import Excel
                            </Badge>
                          ) : null}
                          {entry.source === 'MANUAL' ? (
                            <Badge variant="outline" className="mt-0.5 border-slate-200 bg-slate-50 text-[11px] text-slate-600">
                              Bấm tay
                            </Badge>
                          ) : null}
                        </td>
                        {canAdjust ? (
                          <td className={td}>
                            {entry.kind === 'ADJUST' && !entry.reversesId ? (
                              entry.reversedById ? (
                                <Badge
                                  variant="outline"
                                  className="border-amber-200 bg-amber-50 text-[11px] text-amber-700"
                                  title={`Đã ghi dòng đối ứng ngày ${formatCompDate(reversalOf.get(entry.reversedById)?.occurredOn ?? entry.occurredOn)}${reversalOf.get(entry.reversedById)?.reason ? `: ${reversalOf.get(entry.reversedById)?.reason}` : ''}`}
                                >
                                  Đã đảo điều chỉnh
                                </Badge>
                              ) : (
                                <Popconfirm
                                  title="Đảo điều chỉnh này?"
                                  description={`Ghi dòng đối ứng ${entry.days > 0 ? '-' : '+'}${formatCompNumber(Math.abs(entry.days))} ngày; dòng gốc được giữ nguyên.`}
                                  okText="Xác nhận"
                                  cancelText="Quay lại"
                                  placement="bottom-end"
                                  reasonRequired
                                  reasonLabel="Lý do đảo điều chỉnh"
                                  onConfirm={(reason) => reverse(entry, reason)}
                                >
                                  <Button variant="outline" size="sm">
                                    <Undo2 className="size-3.5" />
                                    Đảo điều chỉnh
                                  </Button>
                                </Popconfirm>
                              )
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              </section>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
