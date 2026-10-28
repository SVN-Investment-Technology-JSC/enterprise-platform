import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ExecuteTaskActionDto } from '@enterprise-platform/contracts-task-approval';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmTaskApprovalService } from '../application/hrm-task-approval.service.js';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';

@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1/tasks')
export class HrmTaskApprovalController {
  constructor(
    private readonly ctx: HrmContextService,
    private readonly taskService: HrmTaskApprovalService,
  ) {}

  /**
   * Lấy danh sách tác vụ phê duyệt HRM đang chờ xử lý của người dùng hiện tại
   */
  @Get('pending')
  @RequirePermission('hrm.read')
  async getPendingTasks(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const { tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const pageResult = await this.taskService.getPendingTasks(
      tenantId,
      principal.userId,
      {
        limit: limit ? Math.min(100, Math.max(1, Number(limit))) : 20,
        offset: offset ? Math.max(0, Number(offset)) : 0,
      },
      principal,
    );

    return {
      data: pageResult.items,
      total: pageResult.total,
      limit: pageResult.limit,
      offset: pageResult.offset,
    };
  }

  /**
   * Lấy chi tiết tác vụ theo loại đơn và ID
   */
  @Get(':kind/:id')
  @RequirePermission('hrm.read')
  async getTaskDetail(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    const { tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const task = await this.taskService.getTaskDetail(
      tenantId,
      principal.userId,
      `hrm:${kind}:${id}`,
      principal,
    );
    return { data: task };
  }

  /**
   * Lấy chi tiết tác vụ theo taskId đầy đủ (ví dụ: hrm:correction:uuid)
   */
  @Get(':taskId')
  @RequirePermission('hrm.read')
  async getTaskDetailByTaskId(
    @Req() req: Request,
    @Param('taskId') taskId: string,
  ) {
    const { tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const task = await this.taskService.getTaskDetail(
      tenantId,
      principal.userId,
      taskId,
      principal,
    );
    return { data: task };
  }

  /**
   * Thực thi hành động phê duyệt hoặc từ chối (bắt buộc lý do)
   */
  @Post(':kind/:id/actions')
  @RequirePermission('hrm.read')
  async executeTaskAction(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: ExecuteTaskActionDto,
  ) {
    const { tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const result = await this.taskService.executeAction(
      tenantId,
      principal.userId,
      `hrm:${kind}:${id}`,
      body,
      principal,
    );
    return { data: result };
  }

  /**
   * Thực thi hành động phê duyệt hoặc từ chối theo taskId đầy đủ
   */
  @Post(':taskId/actions')
  @RequirePermission('hrm.read')
  async executeTaskActionByTaskId(
    @Req() req: Request,
    @Param('taskId') taskId: string,
    @Body() body: ExecuteTaskActionDto,
  ) {
    const { tenantId, principal } = await this.ctx.getContext(req, 'hrm.read');
    const result = await this.taskService.executeAction(
      tenantId,
      principal.userId,
      taskId,
      body,
      principal,
    );
    return { data: result };
  }
}

