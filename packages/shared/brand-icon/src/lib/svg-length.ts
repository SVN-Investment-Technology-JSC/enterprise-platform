/** Ngữ cảnh đổi đơn vị: phần trăm tính theo cạnh khung nhìn, `em` theo cỡ chữ. */
export interface LengthContext {
  /** Cỡ chữ (px) của phần tử. */
  readonly fontSize: number;
  /** Số px mà 100% ứng với (cạnh khung nhìn theo trục đang xét). */
  readonly percentBase: number;
}

export const DEFAULT_FONT_SIZE = 16;

const UNIT_PX: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, q: 96 / 101.6 };

const LENGTH = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([a-z%]*)$/i;

/** Độ dài CSS ra số px; null nếu không đọc được (đơn vị lạ, `auto`, rỗng). */
export function parseLength(raw: string | null | undefined, context: LengthContext): number | null {
  if (raw === null || raw === undefined) return null;
  const match = LENGTH.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  if (unit === '') return value;
  if (unit === '%') return (value / 100) * context.percentBase;
  if (unit === 'em') return value * context.fontSize;
  if (unit === 'rem') return value * DEFAULT_FONT_SIZE;
  if (unit === 'ex') return value * context.fontSize * 0.5;
  if (unit === 'ch') return value * context.fontSize * 0.5;
  const factor = UNIT_PX[unit];
  return factor === undefined ? null : value * factor;
}

/** Danh sách độ dài cách nhau bởi dấu cách hoặc phẩy (nét đứt); null nếu có phần không đọc được. */
export function parseLengthList(raw: string | null | undefined, context: LengthContext): number[] | null {
  if (raw === null || raw === undefined) return null;
  const parts = raw.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const values = parts.map((part) => parseLength(part, context));
  return values.some((value) => value === null) ? null : (values as number[]);
}
