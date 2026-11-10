'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HrmCompOffBalanceRow } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../../hrm-comp-off-api';
import { hrmEmployeeOptions, type EmployeeOption } from '../../hrm-api';
import { formatCompDate, formatCompNumber } from '../../comp-off-model';
import { normalizeSearchText } from '../../hrm-employee-view';
import { useHrmPermissions } from '../../hrm-permissions';
import { Button } from '../button';
import { Input } from '../input';
import { toast } from '../toast';
import { CompOffAdjustDialog } from './comp-off-adjust-dialog';
import { CompOffLedgerSheet } from './comp-off-ledger-sheet';
import { EmptyRow, errorText, Notice, TableShell, td, tdRight, th, thRight } from './comp-off-kit';

/** Số dư quỹ nghỉ bù theo nhân viên; mở sổ giao dịch, điều chỉnh tay và chạy hết hạn lô (theo quyền). */
export function CompOffBalancesPanel() {
  const { can } = useHrmPermissions();
  const canAdjust = can('hrm.comp_off.adjust');
  const [rows, setRows] = useState<HrmCompOffBalanceRow[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [ledger, setLedger] = useState<{ id: string; label: string } | null>(null);
  const [adjusting, setAdjusting] = useState<{ employeeId?: string } | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [expiring, setExpiring] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await compOffApi.balances());
    } catch (e) {
      setError(errorText(e, 'Không tải được số dư quỹ nghỉ bù'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canAdjust) return;
    hrmEmployeeOptions().then(setEmployees).catch(() => setEmployees([]));
  }, [canAdjust]);

  const shown = useMemo(() => {
    const q = normalizeSearchText(query);
    return (rows ?? []).filter((r) => !q || normalizeSearchText(`${r.employeeCode ?? ''} ${r.employeeName ?? ''}`).includes(q));
  }, [rows, query]);

  async function expire() {
    setExpiring(true);
    try {
      const result = await compOffApi.expire();
      toast.success(result.expired ? `Đã hết hạn ${result.expired} lô quỹ nghỉ bù.` : 'Không có lô nào quá hạn.');
      await load();
    } catch (e) {
      toast.error(errorText(e, 'Không chạy được hết hạn lô'));
    } finally {
      setExpiring(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Tìm theo mã hoặc tên nhân viên"
          className="max-w-72"
          placeholder="Tìm theo mã hoặc tên nhân viên"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {canAdjust ? (
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={() => void expire()} disabled={expiring}>
              {expiring ? 'Đang chạy…' : 'Chạy hết hạn lô'}
            </Button>
            <Button onClick={() => setAdjusting({})}>Điều chỉnh quỹ</Button>
          </div>
        ) : null}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <TableShell label="Số dư quỹ nghỉ bù">
        <thead className="bg-slate-50">
          <tr>
            <th className={th}>Nhân viên</th>
            <th className={thRight}>Đã nhận</th>
            <th className={thRight}>Điều chỉnh</th>
            <th className={thRight}>Đã dùng</th>
            <th className={thRight}>Giữ chỗ</th>
            <th className={thRight}>Còn lại</th>
            <th className={th}>Sắp hết hạn</th>
            <th className={th}>
              <span className="sr-only">Thao tác</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows === null && !error ? <EmptyRow colSpan={8}>Đang tải…</EmptyRow> : null}
          {rows !== null && shown.length === 0 ? <EmptyRow colSpan={8}>Chưa có nhân viên nào phát sinh quỹ nghỉ bù.</EmptyRow> : null}
          {shown.map((r) => {
            const label = `${r.employeeCode ?? ''} ${r.employeeName ?? ''}`.trim() || r.employeeId;
            return (
              <tr key={r.employeeId}>
                <td className={td}>
                  <div className="font-medium">{r.employeeName ?? r.employeeId}</div>
                  <div className="text-xs text-slate-500">{r.employeeCode}</div>
                </td>
                <td className={tdRight}>{formatCompNumber(r.accrued)}</td>
                <td className={tdRight}>{formatCompNumber(r.adjusted)}</td>
                <td className={tdRight}>{formatCompNumber(r.used)}</td>
                <td className={tdRight}>{formatCompNumber(r.reserved)}</td>
                <td className={`${tdRight} font-bold text-[#021E73]`}>{formatCompNumber(r.available)}</td>
                <td className={`${td} text-xs text-slate-600`}>
                  {r.nextExpiry ? `${formatCompNumber(r.nextExpiry.days)} ngày, hạn ${formatCompDate(r.nextExpiry.on)}` : '—'}
                </td>
                <td className={`${td} text-right`}>
                  <Button size="sm" variant="outline" onClick={() => setLedger({ id: r.employeeId, label })}>
                    Xem sổ
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>
      {ledger ? <CompOffLedgerSheet employee={ledger} onClose={() => setLedger(null)} /> : null}
      {adjusting ? (
        <CompOffAdjustDialog
          employees={employees}
          employeeId={adjusting.employeeId}
          onClose={() => setAdjusting(null)}
          onDone={() => void load()}
        />
      ) : null}
    </div>
  );
}
