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
