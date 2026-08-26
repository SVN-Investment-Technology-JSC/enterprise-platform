import type {
  ApplyProcedureActionRequest,
  CreateProcedureAttachmentRequest,
  CreateProcedureDefinitionRequest,
  CreateProcedureDelegationRequest,
  CreateProcedureInstanceRequest,
  PostProcedureCommentRequest,
  ProcedureSettingsKey,
  RequestProcedureMaterialsRequest,
  SetProcedureSubtasksRequest,
  StartProcedureInstanceRequest,
  UpdateProcedureDefinitionRequest,
  UpdateProcedureSettingsRequest,
} from '@enterprise-platform/contracts-procedure-engine';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Put,
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

  /**
   * Cấu hình module.
   *
   * Khác Kho và Bảo trì: ProcedureAccessGuard không suy quyền theo method+path
   * mà chỉ quyết định `module.access` một lần, nên quyền ghi được gác ở tầng
   * application bằng `canDesign` — cùng cổng với việc sửa định nghĩa quy trình.
   */
  @Get('settings')
  getSettings(@Req() request: ProcedureRequest) {
    return this.execute(() => this.procedures.getSettings(this.actor(request)));
  }

  @Put('settings/:key')
  putSetting(
    @Req() request: ProcedureRequest,
    @Param('key') key: string,
    @Body() body: UpdateProcedureSettingsRequest<unknown>,
  ) {
    return this.execute(() =>
      this.procedures.updateSetting(this.actor(request), key as ProcedureSettingsKey, body),
    );
  }

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

  /** Đổi nhóm quy trình. Chạy được cả trên bản đã công bố — xem application. */
  @Patch('definitions/:definitionId/category')
  setDefinitionCategory(
    @Req() request: ProcedureRequest,
    @Param('definitionId') definitionId: string,
    @Body() input: { category?: string },
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

  /** Dọn dữ liệu rác. Huỷ (`cancel`) mới là thao tác nghiệp vụ; xoá là xoá hẳn. */
  @Delete('instances/:instanceId')
  @HttpCode(204)
  deleteInstance(@Req() request: ProcedureRequest, @Param('instanceId') instanceId: string) {
    return this.execute(() => this.procedures.deleteInstance(this.actor(request), instanceId));
  }

  @Delete('definitions/:definitionId')
  @HttpCode(204)
  deleteDefinition(@Req() request: ProcedureRequest, @Param('definitionId') definitionId: string) {
    return this.execute(() => this.procedures.deleteDefinition(this.actor(request), definitionId));
  }

  /** Nút "Kiểm lại tồn kho": chạy lại phép kiểm vật tư cho bước hiện tại. */
  @Post('instances/:instanceId/material-check')
  @HttpCode(200)
  recheckMaterials(@Req() request: ProcedureRequest, @Param('instanceId') instanceId: string) {
    return this.execute(() =>
      this.procedures.recheckStepMaterials(this.actor(request), instanceId),
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

  /** Vai E chọn thiết bị cho hồ sơ, ngay lúc chạy. */
  @Post('instances/:instanceId/asset')
  @HttpCode(200)
  setInstanceAsset(
    @Req() request: ProcedureRequest,
    @Param('instanceId') instanceId: string,
    @Body() input: { assetCode?: string },
  ) {
    return this.execute(() =>
      this.procedures.setInstanceAsset(this.actor(request), instanceId, input?.assetCode ?? ''),
    );
  }

  /** Mở hồ sơ xin vật tư cho một đầu việc. Không ghi sổ kho — xem application. */
  @Post('instances/:instanceId/material-requests')
  @HttpCode(201)
  requestMaterials(
    @Req() request: ProcedureRequest,
    @Param('instanceId') instanceId: string,
    @Body() input: RequestProcedureMaterialsRequest,
  ) {
    return this.execute(() =>
      this.procedures.requestSubtaskMaterials(this.actor(request), instanceId, input),
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
