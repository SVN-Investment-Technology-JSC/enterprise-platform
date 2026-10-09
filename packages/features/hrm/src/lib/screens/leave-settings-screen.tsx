'use client';
import { useCallback, useEffect, useState } from 'react';
import { CalendarOff, AlertTriangle } from 'lucide-react';
import type { HrmLeaveType } from '@enterprise-platform/contracts-hrm';
import { hrmFetch, hrmEmployeeOptions } from '../hrm-api';
import { useHrmPermissions } from '../hrm-permissions';
import { LeaveLedger } from '../ui/leave-ledger';

/**
 * Màn Quỹ phép: chỉ hiển thị và quản lý số dư quỹ phép của nhân viên.
 * - Danh mục lý do nghỉ phép: chuyển sang màn "Lý do nghỉ phép" (leave-reasons-screen).
 * - Lịch cộng phép, cộng phép tháng, chốt phép cuối năm: chuyển sang màn
 *   "Cấu hình phép năm" (leave-policy-screen).
 */
export default function LeaveSettingsScreen() {
  const { can } = useHrmPermissions();
  const [types, setTypes] = useState<HrmLeaveType[]>([]);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState<
    { value: string; label: string }[]
  >([]);

  const load = useCallback(async () => {
    const [t, e] = await Promise.all([
      hrmFetch<{ data: HrmLeaveType[] }>('/leave-types'),
      // Gồm cả nhân viên đã nghỉ để tra sổ phép.
      hrmEmployeeOptions(true),
    ]);
    setTypes(t.data);
    setEmployees(e);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <CalendarOff className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Quỹ phép
            </h1>
            <p className="text-xs text-slate-500 max-w-[85ch]">
              Số dư quỹ phép của nhân viên theo năm. Lý do nghỉ và quy tắc cộng phép năm được cấu hình trong mục Chính sách & cấu hình.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 shadow-xs flex items-center gap-2"
        >
          <AlertTriangle className="size-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {can('hrm.leave.read') && (
        <LeaveLedger employees={employees} types={types} />
      )}
    </div>
  );
}
