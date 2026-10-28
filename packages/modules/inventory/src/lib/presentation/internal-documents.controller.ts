import { Body, Controller, HttpCode, HttpException, Param, Post, Req } from '@nestjs/common';
import type {
  InternalChangeQualityRequest,
  InternalIssueRequest,
  InternalReturnReceiptRequest,
  InternalStockDocumentRequest,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from '../application/inventory.application.js';
import { QualityService } from '../application/quality.service.js';
import { StockDocumentService } from '../application/stock-document.service.js';
import { InventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

/**
 * Chứng từ kho do Bán hàng yêu cầu (T1-25, T1-26), gọi service-to-service qua
 * route `internal/`. Các API tạo chứng từ bắt buộc `idempotencyKey`: cùng khoá
 * cùng nội dung trả chứng từ đã tạo, khác nội dung thì 409. Bảo hành (T6-05)
 * thêm điều chuyển, xuất khác và đổi chất lượng thay người kiểm định.
 */
@Controller('v1/internal')
export class InternalDocumentsController {
  constructor(
    private readonly documents: StockDocumentService,
    private readonly quality: QualityService,
  ) {}

  /** Chứng từ xuất nháp (xuất bán hoặc xuất bảo hành) gắn giữ hàng và nguồn. */
  @Post('issue-requests')
  @HttpCode(200)
  createIssueRequest(@Req() request: InventoryRequest, @Body() body: InternalIssueRequest) {
    return this.execute(() => this.documents.createIssueRequest(this.actor(request), body));
  }

  /** Nhập trả vào kho cách ly, ghi sổ ngay, hàng Chờ kiểm định. */
  @Post('return-receipts')
  @HttpCode(200)
  createReturnReceipt(@Req() request: InventoryRequest, @Body() body: InternalReturnReceiptRequest) {
    return this.execute(() => this.documents.receiveReturn(this.actor(request), body));
  }

  /** Điều chuyển (ghi sổ ngay) hoặc xuất khác (gửi duyệt) có nguồn. */
  @Post('stock-documents')
  @HttpCode(200)
  createStockDocument(@Req() request: InventoryRequest, @Body() body: InternalStockDocumentRequest) {
    return this.execute(() => this.documents.createInternalDocument(this.actor(request), body));
  }

  /** Đổi chất lượng serial; lý do bắt buộc, `actorUserId` ghi vào lịch sử. */
  @Post('serials/:serial/quality')
  @HttpCode(200)
  changeSerialQuality(
    @Req() request: InventoryRequest,
    @Param('serial') serial: string,
    @Body() body: InternalChangeQualityRequest,
  ) {
    return this.execute(() => this.quality.changeSerialForService(this.actor(request), serial, body));
  }

  /** Đổi chất lượng lô (hàng nhập trả không theo serial). */
  @Post('lots/:id/quality')
  @HttpCode(200)
  changeLotQuality(@Req() request: InventoryRequest, @Param('id') id: string, @Body() body: InternalChangeQualityRequest) {
    return this.execute(() => this.quality.changeLotForService(this.actor(request), id, body));
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
