import { Body, Controller, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type {
  ApproveStepRequest,
  AssignHandlerRequest,
  CreateLetterRequest,
  CreateOutgoingRequest,
  DispatchLetterRequest,
  NoteRequest,
  PublishLetterRequest,
  RespondAssignmentRequest,
  ReturnLetterRequest,
  SubmitLetterRequest,
  UpdateDeliveryRequest,
  UpdateLetterRequest,
} from '@enterprise-platform/contracts-correspondence';
import { CorrespondenceService } from '../application/correspondence.service.js';
import { CorrespondenceHttp, type CorrespondenceRequest } from './correspondence-http.js';

/** Luồng xử lý công văn: tiếp nhận, soạn công văn đi, sửa, giao, phản hồi, kiểm tra, duyệt, trả lại, hoàn tất, ban hành, theo dõi gửi. */
@Controller('v1')
export class LetterFlowController extends CorrespondenceHttp {
  constructor(service: CorrespondenceService) {
    super(service);
  }

  /** Công văn đến: văn thư tiếp nhận, vào sổ. */
  @Post('letters')
  create(@Req() request: CorrespondenceRequest, @Body() body: CreateLetterRequest) {
    return this.execute(() => this.service.create(this.actor(request), body));
  }

  /** Công văn đi: phòng ban soạn thảo. */
  @Post('outgoing')
  createOutgoing(@Req() request: CorrespondenceRequest, @Body() body: CreateOutgoingRequest) {
    return this.execute(() => this.service.createOutgoing(this.actor(request), body));
  }

  @Patch('letters/:id')
  update(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: UpdateLetterRequest) {
    return this.execute(() => this.service.update(this.actor(request), id, body));
  }

  @Post('letters/:id/dispatch')
  @HttpCode(200)
  dispatch(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: DispatchLetterRequest) {
    return this.execute(() => this.service.dispatch(this.actor(request), id, body));
  }

  @Post('letters/:id/assignments/:assignmentId/handler')
  @HttpCode(200)
  assignHandler(
    @Req() request: CorrespondenceRequest,
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: AssignHandlerRequest,
  ) {
    return this.execute(() => this.service.assignHandler(this.actor(request), id, assignmentId, body));
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

  @Post('letters/:id/send-to-clerk')
  @HttpCode(200)
  sendToClerk(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: NoteRequest) {
    return this.execute(() => this.service.sendToClerk(this.actor(request), id, body));
  }

  @Post('letters/:id/submit')
  @HttpCode(200)
  submit(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: SubmitLetterRequest) {
    return this.execute(() => this.service.submit(this.actor(request), id, body));
  }

  @Post('letters/:id/approve')
  @HttpCode(200)
  approve(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: ApproveStepRequest) {
    return this.execute(() => this.service.approve(this.actor(request), id, body));
  }

  /** "Không đạt" / trả lại kèm lý do. */
  @Post('letters/:id/return')
  @HttpCode(200)
  returnLetter(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: ReturnLetterRequest) {
    return this.execute(() => this.service.returnLetter(this.actor(request), id, body));
  }

  @Post('letters/:id/complete')
  @HttpCode(200)
  complete(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: NoteRequest) {
    return this.execute(() => this.service.complete(this.actor(request), id, body));
  }

  @Post('letters/:id/publish')
  @HttpCode(200)
  publish(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: PublishLetterRequest) {
    return this.execute(() => this.service.publish(this.actor(request), id, body));
  }

  @Post('letters/:id/delivery')
  @HttpCode(200)
  updateDelivery(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: UpdateDeliveryRequest) {
    return this.execute(() => this.service.updateDelivery(this.actor(request), id, body));
  }
}
