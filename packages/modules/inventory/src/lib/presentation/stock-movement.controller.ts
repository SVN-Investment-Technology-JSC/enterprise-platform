import { Controller, Get, HttpException, Query, Req } from '@nestjs/common';
import type {
  StockDocumentStatus,
  StockDocumentType,
  StockMovementKind,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from '../application/inventory.application.js';
import { StockMovementService } from '../application/stock-movement.service.js';
import { toInventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

/**
 * Xuất/nhập kho (`v1/stock-movements`): một danh sách gộp chứng từ kho và bút
 * toán cũ chưa có chứng từ. Chỉ có GET nên guard chỉ đòi `inventory.read`.
 */
@Controller('v1/stock-movements')
export class StockMovementController {
  constructor(private readonly movements: StockMovementService) {}

  @Get()
  list(
    @Req() request: InventoryRequest,
    @Query('search') search?: string,
    @Query('kind') kind?: string,
    @Query('docType') docType?: string,
    @Query('status') status?: string,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('sourceType') sourceType?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.execute(() =>
      this.movements.list(this.actor(request), {
        search: search || undefined,
        kind: (kind || undefined) as StockMovementKind | undefined,
        docType: (docType || undefined) as StockDocumentType | undefined,
        status: (status || undefined) as StockDocumentStatus | undefined,
        warehouseCode: warehouseCode || undefined,
        sourceType: sourceType || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      }),
    );
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
      const known = toInventoryError(error);
      if (!known) throw error;
      throw new HttpException(
        { ...known.details, statusCode: known.statusCode, code: known.code, message: known.message },
        known.statusCode,
      );
    }
  }
}
