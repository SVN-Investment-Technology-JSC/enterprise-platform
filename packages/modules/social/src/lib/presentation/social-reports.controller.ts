import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type {
  CreateSocialReportRequest,
  ResolveSocialReportRequest,
  SocialReportStatus,
  SocialReportTargetType,
} from '@enterprise-platform/contracts-social';
import { SocialReportService } from '../application/social-report.service.js';
import { actorOf, numberParam, runSocial, type SocialRequest } from './social-http.js';

/**
 * Báo cáo nhóm/bài/bình luận: gửi báo cáo (mọi thành viên), hàng đợi moderator và hàng đợi admin nhóm.
 * Quyền kiểm ở service (moderator, admin nhóm, luật nhìn thấy của đối tượng).
 */
@Controller('v1')
export class SocialReportsController {
  constructor(private readonly reports: SocialReportService) {}

  @Post('reports')
  @HttpCode(201)
  create(@Req() request: SocialRequest, @Body() body: CreateSocialReportRequest) {
    return runSocial(() => this.reports.create(actorOf(request), body ?? ({} as CreateSocialReportRequest)));
  }

  @Get('moderation/reports')
  listModeration(
    @Req() request: SocialRequest,
    @Query('status') status?: string,
    @Query('targetType') targetType?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return runSocial(() =>
      this.reports.listForModerators(actorOf(request), {
        status: (status || undefined) as SocialReportStatus | undefined,
        targetType: (targetType || undefined) as SocialReportTargetType | undefined,
        cursor: cursor || undefined,
        limit: numberParam(limit),
      }),
    );
  }

  @Post('moderation/reports/:reportId/resolve')
  @HttpCode(200)
  resolveModeration(
    @Req() request: SocialRequest,
    @Param('reportId') reportId: string,
    @Body() body: ResolveSocialReportRequest,
  ) {
    return runSocial(() =>
      this.reports.resolveAsModerator(actorOf(request), reportId, body ?? ({} as ResolveSocialReportRequest)),
    );
  }

  @Get('groups/:id/reports')
  listForGroup(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('targetType') targetType?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return runSocial(() =>
      this.reports.listForGroup(actorOf(request), id, {
        status: (status || undefined) as SocialReportStatus | undefined,
        targetType: (targetType || undefined) as SocialReportTargetType | undefined,
        cursor: cursor || undefined,
        limit: numberParam(limit),
      }),
    );
  }

  @Post('groups/:id/reports/:reportId/resolve')
  @HttpCode(200)
  resolveForGroup(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Param('reportId') reportId: string,
    @Body() body: ResolveSocialReportRequest,
  ) {
    return runSocial(() =>
      this.reports.resolveForGroup(actorOf(request), id, reportId, body ?? ({} as ResolveSocialReportRequest)),
    );
  }
}
