import { Body, Controller, Delete, Get, HttpCode, HttpException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type {
  CreateAssetRequest,
  CreateMaterialRequest,
  CreateStockReservationRequest,
  UpdateAssetRequest,
  UpdateMaterialRequest,
} from '@enterprise-platform/contracts-inventory';
import { InventoryApplication, type InventoryActor } from '../application/inventory.application.js';
import { InventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

@Controller('v1')
export class InventoryController {
  constructor(private readonly app: InventoryApplication) {}

  @Get('warehouses')
  listWarehouses(@Req() request: InventoryRequest) {
    return this.execute(() => this.app.listWarehouses(this.actor(request)));
  }

  @Get('warehouses/:code')
  getWarehouse(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.app.getWarehouse(this.actor(request), code));
  }

  @Get('warehouses/:code/stock')
  listStock(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.app.listStockByWarehouse(this.actor(request), code));
  }

  @Get('materials')
  listMaterials(@Req() request: InventoryRequest) {
    return this.execute(() => this.app.listMaterials(this.actor(request)));
  }

  @Get('materials/:code')
  getMaterial(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.app.getMaterial(this.actor(request), code));
  }

  @Post('materials')
  createMaterial(@Req() request: InventoryRequest, @Body() input: CreateMaterialRequest) {
    return this.execute(() => this.app.createMaterial(this.actor(request), input));
  }

  @Patch('materials/:code')
  updateMaterial(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Body() input: UpdateMaterialRequest,
  ) {
    return this.execute(() => this.app.updateMaterial(this.actor(request), code, input));
  }

  /** Ngừng dùng vật tư: xoá hẳn nếu chưa có giao dịch, ngược lại chỉ hạ cờ hoạt động. */
  @Delete('materials/:code')
  retireMaterial(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.app.retireMaterial(this.actor(request), code));
  }

  @Get('materials/:code/stock')
  getStockLevel(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Query('warehouseCode') warehouseCode: string,
  ) {
    return this.execute(() => this.app.getStockLevel(this.actor(request), code, warehouseCode));
  }

  @Get('assets')
  listAssets(@Req() request: InventoryRequest) {
    return this.execute(() => this.app.listAssets(this.actor(request)));
  }

  @Get('assets/:code')
  getAsset(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.app.getAsset(this.actor(request), code));
  }

  @Post('assets')
  createAsset(@Req() request: InventoryRequest, @Body() input: CreateAssetRequest) {
    return this.execute(() => this.app.createAsset(this.actor(request), input));
  }

  /** Thanh lý thiết bị: xoá hẳn nếu chưa có thiết bị con, ngược lại đánh dấu DISPOSED. */
  @Delete('assets/:code')
  retireAsset(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.app.retireAsset(this.actor(request), code));
  }

  @Patch('assets/:code')
  updateAsset(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Body() input: UpdateAssetRequest,
  ) {
    return this.execute(() => this.app.updateAsset(this.actor(request), code, input));
  }

  @Post('receipts')
  @HttpCode(201)
  receiveStock(
    @Req() request: InventoryRequest,
    @Body()
    body: {
      warehouseCode: string;
      materialCode: string;
      quantity: number;
      unitCost?: number;
      referenceType?: string;
      referenceId?: string;
      note?: string;
    },
  ) {
    return this.execute(() => this.app.receiveStock(this.actor(request), body));
  }

  @Post('issues')
  @HttpCode(201)
  issueStock(
    @Req() request: InventoryRequest,
    @Body()
    body: {
      warehouseCode: string;
      materialCode: string;
      quantity: number;
      referenceType?: string;
      referenceId?: string;
      note?: string;
    },
  ) {
    return this.execute(() => this.app.issueStock(this.actor(request), body));
  }

  @Post('transfers')
  @HttpCode(201)
  transferStock(
    @Req() request: InventoryRequest,
    @Body()
    body: {
      fromWarehouseCode: string;
      toWarehouseCode: string;
      materialCode: string;
      quantity: number;
      note?: string;
    },
  ) {
    return this.execute(() => this.app.transferStock(this.actor(request), body));
  }

  @Post('reservations')
  @HttpCode(201)
  createReservation(
    @Req() request: InventoryRequest,
    @Body() body: CreateStockReservationRequest,
  ) {
    return this.execute(() => this.app.createStockReservation(this.actor(request), body));
  }

  @Get('transactions')
  listTransactions(@Req() request: InventoryRequest, @Query('limit') limit?: string) {
    return this.execute(() =>
      this.app.listRecentTransactions(this.actor(request), Number(limit) || 50),
    );
  }

  @Get('reservations')
  listReservations(@Req() request: InventoryRequest) {
    return this.execute(() => this.app.listReservations(this.actor(request)));
  }

  @Get('serials')
  listSerials(@Req() request: InventoryRequest) {
    return this.execute(() => this.app.listSerials(this.actor(request)));
  }

  @Get('reservations/:code')
  getReservation(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.app.getReservation(this.actor(request), code));
  }

  /** Called by Maintenance to build the equipment maintenance matrix. */
  @Get('internal/assets')
  async listAssetsForServices(@Req() request: InventoryRequest) {
    return this.execute(async () => {
      const assets = await this.app.listAssets(this.actor(request));
      const codeById = new Map(assets.map((asset) => [asset.id, asset.code]));
      return {
        assets: assets.map((asset) => ({
          code: asset.code,
          name: asset.name,
          type: asset.type,
          parentCode: asset.parentId ? codeById.get(asset.parentId) : undefined,
          orgUnitId: asset.orgUnitId,
          taskCount: asset.taskTemplate?.length ?? 0,
        })),
      };
    });
  }

  /** Gọi bởi Quy trình khi công bố: kiểm mã vật tư có thật và lấy tên/đơn vị để đóng băng. */
  @Get('internal/materials')
  async listMaterialsForServices(@Req() request: InventoryRequest) {
    return this.execute(async () => {
      const materials = await this.app.listMaterials(this.actor(request));
      return { materials: materials.map(({ code, name, unit }) => ({ code, name, unit })) };
    });
  }

  /** Gọi bởi Quy trình khi công bố: kiểm mã vật tư có thật và lấy tên/đơn vị để đóng băng. */
  @Get('internal/materials/:code')
  async getMaterialForServices(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(async () => {
      const material = await this.app.getMaterial(this.actor(request), code);
      return {
        code: material.code,
        name: material.name,
        unit: material.unit,
        isActive: material.isActive,
      };
    });
  }

  @Post('reservations/:code/release')
  @HttpCode(200)
  releaseReservation(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.app.releaseReservation(this.actor(request), code));
  }

  /** Quy trình giữ chỗ vật tư cho một bước; gọi service-to-service. */
  @Post('internal/reservations')
  @HttpCode(200)
  createReservationForServices(
    @Req() request: InventoryRequest,
    @Body() input: CreateStockReservationRequest,
  ) {
    return this.execute(() => this.app.createStockReservation(this.actor(request), input));
  }

  /** Quy trình nhả giữ chỗ khi bước xong, hồ sơ huỷ, hoặc bước bị trả lại. */
  @Post('internal/reservations/:code/release')
  @HttpCode(200)
  releaseReservationForServices(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.app.releaseReservation(this.actor(request), code));
  }

  /** Gọi bởi Quy trình lúc chạy: bước có đủ vật tư để làm không. */
  @Get('internal/materials/:code/availability')
  getAvailabilityForServices(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.app.getAvailability(this.actor(request), code));
  }

  /** Called by Procedure when a Role E step sources its task list from an asset. */
  @Get('internal/assets/:code/task-template')
  async getAssetTaskTemplate(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(async () => ({
      taskTemplate: await this.app.resolveAssetTaskTemplate(this.actor(request), code),
    }));
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
        { statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
