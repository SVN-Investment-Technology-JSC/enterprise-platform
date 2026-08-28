'use client';

import styles from './module-shell.module.scss';

/**
 * Biểu đồ vẽ bằng SVG thuần, không thư viện.
 *
 * Cố ý không thêm dependency: kéo một thư viện biểu đồ vào sẽ sửa
 * `pnpm-lock.yaml` — vùng phải hỏi trước — và làm bốn image web nặng thêm cho
 * vài hình cơ bản. Toàn bộ phần dưới đây gói gọn trong một file, không state,
 * không hiệu ứng, nên cũng không có gì để hỏng khi Next đổi phiên bản.
 */

/** Một lát/cột dữ liệu. `value` âm bị coi là 0 — biểu đồ không diễn tả số âm. */
export interface ChartSlice {
  readonly label: string;
  readonly value: number;
  /** Bỏ trống thì lấy theo bảng màu mặc định, xoay vòng theo thứ tự. */
  readonly color?: string;
}

/**
 * Bảng màu dùng chung cho mọi biểu đồ của cả ba module.
 *
 * Cùng một bảng để hai module đặt cạnh nhau không đá màu nhau, và để người đọc
 * quen mắt: lát thứ nhất luôn là màu chủ đạo của sản phẩm.
 */
const PALETTE = [
  '#2f6fed',
  '#16845e',
  '#e0a83a',
  '#b23b3b',
  '#7b5ea7',
  '#3aa0a8',
  '#8494a8',
] as const;

const colorAt = (index: number, override?: string) =>
  override ?? PALETTE[index % PALETTE.length];

const clean = (slices: readonly ChartSlice[]) =>
  slices
    .map((slice) => ({ ...slice, value: Number.isFinite(slice.value) ? Math.max(0, slice.value) : 0 }))
    .filter((slice) => slice.value > 0);

function EmptyNote(props: { hint?: string }) {
  return <p className={styles.chartEmpty}>{props.hint ?? 'Chưa có dữ liệu để vẽ.'}</p>;
}

/**
 * Biểu đồ tròn dạng vành khuyên.
 *
 * Dùng `stroke-dasharray` trên một đường tròn thay vì vẽ path hình quạt: ít
 * phép tính hơn hẳn, và không gặp lỗi làm tròn khiến các lát hở kẽ.
 *
 * Lỗ giữa để đặt tổng số — con số người ta tìm đầu tiên khi nhìn biểu đồ tròn.
 */
export function DonutChart(props: {
  slices: readonly ChartSlice[];
  /** Nhãn dưới tổng số ở giữa, ví dụ "hồ sơ". */
  unit?: string;
  emptyHint?: string;
}) {
  const slices = clean(props.slices);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return <EmptyNote hint={props.emptyHint} />;

  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;

  return (
    <div className={styles.chartRow}>
      <svg viewBox="0 0 160 160" className={styles.donut} role="img" aria-label="Biểu đồ tròn">
        <g transform="rotate(-90 80 80)">
          {slices.map((slice, index) => {
            const length = (slice.value / total) * circumference;
            const dash = `${length} ${circumference - length}`;
            const offset = -consumed;
            consumed += length;
            return (
              <circle
                key={slice.label}
                cx="80"
                cy="80"
                r={radius}
                fill="none"
                stroke={colorAt(index, slice.color)}
                strokeWidth="26"
                strokeDasharray={dash}
                strokeDashoffset={offset}
              >
                <title>{`${slice.label}: ${slice.value}`}</title>
              </circle>
            );
          })}
        </g>
        <text x="80" y="76" className={styles.donutTotal}>
          {total}
        </text>
        {props.unit ? (
          <text x="80" y="94" className={styles.donutUnit}>
            {props.unit}
          </text>
        ) : null}
      </svg>

      <ul className={styles.legend}>
        {slices.map((slice, index) => (
          <li key={slice.label}>
            <span
              className={styles.legendDot}
              style={{ background: colorAt(index, slice.color) }}
              aria-hidden="true"
            />
            <span className={styles.legendLabel}>{slice.label}</span>
            <span className={styles.legendValue}>
              {slice.value}
              <small>{Math.round((slice.value / total) * 100)}%</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Biểu đồ cột ngang.
 *
 * Cột NGANG chứ không dọc: nhãn ở đây là tên đơn vị, tên nhóm quy trình — chuỗi
 * dài. Cột dọc sẽ phải xoay nhãn 45° hoặc cắt bớt, cả hai đều khó đọc.
 *
 * Dựng bằng div + CSS width thay vì SVG: nhãn tự xuống dòng và tự co theo bề
 * ngang thẻ, không phải tính toạ độ chữ.
 */
export function BarChart(props: {
  slices: readonly ChartSlice[];
  emptyHint?: string;
  /** Số cột tối đa; phần còn lại gộp vào "Khác". */
  max?: number;
}) {
  const all = clean(props.slices).sort((left, right) => right.value - left.value);
  if (all.length === 0) return <EmptyNote hint={props.emptyHint} />;

  const limit = props.max ?? 6;
  const head = all.slice(0, limit);
  const rest = all.slice(limit);
  const bars =
    rest.length > 0
      ? [...head, { label: 'Khác', value: rest.reduce((sum, slice) => sum + slice.value, 0) }]
      : head;

  // Chia theo cột LỚN NHẤT, không theo tổng: mắt so sánh các cột với nhau, và
  // chia theo tổng thì mọi cột đều tí xíu khi có nhiều hạng mục.
  const peak = Math.max(...bars.map((bar) => bar.value));

  return (
    <ul className={styles.bars}>
      {bars.map((bar, index) => (
        <li key={bar.label}>
          <span className={styles.barLabel} title={bar.label}>
            {bar.label}
          </span>
          <span className={styles.barTrack}>
            <span
              className={styles.barFill}
              style={{
                width: `${Math.max(2, (bar.value / peak) * 100)}%`,
                background: colorAt(index, bar.color),
              }}
            />
          </span>
          <span className={styles.barValue}>{bar.value}</span>
        </li>
      ))}
    </ul>
  );
}
