import type {
  BulkPriceListItemsRequest,
  PriceListDetail,
  PriceListSummary,
  PriceListSyncResult,
  PriceListSyncStatus,
  PricingResult,
  PricingSettings,
  QuotePreviewRequest,
  SavePriceListItemRequest,
  SavePriceListRequest,
  SetManualPriceRequest,
  SetVatRateRequest,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { PriceListSyncService } from '../application/price-list-sync.service.js';
import { PriceListService } from '../application/price-list.service.js';
import { PricingService } from '../application/pricing.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

/**
 * Bảng giá: đọc với `crm.read`, ghi với quản trị bán hàng (kiểm ở service). Thêm, sửa, xoá dòng chỉ cho bảng nhập tay
 * cũ; bảng theo tỷ lệ nhập hoặc bỏ giá tay; bảng mặc định chỉ sửa thuế suất.
 */
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

  /** Bảng theo tỷ lệ: nhập giá tay cho dòng. */
  @Put('price-lists/:id/items/:itemId/manual-price')
  setManualPrice(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: SetManualPriceRequest,
  ): Promise<PriceListDetail> {
    return runCrm(() => this.lists.setManualPrice(crmActor(request), id, itemId, body ?? ({} as never)));
  }

  /** Bảng theo tỷ lệ: bỏ giá tay, dòng về giá theo tỷ lệ. */
  @Delete('price-lists/:id/items/:itemId/manual-price')
  clearManualPrice(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ): Promise<PriceListDetail> {
    return runCrm(() => this.lists.clearManualPrice(crmActor(request), id, itemId));
  }

  /** Bảng mặc định: sửa thuế suất; bảng theo tỷ lệ nhận theo. */
  @Put('price-lists/:id/items/:itemId/vat-rate')
  setVatRate(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: SetVatRateRequest,
  ): Promise<PriceListDetail> {
    return runCrm(() => this.lists.setVatRate(crmActor(request), id, itemId, body ?? ({} as never)));
  }
}

/** Trần chiết khấu, thử tính giá, đồng bộ bảng giá mặc định với Kho. */
@Controller('v1')
export class PricingController {
  constructor(
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(PriceListSyncService) private readonly sync: PriceListSyncService,
  ) {}

  /** Bảng giá mặc định có cần đồng bộ với Kho không (quản trị bán hàng). */
  @Get('pricing/catalog-sync')
  catalogSyncStatus(@Req() request: CrmRequest): Promise<PriceListSyncStatus> {
    return runCrm(() => this.sync.status(crmActor(request)));
  }

  /** Đồng bộ bảng giá mặc định với Kho và tính lại các bảng theo tỷ lệ. */
  @Post('pricing/catalog-sync')
  @HttpCode(200)
  syncCatalog(@Req() request: CrmRequest): Promise<PriceListSyncResult> {
    return runCrm(() => this.sync.sync(crmActor(request)));
  }

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
