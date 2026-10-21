import { DEFAULT_STROKE_WIDTH } from '@enterprise-platform/shared-brand-icon';

/** Cùng ngưỡng với bộ kiểm tra quy chuẩn (compliance) để cảnh báo ở thanh thuộc tính khớp với bảng Quy chuẩn. */
const TOLERANCE = 0.011;

export const isAllowedStrokeWidth = (width: number, allowed: readonly number[]): boolean =>
  allowed.some((item) => Math.abs(item - width) < TOLERANCE);

/** Độ dày được phép gần nhất; bộ trống thì giữ nguyên. */
export function nearestAllowedStrokeWidth(width: number, allowed: readonly number[]): number {
  if (allowed.length === 0) return width;
  return allowed.reduce((best, item) => (Math.abs(item - width) < Math.abs(best - width) ? item : best), allowed[0]);
}

/** Độ dày cho hình mới: độ dày mặc định của Studio, hoặc giá trị gần nhất trong bộ cho phép. */
export const defaultStrokeWidth = (allowed: readonly number[]): number =>
  nearestAllowedStrokeWidth(DEFAULT_STROKE_WIDTH, allowed);
