import type { PlatformAdminPrincipal } from '@enterprise-platform/contracts-identity';
import { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  UnauthorizedException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { UploadedDataImportFile } from './data-import-file.parser.js';
import { PlatformDataImportService } from './platform-data-import.service.js';

const FILE_LIMIT = 10 * 1024 * 1024;

@Controller('platform')
export class PlatformDataImportController {
  constructor(
    private readonly imports: PlatformDataImportService,
    private readonly identity: PlatformIdentityService,
  ) {}

  @Post('v1/data-import/preview')
  @UseInterceptors(
    FilesInterceptor('files', 16, { limits: { fileSize: FILE_LIMIT } }),
  )
  async preview(
    @Req() request: Request,
    @Body() input: { tenantId?: string },
    @UploadedFiles() files: UploadedDataImportFile[] = [],
  ) {
    await this.platformAdmin(request);
    this.requireCsrf(request);
    return this.imports.preview(input.tenantId ?? '', files);
  }

  @Post('v1/data-import/execute')
  @UseInterceptors(
    FilesInterceptor('files', 16, { limits: { fileSize: FILE_LIMIT } }),
  )
  async execute(
    @Req() request: Request,
    @Body() input: { tenantId?: string; previewId?: string },
    @UploadedFiles() files: UploadedDataImportFile[] = [],
  ) {
    const principal = await this.platformAdmin(request);
    this.requireCsrf(request);
    return this.imports.execute(
      input.tenantId ?? '',
      input.previewId ?? '',
      principal.userId,
      files,
    );
  }

  private async platformAdmin(request: Request): Promise<PlatformAdminPrincipal> {
    const bearer = request.headers.authorization;
    const token = bearer?.startsWith('Bearer ')
      ? bearer.slice(7)
      : (request.cookies?.ep_access as string | undefined);
    if (!token) throw new UnauthorizedException();
    try {
      const principal = await this.identity.verifyAccessToken(token);
      if (principal.kind !== 'platform-admin') throw new ForbiddenException();
      return principal;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException();
    }
  }

  private requireCsrf(request: Request): void {
    const header = request.headers['x-csrf-token'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || value !== request.cookies?.ep_csrf) {
      throw new ForbiddenException({ code: 'CSRF_INVALID' });
    }
  }
}
