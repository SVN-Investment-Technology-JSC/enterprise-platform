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
  Query,
  Req,
} from '@nestjs/common';
import type {
  ApproveStepRequest,
  ClassifyLetterRequest,
  CompleteAttachmentRequest,
  CorrespondenceSettings,
  CreateAttachmentRequest,
  CreateLetterRequest,
  DirectLetterRequest,
  LetterBox,
  LetterStage,
  NoteRequest,
  PublishLetterRequest,
  ReasonRequest,
  RequestRevisionRequest,
  RespondAssignmentRequest,
  SaveCatalogItemRequest,
  SaveWorkflowRequest,
  SubmitLetterRequest,
  UpdateLetterRequest,
} from '@enterprise-platform/contracts-correspondence';
import { CorrespondenceService } from '../application/correspondence.service.js';
import type { CorrespondenceActor } from '../application/ports.js';
import { CorrespondenceError } from '../domain/correspondence.error.js';

/** Guard gắn danh tính đã xác minh vào request dưới tên `correspondenceActor`. */
interface CorrespondenceRequest {
  correspondenceActor?: CorrespondenceActor;
}

@Controller('v1')
export class CorrespondenceController {
  constructor(private readonly service: CorrespondenceService) {}

  @Get('status')
  status(@Req() request: CorrespondenceRequest) {
    return this.execute(() => this.service.status(this.actor(request)));
  }

  @Get('directory')
  directory(@Req() request: CorrespondenceRequest) {
    return this.execute(() => this.service.directory(this.actor(request)));
  }

  @Get('overview')
  overview(@Req() request: CorrespondenceRequest) {
    return this.execute(() => this.service.overview(this.actor(request)));
  }

  /* ----------------------------------------------------------- cấu hình */

  /** Sổ, danh mục và quy trình duyệt: ai vào được phân hệ cũng đọc được, chỉ người có quyền cấu hình sửa. */
  @Get('config')
  config(@Req() request: CorrespondenceRequest) {
    return this.execute(() => this.service.config(this.actor(request)));
  }

  @Put('settings')
  saveSettings(@Req() request: CorrespondenceRequest, @Body() body: CorrespondenceSettings) {
    return this.execute(() => this.service.saveSettings(this.actor(request), body));
  }

  @Post('catalog')
  createCatalogItem(@Req() request: CorrespondenceRequest, @Body() body: SaveCatalogItemRequest) {
    return this.execute(() => this.service.saveCatalogItem(this.actor(request), undefined, body));
  }

  @Put('catalog/:id')
  updateCatalogItem(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: SaveCatalogItemRequest) {
    return this.execute(() => this.service.saveCatalogItem(this.actor(request), id, body));
  }

  @Delete('catalog/:id')
  @HttpCode(204)
  async deleteCatalogItem(@Req() request: CorrespondenceRequest, @Param('id') id: string): Promise<void> {
    await this.execute(() => this.service.deleteCatalogItem(this.actor(request), id));
  }

  @Post('workflows')
  createWorkflow(@Req() request: CorrespondenceRequest, @Body() body: SaveWorkflowRequest) {
    return this.execute(() => this.service.saveWorkflow(this.actor(request), undefined, body));
  }

  @Put('workflows/:id')
  updateWorkflow(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: SaveWorkflowRequest) {
    return this.execute(() => this.service.saveWorkflow(this.actor(request), id, body));
  }

  @Delete('workflows/:id')
  @HttpCode(204)
  async deleteWorkflow(@Req() request: CorrespondenceRequest, @Param('id') id: string): Promise<void> {
    await this.execute(() => this.service.deleteWorkflow(this.actor(request), id));
  }

  /* ----------------------------------------------------------- công văn */

  @Get('letters')
  list(
    @Req() request: CorrespondenceRequest,
    @Query('box') box?: string,
    @Query('stage') stage?: string,
    @Query('search') search?: string,
  ) {
    return this.execute(async () => ({
      items: await this.service.list(this.actor(request), {
        box: (box || undefined) as LetterBox | undefined,
        stage: (stage || undefined) as LetterStage | undefined,
        search,
      }),
    }));
  }

  @Post('letters')
  create(@Req() request: CorrespondenceRequest, @Body() body: CreateLetterRequest) {
    return this.execute(() => this.service.create(this.actor(request), body));
  }

  @Get('letters/:id')
  detail(@Req() request: CorrespondenceRequest, @Param('id') id: string) {
    return this.execute(() => this.service.detail(this.actor(request), id));
  }

  /** Ứng viên cho bước sắp bắt đầu khi bước đó để người thao tác chọn người duyệt. */
  @Get('letters/:id/step-choice')
  stepChoice(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Query('workflowId') workflowId?: string) {
    return this.execute(async () => ({ choice: await this.service.stepChoice(this.actor(request), id, workflowId || undefined) }));
  }

  @Patch('letters/:id')
  update(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: UpdateLetterRequest) {
    return this.execute(() => this.service.update(this.actor(request), id, body));
  }

  @Post('letters/:id/classify')
  @HttpCode(200)
  classify(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: ClassifyLetterRequest) {
    return this.execute(() => this.service.classify(this.actor(request), id, body));
  }

  @Post('letters/:id/submit')
  @HttpCode(200)
  submit(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: SubmitLetterRequest) {
    return this.execute(() => this.service.submit(this.actor(request), id, body));
  }

  @Post('letters/:id/return')
  @HttpCode(200)
  returnToClerk(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: ReasonRequest) {
    return this.execute(() => this.service.returnToClerk(this.actor(request), id, body));
  }

  @Post('letters/:id/direct')
  @HttpCode(200)
  direct(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: DirectLetterRequest) {
    return this.execute(() => this.service.direct(this.actor(request), id, body));
  }

  @Post('letters/:id/close-for-info')
  @HttpCode(200)
  closeForInfo(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: NoteRequest) {
    return this.execute(() => this.service.closeForInfo(this.actor(request), id, body));
  }

  @Post('letters/:id/assignments/:assignmentId/respond')
  @HttpCode(200)
  respond(
    @Req() request: CorrespondenceRequest,
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: RespondAssignmentRequest,
  ) {
    return this.execute(() => this.service.respond(this.actor(request), id, assignmentId, body));
  }

  @Post('letters/:id/approve')
  @HttpCode(200)
  approve(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: ApproveStepRequest) {
    return this.execute(() => this.service.approve(this.actor(request), id, body));
  }

  @Post('letters/:id/request-revision')
  @HttpCode(200)
  requestRevision(
    @Req() request: CorrespondenceRequest,
    @Param('id') id: string,
    @Body() body: RequestRevisionRequest,
  ) {
    return this.execute(() => this.service.requestRevision(this.actor(request), id, body));
  }

  @Post('letters/:id/publish')
  @HttpCode(200)
  publish(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: PublishLetterRequest) {
    return this.execute(() => this.service.publish(this.actor(request), id, body));
  }

  @Post('letters/:id/archive')
  @HttpCode(200)
  archive(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: NoteRequest) {
    return this.execute(() => this.service.archive(this.actor(request), id, body));
  }

  @Post('letters/:id/cancel')
  @HttpCode(200)
  cancel(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: ReasonRequest) {
    return this.execute(() => this.service.cancel(this.actor(request), id, body));
  }

  /* --------------------------------------------------------------- tệp */

  @Post('letters/:id/attachments')
  createAttachment(
    @Req() request: CorrespondenceRequest,
    @Param('id') id: string,
    @Body() body: CreateAttachmentRequest,
  ) {
    return this.execute(() => this.service.createAttachment(this.actor(request), id, body));
  }

  @Post('letters/:id/attachments/:attachmentId/complete')
  @HttpCode(200)
  completeAttachment(
    @Req() request: CorrespondenceRequest,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: CompleteAttachmentRequest,
  ) {
    return this.execute(() => this.service.completeAttachment(this.actor(request), id, attachmentId, body?.sizeBytes));
  }

  @Get('letters/:id/attachments/:attachmentId/download')
  download(
    @Req() request: CorrespondenceRequest,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Query('mode') mode?: string,
  ) {
    return this.execute(() =>
      this.service.download(this.actor(request), id, attachmentId, mode === 'preview' ? 'preview' : 'download'),
    );
  }

  @Delete('letters/:id/attachments/:attachmentId')
  @HttpCode(204)
  async deleteAttachment(
    @Req() request: CorrespondenceRequest,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<void> {
    await this.execute(() => this.service.deleteAttachment(this.actor(request), id, attachmentId));
  }

  /* ------------------------------------------------------------ nội bộ */

  private actor(request: CorrespondenceRequest): CorrespondenceActor {
    if (!request.correspondenceActor) {
      // Guard luôn gắn actor trước khi tới đây; thiếu là cấu hình sai.
      throw new HttpException({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Chưa đăng nhập.' }, 401);
    }
    return request.correspondenceActor;
  }

  private async execute<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    try {
      return await operation();
    } catch (error) {
      if ((error as { code?: string } | null)?.code === '22P02') {
        throw new HttpException(
          { statusCode: 404, code: 'NOT_FOUND', message: 'Không tìm thấy mục được yêu cầu.' },
          404,
        );
      }
      if (!(error instanceof CorrespondenceError)) throw error;
      throw new HttpException(
        { statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
