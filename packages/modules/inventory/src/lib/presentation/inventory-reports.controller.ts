import { Controller, Get, HttpException, Query, Req } from '@nestjs/common';
import type {
  MaterialCategory,
  QualityStatus,
  SerialStockState,
  StockDocumentStatus,
  StockDocumentType,
  StockMovementCategory,
  StockReportGroupBy,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from '../application/inventory.application.js';
import { InventoryReportService } from '../application/inventory-report.service.js';
import { InventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

/** Tham số số từ query string; rỗng coi như không truyền, chuỗi sai thành NaN để service báo lỗi. */
function numeric(value: string | undefined): number | undefined {
  return value === undefined || value.trim() === '' ? undefined : Number(value);
}

/**
 * Báo cáo kho (`v1/reports`, T7-06, T7-07). Chỉ GET nên guard của inventory-api
 * chỉ đòi `inventory.read`.
 */
@Controller('v1/reports')
export class InventoryReportsController {
  constructor(private readonly reports: InventoryReportService) {}

  /** Tồn theo kho, lô hoặc serial: thực tế, đã giữ, chờ kiểm định hoặc không Đạt, khả dụng. */
  @Get('stock')
  stock(
    @Req() request: InventoryRequest,
    @Query('groupBy') groupBy?: string,
    @Query('search') search?: string,
    @Query('materialCode') materialCode?: string,
    @Query('category') category?: string,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('expiringWithinDays') expiringWithinDays?: string,
    @Query('qualityStatus') qualityStatus?: string,
    @Query('stockState') stockState?: string,
    @Query('includeZero') includeZero?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.execute(() =>
      this.reports.stock(this.actor(request), {
        groupBy: groupBy as StockReportGroupBy | undefined,
        search,
        materialCode,
        category: category as MaterialCategory | undefined,
        warehouseCode,
        expiringWithinDays: numeric(expiringWithinDays),
        qualityStatus: qualityStatus as QualityStatus | undefined,
        stockState: stockState as SerialStockState | 'ALL' | undefined,
        includeZero: includeZero === 'true',
        limit: numeric(limit),
        offset: numeric(offset),
      }),
    );
  }

  /** Nhập, xuất, điều chuyển, nhập trả, điều chỉnh, chứng từ đảo theo kỳ. */
  @Get('movements')
  movements(
    @Req() request: InventoryRequest,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('docType') docType?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.execute(() =>
      this.reports.movements(this.actor(request), {
        fromDate,
        toDate,
        warehouseCode,
        docType: docType as StockDocumentType | undefined,
        category: category as StockMovementCategory | undefined,
        search,
        limit: numeric(limit),
        offset: numeric(offset),
      }),
    );
  }

  /** Lịch sử chứng từ phải duyệt: người lập, người duyệt, thời điểm, lý do. */
  @Get('approvals')
  approvals(
    @Req() request: InventoryRequest,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('docType') docType?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.execute(() =>
      this.reports.approvals(this.actor(request), {
        fromDate,
        toDate,
        warehouseCode,
        docType: docType as StockDocumentType | undefined,
        status: status as StockDocumentStatus | undefined,
        limit: numeric(limit),
        offset: numeric(offset),
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
      if (!(error instanceof InventoryError)) throw error;
      throw new HttpException(
        { ...error.details, statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
