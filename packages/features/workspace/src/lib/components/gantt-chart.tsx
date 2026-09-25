'use client';

import type { WorkItem, WorkItemDependency } from '@enterprise-platform/contracts-workspace';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BAR_HEIGHT,
  ROW_HEIGHT,
  buildGanttLayout,
  dayWidthOf,
  type GanttZoom,
} from '../gantt.model';
import { WORK_ITEM_STATUS_LABELS, formatDate } from '../workspace-labels';
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

  const layout = useMemo(
    () => buildGanttLayout(rows, dependencies, zoom),
    [rows, dependencies, zoom],
  );

  const rememberCenter = () => {
    const element = scrollRef.current;
    if (!element) return;
    centerDayRef.current =
      (element.scrollLeft + element.clientWidth / 2) / dayWidthOf(zoom);
  };

  // Đổi mức thu phóng làm mọi toạ độ đổi theo, nên phải cuộn lại tới đúng
  // ngày cũ sau khi khung đã vẽ xong — nếu không người dùng bị ném về đầu
  // dòng thời gian mỗi lần bấm.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const centerDay = centerDayRef.current;
    if (!element || centerDay === undefined) return;
    element.scrollLeft = centerDay * dayWidthOf(zoom) - element.clientWidth / 2;
  }, [zoom]);

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
                    WORK_ITEM_STATUS_LABELS[row.item.status],
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
                    stroke="#f97316"
                    strokeWidth={1.5}
                  >
                    <title>Hôm nay</title>
                  </line>
                )}
              </g>
            </svg>
          </div>
        </div>
      )}

      <p className={styles.muted}>
        Biểu đồ chỉ để xem. Đường liền đậm là phụ thuộc kiểu FS — loại duy nhất chặn hoàn
        thành; ba loại còn lại vẽ nét đứt vì chỉ cảnh báo về lịch. Vạch cam là hôm nay.
      </p>
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
