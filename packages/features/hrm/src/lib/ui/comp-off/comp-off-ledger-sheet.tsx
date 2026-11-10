'use client';
import { useEffect, useState } from 'react';
import type { HrmCompOffBalanceDetail } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../../hrm-comp-off-api';
import { formatCompDate, formatCompNumber, LEDGER_KIND_LABEL } from '../../comp-off-model';
import { Badge } from '../badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../sheet';
import { EmptyRow, errorText, Notice, TableShell, td, tdRight, th, thRight } from './comp-off-kit';

/** Chi tiết quỹ của một nhân viên: các lô còn số dư và sổ giao dịch (mới nhất trước). */
export function CompOffLedgerSheet({
  employee,
  onClose,
}: {
  employee: { id: string; label: string };
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<HrmCompOffBalanceDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    compOffApi
      .detail(employee.id)
      .then((result) => active && setDetail(result))
      .catch((e) => active && setError(errorText(e, 'Không tải được sổ quỹ nghỉ bù')));
    return () => {
      active = false;
    };
  }, [employee.id]);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full max-w-[760px] gap-0 overflow-y-auto p-0">
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.entries.length === 0 ? <EmptyRow colSpan={4}>Chưa có giao dịch.</EmptyRow> : null}
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
                          {entry.reason ??
                            (entry.periodMonth
                              ? `Giờ làm thêm tháng ${entry.periodMonth.slice(5)}/${entry.periodMonth.slice(0, 4)}: ${formatCompNumber(entry.excessHours)} giờ vượt trần`
                              : '')}
                        </td>
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
