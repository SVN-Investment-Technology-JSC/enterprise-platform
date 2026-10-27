import type { StockDocumentType } from '@enterprise-platform/contracts-inventory';

/**
 * Giá vốn bình quân gia quyền tức thời (D4, INV-09, INV-10, T1-21).
 *
 * Hàm thuần, tính bằng số nguyên đã nhân tỉ lệ (BigInt) để không lệch kiểu số
 * thực: số lượng 3 chữ số thập phân như NUMERIC(12,3), đơn giá 4 chữ số như
 * NUMERIC(18,4), thành tiền 2 chữ số như NUMERIC(18,2). Làm tròn nửa xa số 0
 * (0,00005 lên 0,0001), giống `round()` của Postgres trên NUMERIC.
 *
 * Giá bình quân tính theo từng dòng tồn (kho, vật tư); xem `0016-costing.sql`.
 */

const QUANTITY_SCALE = 3;
const COST_SCALE = 4;
const AMOUNT_SCALE = 2;

/** Chuỗi thập phân về số nguyên đã nhân 10^scale, làm tròn nửa xa số 0. */
function toScaled(value: number | string, scale: number): bigint {
  const text = typeof value === 'number' ? value.toFixed(Math.min(scale + 6, 20)) : value.trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new RangeError(`Số không hợp lệ: ${text}`);
  const [, sign, whole, fraction = ''] = match;
  const kept = (fraction + '0'.repeat(scale)).slice(0, scale);
  let scaled = BigInt((whole || '0') + kept);
  const next = fraction.charCodeAt(scale) - 48;
  if (next >= 5) scaled += 1n;
  return sign === '-' && scaled !== 0n ? -scaled : scaled;
}

function fromScaled(value: bigint, scale: number): number {
  return Number(value) / 10 ** scale;
}

/** Chia số nguyên, làm tròn nửa xa số 0. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (2n * n + d) / (2n * d);
  return negative ? -quotient : quotient;
}

/** Làm tròn nửa xa số 0 tới `decimals` chữ số thập phân. */
export function roundHalfAwayFromZero(value: number, decimals: number): number {
  return fromScaled(toScaled(value, decimals), decimals);
}

/** Thành tiền của dòng: `round2(quantity × unitCost)`. */
export function costAmount(quantity: number, unitCost: number): number {
  const product = toScaled(quantity, QUANTITY_SCALE) * toScaled(unitCost, COST_SCALE);
  // product mang 7 chữ số thập phân; về 2 chữ số.
  return fromScaled(divideRounded(product, 10n ** BigInt(QUANTITY_SCALE + COST_SCALE - AMOUNT_SCALE)), AMOUNT_SCALE);
}

export interface CostedBalance {
  /** Tồn thực tế trước lần nhập, xuất này. */
  readonly quantity: number;
  readonly avgCost: number;
}

/**
 * Giá bình quân sau một lần nhập:
 * `(tồn × bình quân + số nhập × đơn giá) / (tồn + số nhập)`, 4 chữ số thập phân.
 * Tồn trước bằng 0 (hoặc âm do dữ liệu cũ) thì bình quân là đơn giá nhập.
 */
export function averageAfterReceipt(
  balance: CostedBalance,
  inQuantity: number,
  unitCost: number,
): number {
  const before = toScaled(balance.quantity, QUANTITY_SCALE);
  const incoming = toScaled(inQuantity, QUANTITY_SCALE);
  const cost = toScaled(unitCost, COST_SCALE);
  if (before <= 0n || before + incoming <= 0n) return fromScaled(cost, COST_SCALE);
  const value = before * toScaled(balance.avgCost, COST_SCALE) + incoming * cost;
  // value mang 7 chữ số thập phân, chia cho số lượng 3 chữ số còn đúng 4 chữ số.
  return fromScaled(divideRounded(value, before + incoming), COST_SCALE);
}

/**
 * Giá bình quân sau một lần xuất ở đơn giá `unitCost`. Xuất theo bình quân hiện
 * tại thì bình quân không đổi; xuất ở giá cố định (đảo phiếu nhập) thì lấy lại
 * phần giá trị đã nhập ra: `(tồn × bình quân − số xuất × đơn giá) / còn lại`, không
 * âm. Xuất hết thì giữ bình quân cũ cho lần nhập sau so sánh.
 */
export function averageAfterIssue(
  balance: CostedBalance,
  outQuantity: number,
  unitCost: number,
): number {
  const before = toScaled(balance.quantity, QUANTITY_SCALE);
  const outgoing = toScaled(outQuantity, QUANTITY_SCALE);
  const average = toScaled(balance.avgCost, COST_SCALE);
  const cost = toScaled(unitCost, COST_SCALE);
  const remaining = before - outgoing;
  if (remaining <= 0n || cost === average) return fromScaled(average, COST_SCALE);
  const value = before * average - outgoing * cost;
  if (value <= 0n) return 0;
  return fromScaled(divideRounded(value, remaining), COST_SCALE);
}

export interface InboundCostInput {
  readonly docType: StockDocumentType;
  /** Đơn giá ghi trên dòng; 0 nghĩa là không ghi. */
  readonly entered: number;
  /** Bình quân hiện tại của dòng tồn nhận hàng. */
  readonly currentAverage: number;
  readonly isReversal: boolean;
  /** Vế nhập của điều chuyển: đơn giá vế xuất. */
  readonly transferCost?: number;
  /** Nhập trả hàng bán có dòng xuất gốc: giá vốn của dòng đó. */
  readonly sourceLineCost?: number;
}

/**
 * Đơn giá nhập dùng để tính bình quân:
 * - chứng từ đảo: giá của dòng gốc (chép sang dòng đảo);
 * - vế nhập điều chuyển: giá vế xuất ở kho đi;
 * - nhập trả hàng bán: giá vốn dòng xuất gốc, không có thì bình quân hiện tại
 *   (đơn giá người nhập ghi trên dòng bị bỏ qua);
 * - loại khác: đơn giá trên dòng; bỏ trống (0) thì bình quân hiện tại, tức bình
 *   quân không đổi. Hàng nhập không có giá (tháo về kho, thừa kiểm kê, dữ liệu cũ
 *   chưa ghi giá) vì vậy không kéo bình quân xuống 0.
 */
export function inboundUnitCost(input: InboundCostInput): number {
  if (input.isReversal && input.entered > 0) return input.entered;
  if (input.transferCost !== undefined) return input.transferCost;
  if (input.docType === 'RECEIPT_SALES_RETURN') {
    return input.sourceLineCost ?? input.currentAverage;
  }
  return input.entered > 0 ? input.entered : input.currentAverage;
}

/**
 * Đơn giá xuất: bình quân hiện tại của dòng tồn. Chứng từ đảo của phiếu nhập
 * xuất lại đúng giá đã nhập (giá dòng gốc), để đảo xong bình quân trở về như cũ.
 */
export function outboundUnitCost(input: {
  readonly entered: number;
  readonly currentAverage: number;
  readonly isReversal: boolean;
}): number {
  return input.isReversal && input.entered > 0 ? input.entered : input.currentAverage;
}
