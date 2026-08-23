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

  async resolveMaterial(
    tenantId: string,
    materialCode: string,
  ): Promise<{ name: string; unit: string } | null> {
    const response = await this.get(tenantId, `materials/${encodeURIComponent(materialCode)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Inventory materials trả về ${response.status}.`);
    const body = (await response.json()) as { name?: string; unit?: string };
    return { name: body.name ?? materialCode, unit: body.unit ?? '' };
  }

  async readAvailability(tenantId: string, materialCode: string): Promise<number> {
    const response = await this.get(
      tenantId,
      `materials/${encodeURIComponent(materialCode)}/availability`,
    );
    // Mã đã biến mất khỏi Kho sau khi quy trình công bố: coi như không còn hàng,
    // để bước bị chặn và người dùng nhìn thấy, thay vì lặng lẽ cho qua.
    if (response.status === 404) return 0;
    if (!response.ok) throw new Error(`Inventory availability trả về ${response.status}.`);
    const body = (await response.json()) as { available?: number };
    return typeof body.available === 'number' ? body.available : 0;
  }

  async readAvailabilityByWarehouse(
    tenantId: string,
    materialCode: string,
  ): Promise<{ warehouseCode: string; available: number }[]> {
    const response = await this.get(
      tenantId,
      `materials/${encodeURIComponent(materialCode)}/availability`,
    );
    if (!response.ok) return [];
    const body = (await response.json()) as {
      byWarehouse?: { warehouseCode: string; available: number }[];
    };
    return body.byWarehouse ?? [];
  }

  async reserveMaterials(
    tenantId: string,
    input: {
      warehouseCode: string;
      referenceId: string;
      items: { materialCode: string; quantityReserved: number }[];
    },
  ): Promise<string> {
    const response = await this.post(tenantId, 'reservations', {
      warehouseCode: input.warehouseCode,
      referenceType: 'PROCEDURE',
      referenceId: input.referenceId,
      items: input.items,
    });
    if (!response.ok) {
      throw new Error(`Inventory reservations trả về ${response.status}.`);
    }
    const body = (await response.json()) as { reservationCode?: string };
    if (!body.reservationCode) throw new Error('Kho không trả về mã phiếu giữ chỗ.');
    return body.reservationCode;
  }

  async releaseReservation(tenantId: string, reservationCode: string): Promise<void> {
    const response = await this.post(
      tenantId,
      `reservations/${encodeURIComponent(reservationCode)}/release`,
      {},
    );
    // 404 nghĩa là phiếu không còn — mục tiêu (không giữ hàng nữa) vẫn đạt.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Inventory release trả về ${response.status}.`);
    }
  }

  private post(tenantId: string, path: string, body: unknown): Promise<Response> {
    return fetch(`${this.inventoryApiUrl}/v1/internal/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Tenant-ID': tenantId,
        'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
      },
      body: JSON.stringify(body),
    });
  }

  private get(tenantId: string, path: string): Promise<Response> {
    return fetch(`${this.inventoryApiUrl}/v1/internal/${path}`, {
      headers: {
        'X-Tenant-ID': tenantId,
        'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
      },
    });
  }
}
