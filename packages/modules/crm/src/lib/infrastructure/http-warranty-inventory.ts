import type {
  InventorySerialInfo,
  QualityChange,
  ReturnReceiptRequest,
  WarrantyInventory,
  WarrantyIssueRequest,
  WarrantyStockDocument,
  WarrantyStockDocumentRequest,
} from '../application/warranty.port.js';
import { CrmError } from '../domain/crm.error.js';
import { HttpInventoryClient, inventoryWriteUnavailable } from './http-inventory-client.js';

interface WireDocument {
  documentId?: unknown;
  documentCode?: unknown;
  status?: unknown;
}

interface WireMovement {
  movementType?: unknown;
  documentCode?: unknown;
  docType?: unknown;
  fromWarehouseCode?: unknown;
  toWarehouseCode?: unknown;
  qualityStatus?: unknown;
  sourceType?: unknown;
  reason?: unknown;
  occurredAt?: unknown;
}

interface WireSerial {
  serialNumber?: unknown;
  materialId?: unknown;
  materialCode?: unknown;
  materialName?: unknown;
  warehouseCode?: unknown;
  stockState?: unknown;
  qualityStatus?: unknown;
  lastIssue?: {
    documentCode?: unknown;
    docType?: unknown;
    warehouseCode?: unknown;
    sourceType?: unknown;
    sourceId?: unknown;
    issuedAt?: unknown;
  } | null;
  movements?: unknown;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

function toDocument(body: WireDocument, fallbackStatus: string): WarrantyStockDocument {
  if (typeof body.documentId !== 'string' || typeof body.documentCode !== 'string') throw inventoryWriteUnavailable();
  return { documentId: body.documentId, documentCode: body.documentCode, status: text(body.status) ?? fallbackStatus };
}

/**
 * Lệnh của bảo hành sang Kho qua API nội bộ (`x-service-token`, `x-tenant-id`):
 *
 * - `GET /v1/internal/serials/:serial`: mặt hàng, kho, chất lượng, lần xuất gần
 *   nhất (chứng từ nguồn, ngày xuất) và lịch sử serial;
 * - `POST /v1/internal/return-receipts`: nhập trả vào kho cách ly, ghi sổ ngay;
 * - `POST /v1/internal/serials/:serial/quality`, `/v1/internal/lots/:id/quality`:
 *   đổi chất lượng, ghi người kiểm định của Bán hàng;
 * - `POST /v1/internal/stock-documents`: điều chuyển sang kho lỗi, xuất khác;
 * - `POST /v1/internal/issue-requests` loại ISSUE_WARRANTY: xuất hàng thay thế.
 *
 * Lỗi giống `HttpInventoryClient`: hạ tầng thành 503, Kho từ chối giữ mã và
 * thông điệp của Kho.
 */
export class HttpWarrantyInventoryClient extends HttpInventoryClient implements WarrantyInventory {
  async serial(tenantId: string, serial: string): Promise<InventorySerialInfo | null> {
    const token = this.token();
    if (!token) throw inventoryWriteUnavailable();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/internal/serials/${encodeURIComponent(serial)}`, {
        headers: { 'x-tenant-id': tenantId, 'x-service-token': token },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw inventoryWriteUnavailable();
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      if (response.status === 400 || response.status === 409) {
        const body = (await response.json().catch(() => ({}))) as { code?: unknown; message?: unknown };
        throw new CrmError(text(body.code) ?? 'INVENTORY_REJECTED', text(body.message) ?? 'Kho từ chối tra cứu serial.', 422);
      }
      throw inventoryWriteUnavailable();
    }
    let body: WireSerial;
    try {
      body = (await response.json()) as WireSerial;
    } catch {
      throw inventoryWriteUnavailable();
    }
    const materialId = text(body.materialId);
    if (!materialId) throw inventoryWriteUnavailable();
    const last = body.lastIssue ?? null;
    return {
      serial: text(body.serialNumber) ?? serial,
      materialId: materialId.toLowerCase(),
      materialCode: text(body.materialCode) ?? '',
      materialName: text(body.materialName) ?? '',
      warehouseCode: text(body.warehouseCode),
      stockState: text(body.stockState),
      qualityStatus: text(body.qualityStatus),
      lastIssue: last
        ? {
            documentCode: text(last.documentCode),
            docType: text(last.docType),
            warehouseCode: text(last.warehouseCode),
            sourceType: text(last.sourceType),
            sourceId: text(last.sourceId),
            issuedAt: text(last.issuedAt),
          }
        : null,
      movements: (Array.isArray(body.movements) ? (body.movements as WireMovement[]) : []).map((movement) => ({
        movementType: text(movement.movementType) ?? '',
        documentCode: text(movement.documentCode),
        docType: text(movement.docType),
        fromWarehouseCode: text(movement.fromWarehouseCode),
        toWarehouseCode: text(movement.toWarehouseCode),
        qualityStatus: text(movement.qualityStatus),
        sourceType: text(movement.sourceType),
        reason: text(movement.reason),
        occurredAt: text(movement.occurredAt) ?? '',
      })),
    };
  }

  async receiveReturn(tenantId: string, request: ReturnReceiptRequest): Promise<WarrantyStockDocument> {
    return toDocument(await this.post<WireDocument>(tenantId, '/v1/internal/return-receipts', request), 'POSTED');
  }

  async changeSerialQuality(tenantId: string, serial: string, change: QualityChange): Promise<void> {
    await this.quality(tenantId, `/v1/internal/serials/${encodeURIComponent(serial)}/quality`, change);
  }

  async changeLotQuality(tenantId: string, lotId: string, change: QualityChange): Promise<void> {
    await this.quality(tenantId, `/v1/internal/lots/${encodeURIComponent(lotId)}/quality`, change);
  }

  async createStockDocument(tenantId: string, request: WarrantyStockDocumentRequest): Promise<WarrantyStockDocument> {
    return toDocument(await this.post<WireDocument>(tenantId, '/v1/internal/stock-documents', request), 'DRAFT');
  }

  async createWarrantyIssue(tenantId: string, request: WarrantyIssueRequest): Promise<WarrantyStockDocument> {
    return toDocument(
      await this.post<WireDocument>(tenantId, '/v1/internal/issue-requests', { ...request, docType: 'ISSUE_WARRANTY' }),
      'DRAFT',
    );
  }

  /** Đã ở đúng trạng thái đích (gọi lại sau lỗi) thì coi như xong. */
  private async quality(tenantId: string, path: string, change: QualityChange): Promise<void> {
    try {
      await this.post(tenantId, path, change);
    } catch (error) {
      if (error instanceof CrmError && error.code === 'QUALITY_STATUS_UNCHANGED') return;
      throw error;
    }
  }
}
