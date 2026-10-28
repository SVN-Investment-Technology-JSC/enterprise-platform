import type {
  ApprovalBinding,
  CreateQuoteRequest,
  CrmCatalogMaterial,
  CrmPage,
  ProcedureDefinitionOption,
  QuoteApprovalSettings,
  QuoteComparison,
  QuoteDecisionRequest,
  QuoteDetail,
  QuoteListQuery,
  QuoteRevisionRequest,
  QuoteSummary,
  SaveApprovalBindingRequest,
  SaveQuoteLineRequest,
  UpdateQuoteVersionRequest,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { QuoteApprovalSettingsService } from '../application/quote-approval-settings.service.js';
import type { QuoteStore } from '../application/quote-store.port.js';
import { CRM_QUOTE_STORE } from '../application/quote-store.port.js';
import { QuoteService } from '../application/quote.service.js';
import { CrmNotFoundError } from '../domain/crm.error.js';
import { isUuid } from '../domain/fields.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

type Payload<T> = T | undefined;
const body = <T>(value: Payload<T>): T => value ?? ({} as T);

/**
 * Báo giá theo phiên bản. Route sửa, chuyển trạng thái ghi rõ số phiên bản
 * (`/versions/:versionNo/...`) và `revision` trong thân: sửa phiên bản cũ trả
 * 409 "Phiên bản cũ chỉ đọc". Quyền kiểm ở `QuoteService`.
 */
@Controller('v1')
export class QuotesController {
  constructor(@Inject(QuoteService) private readonly quotes: QuoteService) {}

  @Get('quotes')
  list(@Req() request: CrmRequest, @Query() query: QuoteListQuery): Promise<CrmPage<QuoteSummary>> {
    return runCrm(() => this.quotes.list(crmActor(request), query));
  }

  @Post('quotes')
  create(@Req() request: CrmRequest, @Body() payload: Payload<CreateQuoteRequest>): Promise<QuoteDetail> {
    return runCrm(() => this.quotes.create(crmActor(request), body(payload)));
  }

  /** Mặt hàng trong danh mục Kho kèm tồn khả dụng, giá vốn bình quân (chọn khi thêm dòng). */
  @Get('catalog/materials')
  catalog(@Req() request: CrmRequest, @Query('search') search?: string, @Query('limit') limit?: string): Promise<CrmCatalogMaterial[]> {
    return runCrm(() => this.quotes.catalogMaterials(crmActor(request), { search, limit }));
  }

  @Get('quotes/:id')
  get(@Req() request: CrmRequest, @Param('id') id: string, @Query('version') version?: string): Promise<QuoteDetail> {
    return runCrm(() => this.quotes.get(crmActor(request), id, version));
  }

  @Get('quotes/:id/compare')
  compare(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<QuoteComparison> {
    return runCrm(() => this.quotes.compare(crmActor(request), id, from, to));
  }

  @Patch('quotes/:id/versions/:versionNo')
  updateVersion(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Body() payload: Payload<UpdateQuoteVersionRequest>,
  ): Promise<QuoteDetail> {
    return runCrm(() => this.quotes.updateVersion(crmActor(request), id, versionNo, body(payload)));
  }

  @Post('quotes/:id/versions/:versionNo/lines')
  addLine(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Body() payload: Payload<SaveQuoteLineRequest>,
  ): Promise<QuoteDetail> {
    return runCrm(() => this.quotes.addLine(crmActor(request), id, versionNo, body(payload)));
  }

  @Patch('quotes/:id/versions/:versionNo/lines/:lineId')
  updateLine(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Param('lineId') lineId: string,
    @Body() payload: Payload<SaveQuoteLineRequest>,
  ): Promise<QuoteDetail> {
    return runCrm(() => this.quotes.updateLine(crmActor(request), id, versionNo, lineId, body(payload)));
  }

  @Delete('quotes/:id/versions/:versionNo/lines/:lineId')
  removeLine(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Param('lineId') lineId: string,
    @Query('revision') revision?: string,
  ): Promise<QuoteDetail> {
    return runCrm(() => this.quotes.removeLine(crmActor(request), id, versionNo, lineId, revision));
  }

  @Post('quotes/:id/versions/:versionNo/recalculate')
  recalculate(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Body() payload: Payload<QuoteRevisionRequest>,
  ): Promise<QuoteDetail> {
    return runCrm(() => this.quotes.recalculate(crmActor(request), id, versionNo, body(payload)));
  }

  @Post('quotes/:id/versions/:versionNo/revise')
  revise(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Body() payload: Payload<QuoteRevisionRequest>,
  ): Promise<QuoteDetail> {
    return runCrm(() => this.quotes.revise(crmActor(request), id, versionNo, body(payload)));
  }

  @Post('quotes/:id/versions/:versionNo/:action')
  act(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Param('action') action: string,
    @Body() payload: Payload<QuoteDecisionRequest>,
  ): Promise<QuoteDetail> {
    return runCrm(() => {
      const actor = crmActor(request);
      const input = body(payload);
      switch (action) {
        case 'submit':
          return this.quotes.submit(actor, id, versionNo, input);
        case 'approve':
          return this.quotes.approve(actor, id, versionNo, input);
        case 'reject':
          return this.quotes.reject(actor, id, versionNo, input);
        case 'send':
          return this.quotes.send(actor, id, versionNo, input);
        case 'accept':
          return this.quotes.accept(actor, id, versionNo, input);
        case 'decline':
          return this.quotes.decline(actor, id, versionNo, input);
        default:
          return Promise.reject(new CrmNotFoundError());
      }
    });
  }
}

/** Cách duyệt theo loại và ngưỡng duyệt báo giá: đọc với `crm.read`, sửa với `crm.manage`. */
@Controller('v1')
export class ApprovalSettingsController {
  constructor(@Inject(QuoteApprovalSettingsService) private readonly settings: QuoteApprovalSettingsService) {}

  @Get('approval-bindings')
  bindings(@Req() request: CrmRequest): Promise<ApprovalBinding[]> {
    return runCrm(() => this.settings.bindings(crmActor(request)));
  }

  @Put('approval-bindings/:kind')
  saveBinding(
    @Req() request: CrmRequest,
    @Param('kind') kind: string,
    @Body() payload: Payload<SaveApprovalBindingRequest>,
  ): Promise<ApprovalBinding[]> {
    return runCrm(() => this.settings.saveBinding(crmActor(request), kind, body(payload)));
  }

  /** Quy trình đã công bố để gắn; hỏi Quy trình bằng phiên của chính người cấu hình. */
  @Get('approval-bindings/procedures')
  procedures(@Req() request: CrmRequest & { headers?: Record<string, string | string[] | undefined> }): Promise<ProcedureDefinitionOption[]> {
    const header = (name: string) => {
      const value = request.headers?.[name];
      return Array.isArray(value) ? value[0] : value;
    };
    return runCrm(() =>
      this.settings.procedureOptions(crmActor(request), { cookie: header('cookie'), authorization: header('authorization') }),
    );
  }

  @Get('quote-approval/settings')
  approvalSettings(@Req() request: CrmRequest): Promise<QuoteApprovalSettings> {
    return runCrm(() => this.settings.approvalSettings(crmActor(request)));
  }

  @Put('quote-approval/settings')
  saveApprovalSettings(@Req() request: CrmRequest, @Body() payload: unknown): Promise<QuoteApprovalSettings> {
    return runCrm(() => this.settings.saveApprovalSettings(crmActor(request), payload));
  }
}

/**
 * Quy trình hỏi trước khi thu hồi phiên duyệt báo giá (`HttpInstanceReversalGuard`
 * của Quy trình). Route nội bộ: guard xác thực `x-service-token`. Chặn khi báo
 * giá đã chuyển thành hợp đồng.
 */
@Controller('v1/internal')
export class InternalInstancesController {
  constructor(@Inject(CRM_QUOTE_STORE) private readonly quotes: QuoteStore) {}

  @Get('instances/:instanceId/reversal-check')
  reversalCheck(@Req() request: CrmRequest, @Param('instanceId') instanceId: string): Promise<{ allowed: boolean; reason?: string }> {
    return runCrm(async () => {
      const actor = crmActor(request);
      if (!isUuid(instanceId)) return { allowed: true };
      return this.quotes.reversalCheck(actor.tenantId, instanceId);
    });
  }
}
