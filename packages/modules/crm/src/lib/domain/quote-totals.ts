import type {
  PricingTotals,
  QuoteAdjustmentMode,
  QuoteFee,
  QuoteOrderAmount,
  QuoteOrderAmountInput,
} from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';

/**
 * Tổng báo giá ở mức tổng đơn (GĐI, P2I-03): hàm thuần, không DB, không giờ hệ thống.
 *
 * Đầu vào là tổng của engine giá (`priceQuote`) đã chạy theo chế độ của mẫu báo giá:
 * - Mẫu `LINE`: engine giữ nguyên hành vi phase 1 (chiết khấu, VAT theo dòng). Không được nhập chiết khấu tổng đơn.
 * - Mẫu `ORDER` về chiết khấu: engine bỏ chiết khấu theo dòng; chiết khấu tổng đơn (phần trăm HOẶC số tiền) áp trên
 *   tổng thành tiền các dòng.
 * - Mẫu `ORDER` về thuế: engine đặt VAT theo dòng và VAT phí vận chuyển bằng 0; thuế tổng đơn (phần trăm HOẶC số
 *   tiền) tính trên tổng thành tiền sau chiết khấu, không gồm phí vận chuyển.
 * - Chiết khấu `ORDER` mà thuế `LINE`: VAT theo dòng của hàng được giảm theo tỷ lệ chiết khấu tổng đơn (làm tròn
 *   đến đồng, xa số 0) để không đánh thuế trên phần đã chiết khấu; VAT phí vận chuyển giữ nguyên.
 * - Phí trên hợp đồng (nhiều khoản) cộng sau thuế, không chịu thuế, không tính vào biên lợi nhuận.
 *
 * Tổng sau thuế = thành tiền sau chiết khấu + phí vận chuyển + thuế + các khoản phí.
 * Tiền nguyên đồng, làm tròn xa số 0 như engine giá; dùng số nguyên lớn (`bigint`) nên số gần giới hạn
 * `NUMERIC(18,2)` không sinh sai số nhị phân. Kết quả vượt `QUOTE_AMOUNT_MAX` bị từ chối (400).
 */

/** 9 triệu tỷ đồng: dưới 2^53 nên `number` còn chính xác, dưới giới hạn `NUMERIC(18,2)`. */
export const QUOTE_AMOUNT_MAX = 9_000_000_000_000_000;

const PERCENT_SCALE = 10_000n; // 4 chữ số thập phân
const HUNDRED_PERCENT = 1_000_000n;

export interface QuoteAdjustmentInput {
  readonly discountMode: QuoteAdjustmentMode;
  readonly taxMode: QuoteAdjustmentMode;
  /** Tổng của engine giá. */
  readonly pricing: PricingTotals;
  /** VAT của phí vận chuyển nằm trong `pricing.vatAmount` (0 nếu không có phí vận chuyển). */
  readonly shippingVatAmount?: number;
  readonly orderDiscount?: QuoteOrderAmountInput | null;
  readonly orderTax?: QuoteOrderAmountInput | null;
  readonly fees?: readonly QuoteFee[];
}

export interface QuoteAdjustmentResult {
  /** Tổng sau điều chỉnh, cùng hình với tổng của engine. */
  readonly totals: PricingTotals;
  readonly orderDiscount: QuoteOrderAmount;
  readonly orderTax: QuoteOrderAmount;
  readonly feesAmount: number;
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = (abs * 2n + denominator) / (2n * denominator);
  return negative ? -quotient : quotient;
}

function wholeMoney(value: unknown, label: string): bigint {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new CrmValidationError('INVALID_AMOUNT', `${label} phải là số không âm.`);
  }
  if (value > QUOTE_AMOUNT_MAX) throw tooLarge();
  if (Number.isInteger(value)) return BigInt(value);
  // Tiền nhập có thể lẻ xu: làm tròn đến đồng, xa số 0.
  return divideRounded(BigInt(Math.round(value * 100)), 100n);
}

function tooLarge(): CrmValidationError {
  return new CrmValidationError('AMOUNT_TOO_LARGE', 'Giá trị báo giá vượt giới hạn cho phép.');
}

/** Phần trăm 0 đến 100, tối đa 4 chữ số thập phân, thành đơn vị 1/10.000 %. */
function percentUnits(value: unknown, label: string): bigint {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new CrmValidationError('INVALID_PERCENT', `${label} phải từ 0 đến 100%.`);
  }
  return BigInt(Math.round(value * Number(PERCENT_SCALE)));
}

function percentOf(part: bigint, base: bigint): number {
  if (base <= 0n) return 0;
  return Number(divideRounded(part * HUNDRED_PERCENT, base)) / Number(PERCENT_SCALE);
}

interface ResolvedOrderAmount {
  readonly amount: bigint;
  readonly result: QuoteOrderAmount;
}

/**
 * Chiết khấu hoặc thuế tổng đơn trên `base`: nhập phần trăm thì số tiền = base × phần trăm; nhập số tiền thì
 * phần trăm tính ngược (4 chữ số thập phân). Nhập cả hai là lỗi (loại trừ nhau). `capAtBase`: chiết khấu không
 * vượt tổng.
 */
function resolveOrderAmount(
  input: QuoteOrderAmountInput | null | undefined,
  base: bigint,
  label: string,
  capAtBase: boolean,
): ResolvedOrderAmount {
  const percent = input?.percent ?? null;
  const amount = input?.amount ?? null;
  if (percent !== null && amount !== null) {
    throw new CrmValidationError(
      'ORDER_AMOUNT_CONFLICT',
      `Chỉ nhập ${label} theo phần trăm hoặc theo số tiền, không nhập cả hai.`,
    );
  }
  if (percent === null && amount === null) {
    return { amount: 0n, result: { percent: 0, amount: 0, inputKind: null } };
  }
  if (percent !== null) {
    const units = percentUnits(percent, `${capitalize(label)} theo phần trăm`);
    const money = divideRounded(base * units, HUNDRED_PERCENT);
    return { amount: money, result: { percent: Number(units) / Number(PERCENT_SCALE), amount: Number(money), inputKind: 'PERCENT' } };
  }
  const money = wholeMoney(amount, capitalize(label));
  if (capAtBase && money > base) {
    throw new CrmValidationError('DISCOUNT_EXCEEDS_TOTAL', 'Chiết khấu tổng đơn không được lớn hơn tổng tiền hàng.');
  }
  return { amount: money, result: { percent: percentOf(money, base), amount: Number(money), inputKind: 'AMOUNT' } };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Tổng tiền các khoản phí (nguyên đồng); mỗi khoản không âm. */
export function sumFees(fees: readonly QuoteFee[] | undefined): number {
  let total = 0n;
  for (const fee of fees ?? []) total += wholeMoney(fee.amount, 'Số tiền phí');
  if (total > BigInt(QUOTE_AMOUNT_MAX)) throw tooLarge();
  return Number(total);
}

/**
 * Áp chiết khấu, thuế tổng đơn và phí lên tổng của engine giá. Mẫu `LINE`/`LINE` không nhập gì và không có phí
 * trả lại đúng tổng của engine (TC-QF-16).
 */
export function applyQuoteAdjustments(input: QuoteAdjustmentInput): QuoteAdjustmentResult {
  const { pricing } = input;
  if (input.discountMode === 'LINE' && hasInput(input.orderDiscount)) {
    throw new CrmValidationError(
      'ORDER_DISCOUNT_NOT_ALLOWED',
      'Mẫu báo giá này chiết khấu theo dòng, không nhập chiết khấu tổng đơn.',
    );
  }
  if (input.taxMode === 'LINE' && hasInput(input.orderTax)) {
    throw new CrmValidationError('ORDER_TAX_NOT_ALLOWED', 'Mẫu báo giá này tính thuế theo dòng, không nhập thuế tổng đơn.');
  }
  const goods = BigInt(pricing.netAmount);
  const discount = resolveOrderAmount(input.orderDiscount, goods, 'chiết khấu tổng đơn', true);
  const netGoods = goods - discount.amount;

  let vat: bigint;
  let tax: ResolvedOrderAmount;
  if (input.taxMode === 'ORDER') {
    tax = resolveOrderAmount(input.orderTax, netGoods, 'thuế tổng đơn', false);
    vat = tax.amount;
  } else {
    tax = { amount: 0n, result: { percent: 0, amount: 0, inputKind: null } };
    const shippingVat = BigInt(input.shippingVatAmount ?? 0);
    const goodsVat = BigInt(pricing.vatAmount) - shippingVat;
    // Chiết khấu tổng đơn làm giảm cơ sở tính VAT của hàng theo cùng tỷ lệ.
    const adjusted = discount.amount > 0n && goods > 0n ? divideRounded(goodsVat * netGoods, goods) : goodsVat;
    vat = adjusted + shippingVat;
  }

  const feesAmount = sumFees(input.fees);
  const shipping = BigInt(pricing.shippingAmount);
  const total = netGoods + shipping + vat + BigInt(feesAmount);
  if (total > BigInt(QUOTE_AMOUNT_MAX) || vat > BigInt(QUOTE_AMOUNT_MAX)) throw tooLarge();

  return {
    totals: {
      grossAmount: pricing.grossAmount,
      discountAmount: pricing.discountAmount + Number(discount.amount),
      netAmount: Number(netGoods),
      shippingAmount: pricing.shippingAmount,
      vatAmount: Number(vat),
      totalAmount: Number(total),
    },
    orderDiscount: discount.result,
    orderTax: tax.result,
    feesAmount,
  };
}

function hasInput(value: QuoteOrderAmountInput | null | undefined): boolean {
  return !!value && ((value.percent ?? null) !== null || (value.amount ?? null) !== null);
}
