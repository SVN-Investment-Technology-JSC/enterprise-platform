'use client';
import { useEffect, useState } from 'react';
import type { HrmRequestTimePreview } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { formatHours } from '../request-time-format';
import { DateTimeInput, splitDateTime } from './date-time-input';

const formatDays = (days: number) => String(Math.round(days * 100) / 100).replace('.', ',');

/**
 * Chọn khoảng thời gian của đơn: từ ngày giờ đến ngày giờ. Số giờ và số ngày công do máy chủ tính theo ca thực tế
 * của nhân viên (`GET /requests/time-preview`), nên con số hiển thị trước khi gửi chính là con số sẽ được lưu.
 */
export function RequestTimeRange({
  employeeId,
  fromAt,
  toAt,
  onChange,
  onPreview,
  leaveTypeId,
  kind = 'leave',
  /** false: chỉ ghi nhận khoảng thời gian, không xin tính theo ca (loại đơn tuỳ chỉnh). */
  showPreview = true,
  fromLabel = 'Từ ngày giờ',
  toLabel = 'Đến ngày giờ',
  disabled,
}: {
  employeeId: string;
  fromAt: string;
  toAt: string;
  onChange: (next: { fromAt: string; toAt: string }) => void;
  /** Báo kết quả tính cho form cha để chặn gửi khi có lỗi; null khi chưa đủ dữ liệu hoặc đang tính. */
  onPreview?: (preview: HrmRequestTimePreview | null) => void;
  leaveTypeId?: string;
  /**
   * Loại đơn quyết định cách máy chủ tính: `leave` theo ca (bỏ ngày nghỉ), `ot` chỉ tính khoảng đã chọn và bắt lỗi khi trùng
   * giờ ca, `trip` tính số ngày công tác theo ca (mỗi ngày cả ca hoặc nửa ca, ngày nghỉ và ngày lễ không tính) và báo lỗi khi sai khung ca.
   */
  kind?: 'leave' | 'ot' | 'trip';
  showPreview?: boolean;
  fromLabel?: string;
  toLabel?: string;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<HrmRequestTimePreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const ordered = !fromAt || !toAt || toAt > fromAt;

  useEffect(() => {
    onPreview?.(null);
    setPreview(null);
    setPreviewError('');
    if (!showPreview || !employeeId || !fromAt || !toAt || !ordered) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ employeeId, fromAt, toAt });
      if (leaveTypeId) query.set('leaveTypeId', leaveTypeId);
      if (kind !== 'leave') query.set('kind', kind);
      hrmFetch<{ data: HrmRequestTimePreview }>(`/requests/time-preview?${query}`)
        .then((result) => {
          if (cancelled) return;
          // Phản hồi không đúng hình dạng (máy chủ cũ) thì không hiển thị và không chặn gửi đơn.
          if (typeof result?.data?.totalMinutes !== 'number') return;
          setPreview(result.data);
          onPreview?.(result.data);
        })
        .catch((e) => {
          if (cancelled) return;
          setPreviewError(e instanceof Error ? e.message : 'Không tính được thời gian');
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // onPreview là callback của form cha, không đưa vào phụ thuộc để tránh tính lại mỗi lần render.
  }, [employeeId, fromAt, toAt, leaveTypeId, kind, showPreview, ordered]);

  return (
    <div className="space-y-2" data-testid="request-time-range">
      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto_1fr]">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-700">
            {fromLabel} <span className="text-rose-500">*</span>
          </span>
          <DateTimeInput
            value={fromAt}
            disabled={disabled}
            aria-label={fromLabel}
            onChange={(value) => {
              // Chọn ngày bắt đầu sau ngày kết thúc hiện tại thì kéo ngày kết thúc theo, giữ giờ kết thúc.
              const from = splitDateTime(value);
              const to = splitDateTime(toAt);
              const nextTo =
                from.date && to.date && to.date < from.date
                  ? `${from.date}T${to.time || from.time}`
                  : toAt;
              onChange({ fromAt: value, toAt: nextTo });
            }}
          />
        </label>
        <span aria-hidden="true" className="hidden pb-2 text-slate-400 md:block">
          →
        </span>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-700">
            {toLabel} <span className="text-rose-500">*</span>
          </span>
          <DateTimeInput
            value={toAt}
            disabled={disabled}
            aria-label={toLabel}
            onChange={(value) => onChange({ fromAt, toAt: value })}
          />
        </label>
      </div>
      {kind === 'trip' && !preview && !previewError && (
        <p className="text-[11px] text-slate-500">
          Công tác chọn theo cả ngày (đủ khung ca hành chính) hoặc nửa ngày; ngày nghỉ và ngày lễ không tính.
        </p>
      )}
      {!ordered && (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          Thời điểm kết thúc phải sau thời điểm bắt đầu.
        </p>
      )}
      {previewError && (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          {previewError}
        </p>
      )}
      {preview && (
        <div
          role="status"
          className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
        >
          {kind === 'trip' ? (
            // Công tác tính theo ngày: chỉ hiện số ngày công tác (cả ca hoặc nửa ca mỗi ngày), không hiện số giờ.
            <p className="font-semibold text-slate-900" data-testid="time-total">
              Số ngày công tác: {formatDays(preview.totalDays)} ngày
            </p>
          ) : (
            <p className="font-semibold text-slate-900" data-testid="time-total">
              {kind !== 'leave' ? 'Tổng thời gian: ' : ''}
              {formatHours(preview.totalMinutes)} giờ
              {preview.totalDays > 0 ? ` (${formatDays(preview.totalDays)} ngày công)` : ''}
            </p>
          )}
          {preview.errors.map((text) => (
            <p key={text} className="font-semibold text-rose-600">
              {text}
            </p>
          ))}
          {preview.warnings.map((text) => (
            <p key={text} className="text-amber-700">
              {text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
