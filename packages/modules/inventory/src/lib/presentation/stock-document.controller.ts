import { Body, Controller, Get, HttpCode, HttpException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type {
  CreateStockDocumentRequest,
  RejectStockDocumentRequest,
  StockDocumentStatus,
  StockDocumentType,
  UpdateStockDocumentRequest,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from '../application/inventory.application.js';
import { StockDocumentService } from '../application/stock-document.service.js';
import { InventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

/**
 * Chứng từ kho (`v1/stock-documents`). Quyền theo đường dẫn ở guard của
 * inventory-api: ghi cần `inventory.transaction.write`, duyệt và từ chối cần
 * `inventory.document.approve`; service kiểm lại lần nữa trên actor.
 */
@Controller('v1/stock-documents')
export class StockDocumentController {
  constructor(private readonly documents: StockDocumentService) {}

  @Get()
  list(
    @Req() request: InventoryRequest,
    @Query('docType') docType?: string,
    @Query('status') status?: string,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.execute(() =>
      this.documents.list(this.actor(request), {
        docType: (docType || undefined) as StockDocumentType | undefined,
        status: (status || undefined) as StockDocumentStatus | undefined,
        warehouseCode: warehouseCode || undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      }),
    );
  }

  @Get(':id')
  get(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.get(this.actor(request), id));
  }

  @Post()
  @HttpCode(201)
  create(@Req() request: InventoryRequest, @Body() body: CreateStockDocumentRequest) {
    return this.execute(() => this.documents.create(this.actor(request), body));
  }

  @Patch(':id')
  update(
    @Req() request: InventoryRequest,
    @Param('id') id: string,
    @Body() body: UpdateStockDocumentRequest,
  ) {
    return this.execute(() => this.documents.update(this.actor(request), id, body));
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.submit(this.actor(request), id));
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.approve(this.actor(request), id));
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Req() request: InventoryRequest,
    @Param('id') id: string,
    @Body() body: RejectStockDocumentRequest,
  ) {
    return this.execute(() => this.documents.reject(this.actor(request), id, body));
  }

  @Post(':id/post')
  @HttpCode(200)
  post(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.post(this.actor(request), id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.cancel(this.actor(request), id));
  }

  /** Tạo chứng từ đảo của chứng từ đã ghi sổ và ghi sổ ngay. */
  @Post(':id/reverse')
  @HttpCode(201)
  reverse(@Req() request: InventoryRequest, @Param('id') id: string) {
    return this.execute(() => this.documents.reverse(this.actor(request), id));
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
