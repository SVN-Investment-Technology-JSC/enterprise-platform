import { PROGRESS_REPORT_DESCRIPTION_MAX_LENGTH } from '@enterprise-platform/contracts-workspace';
import { WorkspaceValidationError } from './workspace.error.js';

/** Phần trăm báo cáo: số nguyên 0–100 (chuỗi số cũng nhận, vì body JSON có thể gửi lên dạng chuỗi). */
export function parseReportPercent(value: unknown): number {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > 100) {
    throw new WorkspaceValidationError('Tiến độ phải là số nguyên từ 0 đến 100.');
  }
  return number;
}

/** Mô tả báo cáo: bỏ khoảng trắng hai đầu, rỗng là không có, dài quá giới hạn thì báo lỗi. */
export function parseReportDescription(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new WorkspaceValidationError('Mô tả báo cáo không hợp lệ.');
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > PROGRESS_REPORT_DESCRIPTION_MAX_LENGTH) {
    throw new WorkspaceValidationError(`Mô tả báo cáo dài tối đa ${PROGRESS_REPORT_DESCRIPTION_MAX_LENGTH} ký tự.`);
  }
  return text;
}

/**
 * Ngày báo cáo `YYYY-MM-DD`: bỏ trống là hôm nay; phải là ngày có thật và không sau hôm nay (báo bù được, báo trước
 * thì không).
 */
export function parseReportDate(value: unknown, today: string): string {
  if (value === undefined || value === null || value === '') return today;
  const text = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const real =
    match !== null &&
    (() => {
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
    })();
  if (!real) throw new WorkspaceValidationError('Ngày báo cáo không hợp lệ.');
  if (text > today) throw new WorkspaceValidationError('Ngày báo cáo không được sau hôm nay.');
  return text;
}

/**
 * Số tiến độ khôi phục khi công việc rời Hoàn thành / Chờ duyệt về Đang làm: phần trăm của báo cáo gần nhất chưa tới
 * 100%, hoặc `undefined` (để về 0% như hoàn tác thông thường) khi chưa có báo cáo nào như vậy. `reports` mới nhất trước.
 */
export function progressToRestore(reports: readonly { readonly percent: number }[]): number | undefined {
  const last = reports.find((report) => report.percent < 100);
  return last && last.percent > 0 ? last.percent : undefined;
}
