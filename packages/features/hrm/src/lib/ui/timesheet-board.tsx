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
  BOX_TONE_CLASS,
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

/** Chú thích một dòng cho lưới bảng công: chấm màu, ô ký hiệu và chấm màu đơn từ. */
export function BoardLegend() {
  const box = (text: string, cls: string) => (
    <span aria-hidden="true" className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 text-[9px] font-bold ${cls}`}>
      {text}
    </span>
  );
  const dot = (cls: string) => <span aria-hidden="true" className={`inline-block size-2.5 rounded-full ${cls}`} />;
  return (
    <ul
      aria-label="Chú thích bảng công"
      className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-slate-600"
    >
      <li className="flex items-center gap-1.5">
        {dot('bg-emerald-500')}Đủ công
      </li>
      <li className="flex items-center gap-1.5">
        {dot('bg-orange-500')}Đi trễ, về sớm
      </li>
      <li className="flex items-center gap-1.5">
        {box('P', BOX_TONE_CLASS.leave)}Nghỉ phép
      </li>
      <li className="flex items-center gap-1.5">
        {box('KP', BOX_TONE_CLASS.absent)}Nghỉ không phép
      </li>
      <li className="flex items-center gap-1.5">
        {box('CT', BOX_TONE_CLASS.trip)}Công tác
      </li>
      <li className="flex items-center gap-1.5">
        {box('!', BOX_TONE_CLASS.abnormal)}Bất thường
      </li>
      <li className="flex items-center gap-1.5">
        {box('OFF', 'bg-slate-100 text-slate-500')}Ngày nghỉ
      </li>
      <li className="flex items-center gap-1.5">
        {box('L', 'bg-rose-50 text-rose-500')}Ngày lễ
      </li>
      <li className="flex items-center gap-1.5 border-l border-slate-200 pl-3">
        Chấm nhỏ đơn từ:
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
  selectedIds,
  onSelectedChange,
  footer,
  fullscreen = false,
}: {
  board: HrmTimesheetBoard;
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
  const [filter, setFilter] = useState<BoardFilter>('ALL');
  const [legendOpen, setLegendOpen] = useState(false);
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
                title={f.id === 'ALL' ? 'Tổng số nhân viên của bộ lọc tìm kiếm' : 'Số nhân viên khớp trong trang đang xem'}
                onClick={() => setFilter(f.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700'
                }`}
              >
                {dotClass[f.id] && <span aria-hidden="true" className={`inline-block size-2 rounded-full ${dotClass[f.id]}`} />}
                {f.label}
                <span className={active ? 'text-blue-600' : 'text-slate-400'}>
                  ({f.id === 'ALL' ? Math.max(board.meta.total, counts.ALL) : counts[f.id]})
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-expanded={legendOpen}
          onClick={() => setLegendOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-blue-700 2xl:hidden"
        >
          {legendOpen ? 'Ẩn chú thích' : 'Chú thích'}
        </button>
        <div className={`${legendOpen ? 'block' : 'hidden'} w-full 2xl:block 2xl:w-auto`}>
          <BoardLegend />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <p className="p-6 text-center text-xs text-slate-500">Không có nhân viên nào khớp bộ lọc trong trang này.</p>
          {footer}
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
          onSelectDay={(employeeId, date) => setSelected({ employeeId, date })}
          onSelectEmployee={board.canViewAll ? setMonthOf : undefined}
          footer={footer}
          fullHeight={fullscreen}
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
