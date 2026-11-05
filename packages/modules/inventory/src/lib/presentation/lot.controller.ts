import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Query, Req } from '@nestjs/common';
import type { ChangeQualityRequest } from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from '../application/inventory.application.js';
import { LotService } from '../application/lot.service.js';
import { QualityService } from '../application/quality.service.js';
import { InventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

/**
 * Lô (`v1/lots`). Đọc cần `inventory.read`; đổi trạng thái chất lượng cần
 * `inventory.quality.write` (guard của inventory-api kiểm theo đường dẫn, service
 * kiểm lại trên actor). Lô được tạo và cộng trừ qua chứng từ kho.
 */
@Controller('v1/lots')
export class LotController {
  constructor(
    private readonly lots: LotService,
    private readonly quality: QualityService,
  ) {}

  @Get()
  list(@Req() request: InventoryRequest, @Query('materialCode') materialCode?: string) {
    return this.execute(() => this.lots.list(this.actor(request), materialCode));
  }

  /** Gợi ý lô theo FEFO: hạn dùng gần nhất trước, bỏ lô hết hạn và lô không Đạt. */
  @Get('suggest')
  suggest(
    @Req() request: InventoryRequest,
    @Query('materialCode') materialCode?: string,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('quantity') quantity?: string,
  ) {
    return this.execute(() =>
      this.lots.suggest(this.actor(request), { materialCode, warehouseCode, quantity }),
    );
  }

  @Get(':id')
  get(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.lots.get(this.actor(request), id));
  }

  @Post(':id/quality')
  @HttpCode(200)
  changeQuality(
    @Req() request: InventoryRequest,
    @Param('id') id: string,
    @Body() body: ChangeQualityRequest,
  ) {
    return this.execute(() => this.quality.changeLot(this.actor(request), id, body));
  }

  private actor(request: InventoryRequest): InventoryActor {
    if (!request.inventoryActor) {
      throw new HttpException(
        { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Thiếu trusted inventory context.' },
        401,
      );
    }
    return request.inventoryActor;
  }

  private async execute<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof InventoryError)) throw error;
      throw new HttpException(
        { ...error.details, statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
