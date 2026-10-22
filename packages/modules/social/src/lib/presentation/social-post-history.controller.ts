import { Controller, Get, Param, Req } from '@nestjs/common';
import { SocialPostHistoryService } from '../application/social-post-history.service.js';
import { actorOf, runSocial, type SocialRequest } from './social-http.js';

/** `GET /v1/posts/:id/edits`: lịch sử chỉnh sửa của bài (tác giả, moderator, admin nhóm). */
@Controller('v1')
export class SocialPostHistoryController {
  constructor(private readonly history: SocialPostHistoryService) {}

  @Get('posts/:id/edits')
  edits(@Req() request: SocialRequest, @Param('id') id: string) {
    return runSocial(() => this.history.get(actorOf(request), id));
  }
}
