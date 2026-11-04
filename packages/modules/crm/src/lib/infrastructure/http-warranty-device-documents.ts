import type {
  DeviceDocumentFromInventory,
  WarrantyDeviceDocumentReader,
} from '../application/warranty-device-documents.service.js';

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/**
 * Đọc tài liệu thiết bị qua API nội bộ của Kho (`x-service-token`, `x-tenant-id`),
 * không đọc DB Kho. Lỗi hạ tầng hay phản hồi sai dạng thì ném để service coi là
 * không có tài liệu.
 */
export class HttpWarrantyDeviceDocuments implements WarrantyDeviceDocumentReader {
  constructor(
    private readonly baseUrl: string = process.env['INVENTORY_API_URL'] ?? 'http://localhost:3336/api/inventory',
    private readonly token: () => string | undefined = () => process.env['INTERNAL_SERVICE_TOKEN'],
  ) {}

  async list(tenantId: string, materialId: string): Promise<DeviceDocumentFromInventory[]> {
    const token = this.token();
    if (!token) throw new Error('Thiếu INTERNAL_SERVICE_TOKEN.');
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, '')}/v1/internal/materials/${encodeURIComponent(materialId)}/documents`,
      {
        headers: { 'x-tenant-id': tenantId, 'x-service-token': token },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) throw new Error(`Kho trả ${response.status}.`);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error('Phản hồi Kho sai dạng.');
    const result: DeviceDocumentFromInventory[] = [];
    for (const item of body as Record<string, unknown>[]) {
      const id = text(item['id']);
      const fileName = text(item['fileName']);
      const downloadUrl = text(item['downloadUrl']);
      if (!id || !fileName || !downloadUrl) continue;
      result.push({
        id,
        fileName,
        contentType: text(item['contentType']) ?? 'application/octet-stream',
        sizeBytes: typeof item['sizeBytes'] === 'number' ? item['sizeBytes'] : null,
        note: text(item['note']),
        createdAt: text(item['createdAt']) ?? '',
        downloadUrl,
        expiresInSeconds: typeof item['expiresInSeconds'] === 'number' ? item['expiresInSeconds'] : 300,
      });
    }
    return result;
  }
}
