import { Controller, Get, Param, Post, Body, HttpCode } from '@nestjs/common';
import { InventoryApplication } from '../application/inventory.application';
import type { CreateStockReservationRequest, StockReservation } from '@enterprise-platform/contracts-inventory';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly app: InventoryApplication) {}

  @Get('warehouses')
  async listWarehouses() {
    return this.app.listWarehouses();
  }

  @Get('warehouses/:code')
  async getWarehouse(@Param('code') code: string) {
    return this.app.getWarehouse(code);
  }

  @Get('materials')
  async listMaterials() {
    return this.app.listMaterials();
  }

  @Get('materials/:code')
  async getMaterial(@Param('code') code: string) {
    return this.app.getMaterial(code);
  }

  @Get('assets')
  async listAssets() {
    return this.app.listAssets();
  }

  @Get('assets/:code')
  async getAsset(@Param('code') code: string) {
    return this.app.getAsset(code);
  }

  @Get('internal/v1/assets/:code/task-template')
  async getAssetTaskTemplate(@Param('code') code: string) {
    const template = await this.app.resolveAssetTaskTemplate(code);
    return { task_template: template };
  }

  @Get('internal/v1/materials/:code/task-template')
  async getMaterialTaskTemplate(
    @Param('code') code: string,
  ) {
    const template = await this.app.resolveMaterialTaskTemplate(code);
    return { task_template: template };
  }

  @Post('v1/reservations')
  @HttpCode(201)
  async createReservation(
    @Body() request: CreateStockReservationRequest
  ): Promise<StockReservation> {
    return this.app.createStockReservation(request);
  }

  @Get('v1/reservations/:code')
  async getReservation(@Param('code') code: string) {
    return this.app.getReservation(code);
  }
}
