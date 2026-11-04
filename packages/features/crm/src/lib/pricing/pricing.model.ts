import {
  DISCOUNT_CRITERION_LABELS,
  PRICE_SOURCE_LABELS,
  type DiscountPolicy,
  type DiscountPolicyRule,
  type PriceListSummary,
  type PricingResult,
  type SavePriceListItemRequest,
} from '@enterprise-platform/contracts-crm';

/**
 * Hàm thuần cho màn bảng giá và chính sách: đọc số kiểu Việt Nam, đọc dòng giá
 * dán từ bảng tính, mô tả tiêu chí. Không gọi API.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Số người dùng gõ hoặc dán: `1.000.000`, `1,000,000`, `1000000,5`,
 * `250000.5`. Rỗng hoặc sai trả `undefined`.
 */
export function parseNumber(text: string): number | undefined {
  const value = text.trim().replace(/\s|%/g, '');
  if (!value) return undefined;
  let normalized: string;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(value)) normalized = value.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) normalized = value.replace(/,/g, '');
  else normalized = value.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  return Number(normalized);
}

const money = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 });

export function formatMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : money.format(value);
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : `${percent.format(value)}%`;
}

/** `YYYY-MM-DD` thành `dd/mm/yyyy`. */
export function formatDate(value: string | null | undefined): string {
  return value ? value.split('-').reverse().join('/') : '';
}

export function validityLabel(from: string, to: string | null): string {
  return to ? `${formatDate(from)} – ${formatDate(to)}` : `Từ ${formatDate(from)}`;
}

export function priceListScopeLabel(list: Pick<PriceListSummary, 'isStandard' | 'customerGroups'>): string {
  if (list.isStandard) return 'Bảng giá chuẩn (mọi khách)';
  if (!list.customerGroups.length) return 'Chưa gán nhóm khách';
  return list.customerGroups.map((group) => group.name).join(', ');
}

export interface PastedItems {
  readonly items: SavePriceListItemRequest[];
  readonly errors: string[];
}

/**
 * Dòng giá dán từ bảng tính, mỗi dòng các cột cách nhau bằng Tab (hoặc `;`):
 * id mặt hàng, mã, tên, đơn vị tính, đơn giá, thuế suất (không bắt buộc, mặc
 * định 10). Dòng tiêu đề (cột đầu không phải id) được bỏ qua.
 */
export function parsePastedItems(text: string): PastedItems {
  const items: SavePriceListItemRequest[] = [];
  const errors: string[] = [];
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line, index) => {
      if (!line) return;
      const cells = line.split(line.includes('\t') ? '\t' : ';').map((cell) => cell.trim());
      const row = index + 1;
      if (!UUID_PATTERN.test(cells[0] ?? '')) {
        if (index === 0) return;
        errors.push(`Dòng ${row}: cột đầu phải là id mặt hàng.`);
        return;
      }
      const [materialId, materialCode, materialName, unit, priceText, vatText] = cells;
      const price = parseNumber(priceText ?? '');
      const vatRate = vatText ? parseNumber(vatText) : 10;
      if (!materialCode || !materialName || !unit) {
        errors.push(`Dòng ${row}: thiếu mã, tên hoặc đơn vị tính.`);
      } else if (price === undefined || price < 0) {
        errors.push(`Dòng ${row}: đơn giá không hợp lệ.`);
      } else if (vatRate === undefined || vatRate < 0 || vatRate > 100) {
        errors.push(`Dòng ${row}: thuế suất không hợp lệ.`);
      } else {
        items.push({ materialId: materialId.toLowerCase(), materialCode, materialName, unit, price, vatRate });
      }
    });
  return { items, errors };
}

/** Mô tả ngắn một tiêu chí cho bảng chính sách. */
export function ruleLabel(rule: DiscountPolicyRule): string {
  const label = DISCOUNT_CRITERION_LABELS[rule.criterion];
  switch (rule.criterion) {
    case 'QUANTITY': {
      const range = rule.maxQty === null || rule.maxQty === undefined ? `từ ${rule.minQty}` : `${rule.minQty}–${rule.maxQty}`;
      return `${range}: ${formatPercent(rule.percent)}`;
    }
    case 'PERIOD':
      return `${label} ${rule.toDate ? `${formatDate(rule.fromDate)} – ${formatDate(rule.toDate)}` : `từ ${formatDate(rule.fromDate)}`}`;
    case 'MATERIAL_CATEGORY':
      return `${label}: ${rule.refText ?? ''}`;
    default:
      return `${label}: ${rule.refText || rule.refId || ''}`;
  }
}

/** Phần trăm của chính sách: một con số, hoặc danh sách bậc. */
export function policyPercentLabel(policy: Pick<DiscountPolicy, 'percent' | 'rules'>): string {
  const tiers = policy.rules.filter((rule) => rule.criterion === 'QUANTITY');
  return tiers.length ? tiers.map(ruleLabel).join('; ') : formatPercent(policy.percent);
}

/** Tiêu chí ngoài bậc số lượng, nối bằng " và " (các chiều kết hợp AND). */
export function policyConditionLabel(policy: Pick<DiscountPolicy, 'appliesToAllCustomers' | 'rules'>): string {
  const conditions = policy.rules.filter((rule) => rule.criterion !== 'QUANTITY').map(ruleLabel);
  if (policy.appliesToAllCustomers) conditions.unshift('Mọi khách hàng');
  return conditions.join(' · ');
}

/**
 * Bảng tính giá để xuất Excel: một dòng tiêu đề, các dòng hàng, rồi phần tổng.
 * Số giữ dạng số (không định dạng chuỗi) để người dùng tính tiếp trong Excel.
 */
export function buildPricingSheet(result: PricingResult): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['Bảng tính giá'],
    ['Ngày tính giá', formatDate(result.date)],
    ['Trần tổng chiết khấu (%)', result.discountCapPercent],
    [],
    [
      'STT',
      'Mã hàng',
      'Tên hàng',
      'Đơn vị',
      'Số lượng',
      'Giá trước chiết khấu (giá gốc)',
      'Nguồn giá',
      'Chính sách đã áp',
      'Chiết khấu (%)',
      'Ghi chú',
      'Đơn giá sau chiết khấu',
      'Thành tiền',
      'Thuế suất VAT (%)',
      'Tiền VAT',
      'Cộng',
    ],
  ];
  for (const line of result.lines) {
    const notes = [line.cappedAt !== null ? 'Chạm trần' : '', line.overridden ? 'Ghi đè' : ''].filter(Boolean).join(', ');
    rows.push([
      line.index + 1,
      line.materialCode ?? '',
      line.materialName ?? '',
      line.unit,
      line.quantity,
      line.listPrice,
      `${PRICE_SOURCE_LABELS[line.priceSource]}${line.priceReferenceCode ? ` ${line.priceReferenceCode}` : ''}`,
      line.appliedPolicies.map((policy) => `${policy.code}: ${policy.percent}%`).join('; '),
      line.discountPercent,
      notes,
      line.unitPriceAfterDiscount,
      line.lineAmount,
      line.vatRate,
      line.vatAmount,
      line.lineTotal,
    ]);
  }
  const { totals } = result;
  rows.push([], ['Tiền hàng theo giá gốc', totals.grossAmount], ['Chiết khấu', totals.discountAmount], ['Tiền hàng sau chiết khấu', totals.netAmount]);
  if (result.shipping) rows.push([`Phí vận chuyển (VAT ${result.shipping.vatRate}%)`, result.shipping.amount]);
  rows.push(['Tiền thuế VAT', totals.vatAmount], ['Tổng cộng', totals.totalAmount]);
  return rows;
}
