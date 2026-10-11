'use client';

import { useEffect, useState } from 'react';
import type {
  HrmBoardEmployee,
  HrmLeaveBalance,
  HrmPayslip,
  HrmTimesheetBoard,
} from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../../hrm-api';
import { todayVn } from '../../hrm-timesheet-format';
import { weekOf } from './dashboard-model';

export interface AnnualBalance {
  readonly total: number;
  readonly used: number;
  readonly pending: number;
  readonly remaining: number;
}

export interface MyDashboardData {
  readonly loading: boolean;
  readonly today: string;
  /** Bảng công tháng hiện tại của chính mình. */
  readonly employee: HrmBoardEmployee | undefined;
  readonly calendar: HrmTimesheetBoard['calendar'];
  readonly monthKey: string;
  /** Ngày công của tuần này (gộp hai tháng nếu tuần nằm giữa hai tháng). */
  readonly weekDays: Record<string, HrmBoardEmployee['days'][string]>;
  readonly annual: AnnualBalance | null;
  readonly payslips: readonly HrmPayslip[] | null;
  readonly error: string;
}

const EMPTY: Omit<MyDashboardData, 'today' | 'monthKey'> = {
  loading: true,
  employee: undefined,
  calendar: [],
  weekDays: {},
  annual: null,
  payslips: null,
  error: '',
};

async function loadBoard(month: string): Promise<HrmTimesheetBoard | null> {
  try {
    return (await hrmFetch<{ data: HrmTimesheetBoard }>(`/timesheet-board?${new URLSearchParams({ month, self: '1' })}`)).data;
  } catch {
    return null;
  }
}

/**
 * Dữ liệu cá nhân cho Bàn làm việc, tải song song và độc lập: một phần lỗi hoặc không có quyền thì chỉ phần đó trống.
 * Bảng công tháng cho cả thống kê, dải ngày, lịch tuần và đơn từ nên chỉ một lần gọi (hai lần nếu tuần này giữa hai tháng).
 */
export function useMyDashboard(options: { enabled: boolean; canSeePayslip: boolean }): MyDashboardData {
  const today = todayVn();
  const monthKey = today.slice(0, 7);
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    if (!options.enabled) {
      setState((prev) => ({ ...prev, loading: false }));
      return;
    }
    let live = true;
    const week = weekOf(today);
    const otherMonth = [...new Set(week.map((d) => d.slice(0, 7)))].find((m) => m !== monthKey);

    const boardJob = Promise.all([loadBoard(monthKey), otherMonth ? loadBoard(otherMonth) : Promise.resolve(null)]);

    const annualJob = (async (): Promise<AnnualBalance | null> => {
      try {
        const [profile, types] = await Promise.all([
          hrmFetch<{ data: { employeeId?: string } }>('/my-profile'),
          hrmFetch<{ data: { id: string; isAnnual?: boolean }[] }>('/leave-types?active=true'),
        ]);
        const employeeId = profile.data?.employeeId;
        const annualId = types.data.find((t) => t.isAnnual)?.id;
        if (!employeeId || !annualId) return null;
        const balances = await hrmFetch<{ data: HrmLeaveBalance[] }>(`/employees/${employeeId}/leave-balances`);
        const row = balances.data.find((b) => b.leaveTypeId === annualId);
        if (!row) return null;
        const total =
          row.projectedEntitlement != null
            ? Number(row.projectedEntitlement)
            : Number(row.openingBalance) + Number(row.accrued) + Number(row.adjusted);
        return { total, used: Number(row.used), pending: Number(row.pending), remaining: Number(row.available ?? row.remaining) };
      } catch {
        return null;
      }
    })();

    const slipJob = options.canSeePayslip
      ? hrmFetch<{ data: HrmPayslip[] }>('/my-payslips').then(
          (r) => r.data,
          () => null,
        )
      : Promise.resolve(null);

    void Promise.all([boardJob, annualJob, slipJob]).then(([[current, other], annual, payslips]) => {
      if (!live) return;
      const days = { ...(other?.employees[0]?.days ?? {}), ...(current?.employees[0]?.days ?? {}) };
      setState({
        loading: false,
        employee: current?.employees[0],
        calendar: current?.calendar ?? [],
        weekDays: Object.fromEntries(week.filter((d) => days[d]).map((d) => [d, days[d]])),
        annual,
        payslips,
        error: current ? '' : 'Không tải được bảng công của bạn.',
      });
    });
    return () => {
      live = false;
    };
  }, [today, monthKey, options.enabled, options.canSeePayslip]);

  return { ...state, today, monthKey };
}
