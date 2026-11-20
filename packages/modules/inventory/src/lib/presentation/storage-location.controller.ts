import { Body, Controller, Get, HttpException, Param, Put, Query, Req } from '@nestjs/common';
import type {
  BulkStorageLocationsRequest,
  ReplaceStorageLocationsRequest,
  UpdateWarehouseLocationLevelsRequest,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from '../application/inventory.application.js';
import { StorageLocationService } from '../application/storage-location.service.js';
import { InventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

/**
 * Vị trí lưu trữ của mặt hàng theo kho (chuỗi tự do, tùy chọn). Đọc cần `inventory.read`; ghi dùng chung quyền sửa
 * danh mục `inventory.manage` (guard của inventory-api: mọi request ghi không thuộc nhóm khác đều rơi về quyền này).
 */
@Controller('v1')
export class StorageLocationController {
  constructor(private readonly locations: StorageLocationService) {}

  /** Mọi vị trí của một mặt hàng, ở mọi kho (giao diện nhóm theo kho). */
  @Get('materials/:code/storage-locations')
  listForMaterial(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.locations.listForMaterial(this.actor(request), code));
  }

  /** Thay toàn bộ vị trí của mặt hàng ở một kho; danh sách rỗng là xóa hết. */
  @Put('materials/:code/storage-locations/:warehouseCode')
  replace(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Param('warehouseCode') warehouseCode: string,
    @Body() body: ReplaceStorageLocationsRequest,
  ) {
    return this.execute(() => this.locations.replace(this.actor(request), code, warehouseCode, body));
  }

  /** Vị trí trong một kho; lọc theo mặt hàng hoặc tìm theo chuỗi vị trí, mã, tên hàng. */
  @Get('warehouses/:code/storage-locations')
  listForWarehouse(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Query('materialCode') materialCode?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.execute(() =>
      this.locations.list(this.actor(request), {
        warehouseCode: code,
        materialCode,
        q,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    );
  }

  /** Toàn tenant: dùng cho ô tìm hàng hóa tìm thêm theo vị trí. */
  @Get('storage-locations')
  list(
    @Req() request: InventoryRequest,
    @Query('q') q?: string,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('materialCode') materialCode?: string,
    @Query('limit') limit?: string,
  ) {
    return this.execute(() =>
      this.locations.list(this.actor(request), {
        q,
        warehouseCode,
        materialCode,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    );
  }

  /** Khai tên cấp của kho; `levels: null` để kho dùng lại mẫu của tenant. */
  @Put('warehouses/:code/location-levels')
  setLevels(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Body() body: UpdateWarehouseLocationLevelsRequest,
  ) {
    return this.execute(() => this.locations.setWarehouseLevels(this.actor(request), code, body));
  }

  /** Nạp danh sách vị trí lưu trữ hàng loạt (từ Excel hoặc đồng bộ). */
  @Put('storage-locations/bulk')
  bulkUpsert(@Req() request: InventoryRequest, @Body() body: BulkStorageLocationsRequest) {
    return this.execute(() => this.locations.bulkUpsert(this.actor(request), body));
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
