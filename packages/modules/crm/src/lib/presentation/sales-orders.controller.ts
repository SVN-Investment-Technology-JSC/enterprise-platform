import type {
  ConvertQuoteResult,
  CreateSalesOrderRequest,
  CrmMaterialStock,
  CrmPage,
  CrmWarehouseOption,
  SalesOrderActionRequest,
  SalesOrderDetail,
  SalesOrderListQuery,
  SalesOrderSummary,
  SalesSettings,
  SaveDeliveryPlanRequest,
  UpdateSalesOrderRequest,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { QuoteConversionService } from '../application/quote-conversion.service.js';
import { SalesOrderService } from '../application/sales-order.service.js';
import { CrmNotFoundError } from '../domain/crm.error.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

type Payload<T> = T | undefined;
const body = <T>(value: Payload<T>): T => value ?? ({} as T);

/**
 * Đơn bán, kế hoạch giao, yêu cầu xuất kho (T4-08 đến T4-11, T4-13) và chuyển
 * báo giá thành hợp đồng, đơn (T4-06). Đọc với `crm.read` trong phạm vi dữ
 * liệu; ghi với `crm.order.write`, kiểm ở service. Thao tác gửi `revision` của
 * đơn để không ghi đè người khác.
 */
@Controller('v1')
export class SalesOrdersController {
  constructor(
    @Inject(SalesOrderService) private readonly orders: SalesOrderService,
    @Inject(QuoteConversionService) private readonly conversion: QuoteConversionService,
  ) {}

  @Get('orders')
  list(@Req() request: CrmRequest, @Query() query: SalesOrderListQuery): Promise<CrmPage<SalesOrderSummary>> {
    return runCrm(() => this.orders.list(crmActor(request), query));
  }

  @Post('orders')
  create(@Req() request: CrmRequest, @Body() payload: Payload<CreateSalesOrderRequest>): Promise<SalesOrderDetail> {
    return runCrm(() => this.orders.create(crmActor(request), body(payload)));
  }

  /** Tồn khả dụng theo kho của các mặt hàng (`?materialIds=a,b`), để chọn kho giữ hàng, kho xuất. */
  @Get('catalog/stock')
  stock(@Req() request: CrmRequest, @Query('materialIds') materialIds?: string): Promise<CrmMaterialStock[]> {
    return runCrm(() => this.orders.materialStock(crmActor(request), materialIds));
  }

  /** Danh sách kho của Kho (`?search=&codes=`) để chọn kho xuất trong kế hoạch giao (T4-19). */
  @Get('catalog/warehouses')
  warehouses(
    @Req() request: CrmRequest,
    @Query('search') search?: string,
    @Query('codes') codes?: string,
  ): Promise<CrmWarehouseOption[]> {
    return runCrm(() => this.orders.warehouses(crmActor(request), { search, codes }));
  }

  @Get('orders/:id')
  get(@Req() request: CrmRequest, @Param('id') id: string): Promise<SalesOrderDetail> {
    return runCrm(() => this.orders.get(crmActor(request), id));
  }

  @Patch('orders/:id')
  update(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload: Payload<UpdateSalesOrderRequest>): Promise<SalesOrderDetail> {
    return runCrm(() => this.orders.update(crmActor(request), id, body(payload)));
  }

  @Post('orders/:id/deliveries')
  addDelivery(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() payload: Payload<SaveDeliveryPlanRequest>,
  ): Promise<SalesOrderDetail> {
    return runCrm(() => this.orders.saveDelivery(crmActor(request), id, null, body(payload)));
  }

  @Patch('orders/:id/deliveries/:deliveryId')
  updateDelivery(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
    @Body() payload: Payload<SaveDeliveryPlanRequest>,
  ): Promise<SalesOrderDetail> {
    return runCrm(() => this.orders.saveDelivery(crmActor(request), id, deliveryId, body(payload)));
  }

  /** `request-issue` (yêu cầu xuất kho), `cancel` (bỏ đợt chưa yêu cầu xuất). */
  @Post('orders/:id/deliveries/:deliveryId/:action')
  deliveryAction(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
    @Param('action') action: string,
    @Body() payload: Payload<SalesOrderActionRequest>,
  ): Promise<SalesOrderDetail> {
    return runCrm(() => {
      const actor = crmActor(request);
      if (action === 'request-issue') return this.orders.requestIssue(actor, id, deliveryId, body(payload));
      if (action === 'cancel') return this.orders.cancelDelivery(actor, id, deliveryId, body(payload));
      return Promise.reject(new CrmNotFoundError());
    });
  }

  /** `confirm`, `cancel`, `close`. */
  @Post('orders/:id/:action')
  act(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() payload: Payload<SalesOrderActionRequest>,
  ): Promise<SalesOrderDetail> {
    return runCrm(() => {
      const actor = crmActor(request);
      const input = body(payload);
      switch (action) {
        case 'confirm':
          return this.orders.confirm(actor, id, input);
        case 'cancel':
          return this.orders.cancel(actor, id, input);
        case 'close':
          return this.orders.close(actor, id, input);
        default:
          return Promise.reject(new CrmNotFoundError());
      }
    });
  }

  /** Báo giá Khách chấp nhận → hợp đồng, đơn, kế hoạch giao mặc định; gọi lại trả kết quả lần đầu. */
  @Post('quotes/:id/convert')
  convert(@Req() request: CrmRequest, @Param('id') id: string): Promise<ConvertQuoteResult> {
    return runCrm(() => this.conversion.convert(crmActor(request), id));
  }

  @Get('sales-settings')
  settings(@Req() request: CrmRequest): Promise<SalesSettings> {
    return runCrm(() => this.orders.salesSettings(crmActor(request)));
  }

  @Put('sales-settings')
  saveSettings(@Req() request: CrmRequest, @Body() payload: Payload<Partial<SalesSettings>>): Promise<SalesSettings> {
    return runCrm(() => this.orders.saveSalesSettings(crmActor(request), body(payload)));
  }
}
