import { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Pool } from 'pg';

@Injectable()
export class HrmContextService {
  private readonly jwks = createRemoteJWKSet(
    new URL(process.env.PLATFORM_JWKS_URL ?? 'http://localhost:3333/api/auth/v1/jwks'),
  );

  constructor(
    private readonly identity: PlatformIdentityService,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  async getContext(
    request: Request,
    requiredPermission: 'hrm.read' | 'hrm.manage' = 'hrm.read',
  ): Promise<{
    principal: AuthenticatedPrincipal;
    tenantId: string;
    pool: Pool;
  }> {
    const bearer = request.headers.authorization;
    let token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : (request.cookies?.ep_access as string | undefined);

    // Fallback: parse raw cookie header if request.cookies is not populated by middleware
    if (!token && request.headers.cookie) {
      const match = request.headers.cookie.match(/(?:^|;\s*)ep_access=([^;]+)/);
      if (match) {
        token = decodeURIComponent(match[1]);
      }
    }

    if (!token) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Missing authentication token' });
    }

    let principal: AuthenticatedPrincipal;
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        algorithms: ['RS256'],
        issuer: 'enterprise-platform',
        audience: 'enterprise-platform-apps',
      });
      principal = payload.principal as unknown as AuthenticatedPrincipal;
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Token is invalid or expired',
      });
    }

    if (principal.kind !== 'tenant-user') {
      throw new ForbiddenException({ code: 'PLATFORM_ADMIN_NOT_ALLOWED', message: 'Only tenant users can access HRM' });
    }

    const decision = await this.identity.decide({
      sessionId: principal.sessionId,
      userId: principal.userId,
      tenantId: principal.tenantId,
      moduleKey: 'hrm',
      permission: requiredPermission,
    });

    if (!decision.allowed || !decision.database) {
      throw new ForbiddenException({
        code: decision.code ?? 'PERMISSION_DENIED',
        message: 'You do not have required permissions or entitlement for HRM',
      });
    }

    const pool = (await this.pools.forTenant(decision.database)) as unknown as Pool;
    return {
      principal,
      tenantId: principal.tenantId,
      pool,
    };
  }
}
