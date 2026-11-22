import { Body, Controller, Get, HttpCode, HttpException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type {
  CreateStocktakeRequest,
  StocktakeReasonRequest,
  StocktakeStatus,
  UpdateStocktakeLinesRequest,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from '../application/inventory.application.js';
import { StocktakeService } from '../application/stocktake.service.js';
import { toInventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

/**
 * Kiểm kê kho (`v1/stocktakes`). Quyền theo đường dẫn ở guard của inventory-api:
 * lập đợt, ghi số đếm, gửi duyệt, huỷ cần `inventory.stocktake.create`; duyệt,
 * trả về đếm lại, ghi sổ cân kho cần `inventory.stocktake.approve`. Service kiểm
 * lại lần nữa trên actor.
 */
@Controller('v1/stocktakes')
export class StocktakeController {
  constructor(private readonly stocktakes: StocktakeService) {}

  @Get()
  list(
    @Req() request: InventoryRequest,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.execute(() =>
      this.stocktakes.list(this.actor(request), {
        warehouseCode: warehouseCode || undefined,
        status: (status || undefined) as StocktakeStatus | undefined,
        search: search || undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      }),
    );
  }

  @Get(':id')
  get(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.stocktakes.get(this.actor(request), id));
  }

  @Get(':id/lines')
  lines(
    @Req() request: InventoryRequest,
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('hasDiffOnly') hasDiffOnly?: string,
  ) {
    return this.execute(() =>
      this.stocktakes.lines(this.actor(request), id, {
        status: (status || undefined) as 'UNCOUNTED' | 'MATCHED' | 'SURPLUS' | 'DEFICIT' | undefined,
        search: search || undefined,
        hasDiffOnly: hasDiffOnly === 'true' || hasDiffOnly === '1',
      }),
    );
  }

  /** Nhật ký sửa số đếm của cả đợt, phục vụ kiểm toán nội bộ. */
  @Get(':id/audit')
  audit(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.stocktakes.audits(this.actor(request), id));
  }

  @Post()
  @HttpCode(201)
  create(@Req() request: InventoryRequest, @Body() body: CreateStocktakeRequest) {
    return this.execute(() => this.stocktakes.create(this.actor(request), body));
  }

  /** Chụp snapshot tồn sổ sách và bắt đầu kiểm đếm. */
  @Post(':id/start')
  @HttpCode(200)
  start(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.stocktakes.start(this.actor(request), id));
  }

  @Patch(':id/lines')
  saveLines(
    @Req() request: InventoryRequest,
    @Param('id') id: string,
    @Body() body: UpdateStocktakeLinesRequest,
  ) {
    return this.execute(() => this.stocktakes.saveLines(this.actor(request), id, body));
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.stocktakes.submit(this.actor(request), id));
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Req() request: InventoryRequest,
    @Param('id') id: string,
    @Body() body: StocktakeReasonRequest,
  ) {
    return this.execute(() => this.stocktakes.reject(this.actor(request), id, body?.reason));
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.stocktakes.approve(this.actor(request), id));
  }

  /** Ghi sổ cân kho: tạo chứng từ điều chỉnh cho các dòng chênh lệch rồi khoá đợt. */
  @Post(':id/post')
  @HttpCode(200)
  post(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.stocktakes.post(this.actor(request), id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Req() request: InventoryRequest,
    @Param('id') id: string,
    @Body() body: StocktakeReasonRequest,
  ) {
    return this.execute(() => this.stocktakes.cancel(this.actor(request), id, body?.reason));
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
        {
          ...known.details,
          statusCode: known.statusCode,
          code: known.code,
          message: known.message,
        },
        known.statusCode,
      );
    }
  }
}
