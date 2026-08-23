import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TenantOrganizationContextClient } from './tenant-organization-context.client';

interface MaintenanceRequest extends Request {
  maintenanceActor?: { tenantId: string };
}

@Controller('v1')
export class MaintenanceIntegrationController {
  constructor(private readonly organizationContexts: TenantOrganizationContextClient) {}

  @Get('organization-context')
  organizationContext(@Req() request: MaintenanceRequest) {
    const tenantId = request.maintenanceActor?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    return this.organizationContexts.load(tenantId);
  }
}
