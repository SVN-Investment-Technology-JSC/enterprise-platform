import type {
  AddQuoteFollowerRequest,
  AddQuoteLinkRequest,
  AddQuoteLinesRequest,
  CustomFieldDefinition,
  QuoteFollower,
  QuoteLink,
  SaveCustomFieldRequest,
  ApprovalBinding,
  BusinessPlanDeviationSettings,
  CreateQuoteRequest,
  CrmCatalogMaterial,
  CrmPage,
  ProcedureDefinitionOption,
  QuoteApprovalSettings,
  QuoteComparison,
  QuoteDecisionRequest,
  QuoteDetail,
  QuoteListQuery,
  QuoteCodeSettings,
  QuoteTemplate,
  QuoteTemplateLayout,
  QuoteType,
  GeneratedQuoteCode,
  SaveQuoteTemplateLayoutRequest,
  SaveQuoteCodeSettingsRequest,
  SaveQuoteTemplateRequest,
  SaveQuoteTypeRequest,
  QuoteRevisionRequest,
  QuoteSummary,
  SaveApprovalBindingRequest,
  SaveQuoteLineRequest,
  UpdateQuoteVersionRequest,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { BusinessPlanService } from '../application/business-plan.service.js';
import { QuoteApprovalSettingsService } from '../application/quote-approval-settings.service.js';
import type { QuoteStore } from '../application/quote-store.port.js';
import { CRM_QUOTE_STORE } from '../application/quote-store.port.js';
import { QuoteFormService } from '../application/quote-form.service.js';
import { QuoteRelationService } from '../application/quote-relation.service.js';
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

  /** Thêm nhiều dòng một lần cho báo giá Nháp: tất cả hoặc không dòng nào. */
  @Post('quotes/:id/versions/:versionNo/lines/batch')
  addLines(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Body() payload: Payload<AddQuoteLinesRequest>,
  ): Promise<QuoteDetail> {
    return runCrm(() => this.quotes.addLines(crmActor(request), id, versionNo, body(payload)));
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

/**
 * Báo giá theo mẫu (GĐI): mẫu báo giá, loại báo giá, mẫu mã báo giá. Đọc cần `crm.read`; thêm, sửa, tắt chỉ
 * `crm.manage`; sinh mã cần quyền lập báo giá. Kiểm quyền ở `QuoteFormService`.
 */
@Controller('v1')
export class QuoteFormController {
  constructor(@Inject(QuoteFormService) private readonly form: QuoteFormService) {}

  @Get('quote-templates')
  templates(@Req() request: CrmRequest, @Query('includeInactive') includeInactive?: string): Promise<QuoteTemplate[]> {
    return runCrm(() => this.form.listTemplates(crmActor(request), includeInactive));
  }

  @Post('quote-templates')
  createTemplate(@Req() request: CrmRequest, @Body() payload: Payload<SaveQuoteTemplateRequest>): Promise<QuoteTemplate> {
    return runCrm(() => this.form.createTemplate(crmActor(request), body(payload)));
  }

  @Put('quote-templates/:id')
  updateTemplate(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() payload: Payload<SaveQuoteTemplateRequest>,
  ): Promise<QuoteTemplate> {
    return runCrm(() => this.form.updateTemplate(crmActor(request), id, body(payload)));
  }

  /** Bố cục in của mẫu (phase 3): đọc `crm.read`; lưu, xoá (`layout: null`) chỉ `crm.manage`. Kiểm ở `QuoteFormService`. */
  @Get('quote-templates/:id/layout')
  templateLayout(@Req() request: CrmRequest, @Param('id') id: string): Promise<QuoteTemplateLayout> {
    return runCrm(() => this.form.getLayout(crmActor(request), id));
  }

  /** Thân lớn tới 2 MB (bố cục có ảnh): giới hạn riêng cho route này đặt ở `apps/crm-api` (`configureCrmBodyParsers`). */
  @Put('quote-templates/:id/layout')
  saveTemplateLayout(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() payload: Payload<SaveQuoteTemplateLayoutRequest>,
  ): Promise<QuoteTemplateLayout> {
    return runCrm(() => this.form.saveLayout(crmActor(request), id, body(payload)));
  }

  @Get('quote-types')
  types(@Req() request: CrmRequest, @Query('includeInactive') includeInactive?: string): Promise<QuoteType[]> {
    return runCrm(() => this.form.listTypes(crmActor(request), includeInactive));
  }

  @Post('quote-types')
  createType(@Req() request: CrmRequest, @Body() payload: Payload<SaveQuoteTypeRequest>): Promise<QuoteType> {
    return runCrm(() => this.form.createType(crmActor(request), body(payload)));
  }

  @Put('quote-types/:id')
  updateType(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload: Payload<SaveQuoteTypeRequest>): Promise<QuoteType> {
    return runCrm(() => this.form.updateType(crmActor(request), id, body(payload)));
  }

  @Get('quote-code-settings')
  codeSettings(@Req() request: CrmRequest): Promise<QuoteCodeSettings> {
    return runCrm(() => this.form.codeSettings(crmActor(request)));
  }

  @Put('quote-code-settings')
  saveCodeSettings(@Req() request: CrmRequest, @Body() payload: Payload<SaveQuoteCodeSettingsRequest>): Promise<QuoteCodeSettings> {
    return runCrm(() => this.form.saveCodeSettings(crmActor(request), body(payload)));
  }

  /** Trường tuỳ biến (P2I-06): đọc `crm.read`; thêm, sửa, tắt (`active: false`) chỉ `crm.manage`. */
  @Get('custom-fields')
  customFields(
    @Req() request: CrmRequest,
    @Query('entityType') entityType?: string,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<CustomFieldDefinition[]> {
    return runCrm(() => this.form.listCustomFields(crmActor(request), entityType, includeInactive));
  }

  @Post('custom-fields')
  createCustomField(@Req() request: CrmRequest, @Body() payload: Payload<SaveCustomFieldRequest>): Promise<CustomFieldDefinition> {
    return runCrm(() => this.form.createCustomField(crmActor(request), body(payload)));
  }

  @Put('custom-fields/:id')
  updateCustomField(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() payload: Payload<SaveCustomFieldRequest>,
  ): Promise<CustomFieldDefinition> {
    return runCrm(() => this.form.updateCustomField(crmActor(request), id, body(payload)));
  }

  /** Nút "sinh lại" mã báo giá: lấy số kế tiếp. */
  @Post('quotes/code/generate')
  generateCode(@Req() request: CrmRequest): Promise<GeneratedQuoteCode> {
    return runCrm(() => this.form.generateCode(crmActor(request)));
  }
}

/**
 * Người theo dõi và đối tượng liên quan của báo giá (P2I-07). Đọc theo phạm vi đọc của báo giá; thêm, bỏ cần
 * `crm.quote.write` và báo giá trong phạm vi ghi (người theo dõi tự bỏ theo dõi được). Kiểm quyền ở `QuoteRelationService`.
 */
@Controller('v1')
export class QuoteRelationController {
  constructor(@Inject(QuoteRelationService) private readonly relations: QuoteRelationService) {}

  @Get('quotes/:id/followers')
  followers(@Req() request: CrmRequest, @Param('id') id: string): Promise<QuoteFollower[]> {
    return runCrm(() => this.relations.listFollowers(crmActor(request), id));
  }

  @Post('quotes/:id/followers')
  addFollower(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload: Payload<AddQuoteFollowerRequest>): Promise<QuoteFollower[]> {
    return runCrm(() => this.relations.addFollower(crmActor(request), id, body(payload)));
  }

  @Delete('quotes/:id/followers/:userId')
  removeFollower(@Req() request: CrmRequest, @Param('id') id: string, @Param('userId') userId: string): Promise<QuoteFollower[]> {
    return runCrm(() => this.relations.removeFollower(crmActor(request), id, userId));
  }

  @Get('quotes/:id/links')
  links(@Req() request: CrmRequest, @Param('id') id: string): Promise<QuoteLink[]> {
    return runCrm(() => this.relations.listLinks(crmActor(request), id));
  }

  @Post('quotes/:id/links')
  addLink(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload: Payload<AddQuoteLinkRequest>): Promise<QuoteLink[]> {
    return runCrm(() => this.relations.addLink(crmActor(request), id, body(payload)));
  }

  @Delete('quotes/:id/links/:linkId')
  removeLink(@Req() request: CrmRequest, @Param('id') id: string, @Param('linkId') linkId: string): Promise<QuoteLink[]> {
    return runCrm(() => this.relations.removeLink(crmActor(request), id, linkId));
  }
}

/** Cách duyệt theo loại và ngưỡng duyệt báo giá: đọc với `crm.read`, sửa với `crm.manage`. */
@Controller('v1')
export class ApprovalSettingsController {
  constructor(
    @Inject(QuoteApprovalSettingsService) private readonly settings: QuoteApprovalSettingsService,
    @Inject(BusinessPlanService) private readonly plans: BusinessPlanService,
  ) {}

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

  /** Cách so lệch PAKD khi sửa báo giá đã duyệt (theo lợi nhuận hay chiết khấu) và ngưỡng: đọc `crm.read`, sửa `crm.manage`. */
  @Get('quote-approval/business-plan-settings')
  businessPlanSettings(@Req() request: CrmRequest): Promise<BusinessPlanDeviationSettings> {
    return runCrm(() => this.plans.deviationSettings(crmActor(request)));
  }

  @Put('quote-approval/business-plan-settings')
  saveBusinessPlanSettings(@Req() request: CrmRequest, @Body() payload: unknown): Promise<BusinessPlanDeviationSettings> {
    return runCrm(() => this.plans.saveDeviationSettings(crmActor(request), payload));
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
