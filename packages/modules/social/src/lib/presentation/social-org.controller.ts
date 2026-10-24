import { Controller, Get, Query, Req } from '@nestjs/common';
import { SocialOrgService } from '../application/social-org.service.js';
import { actorOf, runSocial, type SocialRequest } from './social-http.js';

/** `GET /v1/org/nodes?kind&query&limit`: phòng ban và vị trí để chọn (mọi thành viên tenant). */
@Controller('v1')
export class SocialOrgController {
  constructor(private readonly org: SocialOrgService) {}

  @Get('org/nodes')
  nodes(
    @Req() request: SocialRequest,
    @Query('kind') kind?: string,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
  ) {
    return runSocial(() =>
      this.org.list(actorOf(request), { kind: kind || undefined, query: query || undefined, limit }),
    );
  }
}
