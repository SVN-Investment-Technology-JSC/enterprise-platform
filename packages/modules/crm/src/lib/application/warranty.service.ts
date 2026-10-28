import {
  WARRANTY_CAUSES,
  WARRANTY_INSPECTION_RESULTS,
  WARRANTY_LINES_MAX,
  WARRANTY_STATUSES,
  type CreateWarrantyCaseRequest,
  type CrmPage,
  type InspectWarrantyLineRequest,
  type WarrantyActionRequest,
  type WarrantyCaseDetail,
  type WarrantyCaseListQuery,
  type WarrantyCaseSummary,
  type WarrantyCoverage,
  type WarrantyLookupItem,
  type WarrantyLookupQuery,
  type WarrantySerialHistory,
  type WarrantySettings,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmError, CrmForbiddenError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, normalizeSearch, optionalEnum, optionalId, optionalText, requiredText, requiredVersion } from '../domain/fields.js';
import { decodeCursor, pageLimit } from '../domain/pagination.js';
import { receiveIdempotencyKey, requireWarrantyWarehouse } from '../domain/warranty-case.js';
import { computeWarranty, vietnamDate } from '../domain/warranty-period.js';
import { requireSalesManager } from './crm-access.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScope, CrmDataScopeService } from './data-scope.js';
import { vietnamToday } from './pricing.service.js';
import type { CatalogReader } from './pricing-store.port.js';
import {
  CRM_WARRANTY_SOURCE_TYPE,
  type DeliveredItemRecord,
  type NewWarrantyLineRecord,
  type WarrantyInventory,
  type WarrantyStore,
} from './warranty.port.js';

const CASE_NOT_FOUND = 'Không tìm thấy yêu cầu bảo hành.';
const SERIAL_MAX = 100;
const QUANTITY_MAX = 999_999_999;
const LOOKUP_LIMIT = 200;
const WAREHOUSE_CODE_MAX = 50;

/** Ghi bảo hành: `crm.warranty.write` (kỹ thuật, CSKH). */
export function requireWarrantyWriter(actor: CrmActor): void {
  if (!actor.canWriteWarranty) throw new CrmForbiddenError('Bạn không có quyền xử lý bảo hành, đổi trả.');
}

/** Số serial: bỏ khoảng trắng hai đầu, không rỗng, tối đa 100 ký tự. */
export function normalizeSerial(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new CrmValidationError('SERIAL_REQUIRED', 'Vui lòng nhập số serial.');
  if (text.length > SERIAL_MAX) throw new CrmValidationError('TOO_LONG', `Số serial tối đa ${SERIAL_MAX} ký tự.`);
  return text;
}

/**
 * Tiếp nhận, tra cứu hạn bảo hành, nhận hàng về kho cách ly, kiểm định, đóng
 * yêu cầu (T6-02, T6-03, T6-04, T6-07). Hướng xử lý và chứng từ ở
 * `WarrantyResolutionService`.
 *
 * - Xem: `crm.read` trong phạm vi dữ liệu (người phụ trách đơn hoặc người xử
 *   lý yêu cầu); kỹ thuật, CSKH có `crm.read.all`. Ngoài phạm vi trả 404.
 * - Ghi: `crm.warranty.write`. Cấu hình kho cách ly, kho lỗi: `crm.manage`.
 * - Hạn bảo hành: ngày giao thực tế của serial (đợt giao đã xuất; không có thì
 *   ngày xuất ở Kho) cộng thời hạn hợp đồng nếu có, không thì thời hạn mặt
 *   hàng; serial thay thế kế thừa hạn của serial cũ (Q9). Hết hạn vẫn tiếp
 *   nhận, dòng đánh dấu có phí.
 */
export class WarrantyService {
  constructor(
    private readonly store: WarrantyStore,
    private readonly inventory: WarrantyInventory,
    private readonly catalog: CatalogReader,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(): string {
    return vietnamToday(this.now());
  }

  // -------------------------------------------------------------------------
  // Tra cứu
  // -------------------------------------------------------------------------

  /** Tra theo serial, theo đơn hoặc theo khách (TC-WAR-01). Serial không có trong phạm vi trả 404. */
  async lookup(actor: CrmActor, query: WarrantyLookupQuery): Promise<WarrantyLookupItem[]> {
    const scope = await this.scopes.resolve(actor);
    const serial = query?.serial !== undefined && query.serial !== '' ? normalizeSerial(query.serial) : null;
    const orderId = optionalId(query?.orderId, 'đơn bán');
    const customerId = optionalId(query?.customerId, 'khách hàng');
    if (!serial && !orderId && !customerId) {
      throw new CrmValidationError('LOOKUP_REQUIRED', 'Vui lòng nhập serial, chọn đơn hoặc khách hàng để tra cứu.');
    }
    if (serial) {
      const record = await this.findSerial(actor.tenantId, scope, serial);
      if (!record) throw new CrmNotFoundError(`Không tìm thấy serial ${serial} trong các đơn đã giao.`);
      return this.toLookupItems(actor.tenantId, [record]);
    }
    const records = await this.store.deliveredItems(
      actor.tenantId,
      scope,
      { orderId: orderId ?? undefined, customerId: customerId ?? undefined },
      LOOKUP_LIMIT,
    );
    return this.toLookupItems(actor.tenantId, records);
  }

  /** Lịch sử serial: bước kho (Kho trả) và các yêu cầu bảo hành có serial đó (T6-07). */
  async serialHistory(actor: CrmActor, rawSerial: string): Promise<WarrantySerialHistory> {
    const serial = normalizeSerial(rawSerial);
    const scope = await this.scopes.resolve(actor);
    const record = await this.findSerial(actor.tenantId, scope, serial).catch((error) => {
      if (error instanceof CrmError && error.statusCode === 503) return undefined;
      throw error;
    });
    const cases = await this.store.serialCases(actor.tenantId, scope, serial);
    if (!record && !cases.length) throw new CrmNotFoundError(`Không tìm thấy serial ${serial} trong các đơn đã giao.`);
    let inventoryAvailable = true;
    let movements: WarrantySerialHistory['movements'] = [];
    try {
      movements = (await this.inventory.serial(actor.tenantId, serial))?.movements ?? [];
    } catch (error) {
      if (!(error instanceof CrmError) || error.statusCode !== 503) throw error;
      inventoryAvailable = false;
    }
    const lookup = record ? (await this.toLookupItems(actor.tenantId, [record]).catch(() => []))[0] ?? null : null;
    return { serial, lookup, movements, inventoryAvailable, cases };
  }

  /**
   * Bản ghi giao gần nhất của serial: đợt giao đã xuất hoặc dòng bảo hành đã
   * xuất thay thế. Bán hàng chưa ghi serial (dữ liệu cũ) thì hỏi Kho lần xuất
   * gần nhất, rồi tìm đợt giao theo chứng từ nguồn.
   */
  private async findSerial(tenantId: string, scope: CrmDataScope, serial: string): Promise<DeliveredItemRecord | undefined> {
    const found = (await this.store.serialDeliveries(tenantId, scope, serial))[0];
    if (found?.deliveredAt || found?.replacementOf) return found;
    const info = await this.inventory.serial(tenantId, serial);
    const issuedAt = info?.lastIssue?.issuedAt ?? null;
    if (found) return { ...found, deliveredAt: issuedAt };
    const lastIssue = info?.lastIssue;
    if (!info || lastIssue?.sourceType !== 'crm_delivery' || !isUuid(lastIssue.sourceId)) return undefined;
    const item = await this.store.deliveryItem(tenantId, scope, lastIssue.sourceId, info.materialId, info.serial);
    return item ? { ...item, deliveredAt: item.deliveredAt ?? issuedAt } : undefined;
  }

  private async toLookupItems(tenantId: string, records: readonly DeliveredItemRecord[]): Promise<WarrantyLookupItem[]> {
    if (!records.length) return [];
    const needMaterials = records.filter((record) => !record.replacementOf).map((record) => record.materialId);
    const materials = needMaterials.length ? await this.catalog.materials(tenantId, needMaterials) : new Map();
    const open = await this.store.openCasesBySerial(
      tenantId,
      records.flatMap((record) => (record.serial ? [record.serial] : [])),
    );
    const today = this.today();
    return records.map((record) => ({
      serial: record.serial,
      materialId: record.materialId,
      materialCode: record.materialCode,
      materialName: record.materialName,
      unit: record.unit,
      quantity: record.quantity,
      customerId: record.customerId,
      customerCode: record.customerCode,
      customerName: record.customerName,
      orderId: record.orderId,
      orderCode: record.orderCode,
      orderLineId: record.orderLineId,
      contractId: record.contractId,
      contractCode: record.contractCode,
      deliveryCode: record.deliveryCode,
      warehouseCode: record.warehouseCode,
      coverage: this.coverageOf(record, materials.get(record.materialId)?.warrantyMonths ?? null, today),
      replacementOf: record.replacementOf
        ? { caseId: record.replacementOf.caseId, caseCode: record.replacementOf.caseCode, serial: record.replacementOf.serial }
        : null,
      openCaseId: record.serial ? (open.get(record.serial.toUpperCase()) ?? null) : null,
    }));
  }

  private coverageOf(record: DeliveredItemRecord, materialMonths: number | null, today: string): WarrantyCoverage {
    return computeWarranty({
      deliveredOn: vietnamDate(record.deliveredAt),
      contractMonths: record.contractWarrantyMonths,
      materialMonths,
      inheritedUntil: record.replacementOf?.warrantyUntil ?? null,
      today,
    });
  }

  // -------------------------------------------------------------------------
  // Yêu cầu bảo hành
  // -------------------------------------------------------------------------

  async list(actor: CrmActor, query: WarrantyCaseListQuery): Promise<CrmPage<WarrantyCaseSummary>> {
    const scope = await this.scopes.resolve(actor);
    return this.store.listCases(actor.tenantId, scope, {
      q: normalizeSearch(query?.q),
      status: optionalEnum(query?.status, WARRANTY_STATUSES, 'trạng thái'),
      customerId: optionalId(query?.customerId, 'khách hàng') ?? undefined,
      serial: query?.serial ? normalizeSerial(query.serial) : undefined,
      cursor: decodeCursor(query?.cursor),
      limit: pageLimit(query?.limit),
    });
  }

  async get(actor: CrmActor, id: string): Promise<WarrantyCaseDetail> {
    if (!isUuid(id)) throw new CrmNotFoundError(CASE_NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    const detail = await this.store.getCase(actor.tenantId, scope, id);
    if (!detail) throw new CrmNotFoundError(CASE_NOT_FOUND);
    return detail;
  }

  /**
   * Tiếp nhận (T6-02, T6-03): nguyên nhân bắt buộc (TC-WAR-06); mỗi dòng một
   * serial đã giao, hoặc một số lượng của dòng đơn không theo serial; các dòng
   * cùng một khách. Serial đang có yêu cầu mở thì 409. Hạn bảo hành chụp vào
   * dòng; dòng hết hạn là loại có phí (TC-WAR-05).
   */
  async create(actor: CrmActor, request: CreateWarrantyCaseRequest): Promise<WarrantyCaseDetail> {
    requireWarrantyWriter(actor);
    const cause = optionalEnum(request?.cause, WARRANTY_CAUSES, 'nguyên nhân');
    if (!cause) throw new CrmValidationError('CAUSE_REQUIRED', 'Vui lòng chọn nguyên nhân bảo hành, đổi trả.');
    const description = optionalText(request?.description, 4000, 'mô tả');
    const assigneeUserId = optionalId(request?.assigneeUserId, 'người xử lý') ?? actor.userId;
    const rawLines = Array.isArray(request?.lines) ? request.lines : [];
    if (!rawLines.length) throw new CrmValidationError('LINES_REQUIRED', 'Vui lòng thêm ít nhất một serial hoặc dòng hàng.');
    if (rawLines.length > WARRANTY_LINES_MAX) {
      throw new CrmValidationError('TOO_MANY_LINES', `Một yêu cầu có tối đa ${WARRANTY_LINES_MAX} dòng.`);
    }
    const scope = await this.scopes.resolve(actor);
    const seenSerials = new Set<string>();
    const seenOrderLines = new Set<string>();
    const records: { record: DeliveredItemRecord; quantity: number }[] = [];
    for (const [index, raw] of rawLines.entries()) {
      const label = `Dòng ${index + 1}`;
      if (raw?.serial !== undefined && raw?.serial !== null && raw.serial !== '') {
        const serial = normalizeSerial(raw.serial);
        const key = serial.toUpperCase();
        if (seenSerials.has(key)) throw new CrmValidationError('DUPLICATE_SERIAL', `${label}: serial ${serial} bị nhập trùng.`);
        seenSerials.add(key);
        const record = await this.findSerial(actor.tenantId, scope, serial);
        if (!record) throw new CrmNotFoundError(`${label}: không tìm thấy serial ${serial} trong các đơn đã giao.`);
        records.push({ record, quantity: 1 });
        continue;
      }
      const orderLineId = optionalId(raw?.orderLineId, 'dòng đơn');
      if (!orderLineId) throw new CrmValidationError('LINE_REQUIRED', `${label}: nhập serial hoặc chọn dòng đơn đã giao.`);
      if (seenOrderLines.has(orderLineId)) throw new CrmValidationError('DUPLICATE_LINE', `${label}: dòng đơn bị chọn trùng.`);
      seenOrderLines.add(orderLineId);
      const quantity = Number(raw?.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > QUANTITY_MAX) {
        throw new CrmValidationError('INVALID_QUANTITY', `${label}: số lượng phải lớn hơn 0.`);
      }
      const record = await this.store.orderLineDelivery(actor.tenantId, scope, orderLineId);
      if (!record) throw new CrmNotFoundError(`${label}: không tìm thấy dòng đơn đã giao.`);
      if (quantity > record.quantity) {
        throw new CrmValidationError('QUANTITY_EXCEEDS_DELIVERED', `${label}: số lượng vượt số đã giao (${record.quantity}).`);
      }
      records.push({ record, quantity });
    }
    const customerId = records[0].record.customerId;
    if (records.some(({ record }) => record.customerId !== customerId)) {
      throw new CrmValidationError('CUSTOMER_MISMATCH', 'Các dòng của một yêu cầu phải cùng một khách hàng.');
    }
    const open = await this.store.openCasesBySerial(actor.tenantId, [...seenSerials]);
    if (open.size) {
      throw new CrmConflictError('SERIAL_HAS_OPEN_CASE', `Serial ${[...open.keys()].join(', ')} đang có yêu cầu bảo hành chưa đóng.`);
    }
    const materials = await this.catalog.materials(
      actor.tenantId,
      records.filter(({ record }) => !record.replacementOf).map(({ record }) => record.materialId),
    );
    const today = this.today();
    const lines: NewWarrantyLineRecord[] = records.map(({ record, quantity }) => ({
      serial: record.serial,
      materialId: record.materialId,
      materialCode: record.materialCode,
      materialName: record.materialName,
      unit: record.unit,
      quantity,
      orderId: record.orderId,
      orderLineId: record.orderLineId,
      deliveryWarehouseCode: record.warehouseCode,
      coverage: this.coverageOf(record, materials.get(record.materialId)?.warrantyMonths ?? null, today),
    }));
    const orders = new Set(records.map(({ record }) => record.orderId));
    const single = orders.size === 1 ? records[0].record : null;
    const id = await this.store.createCase(
      actor.tenantId,
      {
        customerId,
        orderId: single?.orderId ?? null,
        contractId: single?.contractId ?? null,
        cause,
        description,
        ownerUserId: records[0].record.ownerUserId,
        assigneeUserId,
        lines,
      },
      actor.userId,
    );
    return this.get(actor, id);
  }

  /** Tiếp nhận → Từ chối: không đủ điều kiện bảo hành, bắt buộc lý do. */
  async reject(actor: CrmActor, id: string, request: WarrantyActionRequest): Promise<WarrantyCaseDetail> {
    requireWarrantyWriter(actor);
    await this.get(actor, id);
    const reason = requiredText(request?.reason, 2000, 'lý do từ chối');
    await this.store.reject(actor.tenantId, id, requiredVersion(request?.revision), reason, actor.userId);
    return this.get(actor, id);
  }

  /**
   * Nhận hàng về kho cách ly (T6-04, TC-WAR-07): yêu cầu sang Chờ nhận hàng
   * (ghi trước khi gọi Kho), rồi gọi nhập trả với khoá
   * `crm-warranty:<id>:receive`. Kho ghi sổ ngay, hàng Chờ kiểm định, không
   * tính khả dụng; Kho phát `inventory.stock.returned` thì yêu cầu sang Đang
   * kiểm định. Kho lỗi thì bấm lại: cùng khoá, cùng kho cách ly đã chụp.
   */
  async receiveGoods(actor: CrmActor, id: string, request: WarrantyActionRequest): Promise<WarrantyCaseDetail> {
    requireWarrantyWriter(actor);
    const detail = await this.get(actor, id);
    const settings = await this.store.settings(actor.tenantId);
    // Không có kho mặc định: chưa chọn kho cách ly, kho lỗi thì không nhận hàng (409).
    const quarantine = requireWarrantyWarehouse(detail.quarantineWarehouseCode ?? settings.quarantineWarehouseCode);
    requireWarrantyWarehouse(settings.defectWarehouseCode);
    const warehouseCode = await this.store.requestGoods(actor.tenantId, id, requiredVersion(request?.revision), quarantine, actor.userId);
    const key = receiveIdempotencyKey(id);
    try {
      const receipt = await this.inventory.receiveReturn(actor.tenantId, {
        idempotencyKey: key,
        warehouseCode,
        sourceType: CRM_WARRANTY_SOURCE_TYPE,
        sourceId: id,
        note: `Nhận hàng bảo hành ${detail.code}`,
        lines: detail.lines.map((line) => ({
          materialCode: line.materialCode,
          quantity: line.quantity,
          serials: line.serial ? [line.serial] : undefined,
        })),
      });
      await this.store.saveDocument(actor.tenantId, id, {
        lineId: null,
        kind: 'RETURN_RECEIPT',
        idempotencyKey: key,
        status: receipt.status === 'POSTED' ? 'POSTED' : 'REQUESTED',
        documentId: receipt.documentId,
        documentCode: receipt.documentCode,
        lastError: null,
      });
    } catch (error) {
      await this.store.saveDocument(actor.tenantId, id, {
        lineId: null,
        kind: 'RETURN_RECEIPT',
        idempotencyKey: key,
        status: 'PENDING',
        lastError: (error instanceof Error ? error.message : 'Không gửi được lệnh nhập trả.').slice(0, 2000),
      });
      throw error;
    }
    return this.get(actor, id);
  }

  /** Kết quả kiểm định một dòng (Đạt, Lỗi); mọi dòng có kết quả thì sang Đang xử lý. */
  async inspect(actor: CrmActor, id: string, lineId: string, request: InspectWarrantyLineRequest): Promise<WarrantyCaseDetail> {
    requireWarrantyWriter(actor);
    const detail = await this.get(actor, id);
    if (!isUuid(lineId) || !detail.lines.some((line) => line.id === lineId)) throw new CrmNotFoundError('Không tìm thấy dòng yêu cầu.');
    const result = optionalEnum(request?.result, WARRANTY_INSPECTION_RESULTS, 'kết quả kiểm định');
    if (!result) throw new CrmValidationError('RESULT_REQUIRED', 'Vui lòng chọn kết quả kiểm định Đạt hoặc Lỗi.');
    const note = optionalText(request?.note, 2000, 'ghi chú kiểm định');
    await this.store.inspectLine(actor.tenantId, id, requiredVersion(request?.revision), lineId, result, note, actor.userId);
    return this.get(actor, id);
  }

  /** Đóng (T6-07, TC-WAR-12): mọi dòng có kết quả và hướng xử lý, mọi chứng từ đã ghi sổ. */
  async close(actor: CrmActor, id: string, request: WarrantyActionRequest): Promise<WarrantyCaseDetail> {
    requireWarrantyWriter(actor);
    await this.get(actor, id);
    await this.store.close(actor.tenantId, id, requiredVersion(request?.revision), actor.userId);
    return this.get(actor, id);
  }

  // -------------------------------------------------------------------------
  // Cấu hình
  // -------------------------------------------------------------------------

  async settings(actor: CrmActor): Promise<WarrantySettings> {
    return this.store.settings(actor.tenantId);
  }

  async saveSettings(actor: CrmActor, request: Partial<WarrantySettings>): Promise<WarrantySettings> {
    requireSalesManager(actor);
    const quarantineWarehouseCode = requiredText(request?.quarantineWarehouseCode, WAREHOUSE_CODE_MAX, 'mã kho cách ly').toUpperCase();
    const defectWarehouseCode = requiredText(request?.defectWarehouseCode, WAREHOUSE_CODE_MAX, 'mã kho lỗi').toUpperCase();
    if (quarantineWarehouseCode === defectWarehouseCode) {
      throw new CrmValidationError('SAME_WAREHOUSE', 'Kho cách ly và kho lỗi phải khác nhau.');
    }
    // Kho nhập lại hàng Đạt (T6-11): không gửi thì giữ cấu hình đang có; gửi rỗng thì bỏ cấu hình.
    const restockWarehouseCode =
      request?.restockWarehouseCode === undefined
        ? (await this.store.settings(actor.tenantId)).restockWarehouseCode
        : (optionalText(request.restockWarehouseCode, WAREHOUSE_CODE_MAX, 'mã kho nhập lại')?.toUpperCase() ?? null);
    if (restockWarehouseCode && restockWarehouseCode === quarantineWarehouseCode) {
      throw new CrmValidationError('SAME_WAREHOUSE', 'Kho nhập lại hàng Đạt phải khác kho cách ly.');
    }
    await this.store.saveSettings(actor.tenantId, { quarantineWarehouseCode, defectWarehouseCode, restockWarehouseCode }, actor.userId);
    return this.store.settings(actor.tenantId);
  }
}
