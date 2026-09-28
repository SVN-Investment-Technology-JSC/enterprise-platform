import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantOrganizationContextClient } from './tenant-organization-context.client';
import { TenantInventoryCatalogClient } from './tenant-inventory-catalog.client';

interface ProcedureRequest extends Request {
  procedureActor?: { tenantId: string; isOverride?: boolean };
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

  /**
   * Màn Quản lý chức danh (nằm trong module Quy trình) lưu "Báo cáo cho".
   *
   * Chỉ quản trị tenant: đây là dữ liệu tổ chức dùng chung cho mọi module, không
   * phải cấu hình riêng của Quy trình — nên không mở cho mọi người thiết kế
   * quy trình (`canDesign` hiện đang bật cho mọi người dùng được vào module).
   */
  @Put('positions/:positionId/reports-to')
  setPositionReportsTo(
    @Req() request: ProcedureRequest,
    @Param('positionId') positionId: string,
    @Body() input: { reportsToPositionId?: string | null },
  ) {
    const actor = request.procedureActor;
    if (!actor?.tenantId) throw new UnauthorizedException();
    if (!actor.isOverride) {
      throw new ForbiddenException({
        code: 'POSITION_MANAGE_FORBIDDEN',
        message: 'Chỉ quản trị tenant mới sửa được "Báo cáo cho" của chức danh.',
      });
    }
    return this.organizationContexts.setPositionReportsTo(
      actor.tenantId,
      positionId,
      input?.reportsToPositionId?.trim() || null,
    );
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
