'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HrmTimesheetBoard } from '@enterprise-platform/contracts-hrm';
import { isMonthKey, shiftMonth, todayVn } from '../hrm-timesheet-format';
import { Button } from './button';
import { BoardDayInline } from './board-day-detail';
import { BoardGrid } from './board-grid';
import { EmployeeMonthView } from './employee-month-view';
import { MonthNumberLegend } from './my-timesheet-calendar';
import { Input } from './input';
import {
  BOARD_FILTERS,
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

/** Chú thích số công của lưới bảng công (cùng quy ước với lịch tháng của một nhân viên) và ký hiệu ngày nghỉ. */
export function BoardLegend() {
  return (
    <div aria-label="Chú thích bảng công" className="flex flex-wrap items-center gap-1.5">
      <MonthNumberLegend />
      <span className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[12px] text-slate-600">
        <span className="min-w-6 text-center text-[12px] font-semibold text-slate-400">OFF</span>Ngày nghỉ
      </span>
    </div>
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
  selectedIds,
  onSelectedChange,
  footer,
  fullscreen = false,
  filter,
  onFilterChange,
}: {
  board: HrmTimesheetBoard;
  /** Bộ lọc nhanh đang áp. Do màn hình giữ và gửi lên máy chủ để lọc trên toàn bộ tháng rồi mới phân trang. */
  filter: BoardFilter;
  onFilterChange: (filter: BoardFilter) => void;
  /** Nhân viên được tick ở cột đầu (dùng để xuất đúng người đã chọn). */
  selectedIds?: ReadonlySet<string>;
  onSelectedChange?: (ids: Set<string>) => void;
  /** Thanh dưới lưới (phân trang), nằm trong cùng khung với lưới. */
  footer?: React.ReactNode;
  /** Đang xem toàn màn hình: lưới giãn hết chiều cao. */
  fullscreen?: boolean;
  /** Mở sẵn chi tiết một ngày (ví dụ từ danh sách vướng khi chốt công). */
  focus?: { employeeId: string; date: string } | null;
  onFocusHandled?: () => void;
  /** Gọi sau khi điều chỉnh công để màn hình tải lại bảng. */
  onChanged?: () => void;
}) {
  const [selected, setSelected] = useState<{ employeeId: string; date: string } | null>(null);
  const [monthOf, setMonthOf] = useState<string | null>(null);
  const [monthDate, setMonthDate] = useState<string | null>(null);
  const today = todayVn();

  /** Bấm một ô ngày: mở ngăn kéo bảng công tháng của người đó, chọn ngày và hiện chi tiết ngày ngay dưới lịch. */
  const openMonth = useCallback((employeeId: string, date: string) => {
    setMonthOf(employeeId);
    setMonthDate(date);
    setSelected({ employeeId, date });
  }, []);

  useEffect(() => {
    if (!focus) return;
    if (board.employees.some((e) => e.employeeId === focus.employeeId)) {
      openMonth(focus.employeeId, focus.date);
      onFocusHandled?.();
    }
  }, [focus, board.employees, onFocusHandled, openMonth]);

  // Số đếm và danh sách đều do máy chủ tính trên toàn bộ nhân viên của tháng, không đổi theo cỡ trang.
  const counts = board.meta.counts;
  const visible = board.employees;

  const monthEmployee = monthOf ? (board.employees.find((e) => e.employeeId === monthOf) ?? null) : null;
  const inlineDay =
    monthOf && selected?.employeeId === monthOf ? (monthEmployee?.days[selected.date] ?? null) : null;
  // Công chuẩn hiển thị ở đầu lưới khi mọi nhân viên có cùng công chuẩn.
  const standardValues = new Set(
    board.employees.map((e) => e.standard?.workdays).filter((v): v is number => v != null),
  );
  const standardWorkdays = standardValues.size === 1 ? [...standardValues][0] : undefined;
  // Chú thích nằm ở chân bảng, ngay trên thanh phân trang.
  const gridFooter = (
    <>
      <div className="border-t border-slate-200 bg-white px-3 py-2">
        <BoardLegend />
      </div>
      {footer}
    </>
  );

  return (
    <div className={`flex flex-col gap-2 ${fullscreen ? 'min-h-0 flex-1' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <div role="group" aria-label="Lọc nhanh" className="flex flex-wrap items-center gap-1.5">
          {BOARD_FILTERS.map((f) => {
            const active = filter === f.id;
            const dotClass: Record<BoardFilter, string> = {
              ALL: '',
              LATE_EARLY: 'bg-orange-500',
              ABNORMAL: 'bg-amber-400',
              ABSENT: 'border-2 border-red-500 bg-white',
              PENDING: 'bg-violet-500',
            };
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                data-testid={`board-filter-${f.id}`}
                title={f.id === 'ALL' ? 'Tổng số nhân viên của bộ lọc tìm kiếm' : 'Số nhân viên khớp trong cả tháng'}
                onClick={() => onFilterChange(f.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700'
                }`}
              >
                {dotClass[f.id] && <span aria-hidden="true" className={`inline-block size-2 rounded-full ${dotClass[f.id]}`} />}
                {f.label}
                <span className={active ? 'text-blue-600' : 'text-slate-400'}>
                  ({counts ? counts[f.id] : f.id === 'ALL' ? board.meta.total : '-'})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <p className="p-6 text-center text-xs text-slate-500">Không có nhân viên nào khớp bộ lọc này.</p>
          {gridFooter}
        </div>
      ) : (
        <BoardGrid
          calendar={board.calendar}
          employees={visible}
          today={today}
          standardWorkdays={standardWorkdays}
          selectedIds={board.canViewAll ? selectedIds : undefined}
          onToggleSelected={
            board.canViewAll && selectedIds && onSelectedChange
              ? (id) => {
                  const next = new Set(selectedIds);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  onSelectedChange(next);
                }
              : undefined
          }
          onToggleAll={
            board.canViewAll && selectedIds && onSelectedChange
              ? (checked) => {
                  const next = new Set(selectedIds);
                  for (const e of visible) {
                    if (checked) next.add(e.employeeId);
                    else next.delete(e.employeeId);
                  }
                  onSelectedChange(next);
                }
              : undefined
          }
          onSelectDay={openMonth}
          onSelectEmployee={board.canViewAll ? (id) => { setMonthOf(id); setMonthDate(null); setSelected(null); } : undefined}
          footer={gridFooter}
          fullHeight={fullscreen}
        />
      )}

      <Sheet
        open={Boolean(monthEmployee)}
        onOpenChange={(open) => {
          if (!open) {
            setMonthOf(null);
            setMonthDate(null);
            setSelected(null);
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
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
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
                {inlineDay && (
                  <BoardDayInline
                    employee={monthEmployee}
                    day={inlineDay}
                    canViewAll={board.canViewAll}
                    month={board.month.month}
                    adjustable={board.canViewAll && board.month.state !== 'LOCKED' && Boolean(board.month.calculatedAt)}
                    onAdjusted={onChanged}
                    onClose={() => {
                      setSelected(null);
                      setMonthDate(null);
                    }}
                  />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
