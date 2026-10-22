'use client';

import type { ReportTrend, ReportTrendBucket } from '@enterprise-platform/contracts-workspace';
import { formatDate } from '../workspace-labels';
import styles from '../workspace.module.scss';

/** Màu ba chuỗi của biểu đồ xu hướng; dùng lại ở chú thích và bảng. */
export const TREND_SERIES = [
  { key: 'created', label: 'Tạo mới', color: '#93c5fd' },
  { key: 'completed', label: 'Hoàn thành', color: '#10b981' },
  { key: 'missedDeadline', label: 'Lỡ hạn', color: '#ef4444' },
] as const;
export type TrendSeriesKey = (typeof TREND_SERIES)[number]['key'];

const CHART_HEIGHT = 180;

/** Nhãn ngắn của một cột: ngày và tuần "21/10" (tuần lấy ngày thứ Hai), tháng "T10". Năm đã rõ từ kỳ báo cáo. */
function bucketLabel(start: string, granularity: ReportTrend['granularity']): string {
  const [, month, day] = start.split('-');
  return granularity === 'month' ? `T${Number(month)}` : `${day}/${month}`;
}

/**
 * Biểu đồ cột nhóm: mỗi mốc thời gian ba cột (tạo mới, hoàn thành, lỡ hạn). Bấm một cột để xem danh sách việc của
 * mốc đó. Vẽ bằng SVG thuần, giãn theo bề ngang khung.
 */
export function TrendChart({
  trend,
  onPick,
}: {
  readonly trend: ReportTrend;
  readonly onPick?: (bucket: ReportTrendBucket, series: TrendSeriesKey) => void;
}) {
  const buckets = trend.buckets;
  const max = Math.max(1, ...buckets.flatMap((bucket) => [bucket.created, bucket.completed, bucket.missedDeadline]));
  const slot = 100 / Math.max(1, buckets.length);
  const bar = (slot * 0.8) / TREND_SERIES.length;
  // Nhãn trục ngang thưa bớt khi nhiều cột, để chữ không chồng lên nhau.
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 12));

  return (
    <div className={styles.reportChart}>
      <div className={styles.reportLegend}>
        {TREND_SERIES.map((series) => (
          <span key={series.key}>
            <i style={{ background: series.color }} /> {series.label}
          </span>
        ))}
      </div>
      <div className={styles.reportTrend}>
        <span className={styles.reportAxisMax}>{max}</span>
        <svg viewBox={`0 0 100 ${CHART_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="Biểu đồ xu hướng">
          {[0.25, 0.5, 0.75].map((line) => (
            <line
              key={line}
              x1="0"
              x2="100"
              y1={CHART_HEIGHT * line}
              y2={CHART_HEIGHT * line}
              stroke="#e2e8f0"
              strokeWidth="0.6"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {buckets.map((bucket, index) =>
            TREND_SERIES.map((series, s) => {
              const value = bucket[series.key];
              const height = (value / max) * (CHART_HEIGHT - 4);
              return (
                <rect
                  key={`${bucket.start}-${series.key}`}
                  x={index * slot + slot * 0.1 + s * bar}
                  y={CHART_HEIGHT - height}
                  width={bar * 0.9}
                  height={Math.max(height, value > 0 ? 1 : 0)}
                  fill={series.color}
                  className={value > 0 && onPick ? styles.reportBarClickable : undefined}
                  onClick={value > 0 && onPick ? () => onPick(bucket, series.key) : undefined}
                >
                  <title>{`${formatDate(bucket.start)} · ${series.label}: ${value}`}</title>
                </rect>
              );
            }),
          )}
        </svg>
      </div>
      <div className={styles.reportAxis}>
        {buckets.map((bucket, index) => (
          <span key={bucket.start} style={{ width: `${slot}%` }}>
            {index % labelEvery === 0 ? bucketLabel(bucket.start, trend.granularity) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface ShareItem {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

/** Biểu đồ vành khuyên kèm chú thích; bấm một phần (hoặc dòng chú thích) để xem danh sách việc. */
export function DonutChart({
  items,
  centerLabel,
  onPick,
}: {
  readonly items: readonly ShareItem[];
  readonly centerLabel: string;
  readonly onPick?: (key: string) => void;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const radius = 15.9155; // chu vi 100: mỗi phần trăm là một đơn vị nét.
  let offset = 25;
  return (
    <div className={styles.reportDonut}>
      <svg viewBox="0 0 42 42" role="img" aria-label={centerLabel}>
        <circle cx="21" cy="21" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="6" />
        {total > 0
          ? items.map((item) => {
              const share = (item.value / total) * 100;
              const segment = (
                <circle
                  key={item.key}
                  cx="21"
                  cy="21"
                  r={radius}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="6"
                  strokeDasharray={`${share} ${100 - share}`}
                  strokeDashoffset={offset}
                  className={onPick ? styles.reportBarClickable : undefined}
                  onClick={onPick ? () => onPick(item.key) : undefined}
                >
                  <title>{`${item.label}: ${item.value}`}</title>
                </circle>
              );
              offset -= share;
              return segment;
            })
          : null}
        <text x="21" y="21" textAnchor="middle" className={styles.reportDonutValue}>
          {total}
        </text>
        <text x="21" y="26.5" textAnchor="middle" className={styles.reportDonutLabel}>
          {centerLabel}
        </text>
      </svg>
      <ul className={styles.reportLegendList}>
        {items.map((item) => (
          <li key={item.key}>
            <button type="button" disabled={!onPick || item.value === 0} onClick={() => onPick?.(item.key)}>
              <i style={{ background: item.color }} />
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <em>{total > 0 ? `${Math.round((item.value / total) * 100)}%` : ''}</em>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Thanh ngang theo từng mục (vd độ ưu tiên); bấm để xem danh sách. */
export function BarList({
  items,
  onPick,
}: {
  readonly items: readonly ShareItem[];
  readonly onPick?: (key: string) => void;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className={styles.reportBarList}>
      {items.map((item) => (
        <li key={item.key}>
          <button type="button" disabled={!onPick || item.value === 0} onClick={() => onPick?.(item.key)}>
            <span>{item.label}</span>
            <span className={styles.reportBarTrack}>
              <span style={{ width: `${(item.value / max) * 100}%`, background: item.color }} />
            </span>
            <strong>{item.value}</strong>
          </button>
        </li>
      ))}
    </ul>
  );
}
