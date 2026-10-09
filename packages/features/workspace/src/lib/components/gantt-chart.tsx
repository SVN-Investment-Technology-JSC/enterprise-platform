'use client';

import type { WorkItem, WorkItemDependency } from '@enterprise-platform/contracts-workspace';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BAR_HEIGHT,
  ROW_HEIGHT,
  buildGanttLayout,
  dayWidthOf,
  type GanttZoom,
} from '../gantt.model';
import { formatDate, workItemStatusLabel } from '../workspace-labels';
import styles from '../workspace.module.scss';

/** Bề rộng cột tên việc bên trái, cố định để hai vùng cuộn khớp hàng. */
const LABEL_WIDTH = 240;
const AXIS_HEIGHT = 26;

export interface GanttChartProps {
  /** Đã theo đúng thứ tự cây; component không tự sắp xếp lại. */
  readonly rows: readonly { item: WorkItem; depth: number }[];
  readonly dependencies: readonly WorkItemDependency[];
  readonly onOpen: (item: WorkItem) => void;
}

const ZOOMS: readonly { id: GanttZoom; label: string }[] = [
  { id: 'day', label: 'Ngày' },
  { id: 'week', label: 'Tuần' },
  { id: 'month', label: 'Tháng' },
];

/**
 * Gantt vẽ bằng SVG thuần, không thư viện.
 *
 * Cùng lý do với `charts.tsx` của module-shell: kéo một thư viện biểu đồ vào
 * sẽ sửa `pnpm-lock.yaml` và làm các image web nặng thêm cho vài hình cơ bản.
 *
 * Đợt này biểu đồ **chỉ đọc** — không kéo thả đổi lịch. Sửa mốc kế hoạch vẫn
 * qua form công việc.
 */
export function GanttChart({ rows, dependencies, onOpen }: GanttChartProps) {
  const [zoom, setZoom] = useState<GanttZoom>('week');
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Ngày đang ở giữa khung nhìn, giữ lại để đổi mức thu phóng không mất chỗ. */
  const centerDayRef = useRef<number | undefined>(undefined);
  const empty = rows.length === 0;
  /** Bề rộng vùng cuộn: trục giãn ra cho kín khung, không để một mảng trắng. */
  const [viewWidth, setViewWidth] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewWidth(element.clientWidth));
    observer.observe(element);
    setViewWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [empty]);

  const layout = useMemo(
    () =>
      buildGanttLayout(rows, dependencies, zoom, new Date(), {
        minWidth: viewWidth,
        includeToday: true,
      }),
    [rows, dependencies, zoom, viewWidth],
  );

  /** Ngày bắt đầu khung, tính bằng số ngày từ mốc 0: dùng để giữ chỗ khi khung giãn. */
  const startDay = Math.round(layout.start.getTime() / 86_400_000);

  const scrollToToday = (smooth: boolean) => {
    const element = scrollRef.current;
    if (!element || layout.todayX === undefined) return;
    // Hôm nay đứng ở một phần ba bên trái: thấy cả việc vừa qua lẫn việc sắp tới.
    element.scrollTo({
      left: Math.max(layout.todayX - element.clientWidth / 3, 0),
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  // Mở biểu đồ (hay đổi dự án) thì tự cuộn tới hôm nay, một lần. Chờ có bề
  // rộng khung: trước đó trục chưa giãn xong và toạ độ hôm nay còn đổi.
  const project = rows[0]?.item.projectId;
  const scrolledFor = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!viewWidth || !project || scrolledFor.current === project) return;
    scrolledFor.current = project;
    scrollToToday(false);
  });

  // Ngày ở giữa khung tính từ mốc 0 tuyệt đối, không phải từ đầu khung: đầu
  // khung dời đi khi đổi mức thu phóng (khung giãn theo bề rộng).
  const rememberCenter = () => {
    const element = scrollRef.current;
    if (!element) return;
    // Đang nhìn thấy hôm nay thì đổi mức xong vẫn neo vào hôm nay.
    const todayX = layout.todayX;
    anchorTodayRef.current =
      todayX !== undefined &&
      todayX >= element.scrollLeft &&
      todayX <= element.scrollLeft + element.clientWidth;
    centerDayRef.current =
      startDay + (element.scrollLeft + element.clientWidth / 2) / dayWidthOf(zoom);
  };

  // Đổi mức thu phóng làm mọi toạ độ đổi theo, nên phải cuộn lại tới đúng
  // ngày cũ sau khi khung đã vẽ xong — nếu không người dùng bị ném về đầu
  // dòng thời gian mỗi lần bấm.
  //
  // Khung giãn vì đổi bề rộng cửa sổ thì đầu khung dời đi: dịch lại đúng
  // ngần ấy ngày để những gì đang xem đứng yên.
  const previousStart = useRef(startDay);
  const anchorTodayRef = useRef(false);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const shifted = previousStart.current - startDay;
    previousStart.current = startDay;
    if (!element) return;
    const centerDay = centerDayRef.current;
    if (anchorTodayRef.current && layout.todayX !== undefined) {
      anchorTodayRef.current = false;
      centerDayRef.current = undefined;
      element.scrollLeft = Math.max(layout.todayX - element.clientWidth / 3, 0);
    } else if (centerDay !== undefined) {
      centerDayRef.current = undefined;
      element.scrollLeft = (centerDay - startDay) * dayWidthOf(zoom) - element.clientWidth / 2;
    } else if (shifted !== 0) {
      element.scrollLeft += shifted * dayWidthOf(zoom);
    }
  }, [zoom, startDay, layout.todayX]);

  const changeZoom = (next: GanttZoom) => {
    rememberCenter();
    setZoom(next);
  };

  return (
    <div className={styles.tabBody}>
      <div className={styles.calendarBar}>
        <strong className={styles.calendarLabel}>
          {formatDate(isoDay(layout.start))} – {formatDate(isoDay(layout.end))}
        </strong>
        <div className={styles.ganttActions}>
          <button
            type="button"
            className={styles.buttonGhost}
            disabled={layout.todayX === undefined}
            onClick={() => scrollToToday(true)}
          >
            Hôm nay
          </button>
          <div className={styles.segmented} role="group" aria-label="Mức thu phóng">
            {ZOOMS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={zoom === entry.id}
                className={zoom === entry.id ? styles.segmentActive : styles.segment}
                onClick={() => changeZoom(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className={styles.muted}>Chưa có công việc nào để vẽ.</p>
      ) : (
        <div className={styles.gantt}>
          <div className={styles.ganttLabels} style={{ width: LABEL_WIDTH }}>
            <div className={styles.ganttAxisSpacer} style={{ height: AXIS_HEIGHT }} />
            {layout.rows.map((row) => (
              <button
                key={row.item.id}
                type="button"
                className={styles.ganttLabel}
                style={{ height: ROW_HEIGHT, paddingLeft: `${row.depth * 0.75 + 0.5}rem` }}
                title={`${row.item.code} · ${row.item.title}`}
                onClick={() => onOpen(row.item)}
              >
                {row.item.code} · {row.item.title}
              </button>
            ))}
          </div>

          <div className={styles.ganttScroll} ref={scrollRef}>
            <svg
              width={layout.width}
              height={layout.height + AXIS_HEIGHT}
              role="img"
              aria-label="Biểu đồ Gantt của dự án"
              className={styles.ganttSvg}
            >
              <defs>
                {/* Hai đầu mũi tên: đậm cho FS, nhạt cho ba loại chỉ cảnh báo. */}
                <marker
                  id="ws-arrow-strong"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3"
                  orient="auto"
                >
                  <path d="M 0 0 L 6 3 L 0 6 z" fill="#334155" />
                </marker>
                <marker
                  id="ws-arrow-soft"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3"
                  orient="auto"
                >
                  <path d="M 0 0 L 6 3 L 0 6 z" fill="#cbd5e1" />
                </marker>
              </defs>

              {/* Trục thời gian */}
              <g>
                {layout.ticks.map((tick) => (
                  <g key={tick.x}>
                    <line
                      x1={tick.x}
                      y1={0}
                      x2={tick.x}
                      y2={layout.height + AXIS_HEIGHT}
                      stroke={tick.major ? '#cbd5e1' : '#eef2f7'}
                    />
                    <text x={tick.x + 3} y={16} className={styles.ganttTickLabel}>
                      {tick.label}
                    </text>
                  </g>
                ))}
              </g>

              <g transform={`translate(0, ${AXIS_HEIGHT})`}>
                {/* Sọc hàng chẵn lẻ để mắt lần đúng dòng khi cuộn ngang. */}
                {layout.rows.map((row, index) =>
                  index % 2 === 1 ? (
                    <rect
                      key={`stripe-${row.item.id}`}
                      x={0}
                      y={row.y}
                      width={layout.width}
                      height={ROW_HEIGHT}
                      fill="#f8fafc"
                    />
                  ) : null,
                )}

                {layout.edges.map((edge) => (
                  <path
                    key={edge.id}
                    d={edge.path}
                    fill="none"
                    stroke={edge.strong ? '#334155' : '#cbd5e1'}
                    strokeWidth={edge.strong ? 1.4 : 1}
                    strokeDasharray={edge.strong ? undefined : '3 3'}
                    markerEnd={`url(#${edge.strong ? 'ws-arrow-strong' : 'ws-arrow-soft'})`}
                  >
                    <title>{edge.label}</title>
                  </path>
                ))}

                {layout.rows.map((row) => {
                  const centerY = row.y + ROW_HEIGHT / 2;
                  const tooltip = [
                    `${row.item.code} · ${row.item.title}`,
                    workItemStatusLabel(row.item),
                    `${formatDate(row.item.plannedStart) || '…'} → ${formatDate(row.item.plannedEnd) || '…'}`,
                    `${row.item.progressPercent}%`,
                  ].join('\n');

                  if (row.milestoneX !== undefined) {
                    const size = 6;
                    return (
                      <polygon
                        key={row.item.id}
                        points={[
                          `${row.milestoneX},${centerY - size}`,
                          `${row.milestoneX + size},${centerY}`,
                          `${row.milestoneX},${centerY + size}`,
                          `${row.milestoneX - size},${centerY}`,
                        ].join(' ')}
                        fill={row.overdue ? '#b91c1c' : '#6d28d9'}
                        className={styles.ganttHit}
                        onClick={() => onOpen(row.item)}
                      >
                        <title>{tooltip}</title>
                      </polygon>
                    );
                  }

                  if (!row.bar) return null;
                  const barY = centerY - BAR_HEIGHT / 2;
                  return (
                    <g
                      key={row.item.id}
                      className={styles.ganttHit}
                      onClick={() => onOpen(row.item)}
                    >
                      <rect
                        x={row.bar.x}
                        y={barY}
                        width={row.bar.width}
                        height={BAR_HEIGHT}
                        rx={3}
                        fill={row.overdue ? '#fee2e2' : '#dbeafe'}
                        stroke={row.overdue ? '#b91c1c' : '#2563eb'}
                      />
                      {row.bar.progressWidth > 0 ? (
                        <rect
                          x={row.bar.x}
                          y={barY}
                          width={row.bar.progressWidth}
                          height={BAR_HEIGHT}
                          rx={3}
                          fill={row.overdue ? '#b91c1c' : '#2563eb'}
                        />
                      ) : null}
                      <title>{tooltip}</title>
                    </g>
                  );
                })}

                {layout.todayX === undefined ? null : (
                  <line
                    x1={layout.todayX}
                    y1={0}
                    x2={layout.todayX}
                    y2={layout.height}
                    stroke="#d9ab00"
                    strokeWidth={1.5}
                  >
                    <title>Hôm nay</title>
                  </line>
                )}
              </g>

              {/* Nhãn "Hôm nay" trên trục, cho vạch vàng khỏi lẫn với vạch tuần. */}
              {layout.todayX === undefined ? null : (
                <g transform={`translate(${layout.todayX}, 0)`}>
                  <rect x={-26} y={3} width={52} height={17} rx={8} fill="#d9ab00" />
                  <text x={0} y={15} textAnchor="middle" className={styles.ganttTodayLabel}>
                    Hôm nay
                  </text>
                </g>
              )}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

/** `Date` → `YYYY-MM-DD` theo giờ trình duyệt, để dùng lại `formatDate`. */
function isoDay(value: Date): string {
  return [
    String(value.getFullYear()).padStart(4, '0'),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}
