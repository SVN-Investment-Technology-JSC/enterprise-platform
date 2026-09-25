'use client';

import type { CalendarOccurrence, WorkItem } from '@enterprise-platform/contracts-workspace';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  buildCalendarGrid,
  dateKey,
  gridLabel,
  gridRange,
  shiftAnchor,
  type CalendarMode,
} from '../calendar-grid.model';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

export interface TabCalendarProps {
  readonly projectId: string;
  readonly items: readonly WorkItem[];
  readonly canWrite: boolean;
  readonly onCreate: (date: string) => void;
  readonly onOpenEvent: (occurrence: CalendarOccurrence) => void;
  readonly onOpenWorkItem: (workItemId: string) => void;
  /** Đổi giá trị để buộc tải lại, sau khi tạo hoặc sửa sự kiện. */
  readonly reloadToken?: number;
}

/**
 * Lưới tuần và lưới tháng của một dự án.
 *
 * Hạn công việc hiện như sự kiện nhưng **không** phải dòng trong
 * `calendar_events`: chúng được ghép ở client từ cây công việc đã có sẵn, nên
 * dời hạn một việc là lịch đổi theo ngay, không cần đồng bộ gì.
 */
export function TabCalendar({
  projectId,
  items,
  canWrite,
  onCreate,
  onOpenEvent,
  onOpenWorkItem,
  reloadToken = 0,
}: TabCalendarProps) {
  const [mode, setMode] = useState<CalendarMode>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [occurrences, setOccurrences] = useState<readonly CalendarOccurrence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const range = useMemo(() => gridRange(anchor, mode), [anchor, mode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .loadCalendar({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        projectId,
      })
      .then((response) => {
        if (cancelled) return;
        setOccurrences(response.occurrences);
        setError(undefined);
      })
      .catch((cause: { message?: string }) => {
        if (cancelled) return;
        setOccurrences([]);
        setError(cause?.message ?? 'Không tải được lịch.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Lưới có thể đổi trong lúc đang chờ; bỏ kết quả cũ thay vì ghi đè lưới mới.
    return () => {
      cancelled = true;
    };
  }, [projectId, range.from, range.to, reloadToken]);

  const cells = useMemo(
    () => buildCalendarGrid(anchor, mode, occurrences, items),
    [anchor, mode, occurrences, items],
  );

  return (
    <div className={styles.tabBody}>
      <div className={styles.calendarBar}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Kỳ trước"
          onClick={() => setAnchor((current) => shiftAnchor(current, mode, -1))}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          className={styles.buttonGhost}
          onClick={() => setAnchor(new Date())}
        >
          Hôm nay
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Kỳ sau"
          onClick={() => setAnchor((current) => shiftAnchor(current, mode, 1))}
        >
          <ChevronRight size={15} />
        </button>

        <strong className={styles.calendarLabel}>{gridLabel(anchor, mode)}</strong>

        <div className={styles.segmented} role="group" aria-label="Chế độ xem">
          <button
            type="button"
            aria-pressed={mode === 'week'}
            className={mode === 'week' ? styles.segmentActive : styles.segment}
            onClick={() => setMode('week')}
          >
            Tuần
          </button>
          <button
            type="button"
            aria-pressed={mode === 'month'}
            className={mode === 'month' ? styles.segmentActive : styles.segment}
            onClick={() => setMode('month')}
          >
            Tháng
          </button>
        </div>

        {canWrite ? (
          <button
            type="button"
            className={styles.buttonPrimary}
            onClick={() => onCreate(dateKey(anchor))}
          >
            <CalendarPlus size={14} /> Sự kiện mới
          </button>
        ) : null}

        {loading ? <span className={styles.muted}>Đang tải…</span> : null}
      </div>

      {error ? (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      ) : null}

      <div className={styles.calendarGrid}>
        {WEEKDAYS.map((label) => (
          <div key={label} className={styles.calendarWeekday}>
            {label}
          </div>
        ))}

        {cells.map((cell) => (
          <div
            key={cell.date}
            className={[
              styles.calendarCell,
              cell.inCurrentMonth ? '' : styles.calendarCellMuted,
              cell.isToday ? styles.calendarCellToday : '',
              mode === 'week' ? styles.calendarCellTall : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onDoubleClick={() => canWrite && onCreate(cell.date)}
          >
            <span className={styles.calendarDayNumber}>{Number(cell.date.slice(8, 10))}</span>

            {cell.entries.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={styles.calendarEntry}
                style={{ borderLeftColor: entry.tone }}
                title={entry.title}
                onClick={() => {
                  if (entry.kind === 'deadline' && entry.workItemId) {
                    onOpenWorkItem(entry.workItemId);
                  } else if (entry.occurrence) {
                    onOpenEvent(entry.occurrence);
                  }
                }}
              >
                {entry.time ? <span className={styles.calendarEntryTime}>{entry.time}</span> : null}
                <span className={styles.calendarEntryTitle}>{entry.title}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <p className={styles.muted}>
        Nhấp đúp vào một ô để tạo sự kiện vào ngày đó. Mục màu cam là hạn của công việc, bấm
        vào sẽ mở công việc tương ứng.
      </p>
    </div>
  );
}
