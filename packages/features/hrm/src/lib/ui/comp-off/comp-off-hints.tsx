'use client';
import { useEffect, useState } from 'react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import type { HrmCompOffAvailability, HrmNextDayRest, HrmOvertimeClassifyPreview } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../../hrm-comp-off-api';
import { formatCompDate, formatCompNumber, NEXT_DAY_REST_OPTIONS } from '../../comp-off-model';

/**
 * Số dư nghỉ bù khả dụng của một nhân viên tại một ngày, dùng cho form đơn nghỉ. Chỉ gọi khi `active`
 * (đã chọn loại nghỉ và ngày); lỗi tải thì coi như không có thông tin, máy chủ vẫn kiểm tra khi gửi đơn.
 */
export function useCompOffAvailability(employeeId: string, date: string, active: boolean) {
  const [data, setData] = useState<HrmCompOffAvailability | null>(null);
  useEffect(() => {
    if (!active || !employeeId) return;
    let alive = true;
    compOffApi
      .availability(employeeId, date || undefined)
      .then((result) => alive && setData(result))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [employeeId, date, active]);
  return data;
}

/**
 * Ghi chú dưới thẻ số ngày nghỉ của lý do Nghỉ bù, cùng kiểu với ghi chú của phép năm: số dư còn lại, giữ chỗ, hạn gần nhất,
 * bước dùng; vượt số dư hoặc sai bước thì báo đỏ đậm. Bốn ô số liệu nằm ở thẻ của form (`create-request-form`).
 */
export function CompOffAvailabilityHint({
  availability,
  problem,
}: {
  availability: HrmCompOffAvailability | null;
  problem: string;
}) {
  if (!availability) return null;
  return (
    <div data-testid="comp-off-availability" className="space-y-1">
      <p className="text-[12px] leading-relaxed text-slate-500">
        Hiện còn {formatCompNumber(availability.available)} ngày
        {availability.reserved > 0 ? ` • Đang giữ chỗ ${formatCompNumber(availability.reserved)} ngày` : ''}
        {availability.nextExpiry
          ? ` • Hạn gần nhất: ${formatCompNumber(availability.nextExpiry.days)} ngày, hết hạn ${formatCompDate(availability.nextExpiry.on)}`
          : ''}
        {` • Dùng theo bước ${formatCompNumber(availability.usageStepDays)} ngày`}
      </p>
      {problem ? (
        <p role="alert" className="text-[12px] font-semibold text-rose-600">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Gợi ý phân loại làm thêm / ca đêm cho khoảng giờ đang nhập (gọi máy chủ sau 400 ms không đổi). Với ca xuyên đêm theo chế độ
 * NIGHT_REST thì hiện thêm lựa chọn "Hôm sau nghỉ". Không hiện gì khi quy tắc chưa bật hoặc không xem trước được.
 */
export function OvertimeClassifyHint({
  employeeId,
  fromAt,
  toAt,
  value,
  onChange,
  disabled,
}: {
  employeeId: string;
  fromAt: string;
  toAt: string;
  value: HrmNextDayRest;
  onChange: (value: HrmNextDayRest) => void;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<HrmOvertimeClassifyPreview | null>(null);

  useEffect(() => {
    if (!employeeId || !fromAt || !toAt || toAt <= fromAt) {
      setPreview(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      compOffApi
        .classifyPreview({ employeeId, fromAt, toAt, nextDayRest: value })
        .then((result) => alive && setPreview(result))
        .catch(() => alive && setPreview(null));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [employeeId, fromAt, toAt, value]);

  const asks = Boolean(preview?.enabled && preview.askNextDayRest);
  // Ca không còn xuyên đêm thì bỏ lựa chọn nghỉ đã chọn trước đó.
  useEffect(() => {
    if (preview && !asks && value !== 'NONE') onChange('NONE');
  }, [preview, asks, value, onChange]);

  if (!preview?.enabled) return null;
  return (
    <div data-testid="overtime-classify-hint" className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-xs">
      {asks ? (
        <label className="flex max-w-xs flex-col gap-1 font-semibold text-slate-700">
          <span>Hôm sau nghỉ</span>
          <SearchableSelect
            height={36}
            value={value}
            options={NEXT_DAY_REST_OPTIONS as { value: string; label: string }[]}
            clearable={false}
            disabled={disabled}
            onChange={(v) => v && onChange(v as HrmNextDayRest)}
          />
        </label>
      ) : null}
      <p className="text-slate-700">
        Gợi ý phân loại: làm thêm <strong className="font-mono">{formatCompNumber(preview.otHours)} giờ</strong>, ca đêm{' '}
        <strong className="font-mono">{formatCompNumber(preview.nightHours)} giờ</strong>. HR có thể điều chỉnh sau khi duyệt.
      </p>
      {preview.parts.flatMap((p) => p.warnings).map((w) => (
        <p key={w} className="text-amber-700">
          {w}
        </p>
      ))}
    </div>
  );
}
