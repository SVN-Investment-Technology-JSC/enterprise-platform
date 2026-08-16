import { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import { Controller, ForbiddenException, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

interface CustomerRow { id: string; name: string; email: string }

@Controller('crm/v1')
export class CrmController {
  constructor(
    private readonly identity: PlatformIdentityService,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  @Get('summary')
  async summary(@Req() request: Request) {
    const principal = await this.principal(request);
    if (principal.kind !== 'tenant-user') {
      throw new ForbiddenException({ code: 'PLATFORM_ADMIN_NOT_ALLOWED' });
    }
    const decision = await this.identity.decide({
      sessionId: principal.sessionId,
      userId: principal.userId,
      tenantId: principal.tenantId,
      moduleKey: 'crm',
      permission: 'crm.read',
    });
    if (!decision.allowed || !decision.database) {
      throw new ForbiddenException({ code: decision.code ?? 'ACCESS_DENIED' });
    }
    const pool = await this.pools.forTenant(decision.database);
    const customers = await pool.query<CustomerRow>(
      'SELECT id, name, email FROM crm_schema.customers ORDER BY name LIMIT 25',
    );
    return { tenantId: principal.tenantId, customers: customers.rows };
  }

  private async principal(request: Request): Promise<AuthenticatedPrincipal> {
    const bearer = request.headers.authorization;
    const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : request.cookies?.ep_access as string | undefined;
    if (!token) throw new UnauthorizedException();
    try { return await this.identity.verifyAccessToken(token); }
    catch { throw new UnauthorizedException(); }
  }
}
