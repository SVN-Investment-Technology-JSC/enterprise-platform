import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TenantOrganizationContextClient } from './tenant-organization-context.client';
import { TenantInventoryCatalogClient } from './tenant-inventory-catalog.client';

interface ProcedureRequest extends Request {
  procedureActor?: { tenantId: string };
}

/** Read models Procedure publishes to its own web client. */
@Controller('v1')
export class ProcedureIntegrationController {
  constructor(
    private readonly organizationContexts: TenantOrganizationContextClient,
    private readonly inventoryCatalog: TenantInventoryCatalogClient,
  ) {}

  @Get('organization-context')
  organizationContext(@Req() request: ProcedureRequest) {
    const tenantId = request.procedureActor?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    return this.organizationContexts.load(tenantId);
  }

  /** Danh mục thiết bị cho vai E chọn lúc chạy. */
  @Get('asset-catalog')
  assetCatalog(@Req() request: ProcedureRequest) {
    const tenantId = request.procedureActor?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    return this.inventoryCatalog.listAssets(tenantId);
  }

  @Get('material-catalog')
  materialCatalog(@Req() request: ProcedureRequest) {
    const tenantId = request.procedureActor?.tenantId;
    if (!tenantId) throw new UnauthorizedException();
    return this.inventoryCatalog.list(tenantId);
  }
}
