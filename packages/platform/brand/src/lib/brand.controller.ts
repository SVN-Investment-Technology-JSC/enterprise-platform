import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { Request, Response } from 'express';
import { BrandError, brandErrors } from './brand.errors.js';
import { BrandIconService, type SvgViewer } from './brand-icon.service.js';
import {
  parseOptionalVersion,
  parseStatuses,
  parseSvgMode,
} from './brand-input.js';

/** Kiểm tra access token của Platform; trong module này là `PlatformIdentityService`. */
export interface BrandAuthenticator {
  verifyAccessToken(token: string): Promise<AuthenticatedPrincipal>;
}

export const BRAND_AUTHENTICATOR = 'BRAND_AUTHENTICATOR';

/** Mọi API quản trị chỉ dành cho platform-admin; riêng đọc SVG bản đã phát hành là công khai (xem `readSvg`). */
@Controller('platform/v1/brand')
export class BrandController {
  constructor(
    @Inject(BrandIconService) private readonly brand: BrandIconService,
    @Inject(BRAND_AUTHENTICATOR)
    private readonly authenticator: BrandAuthenticator,
  ) {}

  @Get('icons')
  list(@Req() request: Request, @Query('status') status?: string) {
    return this.run(async () => {
      await this.admin(request);
      return this.brand.list(parseStatuses(status));
    });
  }

  @Get('icons/:id')
  detail(@Req() request: Request, @Param('id') id: string) {
    return this.run(async () => {
      await this.admin(request);
      return this.brand.detail(id);
    });
  }

  @Get('icons/:id/spec')
  spec(
    @Req() request: Request,
    @Param('id') id: string,
    @Query('version') version?: string,
  ) {
    return this.run(async () => {
      await this.admin(request);
      return this.brand.spec(id, parseOptionalVersion(version, 'version'));
    });
  }

  @Post('icons')
  create(@Req() request: Request, @Body() body: unknown) {
    return this.run(async () => {
      const admin = await this.admin(request);
      this.requireCsrf(request);
      return this.brand.create(admin, this.record(body));
    });
  }

  @Put('icons/:id')
  update(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.run(async () => {
      const admin = await this.admin(request);
      this.requireCsrf(request);
      return this.brand.update(admin, id, this.record(body));
    });
  }

  @Post('icons/:id/publish')
  @HttpCode(200)
  publish(@Req() request: Request, @Param('id') id: string) {
    return this.run(async () => {
      const admin = await this.admin(request);
      this.requireCsrf(request);
      return this.brand.publish(admin, id);
    });
  }

  @Post('icons/:id/unpublish')
  @HttpCode(200)
  unpublish(@Req() request: Request, @Param('id') id: string) {
    return this.run(async () => {
      const admin = await this.admin(request);
      this.requireCsrf(request);
      return this.brand.unpublish(admin, id);
    });
  }

  /** Lưu trữ icon (không xoá dữ liệu). */
  @Delete('icons/:id')
  archive(@Req() request: Request, @Param('id') id: string) {
    return this.run(async () => {
      const admin = await this.admin(request);
      this.requireCsrf(request);
      return this.brand.archive(admin, id);
    });
  }

  @Post('icons/:id/restore')
  @HttpCode(200)
  restore(@Req() request: Request, @Param('id') id: string) {
    return this.run(async () => {
      const admin = await this.admin(request);
      this.requireCsrf(request);
      return this.brand.restore(admin, id);
    });
  }

  /**
   * SVG dựng sẵn của một phiên bản. Bản đang phát hành đọc công khai không cần đăng nhập (trừ khi
   * `BRAND_ICON_PUBLIC_READ=false`); bản nháp và bản lưu trữ chỉ platform-admin. SVG do máy chủ tự dựng từ mô
   * hình có cấu trúc, và vẫn trả kèm CSP, `nosniff` để trình duyệt không chạy được gì từ nó.
   */
  @Get('icons/:id/svg')
  async svg(
    @Req() request: Request,
    @Res() response: Response,
    @Param('id') id: string,
    @Query('v') v?: string,
    @Query('mode') mode?: string,
  ): Promise<void> {
    const result = await this.run(async () =>
      this.brand.readSvg(
        id,
        { version: parseOptionalVersion(v, 'v'), mode: parseSvgMode(mode) },
        () => this.viewer(request),
        request.get('if-none-match'),
      ),
    );
    response.setHeader('ETag', result.etag);
    response.setHeader('Cache-Control', result.cacheControl);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.notModified) {
      response.status(304).end();
      return;
    }
    response.status(200);
    response.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${result.filename}"`,
    );
    response.send(result.body);
  }

  @Get('standards')
  standards(@Req() request: Request) {
    return this.run(async () => {
      await this.admin(request);
      return this.brand.standards();
    });
  }

  @Put('standards')
  saveStandards(@Req() request: Request, @Body() body: unknown) {
    return this.run(async () => {
      const admin = await this.admin(request);
      this.requireCsrf(request);
      return this.brand.saveStandards(admin, this.record(body));
    });
  }

  private record(body: unknown): Record<string, unknown> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw brandErrors.requestInvalid(
        'Thân yêu cầu phải là một đối tượng JSON.',
      );
    }
    return body as Record<string, unknown>;
  }

  private token(request: Request): string | undefined {
    const authorization = request.headers.authorization;
    return authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : (request.cookies?.ep_access as string | undefined);
  }

  /** Phiên hợp lệ hay không; token thiếu hoặc hết hạn coi như chưa đăng nhập. */
  private async principal(
    request: Request,
  ): Promise<AuthenticatedPrincipal | null> {
    const token = this.token(request);
    if (!token) return null;
    try {
      return await this.authenticator.verifyAccessToken(token);
    } catch {
      return null;
    }
  }

  private async viewer(request: Request): Promise<SvgViewer> {
    const principal = await this.principal(request);
    if (!principal) return 'anonymous';
    return principal.kind === 'platform-admin' ? 'admin' : 'user';
  }

  private async admin(request: Request): Promise<{ readonly userId: string }> {
    const principal = await this.principal(request);
    if (!principal) throw brandErrors.unauthorized();
    if (principal.kind !== 'platform-admin') throw brandErrors.forbidden();
    return { userId: principal.userId };
  }

  /** Request ghi phải mang `x-csrf-token` đúng bằng cookie `ep_csrf` (double-submit, như các API Platform khác). */
  private requireCsrf(request: Request): void {
    const header = request.headers['x-csrf-token'];
    const value = Array.isArray(header) ? header[0] : header;
    const cookie = request.cookies?.ep_csrf as string | undefined;
    if (!value || !cookie) throw brandErrors.csrfInvalid();
    const a = Buffer.from(value);
    const b = Buffer.from(cookie);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw brandErrors.csrfInvalid();
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const failure =
        error instanceof BrandError ? error : brandErrors.internal();
      throw new HttpException(
        {
          statusCode: failure.status,
          code: failure.code,
          message: failure.message,
          ...failure.extra,
        },
        failure.status,
      );
    }
  }
}
