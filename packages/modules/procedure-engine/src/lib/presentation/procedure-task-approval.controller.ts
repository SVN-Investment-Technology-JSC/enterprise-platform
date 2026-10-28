import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { ExecuteTaskActionDto } from '@enterprise-platform/contracts-task-approval';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { ProcedureEngineError } from '../domain/procedure-engine.error.js';
import { ProcedureTaskApprovalService } from '../application/procedure-task-approval.service.js';

interface ProcedureRequest {
  procedureActor?: ProcedureActor;
}

@Controller('v1/tasks')
export class ProcedureTaskApprovalController {
  constructor(
    private readonly taskService: ProcedureTaskApprovalService,
  ) {}

  /**
   * Lấy danh sách hồ sơ quy trình đang chờ người dùng hiện tại xử lý
   */
  @Get('pending')
  getPendingTasks(
    @Req() request: ProcedureRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const actor = this.actor(request);
    return this.execute(async () => {
      const pageResult = await this.taskService.getPendingTasks(
        actor.tenantId,
        actor.userId,
        {
          limit: limit ? Math.min(100, Math.max(1, Number(limit))) : 20,
          offset: offset ? Math.max(0, Number(offset)) : 0,
        },
        actor,
      );

      return {
        data: pageResult.items,
        total: pageResult.total,
        limit: pageResult.limit,
        offset: pageResult.offset,
      };
    });
  }

  /**
   * Lấy chi tiết tác vụ quy trình theo ID hồ sơ hoặc taskId
   */
  @Get(':id')
  getTaskDetail(
    @Req() request: ProcedureRequest,
    @Param('id') id: string,
  ) {
    const actor = this.actor(request);
    return this.execute(async () => {
      const task = await this.taskService.getTaskDetail(
        actor.tenantId,
        actor.userId,
        id,
        actor,
      );
      return { data: task };
    });
  }

  /**
   * Thực thi hành động phê duyệt, từ chối hoặc yêu cầu làm lại hồ sơ
   */
  @Post(':id/actions')
  @HttpCode(200)
  executeTaskAction(
    @Req() request: ProcedureRequest,
    @Param('id') id: string,
    @Body() body: ExecuteTaskActionDto,
  ) {
    const actor = this.actor(request);
    return this.execute(async () => {
      const result = await this.taskService.executeAction(
        actor.tenantId,
        actor.userId,
        id,
        body,
        actor,
      );
      return { data: result };
    });
  }

  private actor(request: ProcedureRequest): ProcedureActor {
    if (!request.procedureActor) {
      throw new HttpException(
        { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Thiếu trusted procedure context.' },
        401,
      );
    }
    return request.procedureActor;
  }

  private async execute<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ProcedureEngineError)) throw error;
      const status = {
        validation: 400,
        forbidden: 403,
        not_found: 404,
        conflict: 409,
      }[error.code] ?? 500;
      throw new HttpException(
        { statusCode: status, message: error.message, error: error.code },
        status,
      );
    }
  }
}
