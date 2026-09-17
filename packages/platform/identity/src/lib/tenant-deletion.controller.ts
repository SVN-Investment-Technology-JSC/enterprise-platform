import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RequestTenantDeletion } from '@enterprise-platform/contracts-tenancy';
import {
  TenantDeletionError,
  TenantDeletionService,
  errorCode,
} from '@enterprise-platform/platform-tenancy/deletion';
import { PlatformIdentityService } from './platform-identity.service.js';

@Controller('platform/v1')
export class TenantDeletionController {
  constructor(
    private readonly identity: PlatformIdentityService,
    @Inject(TenantDeletionService)
    private readonly deletion: TenantDeletionService,
  ) {}

  @Get('tenants/:tenantId/deletion-preview')
  preview(@Req() request: Request, @Param('tenantId') id: string) {
    return this.run(async () =>
      this.deletion.preview(id, await this.principal(request)),
    );
  }
  @Post('tenants/:tenantId/deletion')
  @HttpCode(202)
  request(
    @Req() request: Request,
    @Param('tenantId') id: string,
    @Body() input: RequestTenantDeletion,
  ) {
    return this.run(async () =>
      this.deletion.request(
        id,
        input,
        request.get('idempotency-key') ?? '',
        await this.principal(request),
        this.csrf(request),
      ),
    );
  }
  @Get('tenant-deletions')
  list(@Req() request: Request) {
    return this.run(async () => ({
      jobs: await this.deletion.list(await this.principal(request)),
    }));
  }
  @Get('tenant-deletions/:jobId')
  get(@Req() request: Request, @Param('jobId') id: string) {
    return this.run(async () =>
      this.deletion.get(id, await this.principal(request)),
    );
  }
  @Post('tenant-deletions/:jobId/retry')
  @HttpCode(202)
  retry(@Req() request: Request, @Param('jobId') id: string) {
    return this.run(async () =>
      this.deletion.retry(
        id,
        await this.principal(request),
        this.csrf(request),
      ),
    );
  }
  private async principal(request: Request) {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : (request.cookies?.ep_access as string | undefined);
    if (!token) throw new UnauthorizedException();
    try {
      return await this.identity.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException();
    }
  }
  private csrf(request: Request) {
    return {
      header: request.get('x-csrf-token'),
      cookie: request.cookies?.ep_csrf as string | undefined,
    };
  }
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      if (cause instanceof HttpException) throw cause;
      const failure =
        cause instanceof TenantDeletionError
          ? cause
          : new TenantDeletionError(503, errorCode(cause));
      throw new HttpException(
        { code: failure.code, message: failure.message },
        failure.status,
      );
    }
  }
}
