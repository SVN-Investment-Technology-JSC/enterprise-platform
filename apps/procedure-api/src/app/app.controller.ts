import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AppService } from './app.service';
import { TenantOrganizationContextClient } from './tenant-organization-context.client';

interface ProcedureRequest extends Request {
  procedureActor?: { tenantId: string };
}

@Controller('health')
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly organizationContexts: TenantOrganizationContextClient,
  ) {}

  @Get('live')
  getData() {
    return this.appService.getData();
  }

  @Get('ready')
  ready() { return { status: 'ready', service: 'procedure-api' }; }

  @Get('v1/organization-context')
  organizationContext(@Req() request: ProcedureRequest) {
    const tenantId = request.procedureActor?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    return this.organizationContexts.load(tenantId);
  }
}
