import type {
  CreateWarrantyCaseRequest,
  CrmPage,
  InspectWarrantyLineRequest,
  ResolveWarrantyLineRequest,
  WarrantyActionRequest,
  WarrantyCaseDetail,
  WarrantyCaseListQuery,
  WarrantyCaseSummary,
  WarrantyLookupItem,
  WarrantyLookupQuery,
  WarrantySerialHistory,
  WarrantySettings,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { WarrantyResolutionService } from '../application/warranty-resolution.service.js';
import { WarrantyService } from '../application/warranty.service.js';
import { CrmNotFoundError } from '../domain/crm.error.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

type Payload<T> = T | undefined;
const body = <T>(value: Payload<T>): T => value ?? ({} as T);

/**
 * Bảo hành, đổi trả (GĐ6): tra cứu hạn bảo hành, tiếp nhận, nhận hàng về kho
 * cách ly, kiểm định, hướng xử lý và chứng từ, đóng. Đọc với `crm.read` trong
 * phạm vi dữ liệu; ghi với `crm.warranty.write`, cấu hình kho với
 * `crm.manage`, kiểm ở service. Thao tác gửi `revision` của yêu cầu.
 */
@Controller('v1/warranty')
export class WarrantyController {
  constructor(
    @Inject(WarrantyService) private readonly warranty: WarrantyService,
    @Inject(WarrantyResolutionService) private readonly resolution: WarrantyResolutionService,
  ) {}

  /** Tra theo `serial`, `orderId` hoặc `customerId`. */
  @Get('lookup')
  lookup(@Req() request: CrmRequest, @Query() query: WarrantyLookupQuery): Promise<WarrantyLookupItem[]> {
    return runCrm(() => this.warranty.lookup(crmActor(request), query));
  }

  @Get('serials/:serial/history')
  serialHistory(@Req() request: CrmRequest, @Param('serial') serial: string): Promise<WarrantySerialHistory> {
    return runCrm(() => this.warranty.serialHistory(crmActor(request), serial));
  }

  @Get('settings')
  settings(@Req() request: CrmRequest): Promise<WarrantySettings> {
    return runCrm(() => this.warranty.settings(crmActor(request)));
  }

  @Put('settings')
  saveSettings(@Req() request: CrmRequest, @Body() payload: Payload<Partial<WarrantySettings>>): Promise<WarrantySettings> {
    return runCrm(() => this.warranty.saveSettings(crmActor(request), body(payload)));
  }

  @Get('cases')
  list(@Req() request: CrmRequest, @Query() query: WarrantyCaseListQuery): Promise<CrmPage<WarrantyCaseSummary>> {
    return runCrm(() => this.warranty.list(crmActor(request), query));
  }

  @Post('cases')
  create(@Req() request: CrmRequest, @Body() payload: Payload<CreateWarrantyCaseRequest>): Promise<WarrantyCaseDetail> {
    return runCrm(() => this.warranty.create(crmActor(request), body(payload)));
  }

  @Get('cases/:id')
  get(@Req() request: CrmRequest, @Param('id') id: string): Promise<WarrantyCaseDetail> {
    return runCrm(() => this.warranty.get(crmActor(request), id));
  }

  /** `inspect` (kết quả kiểm định), `resolve` (hướng xử lý và chứng từ). */
  @Post('cases/:id/lines/:lineId/:action')
  lineAction(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Param('action') action: string,
    @Body() payload: Payload<InspectWarrantyLineRequest & ResolveWarrantyLineRequest>,
  ): Promise<WarrantyCaseDetail> {
    return runCrm(() => {
      const actor = crmActor(request);
      if (action === 'inspect') return this.warranty.inspect(actor, id, lineId, body(payload));
      if (action === 'resolve') return this.resolution.resolve(actor, id, lineId, body(payload));
      return Promise.reject(new CrmNotFoundError());
    });
  }

  /** `receive` (nhận hàng về kho cách ly), `reject`, `sync-documents` (gửi lại chứng từ), `close`. */
  @Post('cases/:id/:action')
  act(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() payload: Payload<WarrantyActionRequest>,
  ): Promise<WarrantyCaseDetail> {
    return runCrm(() => {
      const actor = crmActor(request);
      const input = body(payload);
      switch (action) {
        case 'receive':
          return this.warranty.receiveGoods(actor, id, input);
        case 'reject':
          return this.warranty.reject(actor, id, input);
        case 'sync-documents':
          return this.resolution.syncDocuments(actor, id, input);
        case 'close':
          return this.warranty.close(actor, id, input);
        default:
          return Promise.reject(new CrmNotFoundError());
      }
    });
  }
}
