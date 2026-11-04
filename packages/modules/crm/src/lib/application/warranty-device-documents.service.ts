import type { WarrantyDeviceDocument } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import { NO_INVENTORY_ACCESS, type InventoryAccessReader } from './inventory-access.port.js';
import type { WarrantyService } from './warranty.service.js';

export const CRM_WARRANTY_DEVICE_DOCUMENTS = Symbol('CRM_WARRANTY_DEVICE_DOCUMENTS');

/** Tài liệu một thiết bị do Kho trả (siêu dữ liệu và URL tải ký ngắn hạn). */
export interface DeviceDocumentFromInventory {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number | null;
  readonly note: string | null;
  readonly createdAt: string;
  readonly downloadUrl: string;
  readonly expiresInSeconds: number;
}

/** `GET v1/internal/materials/:materialId/documents` của Kho. */
export interface WarrantyDeviceDocumentReader {
  list(tenantId: string, materialId: string): Promise<DeviceDocumentFromInventory[]>;
}

/**
 * Tài liệu thiết bị của Kho ở màn Bảo hành (chỉ đọc). Phạm vi yêu cầu bảo hành
 * kiểm bằng `WarrantyService.get`; quyền Kho kiểm ở server bằng access-decision
 * `inventory.read` của chính người dùng. Không có quyền Kho, Kho không phản hồi
 * hoặc lỗi thì trả `[]`, không lộ tên tệp.
 */
export class WarrantyDeviceDocumentService {
  constructor(
    private readonly warranty: Pick<WarrantyService, 'get'>,
    private readonly access: InventoryAccessReader,
    private readonly reader: WarrantyDeviceDocumentReader,
  ) {}

  async list(actor: CrmActor, caseId: string): Promise<WarrantyDeviceDocument[]> {
    // Yêu cầu ngoài phạm vi dữ liệu thì 404 như các API bảo hành khác.
    const detail = await this.warranty.get(actor, caseId);
    const access = await this.access
      .read({ tenantId: actor.tenantId, userId: actor.userId, sessionId: actor.sessionId })
      .catch(() => NO_INVENTORY_ACCESS);
    if (!access.canAccessInventory) return [];

    const byMaterial = new Map<string, (typeof detail.lines)[number]>();
    for (const line of detail.lines) if (!byMaterial.has(line.materialId)) byMaterial.set(line.materialId, line);

    const groups = await Promise.all(
      [...byMaterial.values()].map(async (line) => {
        try {
          const documents = await this.reader.list(actor.tenantId, line.materialId);
          return documents.map<WarrantyDeviceDocument>((document) => ({
            ...document,
            lineId: line.id,
            materialCode: line.materialCode,
            materialName: line.materialName,
            serial: line.serial,
          }));
        } catch {
          return [];
        }
      }),
    );
    return groups.flat();
  }
}
