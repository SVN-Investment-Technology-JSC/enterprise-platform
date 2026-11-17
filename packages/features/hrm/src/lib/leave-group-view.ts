import type { HrmLeaveGroupRange, HrmOtGroupRange } from '@enterprise-platform/contracts-hrm';
import { formatRequestPeriod } from './request-time-format';

/** Khoản bổ sung của đơn nghỉ nhiều khoản: không hiện thành dòng riêng, đi theo khoản chính. */
export function isLeaveGroupFollower(r: { id: string; groupId?: unknown }): boolean {
  return typeof r.groupId === 'string' && r.groupId !== r.id;
}

/**
 * Tóm tắt đơn nhiều khoản từ khoản chính: thời gian từng khoản và tổng số ngày. Đơn một khoản hoặc dòng không phải khoản
 * chính trả null.
 */
export function leaveGroupSummary(r: object): {
  count: number;
  periods: string[];
  totalDays: number;
} | null {
  const value = (r as { groupRanges?: unknown }).groupRanges;
  const ranges = Array.isArray(value) ? (value as readonly HrmLeaveGroupRange[]) : [];
  if (ranges.length < 2) return null;
  return {
    count: ranges.length,
    periods: ranges.map((g) => formatRequestPeriod(g)),
    totalDays: Math.round(ranges.reduce((n, g) => n + (Number(g.duration) || 0), 0) * 100) / 100,
  };
}

/**
 * Tóm tắt đơn làm thêm nhiều khoảng từ khoảng chính: thời gian từng khoảng và tổng số phút. Đơn một khoảng hoặc dòng không
 * phải khoảng chính trả null.
 */
export function overtimeGroupSummary(r: object): {
  count: number;
  periods: string[];
  totalMinutes: number;
} | null {
  const value = (r as { groupRanges?: unknown }).groupRanges;
  const ranges = Array.isArray(value) ? (value as readonly HrmOtGroupRange[]) : [];
  if (ranges.length < 2) return null;
  return {
    count: ranges.length,
    periods: ranges.map((g) => formatRequestPeriod(g)),
    totalMinutes: ranges.reduce((n, g) => n + (Number(g.plannedMinutes) || 0), 0),
  };
}
