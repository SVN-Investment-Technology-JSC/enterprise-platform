import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { SocialFeedQuery, SocialFeedSource, SocialPostKind } from '@enterprise-platform/contracts-social';
import { SocialFeedService } from '../application/social-feed.service.js';
import { actorOf, numberParam, runSocial, type SocialRequest } from './social-http.js';

/**
 * Bảng tin P2: `GET /feed` (thay bản P1) và `GET /posts` (cùng danh sách), `GET /groups/:id/feed`.
 * Mọi thành viên tenant dùng được; luật nhìn thấy bài áp ở service/store.
 */
@Controller('v1')
export class SocialFeedController {
  constructor(private readonly feed: SocialFeedService) {}

  @Get('feed')
  getFeed(
    @Req() request: SocialRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('topicId') topicId?: string,
    @Query('kind') kind?: string,
    @Query('authorId') authorId?: string,
    @Query('scope') scope?: string,
    @Query('groupId') groupId?: string,
    @Query('groupTopicId') groupTopicId?: string,
  ) {
    const query: SocialFeedQuery = {
      cursor: cursor || undefined,
      limit: numberParam(limit),
      topicId: topicId || undefined,
      kind: (kind || undefined) as SocialPostKind | undefined,
      authorId: authorId || undefined,
      scope: (scope || undefined) as SocialFeedSource | undefined,
      groupId: groupId || undefined,
      groupTopicId: groupTopicId || undefined,
    };
    return runSocial(() => this.feed.feed(actorOf(request), query));
  }

  /** Cùng danh sách với `feed`. */
  @Get('posts')
  listPosts(
    @Req() request: SocialRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('topicId') topicId?: string,
    @Query('kind') kind?: string,
    @Query('authorId') authorId?: string,
    @Query('scope') scope?: string,
    @Query('groupId') groupId?: string,
    @Query('groupTopicId') groupTopicId?: string,
  ) {
    return this.getFeed(request, cursor, limit, topicId, kind, authorId, scope, groupId, groupTopicId);
  }

  @Get('groups/:id/feed')
  groupFeed(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('kind') kind?: string,
    @Query('authorId') authorId?: string,
    @Query('groupTopicId') groupTopicId?: string,
  ) {
    return runSocial(() =>
      this.feed.groupFeed(actorOf(request), id, {
        cursor: cursor || undefined,
        limit: numberParam(limit),
        kind: (kind || undefined) as SocialPostKind | undefined,
        authorId: authorId || undefined,
        groupTopicId: groupTopicId || undefined,
      }),
    );
  }
}
