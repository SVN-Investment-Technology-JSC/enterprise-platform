import { createHash } from 'node:crypto';
import type { CreateStockReservationRequest } from '@enterprise-platform/contracts-inventory';
import { InvalidReservationError } from './inventory.error.js';

/**
 * Chuẩn hoá yêu cầu giữ hàng và băm nội dung cho khoá chống lặp (T1-11).
 *
 * Hàm thuần, không đụng DB. Hai yêu cầu cùng nghĩa (đổi thứ tự dòng, tách một mã
 * thành hai dòng, khác khoảng trắng) cho cùng một mã băm, nên bên gọi thử lại
 * không bị 409 oan.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_RESERVATION_LINES = 500;
const MAX_KEY_LENGTH = 200;
const MAX_TYPE_LENGTH = 50;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export interface NormalizedReservationLine {
  readonly warehouseCode: string;
  readonly materialCode: string;
  readonly quantity: number;
}

export interface NormalizedReservationRequest {
  readonly referenceType: string;
  readonly referenceId?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly idempotencyKey?: string;
  /** ISO 8601 UTC. */
  readonly expiresAt?: string;
  /** Mỗi cặp kho, vật tư một dòng, sắp theo kho rồi vật tư. */
  readonly lines: readonly NormalizedReservationLine[];
}

function optionalUuid(value: string | undefined, label: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!UUID_PATTERN.test(trimmed)) throw new InvalidReservationError(`${label} không hợp lệ.`);
  return trimmed.toLowerCase();
}

function optionalType(value: string | undefined, label: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_TYPE_LENGTH) {
    throw new InvalidReservationError(`${label} dài tối đa ${MAX_TYPE_LENGTH} ký tự.`);
  }
  return trimmed;
}

export function normalizeReservationRequest(
  request: CreateStockReservationRequest | undefined,
): NormalizedReservationRequest {
  const items = request?.items;
  if (!request || !Array.isArray(items) || items.length === 0) {
    throw new InvalidReservationError('Yêu cầu giữ vật tư phải có ít nhất một dòng.');
  }
  if (items.length > MAX_RESERVATION_LINES) {
    throw new InvalidReservationError(`Yêu cầu giữ vật tư có tối đa ${MAX_RESERVATION_LINES} dòng.`);
  }

  const sourceType = optionalType(request.sourceType, 'Loại chứng từ nguồn');
  const sourceId = optionalUuid(request.sourceId, 'Mã chứng từ nguồn');
  const referenceType = optionalType(request.referenceType, 'Loại đối tượng giữ hàng') ?? sourceType;
  if (!referenceType) {
    throw new InvalidReservationError('Phải ghi nguồn giữ hàng (sourceType hoặc referenceType).');
  }
  const referenceId = optionalUuid(request.referenceId, 'Mã đối tượng giữ hàng') ?? sourceId;

  const idempotencyKey = request.idempotencyKey?.trim() || undefined;
  if (idempotencyKey && idempotencyKey.length > MAX_KEY_LENGTH) {
    throw new InvalidReservationError(`Khoá chống lặp dài tối đa ${MAX_KEY_LENGTH} ký tự.`);
  }

  let expiresAt: string | undefined;
  const rawExpiry = request.expiresAt?.trim();
  if (rawExpiry) {
    const parsed = Date.parse(rawExpiry);
    if (Number.isNaN(parsed)) {
      throw new InvalidReservationError('Hạn giữ hàng phải là thời điểm ISO 8601 hợp lệ.');
    }
    expiresAt = new Date(parsed).toISOString();
  }

  const headerWarehouse = request.warehouseCode?.trim();
  const merged = new Map<string, { warehouseCode: string; materialCode: string; quantity: number }>();
  items.forEach((item, index) => {
    const lineNo = index + 1;
    const materialCode = item?.materialCode?.trim();
    if (!materialCode) throw new InvalidReservationError(`Dòng ${lineNo}: thiếu mã vật tư.`);
    const warehouseCode = item.warehouseCode?.trim() || headerWarehouse;
    if (!warehouseCode) throw new InvalidReservationError(`Dòng ${lineNo}: thiếu kho giữ hàng.`);
    const quantity = Number(item.quantityReserved);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new InvalidReservationError(`Dòng ${lineNo}: số lượng phải là số dương.`);
    }
    const key = `${warehouseCode}\u0000${materialCode}`;
    const current = merged.get(key);
    merged.set(key, {
      warehouseCode,
      materialCode,
      quantity: round3((current?.quantity ?? 0) + quantity),
    });
  });
  const lines = [...merged.values()].sort((left, right) =>
    left.warehouseCode === right.warehouseCode
      ? compare(left.materialCode, right.materialCode)
      : compare(left.warehouseCode, right.warehouseCode),
  );

  return { referenceType, referenceId, sourceType, sourceId, idempotencyKey, expiresAt, lines };
}

/** Hạn giữ hàng mới phải ở tương lai; gọi lại theo khoá chống lặp thì không kiểm lại. */
export function assertExpiryInFuture(expiresAt: string | undefined, now: Date): void {
  if (expiresAt && Date.parse(expiresAt) <= now.getTime()) {
    throw new InvalidReservationError('Hạn giữ hàng phải sau thời điểm hiện tại.');
  }
}

/** sha256 của nội dung đã chuẩn hoá, không gồm chính khoá chống lặp. */
export function reservationRequestHash(request: NormalizedReservationRequest): string {
  const canonical = JSON.stringify([
    request.referenceType,
    request.referenceId ?? null,
    request.sourceType ?? null,
    request.sourceId ?? null,
    request.expiresAt ?? null,
    request.lines.map((line) => [line.warehouseCode, line.materialCode, line.quantity]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** So sánh theo mã điểm Unicode, không theo locale, để thứ tự giống nhau ở mọi máy. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
