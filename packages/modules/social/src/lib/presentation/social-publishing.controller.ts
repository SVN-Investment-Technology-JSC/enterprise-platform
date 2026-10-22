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
  CreateSocialPostRequest,
  PinSocialPostRequest,
  RejectSocialPostRequest,
  SetSocialBookmarkRequest,
  SetSocialPollVoteRequest,
  UpdateSocialPostRequest,
  UpdateSocialSettingsRequest,
} from '@enterprise-platform/contracts-social';
import type { SocialActor } from '../application/social-actor.js';
import { SocialBookmarkService } from '../application/social-bookmark.service.js';
import { SocialModerationService } from '../application/social-moderation.service.js';
import { SocialMyPostsService } from '../application/social-my-posts.service.js';
import { SocialPollService } from '../application/social-poll.service.js';
import { SocialPublishingService } from '../application/social-publishing.service.js';
import { SocialReadConfirmationService } from '../application/social-read-confirmation.service.js';
import { SocialSettingsService } from '../application/social-settings.service.js';
import { SocialError } from '../domain/social.error.js';

/** Guard của `apps/social-api` gắn danh tính đã xác minh vào request dưới tên `socialActor`. */
interface SocialRequest {
  socialActor?: SocialActor;
}

function numberOrUndefined(value: string | undefined): number | undefined {
  return value === undefined || value === '' ? undefined : Number(value);
}

/**
 * Đường ghi bài P2 (BE-1): tạo/sửa/xoá, duyệt, hẹn giờ, bình chọn, xác nhận đã đọc, đã lưu, cài đặt.
 * Controller chỉ đọc request, gọi service và đổi lỗi nghiệp vụ thành HTTP; quyền kiểm trong service.
 *
 * Các route `posts` (POST, GET :id, PATCH, DELETE, PUT :id/pin) thay bản P1 trong `social.controller.ts`;
 * người điều phối gỡ bản cũ khi nối.
 */
@Controller('v1')
export class SocialPublishingController {
  constructor(
    private readonly posts: SocialPublishingService,
    private readonly moderation: SocialModerationService,
    private readonly polls: SocialPollService,
    private readonly confirmations: SocialReadConfirmationService,
    private readonly bookmarks: SocialBookmarkService,
    private readonly myPosts: SocialMyPostsService,
    private readonly settings: SocialSettingsService,
  ) {}

  /* ------------------------------------------------------------ bài viết */

  @Post('posts')
  create(@Req() request: SocialRequest, @Body() body: CreateSocialPostRequest) {
    return this.execute(() => this.posts.create(this.actor(request), body ?? ({} as CreateSocialPostRequest)));
  }

  @Get('posts/:id')
  detail(@Req() request: SocialRequest, @Param('id') id: string) {
    return this.execute(() => this.posts.get(this.actor(request), id));
  }

  @Patch('posts/:id')
  update(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: UpdateSocialPostRequest) {
    return this.execute(() => this.posts.update(this.actor(request), id, body ?? {}));
  }

  @Delete('posts/:id')
  @HttpCode(204)
  async remove(@Req() request: SocialRequest, @Param('id') id: string): Promise<void> {
    await this.execute(() => this.posts.remove(this.actor(request), id));
  }

  @Put('posts/:id/pin')
  pin(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: PinSocialPostRequest) {
    return this.execute(() => this.posts.setPinned(this.actor(request), id, body));
  }

  @Post('posts/:id/publish-now')
  @HttpCode(200)
  publishNow(@Req() request: SocialRequest, @Param('id') id: string) {
    return this.execute(() => this.posts.publishNow(this.actor(request), id));
  }

  /* --------------------------------------------------------------- duyệt bài */

  @Post('posts/:id/approve')
  @HttpCode(200)
  approve(@Req() request: SocialRequest, @Param('id') id: string) {
    return this.execute(() => this.moderation.approve(this.actor(request), id));
  }

  @Post('posts/:id/reject')
  @HttpCode(200)
  reject(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: RejectSocialPostRequest) {
    return this.execute(() =>
      this.moderation.reject(this.actor(request), id, body ?? ({} as RejectSocialPostRequest)),
    );
  }

  @Get('moderation/posts')
  moderationQueue(
    @Req() request: SocialRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.execute(() =>
      this.moderation.listPending(this.actor(request), { cursor: cursor || undefined, limit: numberOrUndefined(limit) }),
    );
  }

  /* ----------------------------------------------------- bài của tôi, đã lưu */

  @Get('me/posts')
  myPostList(
    @Req() request: SocialRequest,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.execute(() =>
      this.myPosts.list(this.actor(request), { status, cursor: cursor || undefined, limit: numberOrUndefined(limit) }),
    );
  }

  @Get('me/inbox')
  inbox(@Req() request: SocialRequest) {
    return this.execute(() => this.myPosts.inbox(this.actor(request)));
  }

  @Put('posts/:id/bookmark')
  setBookmark(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: SetSocialBookmarkRequest) {
    return this.execute(() => this.bookmarks.set(this.actor(request), id, body ?? ({} as SetSocialBookmarkRequest)));
  }

  @Get('bookmarks')
  bookmarkList(@Req() request: SocialRequest, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.execute(() =>
      this.bookmarks.list(this.actor(request), { cursor: cursor || undefined, limit: numberOrUndefined(limit) }),
    );
  }

  /* ------------------------------------------------------- xác nhận đã đọc */

  @Put('posts/:id/read-confirmation')
  confirmRead(@Req() request: SocialRequest, @Param('id') id: string) {
    return this.execute(() => this.confirmations.confirm(this.actor(request), id));
  }

  @Get('posts/:id/read-confirmations')
  readConfirmations(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Query('filter') filter?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.execute(() =>
      this.confirmations.list(this.actor(request), id, {
        filter: filter || undefined,
        cursor: cursor || undefined,
        limit: numberOrUndefined(limit),
      }),
    );
  }

  /* ------------------------------------------------------------- bình chọn */

  @Put('posts/:id/poll/vote')
  vote(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: SetSocialPollVoteRequest) {
    return this.execute(() => this.polls.vote(this.actor(request), id, body ?? ({} as SetSocialPollVoteRequest)));
  }

  @Get('posts/:id/poll/voters')
  voters(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Query('optionId') optionId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.execute(() =>
      this.polls.voters(this.actor(request), id, {
        optionId: optionId || undefined,
        cursor: cursor || undefined,
        limit: numberOrUndefined(limit),
      }),
    );
  }

  @Post('posts/:id/poll/close')
  @HttpCode(200)
  closePoll(@Req() request: SocialRequest, @Param('id') id: string) {
    return this.execute(() => this.polls.close(this.actor(request), id));
  }

  /* ------------------------------------------------------------- cài đặt */

  @Get('settings')
  getSettings(@Req() request: SocialRequest) {
    return this.execute(() => this.settings.get(this.actor(request)));
  }

  @Patch('settings')
  updateSettings(@Req() request: SocialRequest, @Body() body: UpdateSocialSettingsRequest) {
    return this.execute(() => this.settings.update(this.actor(request), body ?? {}));
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
