'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import styles from '../workspace.module.scss';

/**
 * Ô chọn tháng theo kiểu "Date Picker" của shadcn/ui: nút giống ô nhập mở một Popover chọn năm (mũi tên trước/sau) và
 * một lưới 12 tháng. Thay cho `<input type="month">` của trình duyệt (mỗi nền tảng một kiểu, không theo giao diện hệ
 * thống). Giá trị vào/ra là chuỗi `YYYY-MM`; hiển thị "Tháng M/YYYY". Dựng bằng SCSS vì Workspace không chạy Tailwind.
 */
export interface MonthPickFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Tháng sớm nhất / muộn nhất chọn được (`YYYY-MM`). */
  readonly min?: string;
  readonly max?: string;
  readonly 'aria-label': string;
}

const POPOVER_WIDTH = 264;
const POPOVER_HEIGHT = 250;
const GAP = 6;
const VIEWPORT_GAP = 8;
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

const pad = (value: number) => String(value).padStart(2, '0');

function parseMonth(value: string | undefined): { year: number; month: number } | undefined {
  const match = value ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  if (!match) return undefined;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : undefined;
}

const keyOf = (year: number, month: number) => `${year}-${pad(month)}`;

export function MonthPickField({ value, onChange, min, max, 'aria-label': label }: MonthPickFieldProps) {
  const selected = parseMonth(value);
  const now = new Date();
  const thisMonth = keyOf(now.getFullYear(), now.getMonth() + 1);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(selected?.year ?? now.getFullYear());
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});

  const allowed = (key: string) => (!min || key >= min) && (!max || key <= max);

  // Mở lại thì về năm của tháng đang chọn.
  useEffect(() => {
    if (open) setYear(selected?.year ?? new Date().getFullYear());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Định vị theo cửa sổ (`fixed`) để không bị khung cuộn hay `overflow: hidden` cắt; lật lên trên khi phía dưới hết chỗ.
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

  const pick = (key: string) => {
    onChange(key);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div
      ref={box}
      className={styles.datePickBox}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          // Chỉ đóng bảng chọn tháng; không để Esc đóng luôn ngăn kéo bên ngoài.
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
          {selected ? `Tháng ${selected.month}/${selected.year}` : 'Chọn tháng'}
        </span>
      </button>
      {open ? (
        <div className={styles.monthPopover} style={place} role="dialog" aria-label={label}>
          <div className={styles.monthHead}>
            <button
              type="button"
              className={styles.calNavButton}
              aria-label="Năm trước"
              onClick={() => setYear((current) => current - 1)}
            >
              <ChevronLeft size={16} aria-hidden />
            </button>
            <strong aria-live="polite">{year}</strong>
            <button
              type="button"
              className={styles.calNavButton}
              aria-label="Năm sau"
              onClick={() => setYear((current) => current + 1)}
            >
              <ChevronRight size={16} aria-hidden />
            </button>
          </div>
          <div className={styles.monthGrid} role="group" aria-label={`Các tháng của năm ${year}`}>
            {MONTHS.map((month) => {
              const key = keyOf(year, month);
              const on = selected?.year === year && selected.month === month;
              return (
                <button
                  key={month}
                  type="button"
                  className={[styles.monthCell, on ? styles.monthCellOn : '', key === thisMonth ? styles.monthCellNow : '']
                    .filter(Boolean)
                    .join(' ')}
                  aria-pressed={on}
                  disabled={!allowed(key)}
                  onClick={() => pick(key)}
                >
                  Tháng {month}
                </button>
              );
            })}
          </div>
          <div className={styles.datePickFooter}>
            <button
              type="button"
              className={styles.datePickAction}
              disabled={!allowed(thisMonth)}
              onClick={() => pick(thisMonth)}
            >
              Tháng này
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
