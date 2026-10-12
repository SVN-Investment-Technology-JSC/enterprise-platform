import { BadRequestException } from '@nestjs/common';

export interface CorrectionPunch {
  readonly kind: 'IN' | 'OUT';
  /** Thời điểm ISO. */
  readonly at: string;
}

/**
 * Đọc danh sách mốc giờ giải trình công do client gửi (HÀM THUẦN, trừ `now` để kiểm tra không ở tương lai).
 * Mỗi mốc có loại rõ ràng: giờ vào (IN) hoặc giờ ra (OUT); tối đa một giờ vào và một giờ ra; mốc hợp lệ, không ở tương lai.
 * Có cả hai loại thì giờ ra phải sau giờ vào và cách nhau tối đa 24 giờ. Không gửi gì thì trả mảng rỗng.
 */
export function parseCorrectionPunches(
  value: unknown,
  now: number = Date.now(),
): CorrectionPunch[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > 2)
    throw new BadRequestException(
      'Cần khai báo giờ vào và/hoặc giờ ra (tối đa một giờ vào và một giờ ra)',
    );
  const out: CorrectionPunch[] = [];
  for (const item of value) {
    const kind = (item as { kind?: unknown })?.kind;
    const at = (item as { at?: unknown })?.at;
    if (kind !== 'IN' && kind !== 'OUT')
      throw new BadRequestException('Mỗi mốc giờ phải chọn là giờ vào hoặc giờ ra');
    const ms = typeof at === 'string' ? Date.parse(at) : NaN;
    if (!Number.isFinite(ms) || ms > now)
      throw new BadRequestException('Giờ vào/ra không hợp lệ hoặc ở tương lai');
    if (out.some((p) => p.kind === kind))
      throw new BadRequestException(
        kind === 'IN' ? 'Chỉ được khai báo một giờ vào' : 'Chỉ được khai báo một giờ ra',
      );
    out.push({ kind, at: new Date(ms).toISOString() });
  }
  const inAt = out.find((p) => p.kind === 'IN');
  const outAt = out.find((p) => p.kind === 'OUT');
  if (inAt && outAt) {
    const span = Date.parse(outAt.at) - Date.parse(inAt.at);
    if (span <= 0) throw new BadRequestException('Giờ ra phải sau giờ vào');
    if (span > 86_400_000)
      throw new BadRequestException('Giờ vào và giờ ra cách nhau tối đa 24 giờ');
  }
  return out;
}

/** Phần tử của `corrected_sessions` là mốc giờ (đơn theo từng mốc) hay cặp phiên (đơn cũ). */
export function isPunchList(value: unknown): value is CorrectionPunch[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((x) => x && typeof x === 'object' && 'kind' in x && 'at' in x)
  );
}
