'use client';

import type { CalendarOccurrence, WorkItem } from '@enterprise-platform/contracts-workspace';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  buildCalendarGrid,
  buildWeekTimeline,
  dateKey,
  gridLabel,
  gridRange,
  shiftAnchor,
  type CalendarMode,
  type WeekTimeline,
} from '../calendar-grid.model';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';
import { useFillViewportHeight } from './use-fill-viewport';
import { Tooltip } from './tooltip';

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

/** Số mục tối đa trong một ô ngày của lưới tháng; phần còn lại gộp thành "+n khác" (bấm để xem tuần đó). */
const MONTH_CELL_LIMIT = 3;

export interface TabCalendarProps {
  readonly projectId: string;
  readonly items: readonly WorkItem[];
  readonly canWrite: boolean;
  readonly onCreate: (date: string) => void;
  readonly onOpenEvent: (occurrence: CalendarOccurrence) => void;
  readonly onOpenWorkItem: (workItemId: string) => void;
  /** Đổi giá trị để buộc tải lại, sau khi tạo hoặc sửa sự kiện. */
  readonly reloadToken?: number;
  /**
   * Công việc của nhánh đang xem. Có thì chỉ hiện sự kiện gắn với các việc
   * này (hạn công việc đã được lọc sẵn qua `items`); vắng là cả dự án.
   */
  readonly scopeWorkItemIds?: ReadonlySet<string>;
  /** Dòng nhắc đang xem một nhánh, do trang Dự án dựng. */
  readonly scopeNote?: ReactNode;
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
  scopeWorkItemIds,
  scopeNote,
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

  const visibleOccurrences = useMemo(
    () =>
      scopeWorkItemIds
        ? occurrences.filter(
            (occurrence) => occurrence.workItemId && scopeWorkItemIds.has(occurrence.workItemId),
          )
        : occurrences,
    [occurrences, scopeWorkItemIds],
  );

  const cells = useMemo(
    () => buildCalendarGrid(anchor, mode, visibleOccurrences, items),
    [anchor, mode, visibleOccurrences, items],
  );

  // Chế độ tuần vẽ lưới giờ; chế độ tháng giữ lưới ô ngày.
  const timeline = useMemo(
    () => (mode === 'week' ? buildWeekTimeline(anchor, visibleOccurrences, items) : undefined),
    [anchor, mode, visibleOccurrences, items],
  );

  // Lịch nằm trong một khung vừa phần cao còn lại của màn hình; chỉ phần lưới cuộn bên trong.
  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useFillViewportHeight(frame, undefined, mode);

  // Vào chế độ tuần thì cuộn tới quanh giờ hiện tại (lùi một giờ cho dễ nhìn), thay vì luôn đứng ở đầu ngày.
  const weekStartHour = timeline?.startHour;
  useEffect(() => {
    const element = scroller.current;
    if (!element || weekStartHour === undefined) return;
    element.scrollTop = Math.max(0, (new Date().getHours() - weekStartHour - 1) * HOUR_PX);
  }, [mode, weekStartHour]);

  const openWeekOf = (date: string) => {
    setAnchor(new Date(`${date}T12:00:00`));
    setMode('week');
  };

  return (
    <div className={styles.tabBody}>
      {scopeNote}

      <div ref={frame} className={styles.calFrame}>
        <div className={styles.calHead}>
          <div className={styles.calNavGroup}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Kỳ trước"
              onClick={() => setAnchor((current) => shiftAnchor(current, mode, -1))}
            >
              <ChevronLeft size={15} />
            </button>
            <button type="button" className={styles.buttonGhost} onClick={() => setAnchor(new Date())}>
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
          </div>

          <strong className={styles.calendarLabel}>{gridLabel(anchor, mode)}</strong>
          {loading ? <span className={styles.muted}>Đang tải…</span> : null}

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
            <button type="button" className={styles.buttonPrimary} onClick={() => onCreate(dateKey(anchor))}>
              <CalendarPlus size={14} /> Sự kiện mới
            </button>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        ) : null}

        <div ref={scroller} className={styles.calBody}>
          {timeline ? (
            <WeekGrid
              timeline={timeline}
              canWrite={canWrite}
              onCreate={onCreate}
              onOpenEvent={onOpenEvent}
              onOpenWorkItem={onOpenWorkItem}
            />
          ) : (
            <div
              className={styles.calendarGrid}
              style={{ gridTemplateRows: `auto repeat(${Math.ceil(cells.length / 7)}, minmax(4.5rem, 1fr))` }}
            >
              {WEEKDAYS.map((label) => (
                <div key={label} className={styles.calendarWeekday}>
                  {label}
                </div>
              ))}

              {cells.map((cell, index) => {
                const shown = cell.entries.slice(0, MONTH_CELL_LIMIT);
                const hidden = cell.entries.length - shown.length;
                return (
                  <div
                    key={cell.date}
                    className={[
                      styles.calendarCell,
                      cell.inCurrentMonth ? '' : styles.calendarCellMuted,
                      cell.isToday ? styles.calendarCellToday : '',
                      index % 7 >= 5 ? styles.calendarCellWeekend : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onDoubleClick={() => canWrite && onCreate(cell.date)}
                  >
                    <span className={styles.calendarDayNumber}>{Number(cell.date.slice(8, 10))}</span>

                    {shown.map((entry) => (
                      <Tooltip key={entry.key} content={entry.title}>
                        <button
                          type="button"
                          className={styles.calendarEntry}
                          style={{ borderLeftColor: entry.tone }}
                          onClick={() => {
                            if (entry.kind === 'deadline' && entry.workItemId) {
                              onOpenWorkItem(entry.workItemId);
                            } else if (entry.occurrence) {
                              onOpenEvent(entry.occurrence);
                            }
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                        >
                          {entry.time ? <span className={styles.calendarEntryTime}>{entry.time}</span> : null}
                          <span className={styles.calendarEntryTitle}>{entry.title}</span>
                        </button>
                      </Tooltip>
                    ))}
                    {hidden > 0 ? (
                      <Tooltip content="Xem cả tuần này">
                        <button
                          type="button"
                          className={styles.calendarMore}
                          onClick={() => openWeekOf(cell.date)}
                        >
                          +{hidden} mục khác
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Chiều cao một giờ trên lưới tuần, tính bằng px. */
const HOUR_PX = 48;

/**
 * Lưới giờ của chế độ tuần: cột giờ bên trái, mỗi ngày một cột, sự kiện đặt
 * theo đúng giờ bắt đầu và độ dài. Hàng trên cùng là sự kiện cả ngày và hạn
 * công việc. Cột hôm nay có vạch đỏ ở giờ hiện tại.
 */
function WeekGrid({
  timeline,
  canWrite,
  onCreate,
  onOpenEvent,
  onOpenWorkItem,
}: {
  timeline: WeekTimeline;
  canWrite: boolean;
  onCreate: (date: string) => void;
  onOpenEvent: (occurrence: CalendarOccurrence) => void;
  onOpenWorkItem: (workItemId: string) => void;
}) {
  const hours = Array.from(
    { length: timeline.endHour - timeline.startHour },
    (_, index) => timeline.startHour + index,
  );
  const height = hours.length * HOUR_PX;
  const now = new Date();
  const nowTop = ((now.getHours() * 60 + now.getMinutes() - timeline.startHour * 60) / 60) * HOUR_PX;
  const dayClass = (day: { isToday: boolean; isWeekend: boolean }, base: string) =>
    [base, day.isToday ? styles.weekToday : '', day.isWeekend ? styles.weekWeekend : '']
      .filter(Boolean)
      .join(' ');

  return (
    <div className={styles.weekScroll}>
      <div className={styles.weekGrid}>
        <span className={styles.weekCorner} />
        {timeline.days.map((day, index) => (
          <div key={day.date} className={dayClass(day, styles.weekHead)}>
            <span className={styles.weekHeadLabel}>
              <span>{WEEKDAYS[index]}</span>
              <b>{`${day.date.slice(8, 10)}/${day.date.slice(5, 7)}`}</b>
            </span>
            {day.allDay.map((entry) => (
              <Tooltip key={entry.key} content={entry.title}>
                <button
                  type="button"
                  className={styles.calendarEntry}
                  style={{ borderLeftColor: entry.tone }}
                  onClick={() => {
                    if (entry.kind === 'deadline' && entry.workItemId) onOpenWorkItem(entry.workItemId);
                    else if (entry.occurrence) onOpenEvent(entry.occurrence);
                  }}
                >
                  <span className={styles.calendarEntryTitle}>{entry.title}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        ))}

        <div className={styles.weekHours} style={{ height }}>
          {hours.map((hour) => (
            <span key={hour} style={{ height: HOUR_PX }}>
              {`${String(hour).padStart(2, '0')}:00`}
            </span>
          ))}
        </div>
        {timeline.days.map((day) => (
          <div
            key={day.date}
            className={dayClass(day, styles.weekColumn)}
            style={{ height, backgroundSize: `100% ${HOUR_PX}px` }}
            onDoubleClick={() => canWrite && onCreate(day.date)}
          >
            {day.timed.map((entry) => (
              <Tooltip key={entry.key} content={`${entry.time} · ${entry.title}${entry.location ? ` · ${entry.location}` : ''}`}>
                <button
                  type="button"
                  className={styles.weekEvent}
                  style={{
                    top: ((entry.startMinute - timeline.startHour * 60) / 60) * HOUR_PX + 1,
                    height: Math.max(((entry.endMinute - entry.startMinute) / 60) * HOUR_PX - 2, 20),
                    left: `calc(${(entry.column / entry.columns) * 100}% + 3px)`,
                    width: `calc(${100 / entry.columns}% - 6px)`,
                    background: entry.tone,
                  }}
                  onClick={() => onOpenEvent(entry.occurrence)}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <b>{entry.title}</b>
                  <span>
                    {entry.time}
                    {entry.location ? ` · ${entry.location}` : ''}
                  </span>
                </button>
              </Tooltip>
            ))}
            {day.isToday && nowTop >= 0 && nowTop <= height ? (
              <span className={styles.weekNow} style={{ top: nowTop }} aria-hidden />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
