import type {
  CompleteMaintenanceOccurrenceRequest,
  CreateMaintenanceIncidentRequest,
  CreateMaintenanceScheduleRequest,
  MaintenanceOccurrenceKind,
  MaintenanceOccurrenceStatus,
  MaintenanceSettingsKey,
  SaveMaintenanceMatrixRequest,
  UpdateMaintenanceScheduleRequest,
  UpdateMaintenanceSettingsRequest,
} from '@enterprise-platform/contracts-maintenance';
import { Body, Controller, Delete, Get, HttpCode, HttpException, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
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

  @Get('schedules') async schedules(@Req() request: MaintenanceRequest) {
    return (await this.maintenance.workspace(this.actor(request))).schedules;
  }

  @Post('schedules') createSchedule(@Req() request: MaintenanceRequest, @Body() input: CreateMaintenanceScheduleRequest) {
    return this.execute(() => this.maintenance.createSchedule(this.actor(request), input));
  }

  /** Bỏ qua đúng một lần bảo trì; lịch vẫn chạy tiếp. */
  @Post('schedules/:id/skip')
  @HttpCode(200)
  skipNextOccurrence(@Req() request: MaintenanceRequest, @Param('id') id: string) {
    return this.execute(() => this.maintenance.skipNextOccurrence(this.actor(request), id));
  }

  @Patch('schedules/:id') updateSchedule(@Req() request: MaintenanceRequest, @Param('id') id: string, @Body() input: UpdateMaintenanceScheduleRequest) {
    return this.execute(() => this.maintenance.updateSchedule(this.actor(request), id, input));
  }

  @Get('matrix') matrix(@Req() request: MaintenanceRequest) {
    return this.execute(() => this.maintenance.getMatrix(this.actor(request)));
  }

  @Post('matrix') @HttpCode(200)
  saveMatrix(@Req() request: MaintenanceRequest, @Body() input: SaveMaintenanceMatrixRequest) {
    return this.execute(() => this.maintenance.saveMatrix(this.actor(request), input));
  }

  @Get('occurrences') async occurrences(@Req() request: MaintenanceRequest) {
    return (await this.maintenance.workspace(this.actor(request))).occurrences;
  }

  @Get('occurrences/history')
  history(
    @Req() request: MaintenanceRequest,
    @Query('assetCode') assetCode?: string,
    @Query('kind') kind?: MaintenanceOccurrenceKind,
    @Query('status') status?: MaintenanceOccurrenceStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.execute(() =>
      this.maintenance.readHistory(this.actor(request), {
        assetCode, kind, status, from, to, cursor,
        limit: limit ? Number(limit) : undefined,
      }),
    );
  }

  @Post('occurrences/incidents')
  @HttpCode(201)
  createIncident(
    @Req() request: MaintenanceRequest,
    @Body() input: CreateMaintenanceIncidentRequest,
  ) {
    return this.execute(() => this.maintenance.createIncident(this.actor(request), input));
  }

  @Post('occurrences/:id/complete')
  @HttpCode(200)
  completeOccurrence(
    @Req() request: MaintenanceRequest,
    @Param('id') id: string,
    @Body() input: CompleteMaintenanceOccurrenceRequest,
  ) {
    return this.execute(() =>
      this.maintenance.completeOccurrence(this.actor(request), id, input?.note),
    );
  }

  @Get('occurrences/:id')
  getOccurrence(@Req() request: MaintenanceRequest, @Param('id') id: string) {
    return this.execute(() => this.maintenance.getOccurrence(this.actor(request), id));
  }

  /** Đầu việc của một thiết bị, đọc từ Kho để hiển thị ngay trong Bảo trì. */
  @Get('assets/:code/tasks')
  assetTasks(@Req() request: MaintenanceRequest, @Param('code') code: string) {
    return this.execute(() => this.maintenance.getAssetTasks(this.actor(request), code));
  }

  /**
   * Service-driven scheduler tick. The in-process 60s timer only covers tenants
   * already registered by a user request, so tenants with no active user would
   * never generate occurrences without this route.
   */
  @Post('internal/scheduler/run') @HttpCode(200)
  runSchedulerForService(@Req() request: MaintenanceRequest) {
    const actor = this.actor(request);
    return this.execute(async () => ({
      generated: await this.maintenance.generateDueOccurrences(actor.tenantId),
    }));
  }

  /** Retries occurrences stranded in 'dispatch_pending'; safe to call repeatedly. */
  @Post('internal/scheduler/reconcile') @HttpCode(200)
  reconcileForService(@Req() request: MaintenanceRequest) {
    const actor = this.actor(request);
    return this.execute(async () => ({
      recovered: await this.maintenance.reconcileStuckDispatches(actor.tenantId),
    }));
  }

  @Post('scheduler/run') @HttpCode(200)
  runScheduler(@Req() request: MaintenanceRequest) {
    const actor = this.actor(request);
    if (!actor.canManage) throw new HttpException({ statusCode: 403, code: 'FORBIDDEN' }, 403);
    return this.execute(async () => ({ generated: await this.maintenance.generateDueOccurrences(actor.tenantId) }));
  }

  /**
   * Cấu hình module.
   *
   * Đường dẫn cố ý không chứa `/occurrences`: MaintenanceAccessGuard suy quyền
   * bằng path, trúng chuỗi đó thì quyền ghi rơi xuống
   * `maintenance.occurrence.manage` thay vì `maintenance.manage`. Với đường dẫn
   * hiện tại, GET dùng quyền đọc sẵn có và PUT rơi vào nhánh mặc định
   * `maintenance.manage` — không phải sửa guard.
   */
  /** Gỡ thiết bị khỏi ma trận. Đường dẫn chứa `/matrix`, quyền rơi vào `maintenance.manage`. */
  @Delete('matrix/:assetCode') removeFromMatrix(
    @Req() request: MaintenanceRequest,
    @Param('assetCode') assetCode: string,
  ) {
    return this.execute(() =>
      this.maintenance.removeAssetFromMatrix(this.actor(request), assetCode),
    );
  }

  /** Bảo trì ngay: đẩy hạn về hiện tại rồi chạy đúng đường sinh phiếu thường ngày. */
  @Post('matrix/:assetCode/run') @HttpCode(200)
  runNow(@Req() request: MaintenanceRequest, @Param('assetCode') assetCode: string) {
    return this.execute(() => this.maintenance.runMaintenanceNow(this.actor(request), assetCode));
  }

  @Get('settings') getSettings(@Req() request: MaintenanceRequest) {
    return this.execute(() => this.maintenance.getSettings(this.actor(request)));
  }

  @Put('settings/:key') putSetting(
    @Req() request: MaintenanceRequest,
    @Param('key') key: string,
    @Body() body: UpdateMaintenanceSettingsRequest<unknown>,
  ) {
    return this.execute(() =>
      this.maintenance.updateSetting(this.actor(request), key as MaintenanceSettingsKey, body),
    );
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
