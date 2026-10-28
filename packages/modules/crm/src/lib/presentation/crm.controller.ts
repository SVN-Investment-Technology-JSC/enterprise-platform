import type { CrmStatus } from '@enterprise-platform/contracts-crm';
import { Controller, Get, Inject, Req } from '@nestjs/common';
import { crmCapabilities } from '../application/crm-actor.js';
import { CRM_DIAGNOSTICS, type CrmDiagnostics } from '../application/crm-store.port.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

export type { CrmRequest } from './crm-http.js';

@Controller('v1')
export class CrmController {
  constructor(@Inject(CRM_DIAGNOSTICS) private readonly diagnostics: CrmDiagnostics) {}

  /** Mức sẵn sàng của phân hệ và quyền của người đang đăng nhập (chỉ để ẩn hiện). */
  @Get('status')
  status(@Req() request: CrmRequest): Promise<CrmStatus> {
    return runCrm(async () => {
      const actor = crmActor(request);
      const schema = await this.diagnostics.schemaStatus(actor.tenantId);
      return { tenantId: actor.tenantId, userId: actor.userId, ...schema, capabilities: crmCapabilities(actor) };
    });
  }
}
