import { quoteDeepLink } from '@enterprise-platform/contracts-crm';
import { formatVnd } from './receivables.js';

/**
 * Thông tin nguồn CRM gửi kèm hồ sơ Quy trình (plan mục 17.2, D3-31): tiêu đề, các dòng nhãn - giá trị, đường dẫn về
 * báo giá. Cùng hình dạng với `ProcedureSourceSummary` của contracts Quy trình (JSON gửi qua API nội bộ).
 */
export interface CrmSourceSummaryItem {
  readonly label: string;
  readonly value: string;
}

export interface CrmSourceSummary {
  readonly title?: string;
  readonly items: readonly CrmSourceSummaryItem[];
  readonly url?: string;
  readonly urlLabel?: string;
}

/** Giới hạn phía Quy trình (`PROCEDURE_SOURCE_SUMMARY_LIMITS`): vượt thì Quy trình trả 400, nên CRM cắt trước khi gửi. */
export const SOURCE_SUMMARY_LIMITS = {
  items: 30,
  label: 100,
  value: 1000,
  title: 200,
  url: 500,
  urlLabel: 100,
} as const;

export const QUOTE_SOURCE_URL_LABEL = 'Mở báo giá trong Bán hàng';

/** Số liệu PAKD hiện trên thông tin nguồn. */
export interface SourcePlanFigures {
  readonly revenue: number;
  readonly goodsCost: number;
  readonly totalCost: number;
  readonly profit: number;
  readonly marginPercent: number | null;
}

export interface QuoteSourceInput {
  readonly quoteId: string;
  readonly code: string;
  readonly versionNo: number;
  readonly customerName: string;
  readonly opportunityName: string | null;
  readonly ownerName: string | null;
  readonly organizationName: string | null;
  readonly totalAmount: number;
  readonly discountAmount: number;
  readonly discountPercent: number;
  readonly estCost: number;
  readonly marginPercent: number | null;
  readonly reasons: readonly string[];
  /** PAKD của phiên bản (nếu có). */
  readonly plan: SourcePlanFigures | null;
}

export interface BusinessPlanSourceInput {
  readonly quoteId: string;
  readonly code: string;
  readonly versionNo: number;
  readonly customerName: string;
  readonly ownerName: string | null;
  readonly figures: SourcePlanFigures;
  /** Lý do lệch ngưỡng so với PAKD đã duyệt gần nhất. */
  readonly reasons: readonly string[];
}

/** `1.234.567 đ`. */
export const moneyText = (value: number): string => `${formatVnd(value)} đ`;

/** `12,5%`; rỗng thì "Chưa tính được". */
export function percentText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Chưa tính được';
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value)}%`;
}

const cut = (value: string, max: number): string => {
  const text = value.trim().normalize('NFC');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** Dòng lý do: mỗi lý do một dòng; quá số dòng còn lại thì dòng cuối gộp phần còn lại. */
function reasonItems(reasons: readonly string[], room: number): CrmSourceSummaryItem[] {
  const clean = reasons.map((reason) => reason.trim()).filter(Boolean);
  if (room <= 0 || !clean.length) return [];
  if (clean.length <= room) return clean.map((value) => ({ label: 'Lý do cần duyệt', value }));
  const kept = clean.slice(0, room - 1).map((value) => ({ label: 'Lý do cần duyệt', value }));
  return [...kept, { label: 'Lý do cần duyệt', value: `Và ${clean.length - kept.length} lý do khác (xem trên báo giá).` }];
}

const planItems = (prefix: string, plan: SourcePlanFigures): CrmSourceSummaryItem[] => [
  { label: `${prefix}Doanh thu`, value: moneyText(plan.revenue) },
  { label: `${prefix}Giá vốn`, value: moneyText(plan.goodsCost) },
  { label: `${prefix}Tổng chi phí`, value: moneyText(plan.totalCost) },
  { label: `${prefix}Lợi nhuận`, value: moneyText(plan.profit) },
  { label: `${prefix}Biên lợi nhuận`, value: percentText(plan.marginPercent) },
];

/** Thông tin nguồn của hồ sơ duyệt báo giá (`crm_quote`). */
export function quoteSourceSummary(input: QuoteSourceInput): CrmSourceSummary {
  const head: CrmSourceSummaryItem[] = [
    { label: 'Khách hàng', value: input.customerName },
    ...(input.opportunityName ? [{ label: 'Dự án', value: input.opportunityName }] : []),
    ...(input.ownerName ? [{ label: 'Người phụ trách', value: input.ownerName }] : []),
    ...(input.organizationName ? [{ label: 'Tổ chức báo giá', value: input.organizationName }] : []),
    { label: 'Tổng tiền', value: moneyText(input.totalAmount) },
    { label: 'Chiết khấu', value: `${moneyText(input.discountAmount)} (${percentText(input.discountPercent)})` },
    { label: 'Giá vốn ước tính', value: moneyText(input.estCost) },
    { label: 'Biên lợi nhuận ước tính', value: percentText(input.marginPercent) },
  ];
  const tail = input.plan ? planItems('PAKD - ', input.plan) : [];
  const room = SOURCE_SUMMARY_LIMITS.items - head.length - tail.length;
  return sanitizeSourceSummary({
    title: `Báo giá ${input.code} v${input.versionNo}`,
    items: [...head, ...reasonItems(input.reasons, room), ...tail],
    url: quoteDeepLink(input.quoteId),
    urlLabel: QUOTE_SOURCE_URL_LABEL,
  });
}

/** Thông tin nguồn của hồ sơ duyệt PAKD trình riêng (`crm_business_plan`). */
export function businessPlanSourceSummary(input: BusinessPlanSourceInput): CrmSourceSummary {
  const head: CrmSourceSummaryItem[] = [
    { label: 'Khách hàng', value: input.customerName },
    ...(input.ownerName ? [{ label: 'Người phụ trách', value: input.ownerName }] : []),
    ...planItems('', input.figures),
  ];
  const room = SOURCE_SUMMARY_LIMITS.items - head.length;
  return sanitizeSourceSummary({
    title: `PAKD báo giá ${input.code} v${input.versionNo}`,
    items: [...head, ...reasonItems(input.reasons, room)],
    url: quoteDeepLink(input.quoteId),
    urlLabel: QUOTE_SOURCE_URL_LABEL,
  });
}

/** Đường dẫn nội bộ an toàn như phía Quy trình (`isInternalPath`). */
function internalPath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === '\\') return false;
  }
  return !/^\/[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/**
 * Đưa thông tin nguồn về trong giới hạn của Quy trình thay vì để Quy trình từ chối (400 làm hỏng cả lần tạo hồ sơ):
 * cắt chữ quá dài, bỏ dòng thừa và dòng rỗng, bỏ link không phải đường dẫn nội bộ.
 */
export function sanitizeSourceSummary(summary: CrmSourceSummary): CrmSourceSummary {
  const L = SOURCE_SUMMARY_LIMITS;
  const items = summary.items
    .map((item) => ({ label: cut(item.label ?? '', L.label), value: cut(item.value ?? '', L.value) }))
    .filter((item) => item.label)
    .slice(0, L.items);
  const title = cut(summary.title ?? '', L.title);
  const url = (summary.url ?? '').trim();
  const urlOk = !!url && url.length <= L.url && internalPath(url);
  const urlLabel = cut(summary.urlLabel ?? '', L.urlLabel);
  return {
    ...(title ? { title } : {}),
    items,
    ...(urlOk ? { url } : {}),
    ...(urlOk && urlLabel ? { urlLabel } : {}),
  };
}
