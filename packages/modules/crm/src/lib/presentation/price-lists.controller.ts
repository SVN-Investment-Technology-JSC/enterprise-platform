import type {
  AssignPriceListGroupsRequest,
  BulkPriceListItemsRequest,
  PriceListDetail,
  PriceListSummary,
  PricingResult,
  PricingSettings,
  QuotePreviewRequest,
  SavePriceListItemRequest,
  SavePriceListRequest,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { PriceListService } from '../application/price-list.service.js';
import { PricingService } from '../application/pricing.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

/** Bảng giá: đọc với `crm.read`, ghi với `crm.manage` (kiểm ở service). */
@Controller('v1')
export class PriceListsController {
  constructor(@Inject(PriceListService) private readonly lists: PriceListService) {}

  @Get('price-lists')
  list(@Req() request: CrmRequest): Promise<PriceListSummary[]> {
    return runCrm(() => this.lists.list(crmActor(request)));
  }

  @Post('price-lists')
  create(@Req() request: CrmRequest, @Body() body: SavePriceListRequest): Promise<PriceListDetail> {
    return runCrm(() => this.lists.create(crmActor(request), body ?? ({} as never)));
  }

  @Get('price-lists/:id')
  get(@Req() request: CrmRequest, @Param('id') id: string): Promise<PriceListDetail> {
    return runCrm(() => this.lists.get(crmActor(request), id));
  }

  @Patch('price-lists/:id')
  update(@Req() request: CrmRequest, @Param('id') id: string, @Body() body: SavePriceListRequest): Promise<PriceListDetail> {
    return runCrm(() => this.lists.update(crmActor(request), id, body ?? ({} as never)));
  }

  @Delete('price-lists/:id')
  @HttpCode(204)
  remove(@Req() request: CrmRequest, @Param('id') id: string): Promise<void> {
    return runCrm(() => this.lists.remove(crmActor(request), id));
  }

  @Put('price-lists/:id/customer-groups')
  assignGroups(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: AssignPriceListGroupsRequest,
  ): Promise<PriceListDetail> {
    return runCrm(() => this.lists.assignGroups(crmActor(request), id, body?.customerGroupIds));
  }

  @Post('price-lists/:id/items')
  addItem(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: SavePriceListItemRequest,
  ): Promise<PriceListDetail> {
    return runCrm(() => this.lists.addItem(crmActor(request), id, body ?? ({} as never)));
  }

  /** Dán nhiều dòng một lần: thêm hoặc cập nhật theo mặt hàng và đơn vị. */
  @Post('price-lists/:id/items/bulk')
  @HttpCode(200)
  upsertItems(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: BulkPriceListItemsRequest,
  ): Promise<PriceListDetail> {
    return runCrm(() => this.lists.upsertItems(crmActor(request), id, body ?? ({} as never)));
  }

  @Patch('price-lists/:id/items/:itemId')
  updateItem(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: SavePriceListItemRequest,
  ): Promise<PriceListDetail> {
    return runCrm(() => this.lists.updateItem(crmActor(request), id, itemId, body ?? ({} as never)));
  }

  @Delete('price-lists/:id/items/:itemId')
  removeItem(@Req() request: CrmRequest, @Param('id') id: string, @Param('itemId') itemId: string): Promise<PriceListDetail> {
    return runCrm(() => this.lists.removeItem(crmActor(request), id, itemId));
  }
}

/** Trần chiết khấu và thử tính giá. */
@Controller('v1')
export class PricingController {
  constructor(@Inject(PricingService) private readonly pricing: PricingService) {}

  @Get('pricing/settings')
  settings(@Req() request: CrmRequest): Promise<PricingSettings> {
    return runCrm(() => this.pricing.settings(crmActor(request)));
  }

  @Put('pricing/settings')
  saveSettings(@Req() request: CrmRequest, @Body() body: PricingSettings): Promise<PricingSettings> {
    return runCrm(() => this.pricing.saveSettings(crmActor(request), body ?? ({} as never)));
  }

  /** Chạy engine giá với bảng giá, chính sách trong DB; không lưu gì. */
  @Post('pricing/quote-preview')
  @HttpCode(200)
  quotePreview(@Req() request: CrmRequest, @Body() body: QuotePreviewRequest): Promise<PricingResult> {
    return runCrm(() => this.pricing.preview(crmActor(request), body ?? ({} as never)));
  }
}
