import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { AccessDecisionResponse, AuthenticatedPrincipal, TenantUserPrincipal } from '@enterprise-platform/contracts-identity';
import type { MaintenanceActor } from '@enterprise-platform/module-maintenance';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

interface MaintenanceRequest extends Request { maintenanceActor?: MaintenanceActor }
interface CachedDecision { readonly value: AccessDecisionResponse; readonly expiresAt: number }

@Injectable()
export class MaintenanceAccessGuard implements CanActivate {
  private readonly jwks = createRemoteJWKSet(new URL(process.env.PLATFORM_JWKS_URL ?? 'http://localhost:3333/api/auth/v1/jwks'));
  private readonly cache = new Map<string, CachedDecision>();

  constructor(private readonly databases: TenantDatabaseRegistry) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MaintenanceRequest>();
    if (request.path.endsWith('/health/live') || request.path.endsWith('/health/ready')) return true;
    this.requireCsrfForMutation(request);
    const principal = await this.principal(request);
    if (principal.kind === 'platform-admin') throw new ForbiddenException({ code: 'PLATFORM_ADMIN_NOT_ALLOWED', message: 'Platform Admin không truy cập dữ liệu tenant.' });
    const permission = request.method === 'GET' ? 'maintenance.read' : 'maintenance.manage';
    const decision = await this.decision(principal, permission);
    if (!decision.allowed || !decision.database || !decision.principal) throw new ForbiddenException({ code: decision.code ?? 'ACCESS_DENIED', message: 'Không được phép truy cập Maintenance.' });
    this.databases.register(decision.database);
    request.maintenanceActor = {
      tenantId: decision.principal.tenantId,
      userId: decision.principal.userId,
      displayName: decision.principal.displayName,
      canManage: decision.principal.permissions.includes('maintenance.manage'),
    };
    return true;
  }

  private async principal(request: Request): Promise<AuthenticatedPrincipal> {
    const bearer = request.headers.authorization;
    const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : request.cookies?.ep_access as string | undefined;
    if (!token) throw new UnauthorizedException();
    try {
      const { payload } = await jwtVerify(token, this.jwks, { algorithms: ['RS256'], issuer: 'enterprise-platform', audience: 'enterprise-platform-apps' });
      return payload.principal as unknown as AuthenticatedPrincipal;
    } catch { throw new UnauthorizedException('Access token không hợp lệ.'); }
  }

  private async decision(principal: TenantUserPrincipal, permission: string): Promise<AccessDecisionResponse> {
    const key = `${principal.sessionId}:${principal.tenantId}:${permission}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const response = await fetch(process.env.PLATFORM_ACCESS_DECISION_URL ?? 'http://localhost:3333/api/platform/internal/v1/access-decisions', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' },
        body: JSON.stringify({ sessionId: principal.sessionId, userId: principal.userId, tenantId: principal.tenantId, moduleKey: 'maintenance', permission }),
      });
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
    if (!value || value !== request.cookies?.ep_csrf) throw new ForbiddenException({ code: 'CSRF_INVALID', message: 'CSRF token không hợp lệ.' });
  }
}
