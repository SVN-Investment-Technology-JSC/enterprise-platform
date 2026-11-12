import { Body, Controller, Get, HttpCode, HttpException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type {
  CreateStocktakeRequest,
  UpdateStocktakeLineInput,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from '../application/inventory.application.js';
import { StocktakeService } from '../application/stocktake.service.js';
import { toInventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

/**
 * Kiểm kê kho (`v1/stocktakes`). Ghi/đếm cần `inventory.transaction.write`;
 * duyệt/trả kiểm đếm lại cần `inventory.stocktake.approve`.
 */
@Controller('v1/stocktakes')
export class StocktakeController {
  constructor(private readonly stocktakes: StocktakeService) {}

  @Get()
  list(@Req() request: InventoryRequest) {
    return this.execute(() => this.stocktakes.listSessions(this.actor(request)));
  }

  @Get('latest-by-material')
  latestByMaterial(
    @Req() request: InventoryRequest,
    @Query('materialCode') materialCode: string,
  ) {
    return this.execute(() =>
      this.stocktakes.latestByMaterial(this.actor(request), materialCode),
    );
  }

  @Get(':id/lines')
  lines(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.stocktakes.listLines(this.actor(request), id));
  }

  @Post()
  @HttpCode(201)
  create(
    @Req() request: InventoryRequest,
    @Body() body: CreateStocktakeRequest,
  ) {
    return this.execute(() => this.stocktakes.createSession(this.actor(request), body));
  }

  @Post(':id/start')
  @HttpCode(200)
  start(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.stocktakes.startCounting(this.actor(request), id));
  }

  @Patch(':id/lines')
  saveLines(
    @Req() request: InventoryRequest,
    @Param('id') id: string,
    @Body() body: { lines: readonly UpdateStocktakeLineInput[] },
  ) {
    return this.execute(() =>
      this.stocktakes.saveLines(this.actor(request), id, body?.lines ?? []),
    );
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.stocktakes.submitForApproval(this.actor(request), id));
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.stocktakes.approveAndPost(this.actor(request), id));
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Req() request: InventoryRequest,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.execute(() =>
      this.stocktakes.rejectSession(this.actor(request), id, body?.reason),
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Req() request: InventoryRequest,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.execute(() =>
      this.stocktakes.cancelSession(this.actor(request), id, body?.reason),
    );
  }

  private actor(request: InventoryRequest): InventoryActor {
    if (!request.inventoryActor) {
      throw new HttpException({ code: 'UNAUTHORIZED', message: 'Thiếu thông tin xác thực Inventory.' }, 401);
    }
    return request.inventoryActor;
  }

  private async execute<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      const mapped = toInventoryError(error);
      if (mapped) {
        throw new HttpException({ code: mapped.code, message: mapped.message }, mapped.statusCode);
      }
      throw error;
    }
  }
}
