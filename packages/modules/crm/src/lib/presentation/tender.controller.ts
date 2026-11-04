import type {
  CreateTenderProfileRequest,
  RecordTenderResultRequest,
  SaveTenderPartnerRequest,
  TenderDecisionRequest,
  TenderProfile,
  TenderVersionRequest,
  UpdateTenderProfileRequest,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { TenderService } from '../application/tender.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

type Payload<T> = T | undefined;
const body = <T>(value: Payload<T>): T => value ?? ({} as T);

/**
 * Hồ sơ thầu của cơ hội luồng Chào thầu (GĐ E). Xem cần `crm.read`; tạo, sửa, đối tác, trình duyệt và ghi kết quả
 * cần `crm.opportunity.write`; duyệt hoặc trả về sửa phương án cần `crm.quote.approve`. Cơ hội ngoài phạm vi dữ
 * liệu trả 404. Quyền kiểm ở `TenderService`.
 */
@Controller('v1')
export class TenderController {
  constructor(@Inject(TenderService) private readonly tender: TenderService) {}

  /** Hồ sơ thầu của cơ hội; `null` khi chưa có. */
  @Get('opportunities/:id/tender')
  get(@Req() request: CrmRequest, @Param('id') id: string): Promise<TenderProfile | null> {
    return runCrm(() => this.tender.get(crmActor(request), id));
  }

  @Post('opportunities/:id/tender')
  create(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload: Payload<CreateTenderProfileRequest>): Promise<TenderProfile> {
    return runCrm(() => this.tender.create(crmActor(request), id, body(payload)));
  }

  @Put('opportunities/:id/tender')
  update(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload: Payload<UpdateTenderProfileRequest>): Promise<TenderProfile> {
    return runCrm(() => this.tender.update(crmActor(request), id, body(payload)));
  }

  @Post('opportunities/:id/tender/partners')
  addPartner(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload: Payload<SaveTenderPartnerRequest>): Promise<TenderProfile> {
    return runCrm(() => this.tender.addPartner(crmActor(request), id, body(payload)));
  }

  @Put('opportunities/:id/tender/partners/:partnerId')
  updatePartner(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('partnerId') partnerId: string,
    @Body() payload: Payload<SaveTenderPartnerRequest>,
  ): Promise<TenderProfile> {
    return runCrm(() => this.tender.updatePartner(crmActor(request), id, partnerId, body(payload)));
  }

  @Delete('opportunities/:id/tender/partners/:partnerId')
  removePartner(@Req() request: CrmRequest, @Param('id') id: string, @Param('partnerId') partnerId: string): Promise<TenderProfile> {
    return runCrm(() => this.tender.removePartner(crmActor(request), id, partnerId));
  }

  @Post('opportunities/:id/tender/plan/submit')
  submitPlan(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload: Payload<TenderVersionRequest>): Promise<TenderProfile> {
    return runCrm(() => this.tender.submitPlan(crmActor(request), id, body(payload)));
  }

  @Post('opportunities/:id/tender/plan/approve')
  approvePlan(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload: Payload<TenderDecisionRequest>): Promise<TenderProfile> {
    return runCrm(() => this.tender.approvePlan(crmActor(request), id, body(payload)));
  }

  @Post('opportunities/:id/tender/plan/reject')
  rejectPlan(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload: Payload<TenderDecisionRequest>): Promise<TenderProfile> {
    return runCrm(() => this.tender.rejectPlan(crmActor(request), id, body(payload)));
  }

  @Post('opportunities/:id/tender/result')
  recordResult(@Req() request: CrmRequest, @Param('id') id: string, @Body() payload: Payload<RecordTenderResultRequest>): Promise<TenderProfile> {
    return runCrm(() => this.tender.recordResult(crmActor(request), id, body(payload)));
  }
}
