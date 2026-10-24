import { AVATAR_MAX_UPLOAD_BYTES } from '@enterprise-platform/contracts-chat';
import { TenantCoreAccess } from '@enterprise-platform/platform-identity';
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { ProfileService } from './profile.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hồ sơ của chính mình, ảnh đại diện và danh bạ công ty. Mọi người dùng doanh nghiệp đều dùng được (không cần quyền
 * phân hệ nào); đặt dưới `/api/platform/v1` nên gateway đã đưa về core API từ mọi ứng dụng web.
 */
@Controller('platform/v1')
export class ProfileController {
  constructor(
    private readonly access: TenantCoreAccess,
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  @Get('profile')
  async me(@Req() request: Request) {
    return this.profiles.me(await this.access.principal(request));
  }

  @Put('profile/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_UPLOAD_BYTES, files: 1 } }))
  async setAvatar(@Req() request: Request, @UploadedFile() file: { buffer?: Buffer } | undefined) {
    const principal = await this.access.principal(request);
    this.access.requireCsrf(request);
    return this.profiles.setAvatar(principal, file?.buffer ? new Uint8Array(file.buffer) : undefined);
  }

  @Delete('profile/avatar')
  async removeAvatar(@Req() request: Request) {
    const principal = await this.access.principal(request);
    this.access.requireCsrf(request);
    return this.profiles.removeAvatar(principal);
  }

  @Get('people')
  async people(@Req() request: Request) {
    return this.profiles.people(await this.access.principal(request));
  }

  /**
   * Ảnh đại diện của một người cùng công ty. Ảnh là byte đã kiểm chữ ký (PNG/JPG/WebP) lúc tải lên, trả kèm
   * `nosniff` và CSP chặn mọi thứ để trình duyệt chỉ coi đây là ảnh. `v` khớp phiên bản hiện tại thì cache lâu dài.
   */
  @Get('users/:userId/avatar')
  @HttpCode(200)
  async avatar(
    @Req() request: Request,
    @Res() response: Response,
    @Param('userId') userId: string,
    @Query('v') version?: string,
  ): Promise<void> {
    const principal = await this.access.principal(request);
    if (!UUID.test(userId)) throw new BadRequestException('Mã người dùng không hợp lệ.');
    const avatar = await this.profiles.avatar(principal, userId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!avatar) {
      response.setHeader('Cache-Control', 'private, no-cache');
      response.status(404).end();
      return;
    }
    const etag = `"avatar-${userId.toLowerCase()}-${avatar.version}"`;
    response.setHeader('ETag', etag);
    response.setHeader(
      'Cache-Control',
      version === String(avatar.version) ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    );
    if (request.get('if-none-match') === etag) {
      response.status(304).end();
      return;
    }
    response.setHeader('Content-Type', avatar.contentType);
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    response.setHeader('Content-Disposition', 'inline');
    response.status(200).send(Buffer.from(avatar.body));
  }
}
