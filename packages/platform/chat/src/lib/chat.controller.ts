import type {
  AddChatMembersRequest,
  CreateDirectChatRequest,
  CreateGroupChatRequest,
  InitiateChatAttachmentRequest,
  MarkChatReadRequest,
  ReactChatMessageRequest,
  SendChatMessageRequest,
  UpdateChatConversationRequest,
  UpdateChatMessageRequest,
} from '@enterprise-platform/contracts-chat';
import { TenantCoreAccess } from '@enterprise-platform/platform-identity';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ChatService } from './chat.service.js';

/**
 * Chat nội bộ của core. Mọi người dùng doanh nghiệp đều dùng được, không cần quyền phân hệ nào; quyền vào từng cuộc
 * trò chuyện do `ChatService` kiểm (thành viên, hoặc cuộc chung toàn công ty). Request ghi phải có mã CSRF.
 */
@Controller('platform/v1/chat')
export class ChatController {
  constructor(
    private readonly access: TenantCoreAccess,
    @Inject(ChatService) private readonly chat: ChatService,
  ) {}

  @Get('conversations')
  async conversations(@Req() request: Request) {
    return this.chat.conversations(await this.access.principal(request));
  }

  @Get('unread')
  async unread(@Req() request: Request) {
    return this.chat.unread(await this.access.principal(request));
  }

  @Get('conversations/company')
  async company(@Req() request: Request) {
    return this.chat.company(await this.access.principal(request));
  }

  @Post('conversations/direct')
  @HttpCode(200)
  async direct(@Req() request: Request, @Body() body: CreateDirectChatRequest) {
    const principal = await this.writer(request);
    return this.chat.openDirect(principal, body?.userId);
  }

  @Post('conversations/group')
  async group(@Req() request: Request, @Body() body: CreateGroupChatRequest) {
    const principal = await this.writer(request);
    return this.chat.createGroup(principal, body);
  }

  @Get('conversations/:id')
  async conversation(@Req() request: Request, @Param('id') id: string) {
    return this.chat.conversation(await this.access.principal(request), id);
  }

  @Patch('conversations/:id')
  async update(@Req() request: Request, @Param('id') id: string, @Body() body: UpdateChatConversationRequest) {
    const principal = await this.writer(request);
    return this.chat.updateConversation(principal, id, body);
  }

  @Post('conversations/:id/members')
  @HttpCode(200)
  async addMembers(@Req() request: Request, @Param('id') id: string, @Body() body: AddChatMembersRequest) {
    const principal = await this.writer(request);
    return this.chat.addMembers(principal, id, body?.userIds);
  }

  @Delete('conversations/:id/members/:userId')
  async removeMember(@Req() request: Request, @Param('id') id: string, @Param('userId') userId: string) {
    const principal = await this.writer(request);
    return this.chat.removeMember(principal, id, userId);
  }

  @Post('conversations/:id/leave')
  @HttpCode(204)
  async leave(@Req() request: Request, @Param('id') id: string) {
    const principal = await this.writer(request);
    await this.chat.leave(principal, id);
  }

  @Get('conversations/:id/messages')
  async messages(
    @Req() request: Request,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chat.messages(await this.access.principal(request), id, { before, limit });
  }

  @Post('conversations/:id/messages')
  async send(@Req() request: Request, @Param('id') id: string, @Body() body: SendChatMessageRequest) {
    const principal = await this.writer(request);
    return this.chat.send(principal, id, body);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  async read(@Req() request: Request, @Param('id') id: string, @Body() body: MarkChatReadRequest) {
    const principal = await this.writer(request);
    return this.chat.markRead(principal, id, body?.messageId);
  }

  /** realtime-api hỏi (bằng cookie của người đang gõ) ai nhận tín hiệu "đang nhập". */
  @Get('conversations/:id/typing-recipients')
  async typingRecipients(@Req() request: Request, @Param('id') id: string) {
    return this.chat.typingRecipients(await this.access.principal(request), id);
  }

  @Patch('messages/:id')
  async edit(@Req() request: Request, @Param('id') id: string, @Body() body: UpdateChatMessageRequest) {
    const principal = await this.writer(request);
    return this.chat.edit(principal, id, body);
  }

  @Delete('messages/:id')
  async recall(@Req() request: Request, @Param('id') id: string) {
    const principal = await this.writer(request);
    return this.chat.recall(principal, id);
  }

  @Put('messages/:id/reaction')
  async react(@Req() request: Request, @Param('id') id: string, @Body() body: ReactChatMessageRequest) {
    const principal = await this.writer(request);
    return this.chat.react(principal, id, body?.reaction ?? null);
  }

  @Post('attachments/uploads')
  async initiate(@Req() request: Request, @Body() body: InitiateChatAttachmentRequest) {
    const principal = await this.writer(request);
    return this.chat.initiateAttachment(principal, body);
  }

  @Post('attachments/:id/complete')
  @HttpCode(200)
  async complete(@Req() request: Request, @Param('id') id: string) {
    const principal = await this.writer(request);
    return this.chat.completeAttachment(principal, id);
  }

  @Get('attachments/:id/url')
  async attachmentUrl(@Req() request: Request, @Param('id') id: string) {
    return this.chat.attachmentUrl(await this.access.principal(request), id);
  }

  private async writer(request: Request) {
    const principal = await this.access.principal(request);
    this.access.requireCsrf(request);
    return principal;
  }
}
