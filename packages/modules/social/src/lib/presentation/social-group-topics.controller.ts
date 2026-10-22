import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { CreateSocialGroupTopicRequest, UpdateSocialGroupTopicRequest } from '@enterprise-platform/contracts-social';
import { SocialGroupTopicService } from '../application/social-group-topic.service.js';
import { actorOf, runSocial, type SocialRequest } from './social-http.js';

/** Chủ đề của nhóm: xem (người thấy nhóm đầy đủ), tạo/sửa/xoá (admin nhóm). */
@Controller('v1')
export class SocialGroupTopicsController {
  constructor(private readonly topics: SocialGroupTopicService) {}

  @Get('groups/:id/topics')
  list(@Req() request: SocialRequest, @Param('id') id: string) {
    return runSocial(() => this.topics.list(actorOf(request), id));
  }

  @Post('groups/:id/topics')
  create(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: CreateSocialGroupTopicRequest) {
    return runSocial(() => this.topics.create(actorOf(request), id, body ?? ({} as CreateSocialGroupTopicRequest)));
  }

  @Patch('groups/:id/topics/:topicId')
  update(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Param('topicId') topicId: string,
    @Body() body: UpdateSocialGroupTopicRequest,
  ) {
    return runSocial(() => this.topics.update(actorOf(request), id, topicId, body ?? {}));
  }

  @Delete('groups/:id/topics/:topicId')
  @HttpCode(204)
  async remove(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Param('topicId') topicId: string,
  ): Promise<void> {
    await runSocial(() => this.topics.remove(actorOf(request), id, topicId));
  }
}
