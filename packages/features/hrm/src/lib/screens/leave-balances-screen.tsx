'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Wallet } from 'lucide-react';
import type { HrmLeaveType } from '@enterprise-platform/contracts-hrm';
import { hrmEmployeeOptions, hrmFetch } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { LeaveLedger } from '../ui/leave-ledger';

/**
 * Quỹ phép: phần vận hành (quỹ theo năm, sổ giao dịch, điều chỉnh/đảo điều chỉnh,
 * quyết toán nghỉ việc). Cấu hình loại nghỉ và lịch cộng phép nằm ở /leave-settings.
 */
export default function LeaveBalancesScreen() {
  const { can, loading: permissionsLoading } = useHrmPermissions();
  const canRead = can('hrm.leave.read');
  const [types, setTypes] = useState<HrmLeaveType[]>([]);
  const [employees, setEmployees] = useState<
    { value: string; label: string }[]
  >([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [t, e] = await Promise.all([
      hrmFetch<{ data: HrmLeaveType[] }>('/leave-types'),
      hrmEmployeeOptions(),
    ]);
    setTypes(t.data);
    setEmployees(e);
  }, []);

  useEffect(() => {
    if (!canRead) return;
    void load().catch((e) =>
      setError(
        e instanceof Error ? e.message : 'Không đọc được danh mục loại nghỉ',
      ),
    );
  }, [canRead, load]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs xl:flex-row xl:items-center">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Wallet className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Quỹ phép
            </h1>
            <p className="max-w-[85ch] text-xs text-slate-500">
              Quỹ phép theo năm, sổ giao dịch, điều chỉnh quỹ và quyết toán
              phép khi nghỉ việc.
            </p>
          </div>
        </div>
        {can('hrm.leave.manage') && (
          <Link
            href="/settings?view=leave"
            className="text-xs font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
          >
            Phép năm và loại nghỉ
          </Link>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {!permissionsLoading && !canRead ? (
        <div
          role="alert"
          className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500"
        >
          Bạn không có quyền xem quỹ phép.
        </div>
      ) : (
        canRead && <LeaveLedger employees={employees} types={types} />
      )}
    </div>
  );
}
