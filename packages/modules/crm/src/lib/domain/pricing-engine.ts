import {
  DEFAULT_VAT_RATE,
  type AppliedDiscountPolicy,
  type DiscountPolicy,
  type DiscountPolicyRule,
  type PricedLine,
  type PricedShipping,
  type PriceSource,
  type PricingResult,
  type PricingStatus,
  type PricingTotals,
} from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';

/**
 * Engine giá: hàm thuần, không DB, không giờ hệ thống. Mọi quy tắc tính tiền
 * của báo giá và đơn bán nằm ở đây (Q3, `docs/crm/plan_crm.md`):
 *
 * 1. Đơn giá gốc theo thứ tự: giá hợp đồng còn hiệu lực, bảng giá của nhóm
 *    khách, bảng giá chuẩn (PRC-01, mục 5).
 * 2. Chính sách khớp với dòng: chính sách độc quyền có ưu tiên cao nhất (số
 *    `priority` nhỏ nhất) loại mọi chính sách khác; nếu không có thì cộng các
 *    chính sách STACK với mức cao nhất trong các chính sách MAX. Tổng là phần
 *    trăm trên giá gốc, cắt theo trần (PRC-03).
 * 3. Tiền làm tròn đến đồng theo từng dòng, kiểu xa số 0; VAT tính trên thành
 *    tiền sau chiết khấu của dòng; tổng bằng cộng các dòng đã làm tròn. Phí vận
 *    chuyển là một dòng dịch vụ có thuế suất riêng.
 *
 * Tiền tính bằng số nguyên lớn (`bigint`) theo đơn vị nhỏ nhất của từng cột
 * (đơn giá 2 chữ số, số lượng 3, phần trăm 4) để không sinh sai số nhị phân.
 */

export interface PricingPriceListItem {
  readonly materialId: string;
  readonly unit: string;
  readonly price: number;
  readonly vatRate: number;
}

export interface PricingPriceList {
  readonly id: string;
  readonly code: string;
  readonly isStandard: boolean;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly status: PricingStatus;
  readonly customerGroupIds: readonly string[];
  readonly items: readonly PricingPriceListItem[];
}

/** Giá khung của hợp đồng (GĐ4 đưa vào); hết hiệu lực thì bỏ qua. */
export interface PricingContractPrice {
  readonly contractId: string;
  readonly contractCode: string;
  readonly materialId: string;
  readonly unit: string;
  readonly price: number;
  /** Rỗng thì lấy thuế suất của bảng giá, không có thì mặc định. */
  readonly vatRate?: number | null;
  readonly validFrom: string;
  readonly validTo: string | null;
}

export type PricingPolicy = Pick<
  DiscountPolicy,
  | 'id'
  | 'code'
  | 'name'
  | 'priority'
  | 'stacking'
  | 'exclusive'
  | 'percent'
  | 'validFrom'
  | 'validTo'
  | 'status'
  | 'appliesToAllCustomers'
  | 'rules'
>;

export interface PricingLineInput {
  readonly materialId: string;
  readonly materialCode?: string | null;
  readonly materialName?: string | null;
  readonly category?: string | null;
  readonly quantity: number;
  readonly unit: string;
  readonly override?: {
    readonly unitPrice?: number | null;
    readonly discountPercent?: number | null;
  } | null;
}

export interface PricingInput {
  /** Ngày tính giá `YYYY-MM-DD` theo giờ Việt Nam. */
  readonly date: string;
  readonly customerId: string | null;
  readonly customerGroupId: string | null;
  readonly lines: readonly PricingLineInput[];
  readonly priceLists: readonly PricingPriceList[];
  readonly policies: readonly PricingPolicy[];
  readonly contractPrices?: readonly PricingContractPrice[];
  readonly discountCapPercent: number;
  readonly shipping?: { readonly amount: number; readonly vatRate?: number | null } | null;
}

// ---------------------------------------------------------------------------
// Số học tiền
// ---------------------------------------------------------------------------

const PRICE_SCALE = 2;
const QUANTITY_SCALE = 3;
const PERCENT_SCALE = 4;
/** 100% ở đơn vị 1/10.000 phần trăm. */
const HUNDRED_PERCENT = 1_000_000n;

/** Số thập phân thành số nguyên lớn với `decimals` chữ số sau dấu phẩy (làm tròn xa số 0). */
function scaled(value: number, decimals: number): bigint {
  if (!Number.isFinite(value)) throw new Error(`Invalid number: ${value}`);
  const sign = value < 0 ? -1n : 1n;
  const abs = Math.abs(value);
  const text = String(abs);
  // Dịch dấu phẩy trên chuỗi để 1.005 thành 100.5 chứ không phải 100.49999...
  const shifted = text.includes('e') ? Math.round(abs * 10 ** decimals) : Math.round(Number(`${text}e${decimals}`));
  return sign * BigInt(shifted);
}

/** Chia rồi làm tròn kiểu xa số 0; `denominator` dương. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = (abs * 2n + denominator) / (2n * denominator);
  return negative ? -quotient : quotient;
}

function unscaled(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

/** Làm tròn tiền VND đến đồng, kiểu xa số 0 (như `roundMoney` của Tài chính nhưng 0 chữ số thập phân). */
export function roundVnd(value: number): number {
  return Number(divideRounded(scaled(value, 6), 1_000_000n));
}

/**
 * Biên lợi nhuận (%) = (doanh thu − giá vốn) / doanh thu, 2 chữ số thập phân.
 * Doanh thu 0 (dòng tặng) trả `null`: giao diện hiện "không xác định".
 */
export function computeMargin(revenue: number, cost: number): number | null {
  const revenueCents = scaled(revenue, PRICE_SCALE);
  if (revenueCents === 0n) return null;
  const costCents = scaled(cost, PRICE_SCALE);
  const sign = revenueCents < 0n ? -1n : 1n;
  return unscaled(divideRounded((revenueCents - costCents) * 10_000n * sign, revenueCents * sign), 2);
}

// ---------------------------------------------------------------------------
// Chọn giá và chính sách
// ---------------------------------------------------------------------------

/** Ngày `date` nằm trong hiệu lực `[from, to]` (cả hai mốc tính trọn ngày). */
export function withinValidity(date: string, from: string | null | undefined, to: string | null | undefined): boolean {
  return (!from || from <= date) && (!to || date <= to);
}

function sameUnit(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function sameText(left: string | null | undefined, right: string | null | undefined): boolean {
  return !!left && !!right && left.trim().toLowerCase() === right.trim().toLowerCase();
}

interface ResolvedPrice {
  readonly price: number;
  readonly vatRate: number;
  readonly source: PriceSource;
  readonly referenceId: string | null;
  readonly referenceCode: string | null;
}

function findItem(lists: readonly PricingPriceList[], line: PricingLineInput) {
  for (const list of lists) {
    const item = list.items.find((entry) => entry.materialId === line.materialId && sameUnit(entry.unit, line.unit));
    if (item) return { list, item };
  }
  return undefined;
}

/** Bảng giá đang hiệu lực, bảng bắt đầu sau cùng đứng trước. */
function effectiveLists(input: PricingInput, accept: (list: PricingPriceList) => boolean): PricingPriceList[] {
  return input.priceLists
    .filter((list) => list.status === 'ACTIVE' && withinValidity(input.date, list.validFrom, list.validTo) && accept(list))
    .sort((left, right) => right.validFrom.localeCompare(left.validFrom) || left.code.localeCompare(right.code));
}

function resolvePrice(input: PricingInput, line: PricingLineInput): ResolvedPrice | undefined {
  const standard = findItem(
    effectiveLists(input, (list) => list.isStandard),
    line,
  );
  const contract = (input.contractPrices ?? []).find(
    (entry) =>
      entry.materialId === line.materialId &&
      sameUnit(entry.unit, line.unit) &&
      withinValidity(input.date, entry.validFrom, entry.validTo),
  );
  if (contract) {
    return {
      price: contract.price,
      vatRate: contract.vatRate ?? standard?.item.vatRate ?? DEFAULT_VAT_RATE,
      source: 'CONTRACT',
      referenceId: contract.contractId,
      referenceCode: contract.contractCode,
    };
  }
  const groupId = input.customerGroupId;
  const group = groupId
    ? findItem(
        effectiveLists(input, (list) => !list.isStandard && list.customerGroupIds.includes(groupId)),
        line,
      )
    : undefined;
  const found = group ?? standard;
  if (!found) return undefined;
  return {
    price: found.item.price,
    vatRate: found.item.vatRate,
    source: group ? 'GROUP_LIST' : 'STANDARD_LIST',
    referenceId: found.list.id,
    referenceCode: found.list.code,
  };
}

export interface PolicyContext {
  readonly date: string;
  readonly customerId: string | null;
  readonly customerGroupId: string | null;
  readonly materialId: string;
  readonly category: string | null;
  readonly quantity: number;
}

/**
 * Phần trăm (đơn vị 1/10.000 %) chính sách cho dòng, hoặc `null` khi không khớp.
 *
 * Tiêu chí chia bốn chiều: số lượng; thời gian; khách hàng hoặc nhóm khách;
 * mặt hàng hoặc nhóm hàng. Các chiều kết hợp AND; trong một chiều, các dòng
 * kết hợp OR. Có bậc số lượng thì phần trăm lấy theo bậc khớp (bậc khớp cao
 * nhất nếu nhập chồng), không thì lấy phần trăm của chính sách.
 */
function policyPercent(policy: PricingPolicy, context: PolicyContext): bigint | null {
  if (policy.status !== 'ACTIVE' || !withinValidity(context.date, policy.validFrom, policy.validTo)) return null;
  const rules = (criteria: readonly string[]) => policy.rules.filter((rule) => criteria.includes(rule.criterion));
  const anyMatch = (list: readonly DiscountPolicyRule[], test: (rule: DiscountPolicyRule) => boolean) =>
    list.length === 0 || list.some(test);

  const customerRules = rules(['CUSTOMER', 'CUSTOMER_GROUP']);
  if (!policy.appliesToAllCustomers && customerRules.length === 0) return null;
  const customerMatches = anyMatch(customerRules, (rule) =>
    rule.criterion === 'CUSTOMER'
      ? !!context.customerId && rule.refId === context.customerId
      : !!context.customerGroupId && rule.refId === context.customerGroupId,
  );
  const materialMatches = anyMatch(rules(['MATERIAL', 'MATERIAL_CATEGORY']), (rule) =>
    rule.criterion === 'MATERIAL' ? rule.refId === context.materialId : sameText(rule.refText, context.category),
  );
  const periodMatches = anyMatch(rules(['PERIOD']), (rule) => withinValidity(context.date, rule.fromDate, rule.toDate));
  if (!customerMatches || !materialMatches || !periodMatches) return null;

  const tiers = rules(['QUANTITY']);
  if (tiers.length === 0) {
    return policy.percent ? scaled(policy.percent, PERCENT_SCALE) : null;
  }
  const quantity = scaled(context.quantity, QUANTITY_SCALE);
  let best: bigint | null = null;
  for (const tier of tiers) {
    const min = scaled(tier.minQty ?? 0, QUANTITY_SCALE);
    const max = tier.maxQty === null || tier.maxQty === undefined ? null : scaled(tier.maxQty, QUANTITY_SCALE);
    if (quantity < min || (max !== null && quantity > max) || !tier.percent) continue;
    const percent = scaled(tier.percent, PERCENT_SCALE);
    if (best === null || percent > best) best = percent;
  }
  return best;
}

interface Candidate {
  readonly policy: PricingPolicy;
  readonly percent: bigint;
}

const byPriority = (left: Candidate, right: Candidate) =>
  left.policy.priority - right.policy.priority || left.policy.code.localeCompare(right.policy.code);

/** Chọn chính sách áp cho một dòng theo độc quyền, cộng dồn, lấy cao nhất. */
export function selectPolicies(policies: readonly PricingPolicy[], context: PolicyContext): Candidate[] {
  const candidates: Candidate[] = [];
  for (const policy of policies) {
    const percent = policyPercent(policy, context);
    if (percent !== null && percent > 0n) candidates.push({ policy, percent });
  }
  const exclusive = candidates.filter((candidate) => candidate.policy.exclusive).sort(byPriority);
  if (exclusive.length) return [exclusive[0]];
  const stacked = candidates.filter((candidate) => candidate.policy.stacking === 'STACK');
  const highest = candidates
    .filter((candidate) => candidate.policy.stacking === 'MAX')
    .sort((left, right) => (left.percent === right.percent ? byPriority(left, right) : left.percent > right.percent ? -1 : 1))[0];
  return [...stacked, ...(highest ? [highest] : [])].sort(byPriority);
}

// ---------------------------------------------------------------------------
// Tính báo giá
// ---------------------------------------------------------------------------

function lineError(index: number, code: string, message: string): CrmValidationError {
  return new CrmValidationError(code, message, { line: index + 1 });
}

function validPercent(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function priceLine(input: PricingInput, line: PricingLineInput, index: number, cap: bigint): PricedLine {
  if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
    throw lineError(index, 'INVALID_QUANTITY', 'Số lượng phải lớn hơn 0.');
  }
  const overridePrice = line.override?.unitPrice ?? null;
  const overridePercent = line.override?.discountPercent ?? null;
  if (overridePrice !== null && overridePercent !== null) {
    throw lineError(index, 'OVERRIDE_CONFLICT', 'Chỉ ghi đè đơn giá hoặc chiết khấu, không ghi đè cả hai.');
  }
  if (overridePrice !== null && (!Number.isFinite(overridePrice) || overridePrice < 0)) {
    throw lineError(index, 'INVALID_PRICE', 'Đơn giá ghi đè phải là số không âm.');
  }
  if (overridePercent !== null && !validPercent(overridePercent)) {
    throw lineError(index, 'INVALID_PERCENT', 'Chiết khấu ghi đè phải từ 0 đến 100%.');
  }

  const resolved = resolvePrice(input, line);
  if (!resolved && overridePrice === null) {
    const label = line.materialCode || line.materialName || line.materialId;
    throw lineError(index, 'PRICE_NOT_FOUND', `Chưa có giá bán cho mặt hàng ${label} (${line.unit}) tại ngày tính giá.`);
  }
  const price: ResolvedPrice = resolved ?? {
    price: overridePrice ?? 0,
    vatRate: DEFAULT_VAT_RATE,
    source: 'MANUAL',
    referenceId: null,
    referenceCode: null,
  };

  const category = line.category?.trim() || null;
  const selected = selectPolicies(input.policies, {
    date: input.date,
    customerId: input.customerId,
    customerGroupId: input.customerGroupId,
    materialId: line.materialId,
    category,
    quantity: line.quantity,
  });
  const policyTotal = selected.reduce((sum, candidate) => sum + candidate.percent, 0n);
  const capped = policyTotal > cap;
  const suggested = capped ? cap : policyTotal;

  const listCents = scaled(price.price, PRICE_SCALE);
  const quantity = scaled(line.quantity, QUANTITY_SCALE);
  // đồng = xu × nghìn-đơn-vị / (100 × 1000)
  const amountDenominator = 100n * 1000n;
  const grossAmount = divideRounded(listCents * quantity, amountDenominator);

  let discount: bigint;
  let unitCents: bigint;
  let lineAmount: bigint;
  if (overridePrice !== null && resolved) {
    unitCents = scaled(overridePrice, PRICE_SCALE);
    lineAmount = divideRounded(unitCents * quantity, amountDenominator);
    discount = listCents > 0n ? divideRounded((listCents - unitCents) * HUNDRED_PERCENT, listCents) : 0n;
  } else {
    discount = overridePercent !== null ? scaled(overridePercent, PERCENT_SCALE) : price.source === 'MANUAL' ? 0n : suggested;
    unitCents = divideRounded(listCents * (HUNDRED_PERCENT - discount), HUNDRED_PERCENT);
    lineAmount = divideRounded(listCents * quantity * (HUNDRED_PERCENT - discount), amountDenominator * HUNDRED_PERCENT);
  }

  const vatRate = scaled(price.vatRate, 2);
  const vatAmount = divideRounded(lineAmount * vatRate, 10_000n);
  const applied: AppliedDiscountPolicy[] = selected.map(({ policy, percent }) => ({
    policyId: policy.id,
    code: policy.code,
    name: policy.name,
    stacking: policy.stacking,
    exclusive: policy.exclusive,
    percent: unscaled(percent, PERCENT_SCALE),
  }));

  return {
    index,
    materialId: line.materialId,
    materialCode: line.materialCode?.trim() || null,
    materialName: line.materialName?.trim() || null,
    category,
    unit: line.unit.trim(),
    quantity: unscaled(quantity, QUANTITY_SCALE),
    listPrice: unscaled(listCents, PRICE_SCALE),
    priceSource: price.source,
    priceReferenceId: price.referenceId,
    priceReferenceCode: price.referenceCode,
    appliedPolicies: applied,
    policyPercent: unscaled(suggested, PERCENT_SCALE),
    discountPercent: unscaled(discount, PERCENT_SCALE),
    cappedAt: capped ? unscaled(cap, PERCENT_SCALE) : null,
    overridden: overridePrice !== null || overridePercent !== null,
    unitPriceAfterDiscount: unscaled(unitCents, PRICE_SCALE),
    grossAmount: Number(grossAmount),
    discountAmount: Number(grossAmount - lineAmount),
    lineAmount: Number(lineAmount),
    vatRate: unscaled(vatRate, 2),
    vatAmount: Number(vatAmount),
    lineTotal: Number(lineAmount + vatAmount),
  };
}

function priceShipping(shipping: PricingInput['shipping']): PricedShipping | null {
  if (!shipping) return null;
  if (!Number.isFinite(shipping.amount) || shipping.amount < 0) {
    throw new CrmValidationError('INVALID_SHIPPING', 'Phí vận chuyển phải là số không âm.');
  }
  const rate = shipping.vatRate ?? DEFAULT_VAT_RATE;
  if (!validPercent(rate)) throw new CrmValidationError('INVALID_VAT', 'Thuế suất phải từ 0 đến 100%.');
  const amount = Number(divideRounded(scaled(shipping.amount, PRICE_SCALE), 100n));
  const vatRate = scaled(rate, 2);
  const vatAmount = Number(divideRounded(BigInt(amount) * vatRate, 10_000n));
  return { amount, vatRate: unscaled(vatRate, 2), vatAmount, total: amount + vatAmount };
}

/** Tính giá cả báo giá. Lỗi dữ liệu nhập (số lượng, ghi đè, thiếu giá) ném 400 kèm số dòng. */
export function priceQuote(input: PricingInput): PricingResult {
  if (!validPercent(input.discountCapPercent)) {
    throw new CrmValidationError('INVALID_CAP', 'Trần chiết khấu phải từ 0 đến 100%.');
  }
  const cap = scaled(input.discountCapPercent, PERCENT_SCALE);
  const lines = input.lines.map((line, index) => priceLine(input, line, index, cap));
  const shipping = priceShipping(input.shipping);
  const sum = (pick: (line: PricedLine) => number) => lines.reduce((total, line) => total + pick(line), 0);
  const netAmount = sum((line) => line.lineAmount);
  const vatAmount = sum((line) => line.vatAmount) + (shipping?.vatAmount ?? 0);
  const shippingAmount = shipping?.amount ?? 0;
  const totals: PricingTotals = {
    grossAmount: sum((line) => line.grossAmount),
    discountAmount: sum((line) => line.discountAmount),
    netAmount,
    shippingAmount,
    vatAmount,
    totalAmount: netAmount + shippingAmount + vatAmount,
  };
  return {
    date: input.date,
    customerId: input.customerId,
    customerGroupId: input.customerGroupId,
    discountCapPercent: unscaled(cap, PERCENT_SCALE),
    lines,
    shipping,
    totals,
  };
}
