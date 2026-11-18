import {
  DISCOUNT_CRITERION_LABELS,
  PRICE_LIST_RATIO_MAX,
  PRICE_LIST_RATIO_MIN,
  PRICE_LIST_TYPE_LABELS,
  PRICE_SOURCE_LABELS,
  PRICING_STATUS_LABELS,
  type DiscountPolicy,
  type DiscountPolicyRule,
  type PriceListSummary,
  type PriceListSyncResult,
  type PricingResult,
  type PricingStatus,
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

/** Cột "Loại": Mặc định, Theo tỷ lệ (kèm tỷ lệ), Tự nhập. */
export function priceListTypeLabel(list: Pick<PriceListSummary, 'listType' | 'ratioPercent'>): string {
  const label = PRICE_LIST_TYPE_LABELS[list.listType];
  return list.listType === 'DERIVED' && list.ratioPercent !== null ? `${label} (${formatPercent(list.ratioPercent)})` : label;
}

const TYPE_ORDER: Readonly<Record<PriceListSummary['listType'], number>> = { DEFAULT: 0, DERIVED: 1, MANUAL: 1 };

/** Bảng mặc định đứng đầu; các bảng khác giữ thứ tự server trả. */
export function sortPriceLists<T extends Pick<PriceListSummary, 'listType'>>(lists: readonly T[]): T[] {
  return lists
    .map((list, index) => ({ list, index }))
    .sort((left, right) => TYPE_ORDER[left.list.listType] - TYPE_ORDER[right.list.listType] || left.index - right.index)
    .map((entry) => entry.list);
}

/** Đơn giá một dòng: rỗng là "Chưa nhập giá ở Kho" (khác 0 đồng). */
export const MISSING_PRICE_TEXT = 'Chưa nhập giá ở Kho';
export function priceText(price: number | null | undefined): string {
  return price === null || price === undefined ? MISSING_PRICE_TEXT : `${formatMoney(price)} đ`;
}

/** Số có tối đa 2 chữ số thập phân. */
function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

export type ParsedNumber = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly error: string };

/** Tỷ lệ giá so với bảng mặc định (%): 0,01 đến 1000, tối đa 2 chữ số thập phân; nhận dấu phẩy thập phân. */
export function parseRatioPercent(text: string): ParsedNumber {
  const value = parseNumber(text);
  if (value === undefined) return { ok: false, error: 'Tỷ lệ phải là số, ví dụ 105 hoặc 105,5.' };
  if (value < PRICE_LIST_RATIO_MIN || value > PRICE_LIST_RATIO_MAX) {
    return { ok: false, error: `Tỷ lệ phải từ ${formatPercent(PRICE_LIST_RATIO_MIN)} đến ${formatPercent(PRICE_LIST_RATIO_MAX)}.` };
  }
  if (!hasAtMostTwoDecimals(value)) return { ok: false, error: 'Tỷ lệ chỉ được tối đa 2 chữ số thập phân.' };
  return { ok: true, value };
}

/** Thuế suất (%): 0 đến 100, tối đa 2 chữ số thập phân; nhận dấu phẩy thập phân. */
export function parseVatRate(text: string): ParsedNumber {
  const value = parseNumber(text);
  if (value === undefined) return { ok: false, error: 'Thuế suất phải là số, ví dụ 8 hoặc 8,5.' };
  if (value < 0 || value > 100) return { ok: false, error: 'Thuế suất phải từ 0 đến 100.' };
  if (!hasAtMostTwoDecimals(value)) return { ok: false, error: 'Thuế suất chỉ được tối đa 2 chữ số thập phân.' };
  return { ok: true, value };
}

/** Đơn giá nhập tay: số không âm, tối đa 2 chữ số thập phân. */
export function parseUnitPrice(text: string): ParsedNumber {
  const value = parseNumber(text);
  if (value === undefined || value < 0) return { ok: false, error: 'Đơn giá phải là số không âm.' };
  if (!hasAtMostTwoDecimals(value)) return { ok: false, error: 'Đơn giá chỉ được tối đa 2 chữ số thập phân.' };
  return { ok: true, value };
}

/** Bảng đang bật và còn hiệu lực tại ngày `YYYY-MM-DD` (trọn ngày). */
export function isPriceListEffective(list: Pick<PriceListSummary, 'status' | 'validFrom' | 'validTo'>, date: string): boolean {
  return list.status === 'ACTIVE' && list.validFrom <= date && (!list.validTo || list.validTo >= date);
}

/** Tên bảng giá để hiện dạng chữ; bảng đã tắt thì thêm " (Ngừng áp dụng)". */
export function priceListDisplayName(name: string | null | undefined, status: PricingStatus | null | undefined): string {
  if (!name) return '';
  return status === 'INACTIVE' ? `${name} (${PRICING_STATUS_LABELS.INACTIVE})` : name;
}

/** Câu báo kết quả đồng bộ bảng giá mặc định với Kho. */
export function syncResultMessage(result: PriceListSyncResult): string {
  const parts = [`thêm ${result.added}`, `cập nhật ${result.updated}`, `bỏ ${result.removed} dòng`];
  let message = `Đã đồng bộ bảng giá mặc định: ${parts.join(', ')}.`;
  if (result.skippedWithoutUnit) message += ` Bỏ qua ${result.skippedWithoutUnit} mặt hàng chưa có đơn vị tính ở Kho.`;
  if (result.derivedListsUpdated) message += ` Đã tính lại ${result.derivedListsUpdated} bảng giá theo tỷ lệ.`;
  if (result.manualPricesRemoved) message += ` Bỏ ${result.manualPricesRemoved} giá tay của mặt hàng không còn ở Kho.`;
  return message;
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

/** Một mặt hàng đã chọn từ danh mục Kho trong hộp "Thêm dòng giá", kèm giá và thuế người dùng gõ. */
export interface PriceRowDraft {
  readonly material: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly unit: string | null;
    /** Giá bán khai ở Kho (cột Giá của màn Hàng hóa), chỉ để tham khảo. */
    readonly salePrice?: number | null;
    /** Giá vốn bình quân của Kho, chỉ để tham khảo khi định giá. */
    readonly avgCost?: number | null;
    /** Nhóm ở Kho (STOCK hàng hoá, SERVICE dịch vụ) và phân loại, chỉ để hiện. */
    readonly kind?: string | null;
    readonly tradeCategory?: string | null;
  };
  /** Đơn vị tính: lấy theo Kho; chỉ gõ tay khi danh mục Kho chưa có đơn vị. */
  readonly unit: string;
  readonly price: string;
  readonly vat: string;
}

export function newPriceRow(material: PriceRowDraft['material']): PriceRowDraft {
  // Đơn giá điền sẵn giá bán đề xuất của Kho (nếu có), người dùng sửa được. Thuế suất để trống, bắt buộc nhập:
  // Kho không có thuế suất và mỗi mặt hàng có thể chịu mức khác nhau (0, 5, 8, 10...).
  const suggested = material.salePrice;
  return { material, unit: material.unit?.trim() ?? '', price: suggested == null ? '' : String(suggested), vat: '' };
}

export type BuiltPriceItems =
  | { readonly ok: true; readonly items: SavePriceListItemRequest[] }
  | { readonly ok: false; readonly error: string; readonly invalidIds: readonly string[] };

/**
 * Kiểm các dòng đã chọn và dựng yêu cầu lưu. Id, mã, tên lấy từ danh mục Kho nên người dùng không gõ;
 * đơn giá và thuế suất là số không âm, cho phép số thập phân; thuế suất tối đa 100.
 */
export function buildPriceListItems(rows: readonly PriceRowDraft[]): BuiltPriceItems {
  if (!rows.length) return { ok: false, error: 'Vui lòng chọn ít nhất một mặt hàng.', invalidIds: [] };
  const items: SavePriceListItemRequest[] = [];
  const invalid = new Set<string>();
  let error = '';
  const fail = (id: string, message: string) => {
    invalid.add(id);
    error ||= message;
  };
  for (const row of rows) {
    const code = row.material.code;
    const unit = row.unit.trim();
    const price = parseNumber(row.price);
    const vatRate = parseNumber(row.vat);
    if (!unit) fail(row.material.id, `${code}: vui lòng nhập đơn vị tính.`);
    else if (price === undefined || price < 0) fail(row.material.id, `${code}: đơn giá phải là số không âm.`);
    else if (vatRate === undefined || vatRate < 0 || vatRate > 100) fail(row.material.id, `${code}: thuế suất phải là số từ 0 đến 100.`);
    else items.push({ materialId: row.material.id, materialCode: row.material.code, materialName: row.material.name, unit, price, vatRate });
  }
  return invalid.size ? { ok: false, error, invalidIds: [...invalid] } : { ok: true, items };
}
