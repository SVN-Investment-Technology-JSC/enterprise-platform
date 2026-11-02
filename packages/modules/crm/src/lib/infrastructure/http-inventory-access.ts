import { Logger } from '@nestjs/common';
import {
  NO_INVENTORY_ACCESS,
  type InventoryAccess,
  type InventoryAccessReader,
} from '../application/inventory-access.port.js';

const TIMEOUT_MS = 5_000;

/**
 * Đọc Kho của người dùng từ access-decision của Platform (cùng endpoint và
 * `x-service-token` mà guard của các phân hệ dùng), với `moduleKey: 'inventory'`
 * và quyền `inventory.read`. Không cache: đổi quyền hay tắt Kho có hiệu lực ngay.
 *
 * - được phép: đã mua Kho, được vào;
 * - `MODULE_ROLE_FORBIDDEN`, `PERMISSION_DENIED`: đã mua Kho, không được vào;
 * - mọi trường hợp khác (chưa mua, phiên hỏng, Platform lỗi, thiếu token): cả hai `false`.
 */
export class HttpInventoryAccess implements InventoryAccessReader {
  private readonly logger = new Logger(HttpInventoryAccess.name);

  constructor(
    private readonly decisionUrl: string = process.env['PLATFORM_ACCESS_DECISION_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/access-decisions',
    private readonly serviceToken: string = process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async read(input: { tenantId: string; userId: string; sessionId?: string }): Promise<InventoryAccess> {
    if (!input.sessionId || !this.serviceToken) return NO_INVENTORY_ACCESS;
    try {
      const response = await this.fetcher(this.decisionUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-token': this.serviceToken },
        body: JSON.stringify({
          sessionId: input.sessionId,
          userId: input.userId,
          tenantId: input.tenantId,
          moduleKey: 'inventory',
          permission: 'inventory.read',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return NO_INVENTORY_ACCESS;
      return interpretInventoryDecision(await response.json());
    } catch (error) {
      this.logger.warn(`Không đọc được quyền Kho: ${error instanceof Error ? error.message : String(error)}`);
      return NO_INVENTORY_ACCESS;
    }
  }
}

/** Đổi câu trả lời access-decision thành hai cờ Kho; payload lạ thì coi như không có Kho. */
export function interpretInventoryDecision(payload: unknown): InventoryAccess {
  const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  if (body['allowed'] === true) return { inventoryEntitled: true, canAccessInventory: true };
  const code = body['code'];
  if (code === 'MODULE_ROLE_FORBIDDEN' || code === 'PERMISSION_DENIED') {
    return { inventoryEntitled: true, canAccessInventory: false };
  }
  return NO_INVENTORY_ACCESS;
}
