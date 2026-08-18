import type { AuthenticatedPrincipal, LoginRequest } from '@enterprise-platform/contracts-identity';
import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PlatformIdentityService } from './platform-identity.service.js';

const ACCESS_COOKIE = 'ep_access';
const REFRESH_COOKIE = 'ep_refresh';
const CSRF_COOKIE = 'ep_csrf';
const REFRESH_COOKIE_AGE = 30 * 24 * 60 * 60 * 1_000;

@Controller('auth/v1')
export class PlatformIdentityController {
  constructor(private readonly identity: PlatformIdentityService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() input: LoginRequest, @Res({ passthrough: true }) response: Response) {
    const session = await this.identity.login(input);
    this.writeCookies(response, session);
    return {
      principal: session.principal,
      redirectTo: session.principal.kind === 'platform-admin' ? '/platform' : `/t/${session.principal.tenantSlug}`,
    };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = request.cookies?.[REFRESH_COOKIE] as string | undefined;
    const csrfToken = this.validCsrf(request);
    if (!refreshToken || !csrfToken) throw new UnauthorizedException();
    const session = await this.identity.refresh(refreshToken, csrfToken);
    this.writeCookies(response, session);
    return { principal: session.principal };
  }

  @Post('tenant-password-reset')
  @HttpCode(204)
  async resetTenantPassword(
    @Body() input: { tenantSlug?: string; token?: string; password?: string },
  ) {
    await this.identity.resetTenantPassword(input);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const principal = await this.requirePrincipal(request);
    if (!this.validCsrf(request)) throw new UnauthorizedException('CSRF token không hợp lệ.');
    await this.identity.logout(principal.sessionId);
    response.clearCookie(ACCESS_COOKIE, { path: '/' });
    response.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    response.clearCookie(CSRF_COOKIE, { path: '/' });
  }

  @Get('me')
  me(@Req() request: Request) { return this.requirePrincipal(request); }

  @Get('jwks')
  jwks() { return this.identity.jwks(); }

  private async requirePrincipal(request: Request): Promise<AuthenticatedPrincipal> {
    const bearer = request.headers.authorization;
    const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : request.cookies?.[ACCESS_COOKIE] as string | undefined;
    if (!token) throw new UnauthorizedException();
    try { return await this.identity.verifyAccessToken(token); }
    catch { throw new UnauthorizedException('Access token không hợp lệ.'); }
  }

  private validCsrf(request: Request): string | undefined {
    const header = request.headers['x-csrf-token'];
    const value = Array.isArray(header) ? header[0] : header;
    const cookie = request.cookies?.[CSRF_COOKIE] as string | undefined;
    return value && cookie && value === cookie ? value : undefined;
  }

  private writeCookies(response: Response, session: { accessToken: string; refreshToken: string; csrfToken: string }): void {
    const configuredSecure = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
    if (configuredSecure && configuredSecure !== 'true' && configuredSecure !== 'false') {
      throw new Error('AUTH_COOKIE_SECURE must be either true or false.');
    }
    const secure = configuredSecure ? configuredSecure === 'true' : process.env.NODE_ENV === 'production';
    response.cookie(ACCESS_COOKIE, session.accessToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 15 * 60 * 1_000 });
    response.cookie(REFRESH_COOKIE, session.refreshToken, { httpOnly: true, sameSite: 'lax', secure, path: '/api/auth', maxAge: REFRESH_COOKIE_AGE });
    response.cookie(CSRF_COOKIE, session.csrfToken, { httpOnly: false, sameSite: 'lax', secure, path: '/', maxAge: REFRESH_COOKIE_AGE });
  }
}
