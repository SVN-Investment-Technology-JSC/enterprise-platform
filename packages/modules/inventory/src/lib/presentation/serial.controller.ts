import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Query, Req } from '@nestjs/common';
import type { ChangeQualityRequest } from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from '../application/inventory.application.js';
import { QualityService } from '../application/quality.service.js';
import { SerialService } from '../application/serial.service.js';
import { InventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

/**
 * Tra cứu và đổi trạng thái chất lượng serial (T1-15, T1-19). Danh sách và khai
 * sê-ri cũ vẫn ở `InventoryController` (`v1/serials`).
 */
@Controller('v1')
export class SerialController {
  constructor(
    private readonly serials: SerialService,
    private readonly quality: QualityService,
  ) {}

  /** Lịch sử một serial cho màn Kho. `materialCode` bắt buộc khi serial có ở nhiều mặt hàng. */
  @Get('serials/:serial/history')
  history(
    @Req() request: InventoryRequest,
    @Param('serial') serial: string,
    @Query('materialCode') materialCode?: string,
  ) {
    return this.execute(() => this.serials.history(this.actor(request), serial, materialCode));
  }

  @Post('serials/:serial/quality')
  @HttpCode(200)
  changeQuality(
    @Req() request: InventoryRequest,
    @Param('serial') serial: string,
    @Body() body: ChangeQualityRequest,
  ) {
    return this.execute(() => this.quality.changeSerial(this.actor(request), serial, body));
  }

  /**
   * Cho dịch vụ khác (Bán hàng: bảo hành, giao hàng): mặt hàng, kho, trạng thái,
   * chất lượng, lần xuất gần nhất kèm chứng từ nguồn, ngày giao và lịch sử.
   */
  @Get('internal/serials/:serial')
  forService(
    @Req() request: InventoryRequest,
    @Param('serial') serial: string,
    @Query('materialCode') materialCode?: string,
  ) {
    return this.execute(() => this.serials.history(this.actor(request), serial, materialCode));
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
