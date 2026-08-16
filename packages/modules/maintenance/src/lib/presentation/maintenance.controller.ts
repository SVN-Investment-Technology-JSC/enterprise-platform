import type {
  CreateMaintenanceAssetRequest,
  CreateMaintenanceJobPlanRequest,
  CreateMaintenanceScheduleRequest,
  UpdateMaintenanceAssetRequest,
  UpdateMaintenanceScheduleRequest,
} from '@enterprise-platform/contracts-maintenance';
import { Body, Controller, Get, HttpCode, HttpException, Param, Patch, Post, Req } from '@nestjs/common';
import { MaintenanceApplication } from '../application/maintenance.application.js';
import type { MaintenanceActor } from '../application/maintenance-store.port.js';
import { MaintenanceError } from '../domain/maintenance.error.js';

interface MaintenanceRequest { maintenanceActor?: MaintenanceActor }

@Controller('v1')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceApplication) {}

  @Get('workspace') workspace(@Req() request: MaintenanceRequest) {
    return this.execute(() => this.maintenance.workspace(this.actor(request)));
  }

  @Get('assets') async assets(@Req() request: MaintenanceRequest) {
    return (await this.maintenance.workspace(this.actor(request))).assets;
  }

  @Post('assets') createAsset(@Req() request: MaintenanceRequest, @Body() input: CreateMaintenanceAssetRequest) {
    return this.execute(() => this.maintenance.createAsset(this.actor(request), input));
  }

  @Patch('assets/:id') updateAsset(@Req() request: MaintenanceRequest, @Param('id') id: string, @Body() input: UpdateMaintenanceAssetRequest) {
    return this.execute(() => this.maintenance.updateAsset(this.actor(request), id, input));
  }

  @Get('job-plans') async jobPlans(@Req() request: MaintenanceRequest) {
    return (await this.maintenance.workspace(this.actor(request))).jobPlans;
  }

  @Post('job-plans') createJobPlan(@Req() request: MaintenanceRequest, @Body() input: CreateMaintenanceJobPlanRequest) {
    return this.execute(() => this.maintenance.createJobPlan(this.actor(request), input));
  }

  @Get('schedules') async schedules(@Req() request: MaintenanceRequest) {
    return (await this.maintenance.workspace(this.actor(request))).schedules;
  }

  @Post('schedules') createSchedule(@Req() request: MaintenanceRequest, @Body() input: CreateMaintenanceScheduleRequest) {
    return this.execute(() => this.maintenance.createSchedule(this.actor(request), input));
  }

  @Patch('schedules/:id') updateSchedule(@Req() request: MaintenanceRequest, @Param('id') id: string, @Body() input: UpdateMaintenanceScheduleRequest) {
    return this.execute(() => this.maintenance.updateSchedule(this.actor(request), id, input));
  }

  @Get('occurrences') async occurrences(@Req() request: MaintenanceRequest) {
    return (await this.maintenance.workspace(this.actor(request))).occurrences;
  }

  @Get('dashboard') async dashboard(@Req() request: MaintenanceRequest) {
    const workspace = await this.maintenance.workspace(this.actor(request));
    return { metrics: workspace.metrics, occurrences: workspace.occurrences, schedules: workspace.schedules };
  }

  @Post('scheduler/run') @HttpCode(200)
  runScheduler(@Req() request: MaintenanceRequest) {
    const actor = this.actor(request);
    if (!actor.canManage) throw new HttpException({ statusCode: 403, code: 'FORBIDDEN' }, 403);
    return this.execute(async () => ({ generated: await this.maintenance.generateDueOccurrences(actor.tenantId) }));
  }

  private actor(request: MaintenanceRequest): MaintenanceActor {
    if (!request.maintenanceActor) throw new HttpException({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Thiếu trusted maintenance context.' }, 401);
    return request.maintenanceActor;
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (!(error instanceof MaintenanceError)) throw error;
      const status = { validation: 400, forbidden: 403, not_found: 404, conflict: 409 }[error.code];
      throw new HttpException({ statusCode: status, code: error.code.toUpperCase(), message: error.message }, status);
    }
  }
}
