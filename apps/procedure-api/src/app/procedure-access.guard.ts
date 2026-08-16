import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type {
  AccessDecisionResponse,
  AuthenticatedPrincipal,
  TenantUserPrincipal,
} from '@enterprise-platform/contracts-identity';
import type { TenantOrganizationSnapshot } from '@enterprise-platform/contracts-organization';
import type { ProcedureActor } from '@enterprise-platform/module-procedure-engine';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

interface ProcedureRequest extends Request {
  procedureActor?: ProcedureActor;
}

interface CachedDecision {
  readonly value: AccessDecisionResponse;
  readonly expiresAt: number;
}

@Injectable()
export class ProcedureAccessGuard implements CanActivate {
  private readonly jwks = createRemoteJWKSet(
    new URL(process.env.PLATFORM_JWKS_URL ?? 'http://localhost:3333/api/auth/v1/jwks'),
  );
  private readonly cache = new Map<string, CachedDecision>();

  constructor(private readonly databases: TenantDatabaseRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ProcedureRequest>();
    if (request.path.endsWith('/health/live') || request.path.endsWith('/health/ready')) return true;
    this.requireCsrfForMutation(request);
    const principal = await this.principal(request);
    if (principal.kind === 'platform-admin') {
      throw new ForbiddenException({ code: 'PLATFORM_ADMIN_NOT_ALLOWED', message: 'Platform Admin không truy cập dữ liệu tenant.' });
    }
    const permission = request.method === 'GET' ? 'procedure.read' : 'procedure.manage';
    const decision = await this.decision(principal, permission);
    if (!decision.allowed || !decision.database || !decision.principal) {
      throw new ForbiddenException({ code: decision.code ?? 'ACCESS_DENIED', message: 'Không được phép truy cập Procedure Engine.' });
    }
    this.databases.register(decision.database);
    const organization = await this.organization(decision.principal.tenantId);
    const subjects = organization.membershipSubjects[decision.principal.membershipId] ?? {
      organizationUnitIds: [],
      positionIds: [],
    };
    request.procedureActor = {
      tenantId: decision.principal.tenantId,
      userId: decision.principal.userId,
      membershipId: decision.principal.membershipId,
      displayName: decision.principal.displayName,
      isOverride: decision.principal.permissions.includes('procedure.manage'),
      organizationUnitIds: subjects.organizationUnitIds,
      positionIds: subjects.positionIds,
    };
    return true;
  }

  private async principal(request: Request): Promise<AuthenticatedPrincipal> {
    const bearer = request.headers.authorization;
    const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : request.cookies?.ep_access as string | undefined;
    if (!token) throw new UnauthorizedException();
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        algorithms: ['RS256'], issuer: 'enterprise-platform', audience: 'enterprise-platform-apps',
      });
      return payload.principal as unknown as AuthenticatedPrincipal;
    } catch {
      throw new UnauthorizedException('Access token không hợp lệ.');
    }
  }

  private async decision(principal: TenantUserPrincipal, permission: string): Promise<AccessDecisionResponse> {
    const key = `${principal.sessionId}:${principal.tenantId}:${permission}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const response = await fetch(
        process.env.PLATFORM_ACCESS_DECISION_URL ?? 'http://localhost:3333/api/platform/internal/v1/access-decisions',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' },
          body: JSON.stringify({
            sessionId: principal.sessionId,
            userId: principal.userId,
            tenantId: principal.tenantId,
            moduleKey: 'procedure-engine',
            permission,
          }),
        },
      );
      if (!response.ok) throw new Error(`Platform access decision returned ${response.status}.`);
      const value = await response.json() as AccessDecisionResponse;
      this.cache.set(key, { value, expiresAt: Date.now() + 30_000 });
      return value;
    } catch {
      this.cache.delete(key);
      throw new ServiceUnavailableException({ code: 'PLATFORM_ACCESS_UNAVAILABLE', message: 'Không thể xác minh quyền truy cập; yêu cầu bị từ chối an toàn.' });
    }
  }

  private requireCsrfForMutation(request: Request): void {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const header = request.headers['x-csrf-token'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || value !== request.cookies?.ep_csrf) {
      throw new ForbiddenException({ code: 'CSRF_INVALID', message: 'CSRF token không hợp lệ.' });
    }
  }

  private async organization(tenantId: string): Promise<TenantOrganizationSnapshot> {
    try {
      const root = process.env.PLATFORM_ORGANIZATION_SNAPSHOT_URL ??
        'http://localhost:3333/api/platform/internal/v1/organization-snapshots';
      const response = await fetch(`${root}/${tenantId}`, {
        headers: { 'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' },
      });
      if (!response.ok) throw new Error(`Organization snapshot returned ${response.status}.`);
      return await response.json() as TenantOrganizationSnapshot;
    } catch {
      throw new ServiceUnavailableException({
        code: 'PLATFORM_ORGANIZATION_UNAVAILABLE',
        message: 'Không thể phân giải cơ cấu tổ chức; yêu cầu bị từ chối an toàn.',
      });
    }
  }
}
