'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { HrmTimesheetBoard } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { currentMonthVn, isMonthKey, todayVn } from '../hrm-timesheet-format';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { BoardDayDrawer, BoardMonthPicker } from '../ui/timesheet-board';
import { EmployeeMonthView } from '../ui/employee-month-view';
import { monthStateLabel, monthStateTimestamp } from '../ui/timesheet-board-format';

/**
 * Công của tôi: một bảng công tháng duy nhất của chính mình, gồm thống kê mọi thông số chấm công của tháng,
 * lịch từng ngày (ngày chưa tới hiện mã ca, ngày đã qua hiện số công, đi trễ về sớm tô đỏ, ký tự đơn từ)
 * và danh sách đơn từ trong tháng. Chấm công thực hiện trên ứng dụng di động, không chấm trên web.
 */
export default function MyTimesheetScreen() {
  const [month, setMonth] = useState(() => currentMonthVn());
  const [board, setBoard] = useState<HrmTimesheetBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (!isMonthKey(month)) return;
    let live = true;
    setLoading(true);
    setError('');
    setSelectedDate(null);
    hrmFetch<{ data: HrmTimesheetBoard }>(
      `/timesheet-board?${new URLSearchParams({ month, self: '1' })}`,
    )
      .then((result) => {
        if (live) setBoard(result.data);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setBoard(null);
        setError(
          e instanceof Error ? e.message : 'Không tải được bảng công của bạn.',
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [month, reloadKey]);

  const employee = board?.employees[0] ?? null;
  const state = board?.month.state;
  const stamp = board ? monthStateTimestamp(board.month) : '';
  const today = todayVn();
  const selectedDay = employee && selectedDate ? (employee.days[selectedDate] ?? null) : null;

  return (
    <div className="flex min-h-[520px] flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900">
              Bảng công của tôi
            </h1>
            <p className="text-xs text-slate-500">
              {employee
                ? `${employee.employeeCode} - ${employee.employeeName}${
                    employee.departmentName ? ` · ${employee.departmentName}` : ''
                  }${employee.positionName ? ` · ${employee.positionName}` : ''}`
                : 'Công từng ngày, đi trễ về sớm và đơn từ trong tháng.'}
            </p>
          </div>
          {state && (
            <Badge
              data-testid="month-state"
              variant="outline"
              className={
                state === 'LOCKED'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }
            >
              {monthStateLabel(state)}
              {stamp ? ` - ${stamp}` : ''}
            </Badge>
          )}
        </div>
        <BoardMonthPicker month={month} onChange={setMonth} />
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-white p-4 text-sm text-red-700"
        >
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            Tải lại
          </Button>
        </div>
      ) : loading ? (
        <div role="status" className="flex items-center gap-2 p-6 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" />
          <span>Đang tải bảng công...</span>
        </div>
      ) : !board || !employee ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Chưa có dữ liệu bảng công trong tháng này.
        </p>
      ) : (
        <>
          <EmployeeMonthView
            calendar={board.calendar}
            employee={employee}
            today={today}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            wide
          />

          <BoardDayDrawer
            employee={employee}
            day={selectedDay}
            onClose={() => setSelectedDate(null)}
            canViewAll={false}
          />
        </>
      )}
    </div>
  );
}
