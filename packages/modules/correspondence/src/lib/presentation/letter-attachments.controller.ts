import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type {
  CompleteAttachmentRequest,
  CreateAttachmentRequest,
  CreateAttachmentVersionRequest,
} from '@enterprise-platform/contracts-correspondence';
import { CorrespondenceService } from '../application/correspondence.service.js';
import { CorrespondenceHttp, type CorrespondenceRequest } from './correspondence-http.js';

/** Tệp đính kèm của công văn. */
@Controller('v1')
export class LetterAttachmentsController extends CorrespondenceHttp {
  constructor(service: CorrespondenceService) {
    super(service);
  }

  @Post('letters/:id/attachments')
  createAttachment(
    @Req() request: CorrespondenceRequest,
    @Param('id') id: string,
    @Body() body: CreateAttachmentRequest,
  ) {
    return this.execute(() => this.service.createAttachment(this.actor(request), id, body));
  }

  /** Phiên bản mới của một tệp đã đính kèm. */
  @Post('letters/:id/attachments/:attachmentId/versions')
  addAttachmentVersion(
    @Req() request: CorrespondenceRequest,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: CreateAttachmentVersionRequest,
  ) {
    return this.execute(() => this.service.addAttachmentVersion(this.actor(request), id, attachmentId, body));
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
}
