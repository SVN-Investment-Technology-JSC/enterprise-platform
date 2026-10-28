import {
  WARRANTY_DISPOSITIONS,
  WARRANTY_REMEDIES,
  type ResolveWarrantyLineRequest,
  type WarrantyActionRequest,
  type WarrantyCaseDetail,
  type WarrantyCaseLine,
  type WarrantyDocumentKind,
  type WarrantySettings,
} from '@enterprise-platform/contracts-crm';
import { CrmConflictError, CrmNotFoundError, CrmValidationError } from '../domain/crm.error.js';
import { isUuid, optionalEnum, optionalText, requiredVersion } from '../domain/fields.js';
import {
  assertResolution,
  documentsForResolution,
  lineDocumentKey,
  lineRefundAmount,
  needsResend,
  warrantyTransferTarget,
} from '../domain/warranty-case.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import {
  CRM_WARRANTY_SOURCE_TYPE,
  type WarrantyCreditPort,
  type WarrantyDocumentRecord,
  type WarrantyInventory,
  type WarrantyStockLine,
  type WarrantyStore,
} from './warranty.port.js';
import { requireWarrantyWriter } from './warranty.service.js';

const CASE_NOT_FOUND = 'Không tìm thấy yêu cầu bảo hành.';
const WAREHOUSE_CODE_MAX = 50;

/** Trạng thái chứng từ Bán hàng ghi theo trạng thái Kho trả về. */
function stockStatus(status: string, pending: 'REQUESTED' | 'PENDING_APPROVAL'): WarrantyDocumentRecord['status'] {
  if (status === 'POSTED') return 'POSTED';
  if (status === 'PENDING' || status === 'APPROVED') return 'PENDING_APPROVAL';
  return pending;
}

/**
 * Hướng xử lý sau kiểm định và chứng từ (T6-05, T6-06):
 *
 * - Nhập lại (Đạt): đổi chất lượng về Đạt, hàng tính lại vào khả dụng (TC-WAR-08).
 * - Chuyển kho lỗi (Lỗi): đổi chất lượng sang Lỗi rồi điều chuyển từ kho cách
 *   ly sang kho lỗi, ghi sổ ngay (TC-WAR-09).
 * - Loại bỏ (Lỗi): đổi sang Lỗi rồi lập xuất khác chờ quản lý kho duyệt.
 * - Đổi hàng: yêu cầu xuất bảo hành nháp, thủ kho chọn serial thay thế; khi Kho
 *   ghi sổ, serial mới kế thừa hạn còn lại của serial cũ (Q9, TC-WAR-10).
 * - Hoàn tiền, giảm trừ công nợ: giá trị dòng đơn theo số lượng trả, qua
 *   `WarrantyCreditPort` (TC-WAR-11).
 *
 * Mỗi chứng từ có khoá `crm-warranty:<id yêu cầu>:<id dòng>:<loại>` nên bấm
 * lại sau lỗi không sinh chứng từ thứ hai. Chứng từ lỗi tạm ghi "chưa gửi
 * được" kèm lỗi; "Gửi lại chứng từ" gửi lại phần còn thiếu.
 */
export class WarrantyResolutionService {
  constructor(
    private readonly store: WarrantyStore,
    private readonly inventory: WarrantyInventory,
    private readonly credit: WarrantyCreditPort,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
  ) {}

  private async load(actor: CrmActor, id: string): Promise<WarrantyCaseDetail> {
    if (!isUuid(id)) throw new CrmNotFoundError(CASE_NOT_FOUND);
    const scope = await this.scopes.resolve(actor);
    const detail = await this.store.getCase(actor.tenantId, scope, id);
    if (!detail) throw new CrmNotFoundError(CASE_NOT_FOUND);
    return detail;
  }

  /** Chốt hướng xử lý một dòng rồi sinh chứng từ; yêu cầu sang Đã xử lý khi mọi dòng xong. */
  async resolve(actor: CrmActor, id: string, lineId: string, request: ResolveWarrantyLineRequest): Promise<WarrantyCaseDetail> {
    requireWarrantyWriter(actor);
    const detail = await this.load(actor, id);
    const line = detail.lines.find((item) => item.id === lineId);
    if (!line) throw new CrmNotFoundError('Không tìm thấy dòng yêu cầu.');
    const disposition = optionalEnum(request?.disposition, WARRANTY_DISPOSITIONS, 'hướng xử lý hàng');
    if (!disposition) throw new CrmValidationError('DISPOSITION_REQUIRED', 'Vui lòng chọn hướng xử lý hàng nhận về.');
    const remedy = optionalEnum(request?.remedy, WARRANTY_REMEDIES, 'xử lý cho khách') ?? 'NONE';
    const note = optionalText(request?.note, 2000, 'ghi chú');
    const replacementWarehouseCode =
      optionalText(request?.replacementWarehouseCode, WAREHOUSE_CODE_MAX, 'kho xuất hàng thay thế')?.toUpperCase() ??
      line.deliveryWarehouseCode;
    if (detail.status !== 'RESOLVING') {
      throw new CrmConflictError('NOT_RESOLVING', 'Chỉ chọn hướng xử lý khi yêu cầu đang ở bước Đang xử lý.');
    }
    assertResolution({ result: line.inspectionResult, disposition, remedy, hasOrderLine: !!line.orderLineId });
    if (remedy === 'REPLACE' && !replacementWarehouseCode) {
      throw new CrmValidationError('WAREHOUSE_REQUIRED', 'Vui lòng nhập kho xuất hàng thay thế.');
    }
    // Kho đích phải cấu hình trước khi chốt hướng xử lý: chưa có thì 409, không lưu gì.
    if (disposition === 'RESTOCK' || disposition === 'MOVE_TO_DEFECT') {
      warrantyTransferTarget(disposition, line.deliveryWarehouseCode, await this.store.settings(actor.tenantId));
    }
    let creditAmount: number | null = null;
    if ((remedy === 'REFUND' || remedy === 'CREDIT') && line.orderLineId) {
      const value = await this.store.orderLineValue(actor.tenantId, line.orderLineId);
      if (!value) throw new CrmNotFoundError('Không tìm thấy dòng đơn bán của dòng bảo hành.');
      creditAmount = lineRefundAmount(value, line.quantity);
    }
    await this.store.saveResolution(
      actor.tenantId,
      id,
      requiredVersion(request?.revision),
      lineId,
      { disposition, remedy, note, replacementWarehouseCode: remedy === 'REPLACE' ? replacementWarehouseCode : null, creditAmount },
      actor.userId,
    );
    const updated = await this.load(actor, id);
    await this.issueDocuments(actor, updated, updated.lines.find((item) => item.id === lineId) as WarrantyCaseLine);
    await this.store.completeResolution(actor.tenantId, id, actor.userId);
    return this.load(actor, id);
  }

  /**
   * Gửi lại chứng từ còn thiếu của mọi dòng đã chốt hướng xử lý (lỗi tạm ở Kho,
   * sổ công nợ chưa hạch toán), rồi chuyển Đã xử lý nếu đủ.
   */
  async syncDocuments(actor: CrmActor, id: string, request: WarrantyActionRequest): Promise<WarrantyCaseDetail> {
    requireWarrantyWriter(actor);
    const detail = await this.load(actor, id);
    requiredVersion(request?.revision);
    if (detail.status !== 'RESOLVING' && detail.status !== 'RESOLVED') {
      throw new CrmConflictError('NOT_RESOLVING', 'Yêu cầu chưa có hướng xử lý để sinh chứng từ.');
    }
    for (const line of detail.lines) {
      if (line.disposition && line.remedy) await this.issueDocuments(actor, detail, line);
    }
    await this.store.completeResolution(actor.tenantId, id, actor.userId);
    return this.load(actor, id);
  }

  /** Sinh lần lượt các chứng từ của một dòng; lỗi thì ghi "chưa gửi được" và dừng. */
  private async issueDocuments(actor: CrmActor, detail: WarrantyCaseDetail, line: WarrantyCaseLine): Promise<void> {
    if (!line.disposition || !line.remedy) return;
    const settings = await this.store.settings(actor.tenantId);
    for (const kind of documentsForResolution(line.disposition, line.remedy)) {
      const key = lineDocumentKey(detail.id, line.id, kind);
      const existing = detail.documents.find((document) => document.lineId === line.id && document.kind === kind);
      if (existing && !needsResend(existing.status)) continue;
      try {
        const record = await this.issue(actor, detail, line, kind, key, settings);
        await this.store.saveDocument(actor.tenantId, detail.id, record);
      } catch (error) {
        await this.store.saveDocument(actor.tenantId, detail.id, {
          lineId: line.id,
          kind,
          idempotencyKey: key,
          status: 'PENDING',
          amount: kind === 'CREDIT' || kind === 'REFUND' ? line.creditAmount : null,
          lastError: (error instanceof Error ? error.message : 'Không gửi được chứng từ.').slice(0, 2000),
        });
        throw error;
      }
    }
  }

  private async issue(
    actor: CrmActor,
    detail: WarrantyCaseDetail,
    line: WarrantyCaseLine,
    kind: WarrantyDocumentKind,
    key: string,
    settings: Pick<WarrantySettings, 'defectWarehouseCode' | 'restockWarehouseCode'>,
  ): Promise<WarrantyDocumentRecord> {
    const tenantId = actor.tenantId;
    const base = { lineId: line.id, kind, idempotencyKey: key, lastError: null } as const;
    const stockLine: WarrantyStockLine = {
      materialCode: line.materialCode,
      quantity: line.quantity,
      ...(line.serial ? { serials: [line.serial] } : line.receivedLotNo ? { lotNo: line.receivedLotNo } : {}),
    };
    const quarantine = detail.quarantineWarehouseCode;
    switch (kind) {
      case 'QUALITY': {
        const change = {
          qualityStatus: line.disposition === 'RESTOCK' ? ('PASSED' as const) : ('DEFECTIVE' as const),
          reason: `Bảo hành ${detail.code}: kiểm định ${line.inspectionResult === 'PASSED' ? 'Đạt' : 'Lỗi'}${line.inspectionNote ? ` (${line.inspectionNote})` : ''}`.slice(0, 500),
          materialCode: line.materialCode,
          actorUserId: actor.userId,
        };
        if (line.serial) await this.inventory.changeSerialQuality(tenantId, line.serial, change);
        else if (line.receivedLotId) await this.inventory.changeLotQuality(tenantId, line.receivedLotId, change);
        else throw new CrmConflictError('LOT_UNKNOWN', 'Chưa biết lô hàng nhận về của dòng này; vui lòng chờ Kho báo nhập trả.');
        return { ...base, status: 'POSTED', payload: { qualityStatus: change.qualityStatus } };
      }
      case 'TRANSFER':
      case 'SCRAP': {
        if (!quarantine) throw new CrmConflictError('GOODS_NOT_RECEIVED', 'Hàng chưa được nhận về kho cách ly.');
        // Nhập lại (T6-11): hàng Đạt về kho đã xuất serial, dòng; không biết thì kho nhập lại theo cấu hình.
        const restock = kind === 'TRANSFER' && line.disposition === 'RESTOCK';
        const target = warrantyTransferTarget(restock ? 'RESTOCK' : 'MOVE_TO_DEFECT', line.deliveryWarehouseCode, settings);
        if (restock && target.toUpperCase() === quarantine.toUpperCase()) {
          // Kho xuất ban đầu chính là kho cách ly: hàng đã ở đúng chỗ, không cần điều chuyển.
          return { ...base, status: 'POSTED', payload: { targetWarehouseCode: target, skipped: true } };
        }
        const document = await this.inventory.createStockDocument(tenantId, {
          docType: kind === 'TRANSFER' ? 'TRANSFER' : 'ISSUE_OTHER',
          idempotencyKey: key,
          warehouseCode: quarantine,
          targetWarehouseCode: kind === 'TRANSFER' ? target : undefined,
          sourceType: CRM_WARRANTY_SOURCE_TYPE,
          sourceId: detail.id,
          note:
            kind === 'SCRAP'
              ? `Bảo hành ${detail.code}: loại bỏ hàng lỗi`
              : restock
                ? `Bảo hành ${detail.code}: nhập lại hàng Đạt về kho ${target}`
                : `Bảo hành ${detail.code}: chuyển hàng lỗi sang kho lỗi`,
          lines: [stockLine],
        });
        return {
          ...base,
          status: stockStatus(document.status, kind === 'SCRAP' ? 'PENDING_APPROVAL' : 'REQUESTED'),
          documentId: document.documentId,
          documentCode: document.documentCode,
        };
      }
      case 'REPLACEMENT': {
        const warehouseCode = line.replacementWarehouseCode ?? line.deliveryWarehouseCode;
        if (!warehouseCode) throw new CrmValidationError('WAREHOUSE_REQUIRED', 'Vui lòng nhập kho xuất hàng thay thế.');
        const document = await this.inventory.createWarrantyIssue(tenantId, {
          idempotencyKey: key,
          warehouseCode,
          sourceType: CRM_WARRANTY_SOURCE_TYPE,
          sourceId: detail.id,
          note: `Bảo hành ${detail.code}: xuất thay thế ${line.serial ?? line.materialCode}`,
          lines: [{ materialCode: line.materialCode, quantity: line.quantity, note: line.serial ? `Thay serial ${line.serial}` : undefined }],
        });
        return {
          ...base,
          status: stockStatus(document.status, 'REQUESTED'),
          documentId: document.documentId,
          documentCode: document.documentCode,
        };
      }
      case 'CREDIT':
      case 'REFUND': {
        const amount = line.creditAmount ?? 0;
        const result = await this.credit.requestCredit({
          tenantId,
          kind,
          customerId: detail.customerId,
          orderId: line.orderId,
          amount,
          reason: `${kind === 'CREDIT' ? 'Giảm trừ công nợ' : 'Hoàn tiền'} trả hàng theo bảo hành ${detail.code}${line.serial ? `, serial ${line.serial}` : ''}`,
          sourceType: CRM_WARRANTY_SOURCE_TYPE,
          sourceId: line.id,
          idempotencyKey: key,
          actorId: actor.userId,
        });
        return { ...base, status: result.status, documentId: result.documentId, documentCode: result.documentCode, amount };
      }
      default:
        throw new CrmValidationError('UNSUPPORTED_DOCUMENT', 'Loại chứng từ không hỗ trợ.');
    }
  }
}
