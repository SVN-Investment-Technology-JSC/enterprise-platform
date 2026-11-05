import {
  DEFAULT_VAT_RATE,
  PRICE_LIST_ITEMS_BULK_MAX,
  PRICING_STATUSES,
  type BulkPriceListItemsRequest,
  type PriceListDetail,
  type PriceListSummary,
  type PricingStatus,
  type SavePriceListItemRequest,
  type SavePriceListRequest,
} from '@enterprise-platform/contracts-crm';
import { CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, optionalDate, optionalEnum, optionalText, requiredText } from '../domain/fields.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CatalogReader, PriceListItemRecord, PriceListRecord, PriceListStore } from './pricing-store.port.js';

const PRICING_CODE_PATTERN = /^[A-Z0-9._-]+$/;
/** Đơn giá tối đa: đủ cho VND, vẫn chính xác khi tính bằng số thực. */
const PRICE_MAX = 1e13;

/**
 * Bảng giá (PRC-01). Ai có `crm.read` cũng đọc được (để lập báo giá); tạo,
 * sửa, xoá, gán nhóm cần `crm.manage`.
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

  async create(actor: CrmActor, request: SavePriceListRequest): Promise<PriceListDetail> {
    requireSalesManager(actor);
    const record = priceListRecord(request);
    const groups = groupIds(request.customerGroupIds, record.isStandard) ?? [];
    const id = await this.lists.createPriceList(actor.tenantId, record, groups, actor.userId);
    return this.require(actor.tenantId, id);
  }

  async update(actor: CrmActor, id: string, request: SavePriceListRequest): Promise<PriceListDetail> {
    requireSalesManager(actor);
    const record = priceListRecord(request);
    const groups = groupIds(request.customerGroupIds, record.isStandard);
    const updated = isUuid(id) && (await this.lists.updatePriceList(actor.tenantId, id, record, groups, actor.userId));
    if (!updated) throw notFound();
    return this.require(actor.tenantId, id);
  }

  /** Gán lại nhóm khách; giữ nguyên phần đầu bảng giá. */
  async assignGroups(actor: CrmActor, id: string, customerGroupIds: unknown): Promise<PriceListDetail> {
    requireSalesManager(actor);
    const current = await this.require(actor.tenantId, id);
    const groups = groupIds(customerGroupIds ?? [], current.isStandard) ?? [];
    await this.lists.updatePriceList(actor.tenantId, id, recordOf(current), groups, actor.userId);
    return this.require(actor.tenantId, id);
  }

  async remove(actor: CrmActor, id: string): Promise<void> {
    requireSalesManager(actor);
    const deleted = isUuid(id) && (await this.lists.deletePriceList(actor.tenantId, id));
    if (!deleted) throw notFound();
  }

  async addItem(actor: CrmActor, priceListId: string, request: SavePriceListItemRequest): Promise<PriceListDetail> {
    requireSalesManager(actor);
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
    const [record] = await this.itemRecords(actor.tenantId, [request]);
    const updated =
      isUuid(priceListId) &&
      isUuid(itemId) &&
      (await this.lists.updateItem(actor.tenantId, priceListId, itemId, record, actor.userId));
    if (!updated) throw new CrmNotFoundError('Không tìm thấy dòng giá.');
    return this.require(actor.tenantId, priceListId);
  }

  async removeItem(actor: CrmActor, priceListId: string, itemId: string): Promise<PriceListDetail> {
    requireSalesManager(actor);
    const deleted =
      isUuid(priceListId) && isUuid(itemId) && (await this.lists.deleteItem(actor.tenantId, priceListId, itemId));
    if (!deleted) throw new CrmNotFoundError('Không tìm thấy dòng giá.');
    return this.require(actor.tenantId, priceListId);
  }

  /** Dán nhiều dòng: thêm mới hoặc cập nhật dòng cùng mặt hàng và đơn vị. */
  async upsertItems(actor: CrmActor, priceListId: string, request: BulkPriceListItemsRequest): Promise<PriceListDetail> {
    requireSalesManager(actor);
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

  private async require(tenantId: string, id: string): Promise<PriceListDetail> {
    const list = isUuid(id) ? await this.lists.getPriceList(tenantId, id) : undefined;
    if (!list) throw notFound();
    return list;
  }
}

function notFound(): CrmNotFoundError {
  return new CrmNotFoundError('Không tìm thấy bảng giá.');
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

export function priceListRecord(request: SavePriceListRequest): PriceListRecord {
  if (request?.isStandard !== undefined && typeof request.isStandard !== 'boolean') {
    throw new CrmValidationError('INVALID', 'Loại bảng giá không hợp lệ.');
  }
  return {
    code: pricingCode(request?.code, 'mã bảng giá'),
    name: requiredText(request?.name, 200, 'tên bảng giá'),
    isStandard: request?.isStandard === true,
    ...validityRange(request?.validFrom, request?.validTo),
    status: pricingStatus(request?.status),
    note: optionalText(request?.note, 1000, 'ghi chú'),
  };
}

/** Nhóm gán cho bảng giá; bảng chuẩn áp cho mọi khách nên không gán nhóm. */
function groupIds(value: unknown, isStandard: boolean): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((id) => !isUuid(id))) {
    throw new CrmValidationError('INVALID_REFERENCE', 'Nhóm khách hàng không hợp lệ.');
  }
  const ids = [...new Set(value.map((id: string) => id.toLowerCase()))];
  if (isStandard && ids.length) {
    throw new CrmValidationError('STANDARD_LIST_GROUPS', 'Bảng giá chuẩn áp cho mọi khách, không gán nhóm khách hàng.');
  }
  return ids;
}

function recordOf(list: PriceListDetail): PriceListRecord {
  return {
    code: list.code,
    name: list.name,
    isStandard: list.isStandard,
    validFrom: list.validFrom,
    validTo: list.validTo,
    status: list.status,
    note: list.note,
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
