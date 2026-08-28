import { Body, Controller, Delete, Get, HttpCode, HttpException, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type {
  AddAssetBomRequest,
  CreateAssetDocumentRequest,
  CreateAssetRequest,
  CreateMaterialRequest,
  CreateStockReservationRequest,
  CreateWarehouseRequest,
  InstallItemRequest,
  InventorySettingsKey,
  RegisterSerialsRequest,
  ReturnItemToStockRequest,
  UninstallMaterialRequest,
  UpdateAssetRequest,
  UpdateMaterialRequest,
  UpdateSerialRequest,
  UpdateSettingsRequest,
  UpdateWarehouseRequest,
} from '@enterprise-platform/contracts-inventory';
import { AssetDocumentService } from '../application/asset-document.service.js';
import { InventoryApplication, type InventoryActor } from '../application/inventory.application.js';
import { InventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

@Controller('v1')
export class InventoryController {
  constructor(
    private readonly app: InventoryApplication,
    private readonly documents: AssetDocumentService,
  ) {}

  @Get('warehouses')
  listWarehouses(@Req() request: InventoryRequest) {
    return this.execute(() => this.app.listWarehouses(this.actor(request)));
  }

  /** Gồm cả kho đã ngừng dùng — cho màn Cài đặt. */
  @Get('warehouses/all')
  listAllWarehouses(@Req() request: InventoryRequest) {
    return this.execute(() => this.app.listAllWarehouses(this.actor(request)));
  }

  @Post('warehouses')
  createWarehouse(@Req() request: InventoryRequest, @Body() body: CreateWarehouseRequest) {
    return this.execute(() => this.app.createWarehouse(this.actor(request), body));
  }

  @Patch('warehouses/:code')
  updateWarehouse(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Body() body: UpdateWarehouseRequest,
  ) {
    return this.execute(() => this.app.updateWarehouse(this.actor(request), code, body));
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

  /** Lịch sử nhập/xuất của một mã vật tư, cho màn chi tiết. */
  /** Danh mục hợp nhất: vật tư kho và thiết bị chung một danh sách. */
  @Get('items')
  listItems(@Req() request: InventoryRequest) {
    return this.execute(() => this.app.listItems(this.actor(request)));
  }

  /** Lắp vật tư từ kho vào một thiết bị — một lệnh xuất. */
  @Post('items/:code/install')
  @HttpCode(200)
  installItem(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Body() body: InstallItemRequest,
  ) {
    return this.execute(() => this.app.installItem(this.actor(request), code, body));
  }

  /** Hồ sơ đầy đủ của một mã bất kỳ — kho hay đã lắp đều mở được. */
  @Get('items/:code')
  getItemProfile(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.app.getItemProfile(this.actor(request), code));
  }

  @Patch('items/:code')
  updateItemProfile(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Body() body: UpdateAssetRequest,
  ) {
    return this.execute(() => this.app.updateItemProfile(this.actor(request), code, body));
  }

  /** Vật tư đang lắp trên từng thiết bị, suy từ sổ cái. */
  @Get('installations')
  listInstalled(@Req() request: InventoryRequest) {
    return this.execute(() => this.app.listInstalled(this.actor(request)));
  }

  /** Tháo một đơn vị đang lắp khỏi cây, nhập ngược về kho. */
  @Post('items/:code/uninstall')
  @HttpCode(200)
  uninstallMaterial(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Body() body: UninstallMaterialRequest,
  ) {
    return this.execute(() => this.app.uninstallMaterial(this.actor(request), code, body));
  }

  /** Thanh lý: tháo khỏi cây và nhập về kho được chọn. */
  @Post('items/:code/return')
  @HttpCode(200)
  returnItem(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Body() body: ReturnItemToStockRequest,
  ) {
    return this.execute(() => this.app.returnItemToStock(this.actor(request), code, body));
  }

  @Get('materials/:code/history')
  listMaterialHistory(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Query('limit') limit?: string,
  ) {
    return this.execute(() =>
      this.app.listMaterialHistory(this.actor(request), code, Number(limit) || 50),
    );
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
  listSerials(@Req() request: InventoryRequest, @Query('materialCode') materialCode?: string) {
    return this.execute(() => this.app.listSerials(this.actor(request), materialCode));
  }

  /** Khai sê-ri cho một mã vật tư — làm lúc nhập kho, khi còn cầm hiện vật. */
  @Post('serials')
  @HttpCode(200)
  registerSerials(@Req() request: InventoryRequest, @Body() body: RegisterSerialsRequest) {
    return this.execute(() => this.app.registerSerials(this.actor(request), body));
  }

  /** Sửa tình trạng / vị trí sử dụng của MỘT cá thể. */
  @Patch('serials/:materialCode/:serialNumber')
  updateSerial(
    @Req() request: InventoryRequest,
    @Param('materialCode') materialCode: string,
    @Param('serialNumber') serialNumber: string,
    @Body() body: UpdateSerialRequest,
  ) {
    return this.execute(() =>
      this.app.updateSerial(this.actor(request), materialCode, serialNumber, body),
    );
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
  /**
   * Danh mục vật tư cho module khác. `available` là tồn khả dụng gộp mọi kho,
   * đọc tươi mỗi lần gọi — không bao giờ đóng băng, khác với `name`/`unit`.
   */
  @Get('internal/materials')
  async listMaterialsForServices(@Req() request: InventoryRequest) {
    return this.execute(async () => ({
      materials: await this.app.listMaterialsWithStock(this.actor(request)),
    }));
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

  /**
   * Tài liệu đính kèm của thiết bị.
   *
   * Đường dẫn dùng `documents`, tránh mọi chuỗi mà InventoryAccessGuard đang dò
   * (`receipts`/`issues`/`transfers`/`reservations`), nên quyền ghi rơi đúng vào
   * nhánh mặc định `inventory.manage`.
   */
  @Get('assets/:code/documents')
  listDocuments(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.documents.list(this.actor(request), code));
  }

  @Post('assets/:code/documents')
  createDocument(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Body() body: CreateAssetDocumentRequest,
  ) {
    return this.execute(() => this.documents.create(this.actor(request), code, body));
  }

  @Get('assets/:code/documents/:documentId/download')
  downloadDocument(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Param('documentId') documentId: string,
  ) {
    return this.execute(async () => ({
      url: await this.documents.downloadUrl(this.actor(request), code, documentId),
    }));
  }

  @Delete('assets/:code/documents/:documentId')
  @HttpCode(204)
  removeDocument(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Param('documentId') documentId: string,
  ) {
    return this.execute(() => this.documents.remove(this.actor(request), code, documentId));
  }

  /** Phụ tùng tiêu chuẩn của thiết bị; đường dẫn rơi vào quyền `inventory.manage` khi ghi. */
  @Get('assets/:code/spare-parts')
  listSpareParts(@Req() request: InventoryRequest, @Param('code') code: string) {
    return this.execute(() => this.app.listAssetBom(this.actor(request), code));
  }

  @Post('assets/:code/spare-parts')
  addSparePart(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Body() body: AddAssetBomRequest,
  ) {
    return this.execute(() => this.app.addAssetBom(this.actor(request), code, body));
  }

  @Delete('assets/:code/spare-parts/:bomId')
  @HttpCode(204)
  removeSparePart(
    @Req() request: InventoryRequest,
    @Param('code') code: string,
    @Param('bomId') bomId: string,
  ) {
    return this.execute(() => this.app.removeAssetBom(this.actor(request), code, bomId));
  }

  /**
   * Cấu hình module.
   *
   * Đường dẫn cố ý không chứa `receipts`/`issues`/`transfers`/`reservations`:
   * InventoryAccessGuard suy quyền bằng `path.includes(...)`, trúng một trong
   * các chuỗi đó thì quyền ghi bị hạ xuống `inventory.transaction.write` thay
   * vì `inventory.manage`. Với đường dẫn hiện tại, GET rơi vào quyền đọc sẵn có
   * và PUT rơi vào nhánh mặc định `inventory.manage` — không phải sửa guard.
   */
  @Get('settings')
  getSettings(@Req() request: InventoryRequest) {
    return this.execute(() => this.app.getSettings(this.actor(request)));
  }

  @Put('settings/:key')
  putSetting(
    @Req() request: InventoryRequest,
    @Param('key') key: string,
    @Body() body: UpdateSettingsRequest<unknown>,
  ) {
    return this.execute(() =>
      this.app.updateSetting(this.actor(request), key as InventorySettingsKey, body),
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
        { statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
