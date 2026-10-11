'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HrmTimesheetBoard } from '@enterprise-platform/contracts-hrm';
import { isMonthKey, shiftMonth, todayVn } from '../hrm-timesheet-format';
import { Button } from './button';
import { BoardDayDrawer } from './board-day-detail';
import { BoardGrid } from './board-grid';
import { EmployeeMonthView } from './employee-month-view';
import { Input } from './input';
import {
  BOARD_FILTERS,
  matchesBoardFilter,
  REQUEST_DOT_CLASS,
  REQUEST_LETTERS,
  type BoardFilter,
} from './my-timesheet-format';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet';

export { BoardDayDrawer } from './board-day-detail';

/** Chọn tháng có nút tháng trước/sau, dùng chung cho Bảng công và Bảng công của tôi. */
export function BoardMonthPicker({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        aria-label="Tháng trước"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Input
        type="month"
        aria-label="Tháng"
        className="w-40"
        value={month}
        onChange={(e) => {
          if (isMonthKey(e.target.value)) onChange(e.target.value);
        }}
      />
      <Button
        variant="outline"
        size="icon"
        aria-label="Tháng sau"
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

/** Chú thích một dòng cho lưới bảng công. */
export function BoardLegend() {
  const swatch = (cls: string) => (
    <span aria-hidden="true" className={`inline-block size-3 rounded-[3px] border border-slate-200 align-middle ${cls}`} />
  );
  return (
    <ul
      aria-label="Chú thích bảng công"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600"
    >
      <li className="flex items-center gap-1">{swatch('bg-red-100')}Đi trễ, về sớm</li>
      <li className="flex items-center gap-1">{swatch('bg-red-600')}KP nghỉ không phép</li>
      <li className="flex items-center gap-1">{swatch('bg-fuchsia-100')}! bất thường</li>
      <li className="flex items-center gap-1">{swatch('bg-slate-100')}Ngày nghỉ</li>
      <li className="flex items-center gap-1">{swatch('bg-rose-50')}L lễ</li>
      <li className="flex items-center gap-1">{swatch('bg-white')}Ngày chưa tới: mã ca</li>
      <li className="flex items-center gap-1.5 border-l border-slate-200 pl-3">
        Chấm màu đơn từ:
        {(['LEAVE', 'TRIP', 'OT', 'CORRECTION'] as const).map((kind) => (
          <span key={kind} className="flex items-center gap-0.5">
            <span aria-hidden="true" className={`inline-block size-1.5 rounded-full ${REQUEST_DOT_CLASS[kind]}`} />
            {REQUEST_LETTERS[kind].letter}
          </span>
        ))}
      </li>
    </ul>
  );
}

/**
 * Bảng công tháng của nhiều nhân viên: lưới gọn vừa một màn hình, bộ lọc nhanh, chú thích một dòng,
 * ngăn kéo chi tiết ngày và ngăn kéo xem cả tháng của một nhân viên.
 */
export function TimesheetBoard({
  board,
  focus,
  onFocusHandled,
  onChanged,
}: {
  board: HrmTimesheetBoard;
  /** Mở sẵn chi tiết một ngày (ví dụ từ danh sách vướng khi chốt công). */
  focus?: { employeeId: string; date: string } | null;
  onFocusHandled?: () => void;
  /** Gọi sau khi điều chỉnh công để màn hình tải lại bảng. */
  onChanged?: () => void;
}) {
  const [selected, setSelected] = useState<{ employeeId: string; date: string } | null>(null);
  const [monthOf, setMonthOf] = useState<string | null>(null);
  const [monthDate, setMonthDate] = useState<string | null>(null);
  const [filter, setFilter] = useState<BoardFilter>('ALL');
  const today = todayVn();

  useEffect(() => {
    if (!focus) return;
    if (board.employees.some((e) => e.employeeId === focus.employeeId)) {
      setSelected(focus);
      onFocusHandled?.();
    }
  }, [focus, board.employees, onFocusHandled]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        BOARD_FILTERS.map((f) => [f.id, board.employees.filter((e) => matchesBoardFilter(e, f.id)).length]),
      ) as Record<BoardFilter, number>,
    [board.employees],
  );
  const visible = useMemo(
    () => board.employees.filter((e) => matchesBoardFilter(e, filter)),
    [board.employees, filter],
  );

  const selectedEmployee = selected
    ? (board.employees.find((e) => e.employeeId === selected.employeeId) ?? null)
    : null;
  const selectedDay =
    selected && selectedEmployee ? (selectedEmployee.days[selected.date] ?? null) : null;
  const monthEmployee = monthOf ? (board.employees.find((e) => e.employeeId === monthOf) ?? null) : null;
  // Công chuẩn hiển thị ở đầu lưới khi mọi nhân viên có cùng công chuẩn.
  const standardValues = new Set(
    board.employees.map((e) => e.standard?.workdays).filter((v): v is number => v != null),
  );
  const standardWorkdays = standardValues.size === 1 ? [...standardValues][0] : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
        <div role="group" aria-label="Lọc nhanh" className="flex flex-wrap items-center gap-1.5">
          {BOARD_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              data-testid={`board-filter-${f.id}`}
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                filter === f.id
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700'
              }`}
            >
              {f.label}
              {f.id !== 'ALL' ? (
                <span className={`ml-1 ${filter === f.id ? 'text-blue-100' : 'text-slate-400'}`}>{counts[f.id]}</span>
              ) : null}
            </button>
          ))}
        </div>
        <BoardLegend />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
          Không có nhân viên nào khớp bộ lọc trong trang này.
        </p>
      ) : (
        <BoardGrid
          calendar={board.calendar}
          employees={visible}
          today={today}
          standardWorkdays={standardWorkdays}
          onSelectDay={(employeeId, date) => setSelected({ employeeId, date })}
          onSelectEmployee={board.canViewAll ? setMonthOf : undefined}
        />
      )}

      <BoardDayDrawer
        employee={selectedEmployee}
        day={selectedDay}
        onClose={() => setSelected(null)}
        canViewAll={board.canViewAll}
        month={board.month.month}
        adjustable={board.canViewAll && board.month.state !== 'LOCKED' && Boolean(board.month.calculatedAt)}
        onAdjusted={onChanged}
      />

      <Sheet
        open={Boolean(monthEmployee)}
        onOpenChange={(open) => {
          if (!open) {
            setMonthOf(null);
            setMonthDate(null);
          }
        }}
      >
        <SheetContent className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-slate-50 p-0 sm:max-w-[720px]">
          {monthEmployee && (
            <>
              <SheetHeader className="shrink-0 border-b border-slate-200 bg-white">
                <SheetTitle>
                  Bảng công tháng {board.month.month.slice(5)}/{board.month.month.slice(0, 4)}
                </SheetTitle>
                <SheetDescription>
                  {monthEmployee.employeeCode} - {monthEmployee.employeeName}
                  {monthEmployee.departmentName ? ` · ${monthEmployee.departmentName}` : ''}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-4">
                <EmployeeMonthView
                  calendar={board.calendar}
                  employee={monthEmployee}
                  today={today}
                  selectedDate={monthDate}
                  onSelectDate={(date) => {
                    setMonthDate(date);
                    setSelected({ employeeId: monthEmployee.employeeId, date });
                  }}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
