import { Body, Controller, Get, HttpException, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FulfilRequisitionRequest } from '@enterprise-platform/contracts-inventory';
import type { InventoryActor } from '../application/inventory.application.js';
import { RequisitionFulfilmentService } from '../application/requisition-fulfilment.service.js';
import { toInventoryError } from '../domain/inventory.error.js';

interface InventoryRequest {
  inventoryActor?: InventoryActor;
}

/**
 * Cấp vật tư theo yêu cầu của Quy trình (`v1/requisitions`, ISS-BE-031). Quyền ở
 * guard của inventory-api: cấp cần `inventory.transaction.write`, xem danh sách và
 * trạng thái cần `inventory.read`; service kiểm lại quyền ghi trên actor.
 */
@Controller('v1/requisitions')
export class RequisitionController {
  constructor(private readonly requisitions: RequisitionFulfilmentService) {}

  /** Mọi yêu cầu cấp vật tư còn phải xử lý (đọc từ Quy trình bằng service token). */
  @Get()
  list(@Req() request: InventoryRequest) {
    return this.execute(() => this.requisitions.list(this.actor(request)));
  }

  /** `?codes=a,b`: mã đã cấp trả FULFILLED kèm mã chứng từ, chưa cấp trả OPEN. */
  @Get('status')
  status(@Req() request: InventoryRequest, @Query('codes') codes?: string) {
    return this.execute(() =>
      this.requisitions.status(
        this.actor(request),
        (codes ?? '').split(',').map((code) => code.trim()).filter(Boolean),
      ),
    );
  }

  /** 201 khi vừa cấp; 200 khi gọi lại cùng mã cùng nội dung (trả chứng từ cũ). */
  @Post(':orderCode/fulfil')
  async fulfil(
    @Req() request: InventoryRequest,
    @Param('orderCode') orderCode: string,
    @Body() body: FulfilRequisitionRequest,
    @Res({ passthrough: true }) response: { status(code: number): unknown },
  ) {
    const result = await this.execute(() => this.requisitions.fulfil(this.actor(request), orderCode, body));
    response.status(result.replayed ? 200 : 201);
    return result;
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
        { ...known.details, statusCode: known.statusCode, code: known.code, message: known.message },
        known.statusCode,
      );
    }
  }
}
