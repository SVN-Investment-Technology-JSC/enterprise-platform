'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { hrmFetch } from '../hrm-api';
import { formatLeaveNumber } from './leave-ledger-format';

interface PreviewLine {
  leaveTypeId: string;
  lastWorkingDay: string;
  signDate: string | null;
  entitled: number;
  used: number;
  pending: number;
  excess: number;
  unused: number;
}

/** Xem trước quyết toán phép năm khi ngừng nhân viên tại ngày đã chọn. */
export function LeaveSettlementPreview({
  employeeId,
  date,
}: {
  employeeId: string;
  date: string;
}) {
  const [data, setData] = useState<{
    blockers: string[];
    lines: PreviewLine[];
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      setData(null);
      return;
    }
    let cancelled = false;
    setError('');
    hrmFetch<{ data: { blockers: string[]; lines: PreviewLine[] } }>(
      `/employees/${employeeId}/leave-settlement-preview?date=${date}`,
    )
      .then((r) => !cancelled && setData(r.data))
      .catch(
        (e) =>
          !cancelled &&
          setError(e instanceof Error ? e.message : 'Không xem trước được'),
      );
    return () => {
      cancelled = true;
    };
  }, [employeeId, date]);

  if (!date) return null;
  if (error)
    return <p className="text-xs text-slate-500">Quyết toán phép: {error}</p>;
  if (!data) return null;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
      <p className="font-semibold text-slate-700">
        Quyết toán phép năm đến ngày làm việc cuối
        {data.lines[0] ? ` (${data.lines[0].lastWorkingDay})` : ''}
      </p>
      {data.blockers.map((b) => (
        <p
          key={b}
          role="alert"
          className="flex items-center gap-1.5 font-medium text-red-700"
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          {b}
        </p>
      ))}
      {data.lines.length === 0 && (
        <p className="text-slate-500">
          Chưa có lịch cộng phép theo ngày ký HĐ; không phát sinh quyết toán.
        </p>
      )}
      {data.lines.map((l) => (
        <p key={l.leaveTypeId} className="text-slate-700">
          Quỹ thực hưởng {formatLeaveNumber(l.entitled)} ngày, đã dùng{' '}
          {formatLeaveNumber(l.used)} ngày.{' '}
          {l.excess > 0 ? (
            <span className="font-semibold text-red-700">
              Dùng vượt {formatLeaveNumber(l.excess)} ngày: sẽ thu hồi và tạo
              khoản trừ lương.
            </span>
          ) : (
            <span>Còn {formatLeaveNumber(l.unused)} ngày chưa dùng.</span>
          )}
          {!l.signDate && (
            <span className="ml-1 text-amber-700">
              (Chưa có HĐLĐ chính thức đã ký.)
            </span>
          )}
        </p>
      ))}
    </div>
  );
}
