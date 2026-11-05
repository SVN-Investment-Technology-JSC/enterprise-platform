'use client';

import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { DayPicker } from 'react-day-picker';
import { vi } from 'react-day-picker/locale';
import styles from '../workspace.module.scss';

/**
 * Ô chọn ngày theo mẫu "Date Picker" của shadcn/ui: nút giống ô nhập mở một Popover chứa Calendar (react-day-picker).
 * Dựng bằng SCSS vì Workspace không chạy Tailwind (xem `form-controls.tsx`). Giá trị vào/ra là chuỗi `YYYY-MM-DD`
 * theo giờ máy, rỗng là chưa chọn; hiển thị dd/MM/yyyy.
 */
export interface DatePickFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  /** Ngày sớm nhất / muộn nhất chọn được (`YYYY-MM-DD`). */
  readonly min?: string;
  readonly max?: string;
  readonly 'aria-label': string;
}

const POPOVER_WIDTH = 288;
const POPOVER_HEIGHT = 340;
const GAP = 6;
const VIEWPORT_GAP = 8;

const pad = (value: number) => String(value).padStart(2, '0');

function parseDay(value: string | undefined): Date | undefined {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const toDayString = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const display = (date: Date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;

export function DatePickField({ value, onChange, placeholder = 'dd/mm/yyyy', min, max, 'aria-label': label }: DatePickFieldProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const selected = parseDay(value);
  const from = parseDay(min);
  const to = parseDay(max);

  // Popover định vị theo cửa sổ (`fixed`) nên không bị khung cuộn hay `overflow: hidden` của bảng bộ lọc cắt; lật lên
  // trên khi phía dưới không đủ chỗ.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - VIEWPORT_GAP;
      const up = below < POPOVER_HEIGHT && rect.top > below;
      const left = Math.min(Math.max(rect.left, VIEWPORT_GAP), window.innerWidth - POPOVER_WIDTH - VIEWPORT_GAP);
      setPlace({
        position: 'fixed',
        left,
        ...(up ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
      });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [open]);

  return (
    <div
      ref={box}
      className={styles.datePickBox}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          // Chỉ đóng lịch; không để Esc đóng luôn bảng bộ lọc bên ngoài.
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={styles.datePickTrigger}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarDays size={14} aria-hidden />
        <span className={selected ? undefined : styles.datePickPlaceholder}>
          {selected ? display(selected) : placeholder}
        </span>
      </button>
      {open ? (
        <div className={styles.datePickPopover} style={place} role="dialog" aria-label={label}>
          <DayPicker
            mode="single"
            locale={vi}
            weekStartsOn={1}
            showOutsideDays
            selected={selected}
            defaultMonth={selected ?? to ?? from}
            disabled={[...(from ? [{ before: from }] : []), ...(to ? [{ after: to }] : [])]}
            onSelect={(date) => {
              onChange(date ? toDayString(date) : '');
              setOpen(false);
              trigger.current?.focus();
            }}
            classNames={{
              root: styles.calRoot,
              months: styles.calMonths,
              month: styles.calMonth,
              month_caption: styles.calCaption,
              caption_label: styles.calCaptionLabel,
              nav: styles.calNav,
              button_previous: styles.calNavButton,
              button_next: styles.calNavButton,
              month_grid: styles.calGrid,
              weekdays: styles.calWeekdays,
              weekday: styles.calWeekday,
              week: styles.calWeek,
              day: styles.calDay,
              day_button: styles.calDayButton,
              selected: styles.calSelected,
              today: styles.calToday,
              outside: styles.calOutside,
              disabled: styles.calDisabled,
              hidden: styles.calHidden,
            }}
            components={{
              Chevron: ({ orientation }) =>
                orientation === 'left' ? <ChevronLeft size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />,
            }}
          />
          <div className={styles.datePickFooter}>
            <button
              type="button"
              className={styles.datePickAction}
              onClick={() => {
                const today = toDayString(new Date());
                if ((!min || today >= min) && (!max || today <= max)) {
                  onChange(today);
                  setOpen(false);
                }
              }}
            >
              Hôm nay
            </button>
            {selected ? (
              <button
                type="button"
                className={styles.datePickAction}
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                <X size={12} aria-hidden />
                Xoá
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
