import type { QuoteApprovalReason, QuoteApprovalSettings } from '@enterprise-platform/contracts-crm';
import { CrmValidationError } from './crm.error.js';

/**
 * Ngưỡng phê duyệt báo giá (PRC-04, PRC-05): hàm thuần, không DB.
 *
 * Báo giá cần duyệt khi có ít nhất một điều sau:
 * - chiết khấu của một dòng (hoặc bình quân cả báo giá) vượt hạn mức theo vai
 *   trò người gửi;
 * - biên lợi nhuận dưới mức tối thiểu;
 * - có dòng ghi đè giá hoặc chiết khấu;
 * - có dòng hàng tồn kho chưa có giá vốn ước tính (không tính được biên thật).
 *
 * Đúng bằng hạn mức thì không cần duyệt (TC-PRC-24, TC-PRC-26). So sánh trên số
 * nguyên đã nhân theo số chữ số thập phân của cột để tránh sai số nhị phân.
 */

export type QuoteRoleTier = 'staff' | 'teamLead' | 'manager';

export const QUOTE_ROLE_TIER_LABELS: Readonly<Record<QuoteRoleTier, string>> = {
  staff: 'nhân viên',
  teamLead: 'trưởng nhóm',
  manager: 'quản lý',
};

/**
 * Vai trò người lập để chọn hạn mức: thấy toàn bộ (`crm.read.all`, quản trị
 * tenant) là quản lý; có `crm.quote.approve` là trưởng nhóm; còn lại là nhân viên.
 */
export function quoteRoleTier(flags: {
  readonly isTenantAdmin: boolean;
  readonly canReadAll: boolean;
  readonly canApproveQuote: boolean;
}): QuoteRoleTier {
  if (flags.isTenantAdmin || flags.canReadAll) return 'manager';
  if (flags.canApproveQuote) return 'teamLead';
  return 'staff';
}

export interface ApprovalPolicyLine {
  readonly lineNo: number;
  readonly materialCode: string;
  readonly materialKind: string;
  readonly discountPercent: number;
  readonly overridden: boolean;
  readonly estUnitCost: number | null;
}

export interface ApprovalPolicyInput {
  readonly settings: QuoteApprovalSettings;
  readonly tier: QuoteRoleTier;
  readonly lines: readonly ApprovalPolicyLine[];
  /** Chiết khấu bình quân trên giá gốc của cả báo giá (%). */
  readonly totalDiscountPercent: number;
  /** Biên lợi nhuận cả báo giá (%); rỗng khi doanh thu bằng 0. */
  readonly marginPercent: number | null;
}

const PERCENT_SCALE = 10_000;
const MARGIN_SCALE = 100;
const scaled = (value: number, scale: number) => Math.round(value * scale);
const percentText = (value: number) => `${Number(value.toFixed(4)).toLocaleString('vi-VN', { maximumFractionDigits: 4 })}%`;

/** Lý do cần duyệt, theo thứ tự dòng; rỗng là duyệt thẳng. */
export function evaluateQuoteApproval(input: ApprovalPolicyInput): QuoteApprovalReason[] {
  const reasons: QuoteApprovalReason[] = [];
  const limit = input.settings.roleLimits[input.tier];
  const tierLabel = QUOTE_ROLE_TIER_LABELS[input.tier];
  const label = (line: ApprovalPolicyLine) => `Dòng ${line.lineNo} (${line.materialCode})`;

  for (const line of input.lines) {
    if (limit !== null && scaled(line.discountPercent, PERCENT_SCALE) > scaled(limit, PERCENT_SCALE)) {
      reasons.push({
        code: 'DISCOUNT_OVER_LIMIT',
        message: `${label(line)}: Chiết khấu vượt hạn mức vai trò ${tierLabel} (${percentText(line.discountPercent)} > ${percentText(limit)}).`,
      });
    }
    if (line.overridden) {
      reasons.push({ code: 'OVERRIDE', message: `${label(line)}: Có ghi đè giá hoặc chiết khấu.` });
    }
    if (line.materialKind !== 'SERVICE' && line.estUnitCost === null) {
      reasons.push({ code: 'COST_UNKNOWN', message: `${label(line)}: Kho chưa có giá vốn ước tính, không tính được biên lợi nhuận.` });
    }
  }
  const lineDiscountReason = reasons.some((reason) => reason.code === 'DISCOUNT_OVER_LIMIT');
  if (
    !lineDiscountReason &&
    limit !== null &&
    scaled(input.totalDiscountPercent, PERCENT_SCALE) > scaled(limit, PERCENT_SCALE)
  ) {
    reasons.push({
      code: 'TOTAL_DISCOUNT_OVER_LIMIT',
      message: `Chiết khấu bình quân cả báo giá vượt hạn mức vai trò ${tierLabel} (${percentText(input.totalDiscountPercent)} > ${percentText(limit)}).`,
    });
  }
  if (input.lines.length) {
    if (input.marginPercent === null) {
      reasons.push({ code: 'MARGIN_BELOW_MIN', message: 'Không xác định được biên lợi nhuận (doanh thu bằng 0).' });
    } else if (scaled(input.marginPercent, MARGIN_SCALE) < scaled(input.settings.minMarginPercent, MARGIN_SCALE)) {
      reasons.push({
        code: 'MARGIN_BELOW_MIN',
        message: `Biên lợi nhuận dưới mức tối thiểu (${percentText(input.marginPercent)} < ${percentText(input.settings.minMarginPercent)}).`,
      });
    }
  }
  return reasons;
}

/** Kiểm và chuẩn hoá cấu hình ngưỡng duyệt người quản trị nhập. */
export function normalizeQuoteApprovalSettings(value: unknown): QuoteApprovalSettings {
  const source = (value ?? {}) as { roleLimits?: Record<string, unknown>; minMarginPercent?: unknown };
  const limit = (raw: unknown, label: string): number | null => {
    if (raw === null || raw === undefined || raw === '') return null;
    return percent(raw, `Hạn mức chiết khấu của ${label}`);
  };
  const limits = source.roleLimits ?? {};
  return {
    roleLimits: {
      staff: limit(limits['staff'], 'nhân viên'),
      teamLead: limit(limits['teamLead'], 'trưởng nhóm'),
      manager: limit(limits['manager'], 'quản lý'),
    },
    minMarginPercent: percent(source.minMarginPercent, 'Biên lợi nhuận tối thiểu'),
  };
}

function percent(raw: unknown, label: string): number {
  const number = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 100) {
    throw new CrmValidationError('INVALID_NUMBER', `${label} phải là số từ 0 đến 100.`);
  }
  if (Math.abs(Number(number.toFixed(2)) - number) > 1e-9) {
    throw new CrmValidationError('INVALID_NUMBER', `${label} tối đa 2 chữ số thập phân.`);
  }
  return number;
}
