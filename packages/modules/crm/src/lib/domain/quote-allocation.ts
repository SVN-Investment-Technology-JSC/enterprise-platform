/**
 * Phân bổ chiết khấu và thuế tổng đơn của báo giá xuống từng dòng khi chuyển thành hợp đồng, đơn bán (P2I-09).
 *
 * Báo giá mẫu `ORDER` giữ chiết khấu, thuế ở tổng đơn nên dòng báo giá chưa phản ánh chúng. Đơn bán và hợp đồng dùng
 * dòng để ghi nhận công nợ, doanh thu theo lần giao, nên nếu chép dòng nguyên trạng thì công nợ và doanh thu lệch
 * tổng báo giá. Hàm này đưa chiết khấu và thuế vào dòng sao cho:
 *
 *   tổng thành tiền các dòng = tiền hàng sau chiết khấu tổng đơn của báo giá;
 *   tổng thuế các dòng       = thuế của hàng (không gồm thuế phí vận chuyển) của báo giá;
 *
 * nên tổng sau thuế của đơn = tổng dòng + phí vận chuyển (và thuế của nó) + phí trên hợp đồng = tổng sau thuế của
 * báo giá. Phí vận chuyển và phí trên hợp đồng không phân bổ vào dòng: công nợ đã tính chúng bằng phần chênh giữa
 * tổng đơn và tổng dòng. Tiền nguyên đồng; phân bổ theo tỷ trọng cộng dồn, nên phần dư dồn vào dòng cuối.
 * Hàm thuần, dùng số nguyên lớn (`bigint`).
 */

export interface AllocationLine {
  readonly quantity: number;
  readonly grossAmount: number;
  readonly discountAmount: number;
  /** Thành tiền sau chiết khấu theo dòng, trước thuế. */
  readonly lineAmount: number;
  readonly vatAmount: number;
}

export interface AllocatedLine extends AllocationLine {
  /** Phần chiết khấu tổng đơn đã chia cho dòng. */
  readonly orderDiscountShare: number;
}

export interface AllocationInput {
  readonly lines: readonly AllocationLine[];
  readonly discountMode: 'LINE' | 'ORDER';
  readonly taxMode: 'LINE' | 'ORDER';
  /** Chiết khấu tổng đơn (đồng). */
  readonly orderDiscountTotal: number;
  /** Thuế tổng đơn (đồng); chỉ dùng khi `taxMode = 'ORDER'`. */
  readonly orderTaxTotal: number;
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (2n * denominator);
}

/**
 * Chia `total` theo tỷ trọng `weights` (số không âm): phần của dòng i = round(total × cộng dồn_i / tổng) trừ phần đã
 * chia, nên tổng các phần đúng bằng `total`. Tổng tỷ trọng bằng 0 thì dồn hết vào dòng cuối.
 */
export function allocateProportionally(total: bigint, weights: readonly bigint[]): bigint[] {
  if (!weights.length) return [];
  const sum = weights.reduce((acc, weight) => acc + weight, 0n);
  if (sum <= 0n) return weights.map((_, index) => (index === weights.length - 1 ? total : 0n));
  let cumulative = 0n;
  let assigned = 0n;
  return weights.map((weight) => {
    cumulative += weight;
    const through = divideRounded(total * cumulative, sum);
    const share = through - assigned;
    assigned = through;
    return share;
  });
}

export function allocateOrderAdjustments(input: AllocationInput): AllocatedLine[] {
  const lines = input.lines;
  const discount = input.discountMode === 'ORDER' ? BigInt(Math.round(input.orderDiscountTotal)) : 0n;
  const hasOrderTax = input.taxMode === 'ORDER';
  // Mẫu theo dòng cho cả chiết khấu lẫn thuế: không có gì để phân bổ, dòng giữ nguyên như phase 1.
  if (discount === 0n && !hasOrderTax) return lines.map((line) => ({ ...line, orderDiscountShare: 0 }));

  const amounts = lines.map((line) => BigInt(Math.round(line.lineAmount)));
  const goods = amounts.reduce((acc, amount) => acc + amount, 0n);
  const shares = allocateProportionally(discount, amounts).map((share, index) => (share > amounts[index] ? amounts[index] : share));
  const net = amounts.map((amount, index) => amount - shares[index]);
  const netGoods = net.reduce((acc, amount) => acc + amount, 0n);

  let vat: bigint[];
  if (hasOrderTax) {
    // Dòng của báo giá có thuế 0; thuế tổng đơn chia theo thành tiền sau chiết khấu.
    vat = allocateProportionally(BigInt(Math.round(input.orderTaxTotal)), net);
  } else {
    // Thuế theo dòng, chiết khấu tổng đơn làm giảm cơ sở thuế theo cùng tỷ lệ (như `applyQuoteAdjustments`).
    const original = lines.map((line) => BigInt(Math.round(line.vatAmount)));
    const goodsVat = original.reduce((acc, amount) => acc + amount, 0n);
    const target = goods > 0n ? divideRounded(goodsVat * netGoods, goods) : goodsVat;
    vat = allocateProportionally(target, original);
  }

  return lines.map((line, index) => {
    const lineAmount = Number(net[index]);
    const discountAmount = line.discountAmount + Number(shares[index]);
    return {
      quantity: line.quantity,
      grossAmount: line.grossAmount,
      discountAmount,
      lineAmount,
      vatAmount: Number(vat[index]),
      orderDiscountShare: Number(shares[index]),
    };
  });
}
