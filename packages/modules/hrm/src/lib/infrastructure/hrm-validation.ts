import { BadRequestException } from '@nestjs/common';

export function requireUuid(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new BadRequestException({
      code: 'HRM_INVALID_INPUT',
      message: `${field}: UUID không hợp lệ`,
    });
  }
  return value;
}

export function requireText(
  value: unknown,
  field: string,
  maxLength = 255,
): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > maxLength
  ) {
    throw new BadRequestException({
      code: 'HRM_INVALID_INPUT',
      message: `${field}: cần nhập từ 1 đến ${maxLength} ký tự`,
    });
  }
  return value.trim();
}

/** Văn bản không bắt buộc: trả về null khi bỏ trống; vẫn từ chối khi vượt độ dài tối đa. */
export function optionalText(
  value: unknown,
  field: string,
  maxLength = 255,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw new BadRequestException({
      code: 'HRM_INVALID_INPUT',
      message: `${field}: tối đa ${maxLength} ký tự`,
    });
  }
  return value.trim() || null;
}

export function requireDate(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException({
      code: 'HRM_INVALID_INPUT',
      message: `${field}: ngày không hợp lệ (YYYY-MM-DD)`,
    });
  }
  return value;
}

export const REJECT_REASON_REQUIRED = 'HRM_REJECT_REASON_REQUIRED';

/**
 * Lý do từ chối đơn: bắt buộc nhập, trừ khi bên gọi đánh dấu từ chối nhanh (nút "Từ chối" ngay trên danh sách ở Bàn làm việc,
 * nơi không có ô nhập ý kiến). Cờ này chỉ bỏ yêu cầu nhập lý do; quyền và phạm vi duyệt vẫn được kiểm riêng.
 */
export function rejectionNote(reason: unknown, quick?: unknown): string | null {
  const note = optionalText(reason, 'Lý do từ chối', 2000);
  if (!note && quick !== true)
    throw new BadRequestException({ code: REJECT_REASON_REQUIRED, message: 'Vui lòng nhập lý do từ chối.' });
  return note;
}
