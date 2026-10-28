'use client';

import {
  OPPORTUNITY_STAGE_LABELS,
  type DashboardStageRow,
  type DashboardTrend,
  type DashboardTrendBucket,
} from '@enterprise-platform/contracts-crm';
import { bucketLabel, formatCount, formatDay, formatVndCompact } from './dashboard.model';
import styles from './dashboard.module.scss';

/** Màu hai chuỗi của biểu đồ xu hướng; dùng lại ở chú thích. */
const REVENUE_COLOR = '#3b82f6';
const ORDERS_COLOR = '#f59e0b';
const CHART_HEIGHT = 200;

/** Màu thanh theo giai đoạn cơ hội: nhạt tới đậm theo độ gần chốt. */
const STAGE_COLOR: Readonly<Record<string, string>> = {
  NEW: '#94a3b8',
  CONTACTED: '#93c5fd',
  DISCOVERY: '#60a5fa',
  QUOTING: '#3b82f6',
  NEGOTIATION: '#1d4ed8',
};

function bucketRange(bucket: DashboardTrendBucket): string {
  return bucket.start === bucket.end ? formatDay(bucket.start) : `${formatDay(bucket.start)} – ${formatDay(bucket.end)}`;
}

/**
 * Doanh thu (cột, trục trái) và số đơn mới (đường, trục phải) theo mốc thời gian. Vẽ bằng SVG thuần, giãn theo bề
 * ngang khung như biểu đồ xu hướng của trang Báo cáo Công việc. Bấm một cột để mở trang chi tiết.
 */
export function RevenueTrendChart({ trend, onPick }: { readonly trend: DashboardTrend; readonly onPick?: () => void }) {
  const buckets = trend.buckets;
  const maxRevenue = Math.max(1, ...buckets.map((bucket) => bucket.revenue));
  const maxOrders = Math.max(1, ...buckets.map((bucket) => bucket.orders));
  const slot = 100 / Math.max(1, buckets.length);
  const bar = slot * 0.62;
  // Nhãn trục ngang thưa bớt khi nhiều cột, để chữ không chồng lên nhau.
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 12));
  const y = (orders: number) => CHART_HEIGHT - (orders / maxOrders) * (CHART_HEIGHT - 6);
  const line = buckets.map((bucket, index) => `${index * slot + slot / 2},${y(bucket.orders)}`).join(' ');

  return (
    <div className={styles.chart}>
      <div className={styles.legend}>
        <span>
          <i style={{ background: REVENUE_COLOR }} /> Doanh thu (trục trái)
        </span>
        <span>
          <i className={styles.legendLine} style={{ background: ORDERS_COLOR }} /> Đơn bán mới (trục phải)
        </span>
      </div>
      <div className={styles.trend}>
        <span className={styles.axisMax}>{formatVndCompact(maxRevenue)}</span>
        <span className={styles.axisMaxRight}>{formatCount(maxOrders)}</span>
        <svg viewBox={`0 0 100 ${CHART_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="Biểu đồ doanh thu và đơn bán mới">
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              x1="0"
              x2="100"
              y1={CHART_HEIGHT * ratio}
              y2={CHART_HEIGHT * ratio}
              stroke="#e2e8f0"
              strokeWidth="0.6"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {buckets.map((bucket, index) => {
            const height = (Math.max(bucket.revenue, 0) / maxRevenue) * (CHART_HEIGHT - 6);
            return (
              <rect
                key={bucket.start}
                x={index * slot + (slot - bar) / 2}
                y={CHART_HEIGHT - height}
                width={bar}
                height={Math.max(height, bucket.revenue > 0 ? 1 : 0)}
                fill={REVENUE_COLOR}
                className={onPick ? styles.barClickable : undefined}
                onClick={onPick}
              >
                <title>{`${bucketRange(bucket)} · Doanh thu ${formatVndCompact(bucket.revenue)} · ${formatCount(bucket.orders)} đơn mới`}</title>
              </rect>
            );
          })}
          {buckets.length > 1 ? (
            <polyline
              points={line}
              fill="none"
              stroke={ORDERS_COLOR}
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : null}
        </svg>
      </div>
      <div className={styles.axis}>
        {buckets.map((bucket, index) => (
          <span key={bucket.start} style={{ width: `${slot}%` }}>
            {index % labelEvery === 0 ? bucketLabel(bucket.start, trend.granularity) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Cơ hội đang mở theo giai đoạn: thanh theo giá trị, kèm số cơ hội và giá trị theo xác suất. Bấm để mở Cơ hội. */
export function PipelineBars({ rows, onPick }: { readonly rows: readonly DashboardStageRow[]; readonly onPick: () => void }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className={styles.barList}>
      {rows.map((row) => (
        <li key={row.stage}>
          <button type="button" onClick={onPick} title={`Theo xác suất: ${formatVndCompact(row.weightedValue)}`}>
            <span>{OPPORTUNITY_STAGE_LABELS[row.stage]}</span>
            <span className={styles.barTrack}>
              <span style={{ width: `${(row.value / max) * 100}%`, background: STAGE_COLOR[row.stage] ?? '#3b82f6' }} />
            </span>
            <span className={styles.barValue}>
              <strong>{formatVndCompact(row.value)}</strong>
              <small>{formatCount(row.count)} cơ hội</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
