import type { AdminPipeline, PipelineTemplate } from '@enterprise-platform/contracts-crm';
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { PipelineConfigService } from '../application/pipeline-config.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

/**
 * Cấu hình luồng cơ hội (GĐ G). Guard bảo đảm `crm.read` và CSRF cho request ghi; MỌI route ở đây (kể cả đọc) chỉ cho
 * `crm.manage`, kiểm ở `PipelineConfigService` (403 nếu thiếu). Mỗi thao tác ghi trả cấu hình mới của mọi luồng.
 */
@Controller('v1/pipelines')
export class PipelinesController {
  constructor(@Inject(PipelineConfigService) private readonly pipelines: PipelineConfigService) {}

  @Get()
  list(@Req() request: CrmRequest): Promise<AdminPipeline[]> {
    return runCrm(() => this.pipelines.list(crmActor(request)));
  }

  @Get('templates')
  templates(@Req() request: CrmRequest): Promise<readonly PipelineTemplate[]> {
    return runCrm(async () => this.pipelines.templates(crmActor(request)));
  }

  @Post()
  create(@Req() request: CrmRequest, @Body() body: unknown): Promise<AdminPipeline[]> {
    return runCrm(() => this.pipelines.createPipeline(crmActor(request), body));
  }

  @Put('order')
  reorder(@Req() request: CrmRequest, @Body() body: unknown): Promise<AdminPipeline[]> {
    return runCrm(() => this.pipelines.reorderPipelines(crmActor(request), body));
  }

  @Patch(':pipelineId')
  update(@Req() request: CrmRequest, @Param('pipelineId') pipelineId: string, @Body() body: unknown): Promise<AdminPipeline[]> {
    return runCrm(() => this.pipelines.updatePipeline(crmActor(request), pipelineId, body));
  }

  @Put(':pipelineId/default')
  setDefault(@Req() request: CrmRequest, @Param('pipelineId') pipelineId: string): Promise<AdminPipeline[]> {
    return runCrm(() => this.pipelines.setDefaultPipeline(crmActor(request), pipelineId));
  }

  @Delete(':pipelineId')
  remove(@Req() request: CrmRequest, @Param('pipelineId') pipelineId: string): Promise<AdminPipeline[]> {
    return runCrm(() => this.pipelines.deletePipeline(crmActor(request), pipelineId));
  }

  @Post(':pipelineId/stages')
  addStage(@Req() request: CrmRequest, @Param('pipelineId') pipelineId: string, @Body() body: unknown): Promise<AdminPipeline[]> {
    return runCrm(() => this.pipelines.addStage(crmActor(request), pipelineId, body));
  }

  @Put(':pipelineId/stages/order')
  reorderStages(@Req() request: CrmRequest, @Param('pipelineId') pipelineId: string, @Body() body: unknown): Promise<AdminPipeline[]> {
    return runCrm(() => this.pipelines.reorderStages(crmActor(request), pipelineId, body));
  }

  @Patch(':pipelineId/stages/:stageId')
  updateStage(
    @Req() request: CrmRequest,
    @Param('pipelineId') pipelineId: string,
    @Param('stageId') stageId: string,
    @Body() body: unknown,
  ): Promise<AdminPipeline[]> {
    return runCrm(() => this.pipelines.updateStage(crmActor(request), pipelineId, stageId, body));
  }

  @Delete(':pipelineId/stages/:stageId')
  removeStage(
    @Req() request: CrmRequest,
    @Param('pipelineId') pipelineId: string,
    @Param('stageId') stageId: string,
  ): Promise<AdminPipeline[]> {
    return runCrm(() => this.pipelines.deleteStage(crmActor(request), pipelineId, stageId));
  }

  @Put(':pipelineId/stages/:stageId/transitions')
  setTransitions(
    @Req() request: CrmRequest,
    @Param('pipelineId') pipelineId: string,
    @Param('stageId') stageId: string,
    @Body() body: unknown,
  ): Promise<AdminPipeline[]> {
    return runCrm(() => this.pipelines.setTransitions(crmActor(request), pipelineId, stageId, body));
  }

  @Put(':pipelineId/stages/:stageId/requirements')
  setRequirements(
    @Req() request: CrmRequest,
    @Param('pipelineId') pipelineId: string,
    @Param('stageId') stageId: string,
    @Body() body: unknown,
  ): Promise<AdminPipeline[]> {
    return runCrm(() => this.pipelines.setRequirements(crmActor(request), pipelineId, stageId, body));
  }
}
