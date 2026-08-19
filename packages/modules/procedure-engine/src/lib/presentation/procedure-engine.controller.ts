import type {
  ApplyProcedureActionRequest,
  CreateProcedureAttachmentRequest,
  CreateProcedureDefinitionRequest,
  CreateProcedureDelegationRequest,
  CreateProcedureInstanceRequest,
  PostProcedureCommentRequest,
  ProcedureCategory,
  SetProcedureSubtasksRequest,
  StartProcedureInstanceRequest,
  UpdateProcedureDefinitionRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ProcedureEngineApplication } from '../application/procedure-engine.application.js';
import { ProcedureAttachmentService } from '../application/procedure-attachment.service.js';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import { ProcedureEngineError } from '../domain/procedure-engine.error.js';

interface ProcedureRequest {
  procedureActor?: ProcedureActor;
}

@Controller('v1')
export class ProcedureEngineController {
  constructor(
    private readonly procedures: ProcedureEngineApplication,
    private readonly attachments: ProcedureAttachmentService,
  ) {}

  @Get('workspace')
  workspace(@Req() request: ProcedureRequest) {
    return this.execute(() =>
      this.procedures.getWorkspace(this.actor(request)),
    );
  }

  @Post('definitions')
  createDefinition(
    @Req() request: ProcedureRequest,
    @Body() input: CreateProcedureDefinitionRequest,
  ) {
    return this.execute(() =>
      this.procedures.createDefinition(this.actor(request), input),
    );
  }

  @Patch('definitions/:definitionId')
  updateDefinition(
    @Req() request: ProcedureRequest,
    @Param('definitionId') definitionId: string,
    @Body() input: UpdateProcedureDefinitionRequest,
  ) {
    return this.execute(() =>
      this.procedures.updateDefinition(this.actor(request), definitionId, input),
    );
  }

  @Patch('definitions/:definitionId/category')
  setCategory(
    @Req() request: ProcedureRequest,
    @Param('definitionId') definitionId: string,
    @Body() input: { category?: ProcedureCategory },
  ) {
    return this.execute(() =>
      this.procedures.setDefinitionCategory(this.actor(request), definitionId, input?.category),
    );
  }

  @Post('definitions/:definitionId/revise')
  @HttpCode(200)
  reviseDefinition(
    @Req() request: ProcedureRequest,
    @Param('definitionId') definitionId: string,
  ) {
    return this.execute(() =>
      this.procedures.reviseDefinition(this.actor(request), definitionId),
    );
  }

  @Post('definitions/:definitionId/publish')
  @HttpCode(200)
  publishDefinition(
    @Req() request: ProcedureRequest,
    @Param('definitionId') definitionId: string,
  ) {
    return this.execute(() =>
      this.procedures.publishDefinition(this.actor(request), definitionId),
    );
  }

  @Post('instances')
  startInstance(
    @Req() request: ProcedureRequest,
    @Body() input: StartProcedureInstanceRequest,
  ) {
    return this.execute(() =>
      this.procedures.startInstance(this.actor(request), input),
    );
  }

  @Post('internal/instances')
  @HttpCode(201)
  createInstanceFromExternal(
    @Req() request: any,
    @Body() input: CreateProcedureInstanceRequest,
  ) {
    // Internal endpoint for Maintenance module to create procedure instances
    // Gets tenantId from X-Tenant-ID header
    const tenantId = request.headers['x-tenant-id'] as string;
    if (!tenantId?.trim()) {
      throw new HttpException(
        { statusCode: 400, code: 'MISSING_TENANT', message: 'X-Tenant-ID header is required' },
        400,
      );
    }
    return this.execute(() => this.procedures.createInstance(tenantId, input));
  }

  @Post('instances/:instanceId/actions')
  @HttpCode(200)
  applyAction(
    @Req() request: ProcedureRequest,
    @Param('instanceId') instanceId: string,
    @Body() input: ApplyProcedureActionRequest,
  ) {
    return this.execute(() =>
      this.procedures.applyAction(this.actor(request), instanceId, input),
    );
  }

  @Post('instances/:instanceId/comments')
  @HttpCode(201)
  postComment(
    @Req() request: ProcedureRequest,
    @Param('instanceId') instanceId: string,
    @Body() input: PostProcedureCommentRequest,
  ) {
    return this.execute(() =>
      this.procedures.postComment(this.actor(request), instanceId, input),
    );
  }

  @Post('instances/:instanceId/delegations')
  @HttpCode(201)
  delegate(
    @Req() request: ProcedureRequest,
    @Param('instanceId') instanceId: string,
    @Body() input: CreateProcedureDelegationRequest,
  ) {
    return this.execute(() =>
      this.procedures.delegate(this.actor(request), instanceId, input),
    );
  }

  @Post('instances/:instanceId/subtasks')
  @HttpCode(200)
  setSubtasks(
    @Req() request: ProcedureRequest,
    @Param('instanceId') instanceId: string,
    @Body() input: SetProcedureSubtasksRequest,
  ) {
    return this.execute(() =>
      this.procedures.setSubtasks(this.actor(request), instanceId, input),
    );
  }

  @Post('instances/:instanceId/subtasks/:subtaskId/complete')
  @HttpCode(200)
  completeSubtask(
    @Req() request: ProcedureRequest,
    @Param('instanceId') instanceId: string,
    @Param('subtaskId') subtaskId: string,
  ) {
    return this.execute(() =>
      this.procedures.completeSubtask(this.actor(request), instanceId, subtaskId),
    );
  }

  @Post('instances/:instanceId/subtasks/:subtaskId/cancel')
  @HttpCode(200)
  cancelSubtask(
    @Req() request: ProcedureRequest,
    @Param('instanceId') instanceId: string,
    @Param('subtaskId') subtaskId: string,
  ) {
    return this.execute(() =>
      this.procedures.cancelSubtask(this.actor(request), instanceId, subtaskId),
    );
  }

  @Get('instances/:instanceId/attachments')
  listAttachments(@Req() request: ProcedureRequest, @Param('instanceId') instanceId: string) {
    return this.execute(() => this.attachments.list(this.actor(request), instanceId));
  }

  @Post('instances/:instanceId/attachments')
  createAttachment(
    @Req() request: ProcedureRequest,
    @Param('instanceId') instanceId: string,
    @Body() input: CreateProcedureAttachmentRequest,
  ) {
    return this.execute(() => this.attachments.create(this.actor(request), instanceId, input));
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

  private async execute<TValue>(
    operation: () => Promise<TValue>,
  ): Promise<TValue> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ProcedureEngineError)) throw error;
      const status = {
        validation: 400,
        forbidden: 403,
        not_found: 404,
        conflict: 409,
      }[error.code];
      throw new HttpException(
        { statusCode: status, message: error.message, error: error.code },
        status,
      );
    }
  }
}
