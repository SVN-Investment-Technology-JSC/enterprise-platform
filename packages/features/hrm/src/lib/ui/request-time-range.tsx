'use client';
import { useEffect, useState } from 'react';
import type { HrmRequestTimePreview } from '@enterprise-platform/contracts-hrm';
import { hrmFetch } from '../hrm-api';
import { formatHours } from '../request-time-format';
import { DateTimeInput, splitDateTime } from './date-time-input';

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
  }, [employeeId, fromAt, toAt, leaveTypeId, showPreview, ordered]);

  return (
    <div className="space-y-2" data-testid="request-time-range">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
          <p className="font-semibold text-slate-900">
            {formatHours(preview.totalMinutes)} giờ
            {preview.totalDays > 0
              ? ` (${String(Math.round(preview.totalDays * 100) / 100).replace('.', ',')} ngày công)`
              : ''}
          </p>
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
