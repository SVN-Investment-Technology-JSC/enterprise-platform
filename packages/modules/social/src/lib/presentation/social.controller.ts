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
  CreateSocialCommentRequest,
  CreateSocialTopicRequest,
  InitiateSocialAttachmentRequest,
  SetSocialReactionRequest,
  UpdateSocialCommentRequest,
  UpdateSocialTopicRequest,
} from '@enterprise-platform/contracts-social';
import { SocialAttachmentService } from '../application/social-attachment.service.js';
import { SocialCommentService } from '../application/social-comment.service.js';
import { SocialMeService } from '../application/social-me.service.js';
import { SocialReactionService } from '../application/social-reaction.service.js';
import { SocialTopicService } from '../application/social-topic.service.js';
import type { SocialActor } from '../application/social-actor.js';
import { SocialError } from '../domain/social.error.js';

/** Guard của `apps/social-api` gắn danh tính đã xác minh vào request dưới tên `socialActor`. */
interface SocialRequest {
  socialActor?: SocialActor;
}

/**
 * Controller của Mạng nội bộ. Quyền kiểm hai lớp: guard của app chặn người
 * không có `social.read`; từng service kiểm quyền ghi, kiểm duyệt, quản lý theo
 * actor. Controller chỉ đọc request, gọi service, đổi lỗi nghiệp vụ thành HTTP.
 */
@Controller('v1')
export class SocialController {
  constructor(
    private readonly reactions: SocialReactionService,
    private readonly comments: SocialCommentService,
    private readonly topics: SocialTopicService,
    private readonly attachments: SocialAttachmentService,
    private readonly me: SocialMeService,
  ) {}

  /* --------------------------------------------------------- người dùng */

  @Get('me')
  getMe(@Req() request: SocialRequest) {
    return this.execute(() => this.me.me(this.actor(request)));
  }

  /** Gợi ý người để nhắc tên. */
  @Get('people')
  people(@Req() request: SocialRequest, @Query('query') query?: string) {
    return this.execute(() => this.me.people(this.actor(request), query));
  }

  /* Bảng tin và bài viết (feed, posts, pin) nằm ở SocialFeedController và SocialPublishingController. */

  /* ------------------------------------------------------------ phản ứng */

  @Put('posts/:id/reaction')
  react(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: SetSocialReactionRequest) {
    return this.execute(() => this.reactions.set(this.actor(request), id, body));
  }

  @Get('posts/:id/reactions')
  reactors(@Req() request: SocialRequest, @Param('id') id: string) {
    return this.execute(() => this.reactions.reactors(this.actor(request), id));
  }

  /* ------------------------------------------------------------ bình luận */

  @Get('posts/:id/comments')
  listComments(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('parentId') parentId?: string,
  ) {
    return this.execute(() =>
      this.comments.list(this.actor(request), id, {
        cursor: cursor || undefined,
        limit: limit === undefined || limit === '' ? undefined : Number(limit),
        parentId: parentId || undefined,
      }),
    );
  }

  @Post('posts/:id/comments')
  createComment(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Body() body: CreateSocialCommentRequest,
  ) {
    return this.execute(() =>
      this.comments.create(this.actor(request), id, body ?? ({} as CreateSocialCommentRequest)),
    );
  }

  @Patch('comments/:id')
  updateComment(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Body() body: UpdateSocialCommentRequest,
  ) {
    return this.execute(() =>
      this.comments.update(this.actor(request), id, body ?? ({} as UpdateSocialCommentRequest)),
    );
  }

  @Delete('comments/:id')
  @HttpCode(204)
  async removeComment(@Req() request: SocialRequest, @Param('id') id: string): Promise<void> {
    await this.execute(() => this.comments.remove(this.actor(request), id));
  }

  /* ----------------------------------------------------------- chuyên mục */

  @Get('topics')
  listTopics(@Req() request: SocialRequest) {
    return this.execute(() => this.topics.list(this.actor(request)));
  }

  @Post('topics')
  createTopic(@Req() request: SocialRequest, @Body() body: CreateSocialTopicRequest) {
    return this.execute(() => this.topics.create(this.actor(request), body ?? ({} as CreateSocialTopicRequest)));
  }

  @Patch('topics/:id')
  updateTopic(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: UpdateSocialTopicRequest) {
    return this.execute(() => this.topics.update(this.actor(request), id, body ?? {}));
  }

  /* --------------------------------------------------------- tệp đính kèm */

  @Post('attachments/uploads')
  initiateUpload(@Req() request: SocialRequest, @Body() body: InitiateSocialAttachmentRequest) {
    return this.execute(() =>
      this.attachments.initiate(this.actor(request), body ?? ({} as InitiateSocialAttachmentRequest)),
    );
  }

  @Post('attachments/:id/complete')
  completeUpload(@Req() request: SocialRequest, @Param('id') id: string) {
    return this.execute(() => this.attachments.complete(this.actor(request), id));
  }

  /* -------------------------------------------------------------- nội bộ */

  private actor(request: SocialRequest): SocialActor {
    if (!request.socialActor) {
      // Guard luôn gắn actor trước khi tới đây; thiếu là cấu hình sai.
      throw new HttpException({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Chưa đăng nhập.' }, 401);
    }
    return request.socialActor;
  }

  private async execute<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    try {
      return await operation();
    } catch (error) {
      // Id trên URL không phải UUID: với người gọi, đó là "không tìm thấy".
      if ((error as { code?: string } | null)?.code === '22P02') {
        throw new HttpException(
          { statusCode: 404, code: 'NOT_FOUND', message: 'Không tìm thấy mục được yêu cầu.' },
          404,
        );
      }
      if (!(error instanceof SocialError)) throw error;
      throw new HttpException(
        { statusCode: error.statusCode, code: error.code, message: error.message },
        error.statusCode,
      );
    }
  }
}
