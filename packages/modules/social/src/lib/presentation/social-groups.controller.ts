import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type {
  AddSocialGroupMembersRequest,
  CreateSocialGroupRequest,
  JoinSocialGroupRequest,
  SetSocialGroupMemberSourcesRequest,
  SetSocialGroupPriorityRequest,
  SocialGroupListScope,
  SocialGroupRole,
  SyncSocialGroupMembersRequest,
  UpdateSocialGroupMemberRequest,
  UpdateSocialGroupRequest,
} from '@enterprise-platform/contracts-social';
import { SocialGroupMemberService } from '../application/social-group-member.service.js';
import { SocialGroupPriorityService } from '../application/social-group-priority.service.js';
import { SocialGroupSyncService } from '../application/social-group-sync.service.js';
import { SocialGroupService } from '../application/social-group.service.js';
import { actorOf, numberParam, runSocial, type SocialRequest } from './social-http.js';

/**
 * Nhóm của Mạng nội bộ (P2): nhóm, thành viên, tham gia/rời, yêu cầu tham gia. Quyền kiểm ở service
 * theo vai trò trong nhóm; mọi thành viên tenant dùng được.
 *
 * Thứ tự khai báo quan trọng: `groups/join-requests` phải đứng TRƯỚC `groups/:id`.
 */
@Controller('v1')
export class SocialGroupsController {
  constructor(
    private readonly groups: SocialGroupService,
    private readonly members: SocialGroupMemberService,
    private readonly priority: SocialGroupPriorityService,
    private readonly sync: SocialGroupSyncService,
  ) {}

  /* ------------------------------------------------------------- danh sách */

  @Get('groups')
  list(
    @Req() request: SocialRequest,
    @Query('scope') scope?: string,
    @Query('query') query?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return runSocial(() =>
      this.groups.list(actorOf(request), {
        scope: (scope || undefined) as SocialGroupListScope | undefined,
        query: query || undefined,
        cursor: cursor || undefined,
        limit: numberParam(limit),
      }),
    );
  }

  /** Yêu cầu tham gia đang chờ ở mọi nhóm tôi là admin. Khai trước `groups/:id`. */
  @Get('groups/join-requests')
  joinRequestInbox(@Req() request: SocialRequest, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return runSocial(() =>
      this.members.joinRequestInbox(actorOf(request), { cursor: cursor || undefined, limit: numberParam(limit) }),
    );
  }

  /** "Các nhóm khác": nhóm công khai tôi chưa tham gia. Khai trước `groups/:id`. */
  @Get('groups/suggestions')
  suggestions(@Req() request: SocialRequest, @Query('limit') limit?: string) {
    return runSocial(() => this.groups.suggestions(actorOf(request), limit || undefined));
  }

  @Post('groups')
  create(@Req() request: SocialRequest, @Body() body: CreateSocialGroupRequest) {
    return runSocial(() => this.groups.create(actorOf(request), body ?? ({} as CreateSocialGroupRequest)));
  }

  /* ------------------------------------------------------------------ nhóm */

  @Get('groups/:id')
  detail(@Req() request: SocialRequest, @Param('id') id: string) {
    return runSocial(() => this.groups.get(actorOf(request), id));
  }

  @Patch('groups/:id')
  update(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: UpdateSocialGroupRequest) {
    return runSocial(() => this.groups.update(actorOf(request), id, body ?? {}));
  }

  @Delete('groups/:id')
  @HttpCode(204)
  async remove(@Req() request: SocialRequest, @Param('id') id: string): Promise<void> {
    await runSocial(() => this.groups.remove(actorOf(request), id));
  }

  /* ------------------------------------- ưu tiên, nguồn thành viên, đồng bộ */

  @Put('groups/:id/priority')
  setPriority(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: SetSocialGroupPriorityRequest) {
    return runSocial(() => this.priority.set(actorOf(request), id, body ?? ({} as SetSocialGroupPriorityRequest)));
  }

  @Put('groups/:id/member-sources')
  setMemberSources(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Body() body: SetSocialGroupMemberSourcesRequest,
  ) {
    return runSocial(() =>
      this.sync.setSources(actorOf(request), id, body ?? ({} as SetSocialGroupMemberSourcesRequest)),
    );
  }

  @Post('groups/:id/sync-members')
  @HttpCode(200)
  syncMembers(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: SyncSocialGroupMembersRequest) {
    return runSocial(() => this.sync.sync(actorOf(request), id, body ?? {}));
  }

  /* ------------------------------------------------------------ thành viên */

  @Get('groups/:id/members')
  listMembers(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Query('role') role?: string,
    @Query('query') query?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return runSocial(() =>
      this.members.list(actorOf(request), id, {
        role: (role || undefined) as SocialGroupRole | undefined,
        query: query || undefined,
        cursor: cursor || undefined,
        limit: numberParam(limit),
      }),
    );
  }

  @Post('groups/:id/members')
  addMembers(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: AddSocialGroupMembersRequest) {
    return runSocial(() => this.members.add(actorOf(request), id, body ?? ({} as AddSocialGroupMembersRequest)));
  }

  @Patch('groups/:id/members/:userId')
  updateMember(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: UpdateSocialGroupMemberRequest,
  ) {
    return runSocial(() =>
      this.members.setRole(actorOf(request), id, userId, body ?? ({} as UpdateSocialGroupMemberRequest)),
    );
  }

  @Delete('groups/:id/members/:userId')
  @HttpCode(204)
  async removeMember(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await runSocial(() => this.members.remove(actorOf(request), id, userId));
  }

  /* ------------------------------------------------- tham gia, yêu cầu */

  @Post('groups/:id/join')
  join(@Req() request: SocialRequest, @Param('id') id: string, @Body() body: JoinSocialGroupRequest) {
    return runSocial(() => this.members.join(actorOf(request), id, body ?? {}));
  }

  @Post('groups/:id/leave')
  @HttpCode(204)
  async leave(@Req() request: SocialRequest, @Param('id') id: string): Promise<void> {
    await runSocial(() => this.members.leave(actorOf(request), id));
  }

  @Delete('groups/:id/join-request')
  @HttpCode(204)
  async cancelJoinRequest(@Req() request: SocialRequest, @Param('id') id: string): Promise<void> {
    await runSocial(() => this.members.cancelJoinRequest(actorOf(request), id));
  }

  @Get('groups/:id/join-requests')
  listJoinRequests(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return runSocial(() =>
      this.members.listJoinRequests(actorOf(request), id, { cursor: cursor || undefined, limit: numberParam(limit) }),
    );
  }

  @Post('groups/:id/join-requests/:requestId/approve')
  approveJoinRequest(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
  ) {
    return runSocial(() => this.members.approveJoinRequest(actorOf(request), id, requestId));
  }

  @Post('groups/:id/join-requests/:requestId/reject')
  @HttpCode(204)
  async rejectJoinRequest(
    @Req() request: SocialRequest,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
  ): Promise<void> {
    await runSocial(() => this.members.rejectJoinRequest(actorOf(request), id, requestId));
  }
}
