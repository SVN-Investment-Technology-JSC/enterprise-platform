import type { CrmStatus } from '@enterprise-platform/contracts-crm';
import { Controller, Get, Inject, Req } from '@nestjs/common';
import { crmCapabilities } from '../application/crm-actor.js';
import { CRM_DIAGNOSTICS, type CrmDiagnostics } from '../application/crm-store.port.js';
import {
  INVENTORY_ACCESS_READER,
  NO_INVENTORY_ACCESS,
  type InventoryAccessReader,
} from '../application/inventory-access.port.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

export type { CrmRequest } from './crm-http.js';

@Controller('v1')
export class CrmController {
  constructor(
    @Inject(CRM_DIAGNOSTICS) private readonly diagnostics: CrmDiagnostics,
    @Inject(INVENTORY_ACCESS_READER) private readonly inventory: InventoryAccessReader,
  ) {}

  /** Mức sẵn sàng của phân hệ và quyền của người đang đăng nhập (chỉ để ẩn hiện). */
  @Get('status')
  status(@Req() request: CrmRequest): Promise<CrmStatus> {
    return runCrm(async () => {
      const actor = crmActor(request);
      const schema = await this.diagnostics.schemaStatus(actor.tenantId);
      // Chỉ để ẩn hiện nút Kho; lỗi đọc thì cả hai cờ là false, không làm hỏng status.
      const inventory = await this.inventory
        .read({ tenantId: actor.tenantId, userId: actor.userId, sessionId: actor.sessionId })
        .catch(() => NO_INVENTORY_ACCESS);
      return {
        tenantId: actor.tenantId,
        userId: actor.userId,
        ...schema,
        capabilities: crmCapabilities(actor),
        inventoryEntitled: inventory.inventoryEntitled,
        canAccessInventory: inventory.canAccessInventory,
      };
    });
  }
}
