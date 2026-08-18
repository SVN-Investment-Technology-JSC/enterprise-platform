import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { CreateStockReservationRequest } from '@enterprise-platform/contracts-inventory';
import { InventoryApplication } from '../application/inventory.application.js';

interface InventoryRequest {
  headers: Record<string, string | string[] | undefined>;
}

@Controller('v1')
export class InventoryController {
  constructor(private readonly app: InventoryApplication) {}

  @Get('warehouses')
  listWarehouses() {
    return this.app.listWarehouses();
  }

  @Get('warehouses/:code')
  getWarehouse(@Param('code') code: string) {
    return this.app.getWarehouse(code);
  }

  @Get('warehouses/:code/stock')
  listStock(@Param('code') code: string) {
    return this.app.listStockByWarehouse(code);
  }

  @Get('materials')
  listMaterials() {
    return this.app.listMaterials();
  }

  @Get('materials/:code')
  getMaterial(@Param('code') code: string) {
    return this.app.getMaterial(code);
  }

  @Get('materials/:code/stock')
  getStockLevel(@Param('code') code: string, @Query('warehouseCode') warehouseCode: string) {
    return this.app.getStockLevel(code, warehouseCode);
  }

  @Get('assets')
  listAssets() {
    return this.app.listAssets();
  }

  @Get('assets/:code')
  getAsset(@Param('code') code: string) {
    return this.app.getAsset(code);
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
    return this.app.receiveStock({ ...body, createdBy: this.actorId(request) });
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
    return this.app.issueStock({ ...body, createdBy: this.actorId(request) });
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
    return this.app.transferStock({ ...body, createdBy: this.actorId(request) });
  }

  @Post('reservations')
  @HttpCode(201)
  createReservation(
    @Req() request: InventoryRequest,
    @Body() body: CreateStockReservationRequest,
  ) {
    return this.app.createStockReservation(body, this.actorId(request));
  }

  @Get('reservations/:code')
  getReservation(@Param('code') code: string) {
    return this.app.getReservation(code);
  }

  /** Called by Procedure when a Role E step sources its task list from an asset. */
  @Get('internal/assets/:code/task-template')
  async getAssetTaskTemplate(@Param('code') code: string) {
    return { taskTemplate: await this.app.resolveAssetTaskTemplate(code) };
  }

  private actorId(request: InventoryRequest): string {
    const header = request.headers['x-user-id'];
    const value = Array.isArray(header) ? header[0] : header;
    return value?.trim() || 'system';
  }
}
