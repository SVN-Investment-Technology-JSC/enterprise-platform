import type {
  AddOpportunityPromotionRequest,
  OpportunityPromotion,
  PromotionCatalogItem,
  SavePromotionCatalogRequest,
  SaveQuotePromotionsRequest,
  SaveQuotePromotionsResponse,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { PromotionService } from '../application/promotion.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

type Payload<T> = T | undefined;
const body = <T>(value: Payload<T>): T => value ?? ({} as T);

/**
 * Khuyến mãi của báo giá (P2I-11). Guard bảo đảm `crm.read` và CSRF cho request ghi; quyền theo thao tác
 * (`crm.manage` cho danh mục, `crm.opportunity.write` cho dự án, `crm.quote.write` cho báo giá) và phạm vi dữ liệu
 * kiểm ở `PromotionService`.
 */
@Controller('v1')
export class PromotionsController {
  constructor(@Inject(PromotionService) private readonly promotions: PromotionService) {}

  @Get('promotions/catalog')
  catalog(
    @Req() request: CrmRequest,
    @Query('kind') kind?: string,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<PromotionCatalogItem[]> {
    return runCrm(() => this.promotions.listCatalog(crmActor(request), { kind, includeInactive }));
  }

  @Post('promotions/catalog')
  createCatalog(@Req() request: CrmRequest, @Body() payload: Payload<SavePromotionCatalogRequest>): Promise<PromotionCatalogItem> {
    return runCrm(() => this.promotions.createCatalog(crmActor(request), body(payload)));
  }

  @Get('promotions/catalog/:id')
  getCatalog(@Req() request: CrmRequest, @Param('id') id: string): Promise<PromotionCatalogItem> {
    return runCrm(() => this.promotions.getCatalog(crmActor(request), id));
  }

  @Put('promotions/catalog/:id')
  replaceCatalog(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() payload: Payload<SavePromotionCatalogRequest>,
  ): Promise<PromotionCatalogItem> {
    return runCrm(() => this.promotions.updateCatalog(crmActor(request), id, body(payload)));
  }

  @Patch('promotions/catalog/:id')
  updateCatalog(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() payload: Payload<SavePromotionCatalogRequest>,
  ): Promise<PromotionCatalogItem> {
    return runCrm(() => this.promotions.updateCatalog(crmActor(request), id, body(payload)));
  }

  @Get('opportunities/:id/promotions')
  forOpportunity(@Req() request: CrmRequest, @Param('id') id: string): Promise<OpportunityPromotion[]> {
    return runCrm(() => this.promotions.listForOpportunity(crmActor(request), id));
  }

  @Post('opportunities/:id/promotions')
  addToOpportunity(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() payload: Payload<AddOpportunityPromotionRequest>,
  ): Promise<OpportunityPromotion[]> {
    return runCrm(() => this.promotions.addToOpportunity(crmActor(request), id, body(payload)));
  }

  @Delete('opportunities/:id/promotions/:linkId')
  removeFromOpportunity(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ): Promise<OpportunityPromotion[]> {
    return runCrm(() => this.promotions.removeFromOpportunity(crmActor(request), id, linkId));
  }

  @Put('quotes/:id/versions/:versionNo/promotions')
  saveForQuote(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Body() payload: Payload<SaveQuotePromotionsRequest>,
  ): Promise<SaveQuotePromotionsResponse> {
    return runCrm(() => this.promotions.saveForQuote(crmActor(request), id, versionNo, body(payload)));
  }
}
