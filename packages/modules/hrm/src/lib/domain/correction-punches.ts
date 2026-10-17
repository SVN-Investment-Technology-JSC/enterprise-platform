import { BadRequestException } from '@nestjs/common';

export interface CorrectionPunch {
  readonly kind: 'IN' | 'OUT';
  /** Thời điểm ISO. */
  readonly at: string;
}

/**
 * Đọc mốc giờ giải trình công do client gửi (HÀM THUẦN, trừ `now` để kiểm tra không ở tương lai).
 * Mỗi đơn chỉ khai báo ĐÚNG MỘT mốc: giờ vào (IN) hoặc giờ ra (OUT), hợp lệ và không ở tương lai. Không gửi gì thì trả mảng rỗng
 * (đơn cũ khai báo theo phiên không còn được tạo mới).
 */
export function parseCorrectionPunches(
  value: unknown,
  now: number = Date.now(),
): CorrectionPunch[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length !== 1)
    throw new BadRequestException(
      'Mỗi đơn giải trình chỉ khai báo một giờ vào hoặc một giờ ra',
    );
  const [item] = value;
  const kind = (item as { kind?: unknown })?.kind;
  const at = (item as { at?: unknown })?.at;
  if (kind !== 'IN' && kind !== 'OUT')
    throw new BadRequestException('Mốc giờ phải chọn là giờ vào hoặc giờ ra');
  const ms = typeof at === 'string' ? Date.parse(at) : NaN;
  if (!Number.isFinite(ms) || ms > now)
    throw new BadRequestException('Giờ vào/ra không hợp lệ hoặc ở tương lai');
  return [{ kind, at: new Date(ms).toISOString() }];
}

/** Phần tử của `corrected_sessions` là mốc giờ (đơn theo từng mốc) hay cặp phiên (đơn cũ). */
export function isPunchList(value: unknown): value is CorrectionPunch[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((x) => x && typeof x === 'object' && 'kind' in x && 'at' in x)
  );
}
