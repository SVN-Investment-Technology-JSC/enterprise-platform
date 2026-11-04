import {
  BUSINESS_PLAN_AMOUNT_MAX,
  BUSINESS_PLAN_COST_KINDS,
  BUSINESS_PLAN_LINES_MAX,
  type BusinessPlanCostKind,
  type BusinessPlanCostLineInput,
  type BusinessPlanDeviationMode,
  type BusinessPlanFigures,
  type BusinessPlanStatus,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmValidationError } from './crm.error.js';
import { optionalText } from './fields.js';
import { computeMargin, roundVnd } from './pricing-engine.js';

/**
 * Phương án kinh doanh (PAKD): hàm thuần tính số liệu, kiểm dòng chi phí, so lệch với PAKD đã duyệt và máy
 * trạng thái duyệt. Không DB.
 *
 * Tiền là VND, mỗi dòng làm tròn đến đồng kiểu xa số 0 (`roundVnd`); các tổng cộng bằng số nguyên lớn để không
 * sai số nhị phân, và báo lỗi khi vượt giới hạn `NUMERIC(18,2)`.
 */

/** Giới hạn của cột `NUMERIC(18,2)`: giá trị tuyệt đối phải nhỏ hơn 1e16. */
const NUMERIC_LIMIT = 10n ** 16n;

export interface PlanCostLine {
  readonly kind: BusinessPlanCostKind;
  readonly amount: number;
}

export interface PlanBasis {
  /** Tổng tiền hàng theo giá gốc (trước chiết khấu) của báo giá. */
  readonly grossAmount: number;
  /** Chiết khấu của chính báo giá. */
  readonly quoteDiscountAmount: number;
  /** Doanh thu: thành tiền sau chiết khấu cộng phí vận chuyển thu khách. */
  readonly revenue: number;
  /** Giá vốn ước tính của hàng cộng chi phí vận chuyển bên bán chịu. */
  readonly goodsCost: number;
}

const toBig = (value: number): bigint => BigInt(roundVnd(value));

function fits(value: bigint): bigint {
  if (value >= NUMERIC_LIMIT || value <= -NUMERIC_LIMIT) {
    throw new CrmValidationError('AMOUNT_OVERFLOW', 'Số tiền của phương án kinh doanh vượt giới hạn cho phép.');
  }
  return value;
}

/**
 * Tính số liệu PAKD: tổng chi phí = giá vốn + các dòng chi phí; lợi nhuận = doanh thu − tổng chi phí; tỷ suất
 * = lợi nhuận / doanh thu (`computeMargin`, 2 chữ số thập phân, rỗng khi doanh thu 0). Tỷ lệ chiết khấu tính
 * trên giá gốc, gồm chiết khấu của báo giá và các dòng chiết khấu, giảm giá của PAKD.
 */
export function computeBusinessPlan(basis: PlanBasis, lines: readonly PlanCostLine[]): BusinessPlanFigures {
  const gross = fits(toBig(basis.grossAmount));
  const revenue = fits(toBig(basis.revenue));
  const goodsCost = fits(toBig(basis.goodsCost));
  let extra = 0n;
  let planDiscount = 0n;
  for (const line of lines) {
    const amount = toBig(line.amount);
    extra += amount;
    if (line.kind === 'DISCOUNT' || line.kind === 'PRICE_REDUCTION') planDiscount += amount;
  }
  fits(extra);
  const discount = fits(toBig(basis.quoteDiscountAmount) + planDiscount);
  const totalCost = fits(goodsCost + extra);
  const profit = fits(revenue - totalCost);
  return {
    grossAmount: Number(gross),
    revenue: Number(revenue),
    goodsCost: Number(goodsCost),
    discountAmount: Number(discount),
    extraCostTotal: Number(extra),
    totalCost: Number(totalCost),
    profit: Number(profit),
    marginPercent: computeMargin(Number(revenue), Number(totalCost)),
    discountPercent: gross > 0n ? discountPercent(discount, gross) : 0,
  };
}

/** Phần trăm chiết khấu 4 chữ số thập phân, làm tròn xa số 0. */
function discountPercent(discount: bigint, gross: bigint): number {
  const negative = discount < 0n;
  const abs = negative ? -discount : discount;
  const scaled = (abs * 1_000_000n * 2n + gross) / (2n * gross);
  return (negative ? -1 : 1) * (Number(scaled) / 10_000);
}

/** Kiểm và chuẩn hoá danh sách dòng chi phí người dùng gửi lên. */
export function normalizePlanLines(value: unknown): Array<{ kind: BusinessPlanCostKind; description: string | null; amount: number }> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new CrmValidationError('INVALID_LINES', 'Danh sách dòng chi phí không hợp lệ.');
  if (value.length > BUSINESS_PLAN_LINES_MAX) {
    throw new CrmValidationError('TOO_MANY_LINES', `Phương án kinh doanh tối đa ${BUSINESS_PLAN_LINES_MAX} dòng chi phí.`);
  }
  return (value as Array<Partial<BusinessPlanCostLineInput> | null>).map((raw, index) => {
    const prefix = `Dòng ${index + 1}: `;
    const kind = BUSINESS_PLAN_COST_KINDS.find((candidate) => candidate === raw?.kind);
    if (!kind) throw new CrmValidationError('INVALID_KIND', `${prefix}Vui lòng chọn loại chi phí.`);
    const number = typeof raw?.amount === 'string' && (raw.amount as string).trim() !== '' ? Number(raw.amount) : raw?.amount;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > BUSINESS_PLAN_AMOUNT_MAX) {
      throw new CrmValidationError('INVALID_AMOUNT', `${prefix}Số tiền phải là số từ 0 đến ${BUSINESS_PLAN_AMOUNT_MAX.toLocaleString('vi-VN')}.`);
    }
    return { kind, description: optionalText(raw?.description, 300, `${prefix}Diễn giải`), amount: roundVnd(number) };
  });
}

// ---------------------------------------------------------------------------
// So lệch với PAKD đã duyệt
// ---------------------------------------------------------------------------

export interface PlanDeviationResult {
  /** Mức lệch bất lợi (%), làm tròn 2 chữ số; `null` khi vô hạn (lợi nhuận gốc không dương mà giảm thêm). */
  readonly deviationPercent: number | null;
  /** Vượt ngưỡng (lớn hơn hẳn; đúng bằng ngưỡng thì không), so sánh chính xác trên số nguyên. */
  readonly exceeded: boolean;
}

/** Ngưỡng 0–100 tối đa 2 chữ số thập phân, đã đổi sang phần trăm × 100. */
const hundredths = (percent: number): bigint => BigInt(Math.round(percent * 100));

/**
 * So số liệu mới với PAKD đã duyệt gần nhất. Chỉ tính lệch bất lợi:
 *
 * - `PROFIT`: lợi nhuận giảm bao nhiêu phần trăm so với lợi nhuận đã duyệt. Lợi nhuận đã duyệt không dương mà
 *   giảm thêm thì coi là vượt mọi ngưỡng; không giảm thì không lệch;
 * - `DISCOUNT`: tỷ lệ chiết khấu tăng bao nhiêu điểm phần trăm.
 */
export function comparePlanFigures(
  mode: BusinessPlanDeviationMode,
  baseline: Pick<BusinessPlanFigures, 'profit' | 'discountPercent'>,
  current: Pick<BusinessPlanFigures, 'profit' | 'discountPercent'>,
  thresholdPercent: number,
): PlanDeviationResult {
  const threshold = hundredths(thresholdPercent);
  if (mode === 'DISCOUNT') {
    const rise = BigInt(Math.round(current.discountPercent * 10_000)) - BigInt(Math.round(baseline.discountPercent * 10_000));
    // Điểm phần trăm × 10.000 so với ngưỡng × 10.000.
    return { deviationPercent: Math.max(0, Number(rise) / 10_000), exceeded: rise > threshold * 100n };
  }
  const base = BigInt(roundVnd(baseline.profit));
  const now = BigInt(roundVnd(current.profit));
  const drop = base - now;
  if (drop <= 0n) return { deviationPercent: 0, exceeded: false };
  if (base <= 0n) return { deviationPercent: null, exceeded: true };
  const hundredthsOfPercent = (drop * 10_000n * 2n + base) / (2n * base);
  return { deviationPercent: Number(hundredthsOfPercent) / 100, exceeded: drop * 10_000n > threshold * base };
}

/** Kiểm cấu hình so lệch người quản trị nhập. */
export function normalizeDeviationSettings(value: unknown): { mode: BusinessPlanDeviationMode; thresholdPercent: number } {
  const source = (value ?? {}) as { mode?: unknown; thresholdPercent?: unknown };
  const mode = source.mode === 'PROFIT' || source.mode === 'DISCOUNT' ? source.mode : undefined;
  if (!mode) throw new CrmValidationError('INVALID_MODE', 'Vui lòng chọn cách so lệch: theo lợi nhuận hoặc theo chiết khấu.');
  const raw = typeof source.thresholdPercent === 'string' && source.thresholdPercent.trim() !== '' ? Number(source.thresholdPercent) : source.thresholdPercent;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 100) {
    throw new CrmValidationError('INVALID_NUMBER', 'Ngưỡng lệch phải là số từ 0 đến 100.');
  }
  if (Math.abs(Number(raw.toFixed(2)) - raw) > 1e-9) {
    throw new CrmValidationError('INVALID_NUMBER', 'Ngưỡng lệch tối đa 2 chữ số thập phân.');
  }
  return { mode, thresholdPercent: raw };
}

// ---------------------------------------------------------------------------
// Máy trạng thái
// ---------------------------------------------------------------------------

const EDITABLE: readonly BusinessPlanStatus[] = ['DRAFT', 'REJECTED'];

/** PAKD sửa được ở trạng thái đang soạn hoặc bị từ chối (sửa xong về đang soạn); đang chờ duyệt thì khoá. */
export function assertPlanEditable(status: BusinessPlanStatus): void {
  if (EDITABLE.includes(status)) return;
  if (status === 'PENDING') {
    throw new CrmConflictError('PLAN_LOCKED', 'Phương án kinh doanh đang chờ duyệt, chưa sửa được.');
  }
  throw new CrmConflictError('PLAN_LOCKED', 'Phương án kinh doanh đã được duyệt, không sửa được. Hãy sửa báo giá để tạo phiên bản mới.');
}

/** Trình duyệt: chỉ từ đang soạn (bị từ chối phải sửa trước, rồi mới trình lại). */
export function assertPlanSubmittable(status: BusinessPlanStatus): void {
  if (status === 'DRAFT') return;
  if (status === 'REJECTED') {
    throw new CrmConflictError('PLAN_REJECTED', 'Phương án kinh doanh bị từ chối, vui lòng sửa lại rồi mới trình duyệt.');
  }
  if (status === 'PENDING') throw new CrmConflictError('PLAN_LOCKED', 'Phương án kinh doanh đã được trình duyệt.');
  throw new CrmConflictError('PLAN_LOCKED', 'Phương án kinh doanh đã được duyệt.');
}
