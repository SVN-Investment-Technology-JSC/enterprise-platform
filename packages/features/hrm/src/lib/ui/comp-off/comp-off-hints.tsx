'use client';
import { useEffect, useState } from 'react';
import type { HrmCompOffAvailability } from '@enterprise-platform/contracts-hrm';
import { compOffApi } from '../../hrm-comp-off-api';
import { formatCompDate, formatCompNumber } from '../../comp-off-model';

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
