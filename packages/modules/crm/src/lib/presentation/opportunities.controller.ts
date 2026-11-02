import type {
  Activity,
  ActivityListQuery,
  ChangeOpportunityStageRequest,
  ConvertLeadRequest,
  ConvertLeadResult,
  CreateActivityRequest,
  CreateLeadRequest,
  CreateOpportunityRequest,
  CrmPage,
  Lead,
  LeadListQuery,
  MyStageTask,
  OpportunityBoard,
  OpportunityDetail,
  OpportunityListQuery,
  OpportunityStagePlan,
  OpportunitySummary,
  Pipeline,
  SkipStageRequest,
  StageRequirementCheck,
  UpdateActivityRequest,
  UpdateLeadRequest,
  UpdateOpportunityRequest,
  UpdateStageAssigneeRequest,
} from '@enterprise-platform/contracts-crm';
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ActivityService } from '../application/activity.service.js';
import { LeadService } from '../application/lead.service.js';
import { OpportunityService } from '../application/opportunity.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

/** Cơ hội: bảng, kanban, chi tiết kèm lịch sử, chuyển giai đoạn. */
@Controller('v1')
export class OpportunitiesController {
  constructor(@Inject(OpportunityService) private readonly opportunities: OpportunityService) {}

  @Get('opportunities')
  list(@Req() request: CrmRequest, @Query() query: OpportunityListQuery): Promise<CrmPage<OpportunitySummary>> {
    return runCrm(() => this.opportunities.list(crmActor(request), query));
  }

  @Get('opportunities/board')
  board(
    @Req() request: CrmRequest,
    @Query('ownerUserId') ownerUserId?: string,
    @Query('q') q?: string,
    @Query('pipelineId') pipelineId?: string,
  ): Promise<OpportunityBoard> {
    return runCrm(() => this.opportunities.board(crmActor(request), { ownerUserId, q, pipelineId }));
  }

  /** Các luồng của tenant kèm giai đoạn, bước chuyển, điều kiện (đọc, có cache ngắn). */
  @Get('opportunities/pipelines')
  pipelines(@Req() request: CrmRequest): Promise<readonly Pipeline[]> {
    return runCrm(() => this.opportunities.listPipelines(crmActor(request)));
  }

  /** "Việc của tôi": giai đoạn ACTIVE hoặc PENDING giao cho người gọi (`crm.read`). */
  @Get('opportunities/my-stage-tasks')
  myStageTasks(@Req() request: CrmRequest): Promise<readonly MyStageTask[]> {
    return runCrm(() => this.opportunities.myStageTasks(crmActor(request)));
  }

  @Post('opportunities')
  create(@Req() request: CrmRequest, @Body() body: CreateOpportunityRequest): Promise<OpportunityDetail> {
    return runCrm(() => this.opportunities.create(crmActor(request), body ?? ({} as never)));
  }

  @Get('opportunities/:id')
  get(@Req() request: CrmRequest, @Param('id') id: string): Promise<OpportunityDetail> {
    return runCrm(() => this.opportunities.get(crmActor(request), id));
  }

  /** Điều kiện chuyển vào giai đoạn `stage` và trạng thái đạt/chưa; `required = false` là gợi ý "cần có". */
  @Get('opportunities/:id/stage-requirements')
  stageRequirements(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Query('stage') stage?: string,
  ): Promise<readonly StageRequirementCheck[]> {
    return runCrm(() => this.opportunities.stageRequirements(crmActor(request), id, stage));
  }

  /** Kế hoạch giai đoạn của dự án: người đảm nhận, trạng thái, hạn, giai đoạn bỏ qua. */
  @Get('opportunities/:id/stage-plan')
  stagePlan(@Req() request: CrmRequest, @Param('id') id: string): Promise<OpportunityStagePlan> {
    return runCrm(() => this.opportunities.stagePlan(crmActor(request), id));
  }

  /** Gán hoặc ghi đè người đảm nhận một giai đoạn của riêng dự án (chủ dự án hoặc `crm.manage`). */
  @Patch('opportunities/:id/stage-plan/:stageId/assignee')
  updateStageAssignee(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() body: UpdateStageAssigneeRequest,
  ): Promise<OpportunityStagePlan> {
    return runCrm(() => this.opportunities.updateStageAssignee(crmActor(request), id, stageId, body ?? ({} as never)));
  }

  /** Bỏ qua một giai đoạn chưa tới (cần lý do; chủ dự án, người đảm nhận giai đoạn hiện tại hoặc `crm.manage`). */
  @Post('opportunities/:id/stage-plan/:stageId/skip')
  skipStage(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() body: SkipStageRequest,
  ): Promise<OpportunityStagePlan> {
    return runCrm(() => this.opportunities.skipStage(crmActor(request), id, stageId, body ?? ({} as never)));
  }

  @Patch('opportunities/:id')
  update(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: UpdateOpportunityRequest,
  ): Promise<OpportunityDetail> {
    return runCrm(() => this.opportunities.update(crmActor(request), id, body ?? ({} as never)));
  }

  /** Chuyển giai đoạn theo máy trạng thái; sai bảng chuyển 409, Thua thiếu lý do 400. */
  @Patch('opportunities/:id/stage')
  changeStage(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: ChangeOpportunityStageRequest,
  ): Promise<OpportunityDetail> {
    return runCrm(() => this.opportunities.changeStage(crmActor(request), id, body ?? ({} as never)));
  }
}

/** Lead và chuyển đổi lead. */
@Controller('v1')
export class LeadsController {
  constructor(@Inject(LeadService) private readonly leads: LeadService) {}

  @Get('leads')
  list(@Req() request: CrmRequest, @Query() query: LeadListQuery): Promise<CrmPage<Lead>> {
    return runCrm(() => this.leads.list(crmActor(request), query));
  }

  @Post('leads')
  create(@Req() request: CrmRequest, @Body() body: CreateLeadRequest): Promise<Lead> {
    return runCrm(() => this.leads.create(crmActor(request), body ?? ({} as never)));
  }

  @Get('leads/:id')
  get(@Req() request: CrmRequest, @Param('id') id: string): Promise<Lead> {
    return runCrm(() => this.leads.get(crmActor(request), id));
  }

  @Patch('leads/:id')
  update(@Req() request: CrmRequest, @Param('id') id: string, @Body() body: UpdateLeadRequest): Promise<Lead> {
    return runCrm(() => this.leads.update(crmActor(request), id, body ?? ({} as never)));
  }

  /** Chuyển thành khách hàng và cơ hội trong một transaction. */
  @Post('leads/:id/convert')
  convert(
    @Req() request: CrmRequest,
    @Param('id') id: string,
    @Body() body: ConvertLeadRequest,
  ): Promise<ConvertLeadResult> {
    return runCrm(() => this.leads.convert(crmActor(request), id, body ?? ({} as never)));
  }
}

/** Hoạt động chăm sóc khách hàng. */
@Controller('v1')
export class ActivitiesController {
  constructor(@Inject(ActivityService) private readonly activities: ActivityService) {}

  @Get('activities')
  list(@Req() request: CrmRequest, @Query() query: ActivityListQuery): Promise<CrmPage<Activity>> {
    return runCrm(() => this.activities.list(crmActor(request), query));
  }

  @Post('activities')
  create(@Req() request: CrmRequest, @Body() body: CreateActivityRequest): Promise<Activity> {
    return runCrm(() => this.activities.create(crmActor(request), body ?? ({} as never)));
  }

  @Get('activities/:id')
  get(@Req() request: CrmRequest, @Param('id') id: string): Promise<Activity> {
    return runCrm(() => this.activities.get(crmActor(request), id));
  }

  @Patch('activities/:id')
  update(@Req() request: CrmRequest, @Param('id') id: string, @Body() body: UpdateActivityRequest): Promise<Activity> {
    return runCrm(() => this.activities.update(crmActor(request), id, body ?? ({} as never)));
  }
}
