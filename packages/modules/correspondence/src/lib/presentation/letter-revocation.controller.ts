import { Body, Controller, Delete, HttpCode, Param, Post, Req } from '@nestjs/common';
import type {
  CommentRequest,
  DecideRevokeRequest,
  ReasonRequest,
  RemindRequest,
  RequestRevokeRequest,
} from '@enterprise-platform/contracts-correspondence';
import { CorrespondenceService } from '../application/correspondence.service.js';
import { CorrespondenceHttp, type CorrespondenceRequest } from './correspondence-http.js';

/** Huỷ, thu hồi, xoá công văn; đôn đốc và trao đổi. */
@Controller('v1')
export class LetterRevocationController extends CorrespondenceHttp {
  constructor(service: CorrespondenceService) {
    super(service);
  }

  @Post('letters/:id/cancel')
  @HttpCode(200)
  cancel(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: ReasonRequest) {
    return this.execute(() => this.service.cancel(this.actor(request), id, body));
  }

  /** Văn thư / bộ phận tổng hợp đôn đốc người đang xử lý. */
  @Post('letters/:id/remind')
  @HttpCode(200)
  remind(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: RemindRequest) {
    return this.execute(() => this.service.remind(this.actor(request), id, body));
  }

  /** Văn thư đề nghị huỷ công văn đã ban hành / hoàn tất (thu hồi, sửa đổi). */
  @Post('letters/:id/revoke')
  @HttpCode(200)
  requestRevoke(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: RequestRevokeRequest) {
    return this.execute(() => this.service.requestRevoke(this.actor(request), id, body));
  }

  /** Người có thẩm quyền xác nhận huỷ hay không. */
  @Post('letters/:id/revoke/decision')
  @HttpCode(200)
  decideRevoke(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: DecideRevokeRequest) {
    return this.execute(() => this.service.decideRevoke(this.actor(request), id, body));
  }

  @Post('letters/:id/revoke/withdraw')
  @HttpCode(200)
  withdrawRevoke(@Req() request: CorrespondenceRequest, @Param('id') id: string) {
    return this.execute(() => this.service.withdrawRevoke(this.actor(request), id));
  }

  /** Xoá công văn đã huỷ khỏi Văn thư. */
  @Delete('letters/:id')
  @HttpCode(204)
  async removeLetter(@Req() request: CorrespondenceRequest, @Param('id') id: string): Promise<void> {
    await this.execute(() => this.service.remove(this.actor(request), id));
  }

  @Post('letters/:id/comments')
  @HttpCode(200)
  comment(@Req() request: CorrespondenceRequest, @Param('id') id: string, @Body() body: CommentRequest) {
    return this.execute(() => this.service.comment(this.actor(request), id, body));
  }
}
