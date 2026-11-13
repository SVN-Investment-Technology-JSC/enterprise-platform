import type { SalesOrganization, SalesOrganizationSummary, SaveSalesOrganizationRequest } from '@enterprise-platform/contracts-crm';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { SalesOrganizationService } from '../application/sales-organization.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

/**
 * Danh mục tổ chức báo giá (plan phase 3 mục 16.2). Đọc cần `crm.read` (guard); thêm, sửa, xoá chỉ `crm.manage`, kiểm ở
 * `SalesOrganizationService`. Thân POST, PATCH tới 2 MB (logo) đặt ở `apps/crm-api` (`configureCrmBodyParsers`).
 */
@Controller('v1')
export class SalesOrganizationsController {
  constructor(@Inject(SalesOrganizationService) private readonly organizations: SalesOrganizationService) {}

  @Get('sales-organizations')
  list(@Req() request: CrmRequest, @Query('includeInactive') includeInactive?: string): Promise<SalesOrganizationSummary[]> {
    return runCrm(() => this.organizations.list(crmActor(request), includeInactive));
  }

  @Get('sales-organizations/:id')
  get(@Req() request: CrmRequest, @Param('id') id: string): Promise<SalesOrganization> {
    return runCrm(() => this.organizations.get(crmActor(request), id));
  }

  @Post('sales-organizations')
  create(@Req() request: CrmRequest, @Body() payload?: SaveSalesOrganizationRequest): Promise<SalesOrganization> {
    return runCrm(() => this.organizations.create(crmActor(request), payload ?? ({} as SaveSalesOrganizationRequest)));
  }

  @Patch('sales-organizations/:id')
  update(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload?: SaveSalesOrganizationRequest): Promise<SalesOrganization> {
    return runCrm(() => this.organizations.update(crmActor(request), id, payload ?? ({} as SaveSalesOrganizationRequest)));
  }

  @Delete('sales-organizations/:id')
  @HttpCode(204)
  remove(@Req() request: CrmRequest, @Param('id') id: string): Promise<void> {
    return runCrm(() => this.organizations.remove(crmActor(request), id));
  }
}
