import { Controller, Get, HttpCode, Param, Query, Req } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { SocialBirthdayService } from '../application/social-birthday.service.js';
import { SocialProfileService } from '../application/social-profile.service.js';
import { SocialRealtimeAccessService } from '../application/social-realtime-access.service.js';
import { SocialSearchService } from '../application/social-search.service.js';
import type { SocialActor } from '../application/social-actor.js';
import { SocialError } from '../domain/social.error.js';

/** Guard của `apps/social-api` gắn danh tính đã xác minh vào request dưới tên `socialActor`. */
interface SocialRequest {
  socialActor?: SocialActor;
}

/**
 * Hồ sơ, sinh nhật, tìm kiếm (P3). Mọi thành viên tenant dùng được; quyền nhìn thấy bài và nhóm do
 * service áp theo người gọi. Controller chỉ đọc request, gọi service và đổi lỗi nghiệp vụ thành HTTP.
 */
@Controller('v1')
export class SocialDiscoveryController {
  constructor(
    private readonly profiles: SocialProfileService,
    private readonly birthdays: SocialBirthdayService,
    private readonly search: SocialSearchService,
    private readonly realtimeAccess: SocialRealtimeAccessService,
  ) {}

  @Get('people/:userId/profile')
  profile(@Req() request: SocialRequest, @Param('userId') userId: string) {
    return this.execute(() => this.profiles.profile(this.actor(request), userId));
  }

  @Get('birthdays')
  listBirthdays(@Req() request: SocialRequest, @Query('days') days?: string) {
    return this.execute(() => this.birthdays.birthdays(this.actor(request), { days: numberOf(days) }));
  }

  /** Trang sinh nhật: danh sách sắp tới nhóm theo tháng (`months` 1-12, `q` lọc tên/đơn vị). */
  @Get('birthdays/upcoming')
  upcomingBirthdays(@Req() request: SocialRequest, @Query('months') months?: string, @Query('q') q?: string) {
    return this.execute(() => this.birthdays.upcoming(this.actor(request), { months: numberOf(months), q }));
  }

  @Get('search')
  overview(@Req() request: SocialRequest, @Query('q') q?: string) {
    return this.execute(() => this.search.overview(this.actor(request), q));
  }

  @Get('search/posts')
  searchPosts(
    @Req() request: SocialRequest,
    @Query('q') q?: string,
    @Query('topicId') topicId?: string,
    @Query('groupId') groupId?: string,
    @Query('authorId') authorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.execute(() =>
      this.search.posts(this.actor(request), {
        q: q ?? '',
        topicId: topicId || undefined,
        groupId: groupId || undefined,
        authorId: authorId || undefined,
        from: from || undefined,
        to: to || undefined,
        cursor: cursor || undefined,
        limit: numberOf(limit),
      }),
    );
  }

  @Get('search/people')
  searchPeople(@Req() request: SocialRequest, @Query('q') q?: string, @Query('limit') limit?: string) {
    return this.execute(() => this.search.people(this.actor(request), { q: q ?? '', limit: numberOf(limit) }));
  }

  @Get('search/groups')
  searchGroups(
    @Req() request: SocialRequest,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.execute(() =>
      this.search.groups(this.actor(request), { q: q ?? '', cursor: cursor || undefined, limit: numberOf(limit) }),
    );
  }

  /**
   * realtime-api hỏi (bằng cookie của chính người xin vào phòng) trước khi cho vào phòng tín hiệu của
   * một nhóm. 204 là được vào; không phải thành viên thì 404 (không lộ nhóm riêng tư).
   */
  @Get('realtime/groups/:groupId/access')
  @HttpCode(204)
  async groupRoomAccess(@Req() request: SocialRequest, @Param('groupId') groupId: string): Promise<void> {
    const allowed = await this.execute(() => this.realtimeAccess.canJoinGroupRoom(this.actor(request), groupId));
    if (!allowed) {
      throw new HttpException(
        { statusCode: 404, code: 'GROUP_NOT_FOUND', message: 'Nhóm không tồn tại hoặc bạn không phải thành viên.' },
        404,
      );
    }
  }

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

function numberOf(value: string | undefined): number | undefined {
  return value === undefined || value === '' ? undefined : Number(value);
}
