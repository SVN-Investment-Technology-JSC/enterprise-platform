import type {
  BusinessPlanDecisionRequest,
  BusinessPlanDetail,
  BusinessPlanVersionRequest,
  SaveBusinessPlanRequest,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { BusinessPlanService } from '../application/business-plan.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

type Payload<T> = T | undefined;
const body = <T>(value: Payload<T>): T => value ?? ({} as T);

/**
 * Phương án kinh doanh (PAKD) của một phiên bản báo giá. Quyền kiểm ở `BusinessPlanService`: xem cần `crm.read`
 * (giá vốn, lợi nhuận cần `crm.quote.cost.read`), lập, sửa, trình cần `crm.quote.write`, duyệt, từ chối cần
 * `crm.quote.approve`. Báo giá ngoài phạm vi dữ liệu trả 404.
 */
@Controller('v1')
export class BusinessPlansController {
  constructor(@Inject(BusinessPlanService) private readonly plans: BusinessPlanService) {}

  /** PAKD của phiên bản; `null` khi chưa lập. */
  @Get('quotes/:id/versions/:versionNo/business-plan')
  get(@Req() request: CrmRequest, @Param('id') id: string, @Param('versionNo') versionNo: string): Promise<BusinessPlanDetail | null> {
    return runCrm(() => this.plans.get(crmActor(request), id, versionNo));
  }

  /** Tạo (chưa có) hoặc sửa (có `version`) PAKD khi phiên bản báo giá còn Nháp. */
  @Put('quotes/:id/versions/:versionNo/business-plan')
  save(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Body() payload: Payload<SaveBusinessPlanRequest>,
  ): Promise<BusinessPlanDetail> {
    return runCrm(() => this.plans.save(crmActor(request), id, versionNo, body(payload)));
  }

  @Post('quotes/:id/versions/:versionNo/business-plan/submit')
  submit(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Body() payload: Payload<BusinessPlanVersionRequest>,
  ): Promise<BusinessPlanDetail> {
    return runCrm(() => this.plans.submit(crmActor(request), id, versionNo, body(payload)));
  }

  @Post('quotes/:id/versions/:versionNo/business-plan/approve')
  approve(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Body() payload: Payload<BusinessPlanDecisionRequest>,
  ): Promise<BusinessPlanDetail> {
    return runCrm(() => this.plans.approve(crmActor(request), id, versionNo, body(payload)));
  }

  @Post('quotes/:id/versions/:versionNo/business-plan/reject')
  reject(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('versionNo') versionNo: string,
    @Body() payload: Payload<BusinessPlanDecisionRequest>,
  ): Promise<BusinessPlanDetail> {
    return runCrm(() => this.plans.reject(crmActor(request), id, versionNo, body(payload)));
  }
}
