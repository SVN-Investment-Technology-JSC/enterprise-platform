import type { InventoryTaskTemplateResolver } from '../application/inventory-task-template.port.js';

/** Calls the Inventory module's internal task-template endpoint over HTTP. */
export class HttpInventoryTaskTemplateResolver implements InventoryTaskTemplateResolver {
  constructor(
    private readonly inventoryApiUrl: string = process.env['INVENTORY_API_URL'] ??
      'http://localhost:3336/api/inventory',
  ) {}

  async resolveAssetTaskTemplate(
    tenantId: string,
    assetCode: string,
  ): Promise<Record<string, unknown>[] | null> {
    const response = await fetch(
      `${this.inventoryApiUrl}/v1/internal/assets/${encodeURIComponent(assetCode)}/task-template`,
      {
        headers: {
          'X-Tenant-ID': tenantId,
          'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
        },
      },
    );

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Inventory task-template trả về ${response.status}.`);
    }

    const body = (await response.json()) as { taskTemplate?: Record<string, unknown>[] | null };
    return body.taskTemplate ?? null;
  }
}
