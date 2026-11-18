import {
  DEFAULT_VAT_RATE,
  PRICE_LIST_ITEMS_BULK_MAX,
  PRICE_LIST_RATIO_DEFAULT,
  PRICE_LIST_RATIO_MAX,
  PRICE_LIST_RATIO_MIN,
  PRICING_STATUSES,
  type BulkPriceListItemsRequest,
  type PriceListDetail,
  type PriceListSummary,
  type PriceListType,
  type PricingStatus,
  type SavePriceListItemRequest,
  type SavePriceListRequest,
  type SetManualPriceRequest,
  type SetVatRateRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, optionalDate, optionalEnum, optionalText, requiredText } from '../domain/fields.js';
import { PRICE_LIST_PRICE_MAX } from '../domain/pricing-engine.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type {
  CatalogReader,
  PriceListItemRecord,
  PriceListRecord,
  PriceListRef,
  PriceListStore,
} from './pricing-store.port.js';

export { priceListRequired, requireSelectablePriceList } from './price-list-selection.js';

const PRICING_CODE_PATTERN = /^[A-Z0-9._-]+$/;
/** Đơn giá tối đa: đủ cho VND, vẫn chính xác khi tính bằng số thực. */
const PRICE_MAX = PRICE_LIST_PRICE_MAX;

/** Thao tác không áp cho loại bảng này (bảng mặc định chỉ sửa thuế suất; bảng theo tỷ lệ chỉ sửa giá tay, tỷ lệ). */
export function priceListReadOnly(listType: PriceListType): CrmConflictError {
  const message =
    listType === 'DEFAULT'
      ? 'Bảng giá mặc định lấy theo Kho, chỉ sửa được thuế suất.'
      : listType === 'DERIVED'
        ? 'Bảng giá theo tỷ lệ không thêm, xoá dòng hay sửa thuế suất; chỉ nhập hoặc bỏ giá tay.'
        : 'Bảng giá này không hỗ trợ thao tác đã chọn.';
  return new CrmConflictError('PRICE_LIST_READ_ONLY', message);
}

/**
 * Bảng giá (`docs/crm_price_list_logic/plan.md` 4.4). Ai có `crm.read` cũng đọc được (để chọn khi báo giá); tạo, sửa,
 * xoá cần quản trị bán hàng.
 *
 * - Bảng mặc định (`DEFAULT`): lấy theo Kho qua "Đồng bộ"; chỉ sửa thuế suất.
 * - Bảng theo tỷ lệ (`DERIVED`): bảng tạo mới luôn thuộc loại này; dòng theo tỷ lệ, từng dòng nhập hoặc bỏ giá tay.
 * - Bảng nhập tay (`MANUAL`): bảng cũ, giữ thêm, sửa, xoá, dán nhiều dòng.
 */
export class PriceListService {
  constructor(
    private readonly lists: PriceListStore,
    private readonly catalog: CatalogReader,
  ) {}

  list(actor: CrmActor): Promise<PriceListSummary[]> {
    return this.lists.listPriceLists(actor.tenantId);
  }

  get(actor: CrmActor, id: string): Promise<PriceListDetail> {
    return this.require(actor.tenantId, id);
  }

  /** Luôn tạo bảng theo tỷ lệ (bỏ qua `isStandard`, loại gửi lên); tỷ lệ rỗng là 100%. */
  async create(actor: CrmActor, request: SavePriceListRequest): Promise<PriceListDetail> {
    requireSalesManager(actor);
    const record = priceListRecord(request, PRICE_LIST_RATIO_DEFAULT);
    const id = await this.lists.createPriceList(actor.tenantId, record, actor.userId);
    return this.require(actor.tenantId, id);
  }

  /** Bảng mặc định không sửa được. Bảng theo tỷ lệ đổi tỷ lệ thì tính lại dòng theo tỷ lệ; tỷ lệ rỗng là giữ nguyên. */
  async update(actor: CrmActor, id: string, request: SavePriceListRequest): Promise<PriceListDetail> {
    requireSalesManager(actor);
    const ref = await this.requireRef(actor.tenantId, id);
    if (ref.listType === 'DEFAULT') throw priceListReadOnly(ref.listType);
    const record = priceListRecord(request, null);
    const updated = await this.lists.updatePriceList(actor.tenantId, ref.id, record, actor.userId);
    if (!updated) throw notFound();
    return this.require(actor.tenantId, ref.id);
  }

  async remove(actor: CrmActor, id: string): Promise<void> {
    requireSalesManager(actor);
    const ref = await this.requireRef(actor.tenantId, id);
    if (ref.listType === 'DEFAULT') throw priceListReadOnly(ref.listType);
    const deleted = await this.lists.deletePriceList(actor.tenantId, ref.id);
    if (!deleted) throw notFound();
  }

  /** Bảng theo tỷ lệ: nhập giá tay cho một dòng (dòng thành `MANUAL`). */
  async setManualPrice(
    actor: CrmActor,
    priceListId: string,
    itemId: string,
    request: SetManualPriceRequest,
  ): Promise<PriceListDetail> {
    requireSalesManager(actor);
    const ref = await this.requireType(actor.tenantId, priceListId, 'DERIVED');
    const price = boundedNumber(request?.price, 0, PRICE_MAX, 'đơn giá', 2);
    const saved = isUuid(itemId) && (await this.lists.setManualPrice(actor.tenantId, ref.id, itemId, price, actor.userId));
    if (!saved) throw itemNotFound();
    return this.require(actor.tenantId, ref.id);
  }

  /** Bảng theo tỷ lệ: bỏ giá tay, dòng về giá theo tỷ lệ hiện tại. */
  async clearManualPrice(actor: CrmActor, priceListId: string, itemId: string): Promise<PriceListDetail> {
    requireSalesManager(actor);
    const ref = await this.requireType(actor.tenantId, priceListId, 'DERIVED');
    const saved = isUuid(itemId) && (await this.lists.clearManualPrice(actor.tenantId, ref.id, itemId, actor.userId));
    if (!saved) throw itemNotFound();
    return this.require(actor.tenantId, ref.id);
  }

  /** Bảng mặc định: sửa thuế suất một dòng; bảng theo tỷ lệ nhận theo ngay. */
  async setVatRate(actor: CrmActor, priceListId: string, itemId: string, request: SetVatRateRequest): Promise<PriceListDetail> {
    requireSalesManager(actor);
    const ref = await this.requireType(actor.tenantId, priceListId, 'DEFAULT');
    const vatRate = boundedNumber(request?.vatRate, 0, 100, 'thuế suất', 2);
    const saved = isUuid(itemId) && (await this.lists.setVatRate(actor.tenantId, ref.id, itemId, vatRate, actor.userId));
    if (!saved) throw itemNotFound();
    return this.require(actor.tenantId, ref.id);
  }

  async addItem(actor: CrmActor, priceListId: string, request: SavePriceListItemRequest): Promise<PriceListDetail> {
    requireSalesManager(actor);
    await this.requireType(actor.tenantId, priceListId, 'MANUAL');
    const [record] = await this.itemRecords(actor.tenantId, [request]);
    const created = isUuid(priceListId) && (await this.lists.addItem(actor.tenantId, priceListId, record, actor.userId));
    if (!created) throw notFound();
    return this.require(actor.tenantId, priceListId);
  }

  async updateItem(
    actor: CrmActor,
    priceListId: string,
    itemId: string,
    request: SavePriceListItemRequest,
  ): Promise<PriceListDetail> {
    requireSalesManager(actor);
    await this.requireType(actor.tenantId, priceListId, 'MANUAL');
    const [record] = await this.itemRecords(actor.tenantId, [request]);
    const updated =
      isUuid(priceListId) &&
      isUuid(itemId) &&
      (await this.lists.updateItem(actor.tenantId, priceListId, itemId, record, actor.userId));
    if (!updated) throw itemNotFound();
    return this.require(actor.tenantId, priceListId);
  }

  async removeItem(actor: CrmActor, priceListId: string, itemId: string): Promise<PriceListDetail> {
    requireSalesManager(actor);
    await this.requireType(actor.tenantId, priceListId, 'MANUAL');
    const deleted =
      isUuid(priceListId) && isUuid(itemId) && (await this.lists.deleteItem(actor.tenantId, priceListId, itemId));
    if (!deleted) throw itemNotFound();
    return this.require(actor.tenantId, priceListId);
  }

  /** Dán nhiều dòng: thêm mới hoặc cập nhật dòng cùng mặt hàng và đơn vị. */
  async upsertItems(actor: CrmActor, priceListId: string, request: BulkPriceListItemsRequest): Promise<PriceListDetail> {
    requireSalesManager(actor);
    await this.requireType(actor.tenantId, priceListId, 'MANUAL');
    const items = Array.isArray(request?.items) ? request.items : [];
    if (!items.length) throw new CrmValidationError('REQUIRED', 'Vui lòng nhập ít nhất một dòng giá.');
    if (items.length > PRICE_LIST_ITEMS_BULK_MAX) {
      throw new CrmValidationError('TOO_MANY_ITEMS', `Mỗi lần nhập tối đa ${PRICE_LIST_ITEMS_BULK_MAX} dòng giá.`);
    }
    const records = await this.itemRecords(actor.tenantId, items);
    const seen = new Set<string>();
    records.forEach((record, index) => {
      const key = `${record.materialId}|${record.unit}`;
      if (seen.has(key)) {
        throw new CrmValidationError(
          'DUPLICATE_ITEM',
          `Dòng ${index + 1}: mặt hàng ${record.materialCode} (${record.unit}) bị nhập hai lần.`,
        );
      }
      seen.add(key);
    });
    const saved = isUuid(priceListId) && (await this.lists.upsertItems(actor.tenantId, priceListId, records, actor.userId));
    if (!saved) throw notFound();
    return this.require(actor.tenantId, priceListId);
  }

  /** Kiểm từng dòng; mặt hàng danh mục Kho biết thì mã, tên lấy theo danh mục. */
  private async itemRecords(tenantId: string, requests: readonly SavePriceListItemRequest[]): Promise<PriceListItemRecord[]> {
    const records = requests.map((request, index) => itemRecord(request ?? ({} as never), requests.length > 1 ? index : undefined));
    const known = await this.catalog.materials(tenantId, [...new Set(records.map((record) => record.materialId))]);
    return records.map((record) => {
      const material = known.get(record.materialId);
      return material ? { ...record, materialCode: material.code, materialName: material.name } : record;
    });
  }

  private async requireRef(tenantId: string, id: string): Promise<PriceListRef> {
    const ref = isUuid(id) ? await this.lists.priceListRef(tenantId, id.toLowerCase()) : undefined;
    if (!ref) throw notFound();
    return ref;
  }

  /** Bảng phải đúng loại `listType`; loại khác thì `PRICE_LIST_READ_ONLY`. */
  private async requireType(tenantId: string, id: string, listType: PriceListType): Promise<PriceListRef> {
    const ref = await this.requireRef(tenantId, id);
    if (ref.listType !== listType) throw priceListReadOnly(ref.listType);
    return ref;
  }

  private async require(tenantId: string, id: string): Promise<PriceListDetail> {
    const list = isUuid(id) ? await this.lists.getPriceList(tenantId, id) : undefined;
    if (!list) throw notFound();
    return list;
  }
}

function notFound(): CrmNotFoundError {
  return new CrmNotFoundError('Không tìm thấy bảng giá.');
}

function itemNotFound(): CrmNotFoundError {
  return new CrmNotFoundError('Không tìm thấy dòng giá.');
}

/** Mã bảng giá, chính sách: chữ in hoa không dấu, số, `.`, `-`, `_`. */
export function pricingCode(value: unknown, label: string): string {
  const code = requiredText(value, 50, label).toUpperCase();
  if (!PRICING_CODE_PATTERN.test(code)) {
    throw new CrmValidationError(
      'INVALID_CODE',
      `${label.charAt(0).toUpperCase()}${label.slice(1)} chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang, gạch dưới.`,
    );
  }
  return code;
}

/** Hiệu lực từ–đến: từ ngày bắt buộc, đến ngày rỗng là không hết hạn. */
export function validityRange(validFrom: unknown, validTo: unknown): { validFrom: string; validTo: string | null } {
  const from = optionalDate(validFrom, 'ngày bắt đầu hiệu lực');
  if (!from) throw new CrmValidationError('REQUIRED', 'Vui lòng nhập ngày bắt đầu hiệu lực.');
  const to = optionalDate(validTo, 'ngày hết hiệu lực');
  if (to && to < from) {
    throw new CrmValidationError('INVALID_VALIDITY', 'Ngày hết hiệu lực phải sau hoặc bằng ngày bắt đầu.');
  }
  return { validFrom: from, validTo: to };
}

export function pricingStatus(value: unknown): PricingStatus {
  return optionalEnum(value, PRICING_STATUSES, 'trạng thái') ?? 'ACTIVE';
}

/**
 * Tỷ lệ giá so với bảng mặc định (%): từ 0,01 đến 1000, tối đa 2 chữ số thập phân. Rỗng thì `fallback` (100 khi tạo,
 * `null` là giữ nguyên khi sửa).
 */
export function ratioPercent(value: unknown, fallback: number | null): number | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return fallback;
  return boundedNumber(value, PRICE_LIST_RATIO_MIN, PRICE_LIST_RATIO_MAX, 'tỷ lệ giá so với bảng mặc định', 2);
}

/** `isStandard`, loại bảng gửi lên bị bỏ qua: bảng mới luôn theo tỷ lệ. */
export function priceListRecord(request: SavePriceListRequest, ratioFallback: number | null = PRICE_LIST_RATIO_DEFAULT): PriceListRecord {
  return {
    code: pricingCode(request?.code, 'mã bảng giá'),
    name: requiredText(request?.name, 200, 'tên bảng giá'),
    ratioPercent: ratioPercent(request?.ratioPercent, ratioFallback),
    ...validityRange(request?.validFrom, request?.validTo),
    status: pricingStatus(request?.status),
    note: optionalText(request?.note, 1000, 'ghi chú'),
  };
}

/** Số không âm trong khoảng; `label` cho lời báo lỗi. */
export function boundedNumber(value: unknown, min: number, max: number, label: string, decimals: number): number {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) {
    throw new CrmValidationError('INVALID_NUMBER', `${label.charAt(0).toUpperCase()}${label.slice(1)} phải là số từ ${min} đến ${max}.`);
  }
  if (Math.abs(Number(number.toFixed(decimals)) - number) > 1e-9) {
    throw new CrmValidationError('INVALID_NUMBER', `${label.charAt(0).toUpperCase()}${label.slice(1)} tối đa ${decimals} chữ số thập phân.`);
  }
  return number;
}

export function itemRecord(request: SavePriceListItemRequest, index?: number): PriceListItemRecord {
  const prefix = index === undefined ? '' : `Dòng ${index + 1}: `;
  try {
    if (!isUuid(request.materialId)) throw new CrmValidationError('INVALID_REFERENCE', 'Mã định danh mặt hàng không hợp lệ.');
    return {
      materialId: request.materialId.toLowerCase(),
      materialCode: requiredText(request.materialCode, 100, 'mã mặt hàng'),
      materialName: requiredText(request.materialName, 300, 'tên mặt hàng'),
      unit: requiredText(request.unit, 50, 'đơn vị tính'),
      price: boundedNumber(request.price, 0, PRICE_MAX, 'đơn giá', 2),
      vatRate:
        request.vatRate === undefined || request.vatRate === null
          ? DEFAULT_VAT_RATE
          : boundedNumber(request.vatRate, 0, 100, 'thuế suất', 2),
    };
  } catch (error) {
    if (prefix && error instanceof CrmValidationError) {
      throw new CrmValidationError(error.code, `${prefix}${error.message}`, { line: (index ?? 0) + 1 });
    }
    throw error;
  }
}
