import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { TenantDatabaseReference } from '@enterprise-platform/contracts-tenancy';
import type {
  AccessDecisionResponse,
  AuthenticatedPrincipal,
  TenantUserPrincipal,
} from '@enterprise-platform/contracts-identity';
import type { TenantOrganizationContext } from '@enterprise-platform/contracts-organization';
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
import { TenantOrganizationContextClient } from './tenant-organization-context.client';

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

  constructor(
    private readonly databases: TenantDatabaseRegistry,
    private readonly organizationContexts: TenantOrganizationContextClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ProcedureRequest>();
    if (request.path.endsWith('/health/live') || request.path.endsWith('/health/ready')) return true;
    // Service-to-service routes carry no browser session, so CSRF and the
    // user access-decision do not apply; they authenticate by service token.
    if (request.path.includes('/v1/internal/')) return this.authorizeService(request);
    this.requireCsrfForMutation(request);
    const principal = await this.principal(request);
    if (principal.kind === 'platform-admin') {
      throw new ForbiddenException({ code: 'PLATFORM_ADMIN_NOT_ALLOWED', message: 'Platform Admin không truy cập dữ liệu tenant.' });
    }
    // Platform only decides whether this user may enter the enabled module. It
    // deliberately does not own Procedure's fine-grained rules.
    const decision = await this.decision(principal, 'module.access');
    if (!decision.allowed || !decision.database || !decision.principal) {
      throw new ForbiddenException({ code: decision.code ?? 'ACCESS_DENIED', message: 'Không được phép truy cập Procedure Engine.' });
    }
    this.databases.register(decision.database);
    const organization = await this.organizationContexts.load(decision.principal.tenantId);
    const subjects = organization.membershipSubjects[decision.principal.membershipId] ?? {
      organizationUnitIds: [],
      positionIds: [],
    };
    request.procedureActor = {
      tenantId: decision.principal.tenantId,
      userId: decision.principal.userId,
      membershipId: decision.principal.membershipId,
      displayName: decision.principal.displayName,
      // Until Procedure has its own role administration, every admitted tenant
      // user can maintain definitions. Runtime actions remain constrained by
      // the R/A/C/S/I/E assignments below.
      canDesign: true,
      // Quản trị tenant thao tác được mọi vai, và xoá được hồ sơ/quy trình. Vai
      // này do Platform Core trả về trong access-decision; các vai RCSI vẫn
      // ràng buộc mọi người còn lại. Lịch sử thao tác ghi rõ ai đã làm, nên một
      // hành động của quản trị vẫn truy vết được.
      isOverride: decision.principal.roles.includes('tenant-admin'),
      organizationUnitIds: subjects.organizationUnitIds,
      positionIds: subjects.positionIds,
      // Lets authorization escalate a step assigned to a headless unit up to the
      // nearest ancestor that has a head, and route a unit-level assignment down
      // to the head position that answers for that unit.
      orgUnits: buildOrgUnits(organization),
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

  /**
   * Authorizes a trusted service caller (e.g. Maintenance creating a work order).
   * Fails closed when INTERNAL_SERVICE_TOKEN is unset so a misconfigured deploy
   * cannot be reached with an empty header.
   */
  private async authorizeService(request: ProcedureRequest): Promise<boolean> {
    const expected = process.env.INTERNAL_SERVICE_TOKEN;
    const presented = request.headers['x-service-token'];
    const token = Array.isArray(presented) ? presented[0] : presented;
    if (!expected || token !== expected) {
      throw new UnauthorizedException({
        code: 'SERVICE_IDENTITY_INVALID',
        message: 'Service identity không hợp lệ.',
      });
    }

    const header = request.headers['x-tenant-id'];
    const tenantId = (Array.isArray(header) ? header[0] : header)?.trim();
    if (!tenantId) {
      throw new ForbiddenException({
        code: 'MISSING_TENANT',
        message: 'X-Tenant-ID là bắt buộc cho lời gọi nội bộ.',
      });
    }

    this.databases.register(await this.serviceDatabase(tenantId));
    return true;
  }

  private async serviceDatabase(tenantId: string) {
    // Đây là endpoint HTTP của Platform, không phải connection string. Tên cũ
    // PLATFORM_TENANT_DATABASE_URL đọc như một DSN nên vẫn được chấp nhận để
    // không phá môi trường đang chạy, nhưng tên đúng là ..._API_URL.
    const root =
      process.env.PLATFORM_TENANT_DATABASE_API_URL ??
      process.env.PLATFORM_TENANT_DATABASE_URL ??
      'http://localhost:3333/api/platform/internal/v1/tenant-databases';
    try {
      const response = await fetch(
        `${root}/${encodeURIComponent(tenantId)}?moduleKey=procedure-engine`,
        { headers: { 'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' } },
      );
      if (!response.ok) throw new Error(`Tenant database lookup returned ${response.status}.`);
      const body = await response.json() as { database: TenantDatabaseReference };
      return body.database;
    } catch {
      throw new ServiceUnavailableException({
        code: 'PLATFORM_ACCESS_UNAVAILABLE',
        message: 'Không thể phân giải database của tenant; yêu cầu bị từ chối an toàn.',
      });
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

}

/**
 * Dựng bản đồ đơn vị cho tầng phân quyền.
 *
 * `units` trong snapshot chứa MỌI node, cả đơn vị lẫn chức danh; `typeCategory`
 * là thứ phân biệt hai loại. Người chỉ được bổ nhiệm vào node chức danh, nên một
 * vai gán ở cấp đơn vị phải được phân giải xuống chức danh phụ trách nằm ngay
 * dưới đơn vị đó, nếu không sẽ không ai khớp.
 */
function buildOrgUnits(
  organization: TenantOrganizationContext,
): Map<
  string,
  {
    parentId?: string;
    hasHead: boolean;
    category?: 'unit' | 'position';
    headPositionIds: string[];
    memberPositionIds: string[];
  }
> {
  const headedNodeIds = new Set(
    organization.members.filter((member) => member.isHead && member.unitId).map((member) => member.unitId as string),
  );

  const headPositionsByParent = new Map<string, string[]>();
  for (const node of organization.units) {
    if (node.typeCategory !== 'position' || !node.parentId) continue;
    if (!headedNodeIds.has(node.id)) continue;
    headPositionsByParent.set(node.parentId, [
      ...(headPositionsByParent.get(node.parentId) ?? []),
      node.id,
    ]);
  }

  // Chức danh nằm dưới một đơn vị, kể cả qua nhiều cấp. Vai S gán ở cấp đơn vị
  // trải xuống toàn bộ danh sách này.
  const childrenByParent = new Map<string, string[]>();
  for (const node of organization.units) {
    if (!node.parentId) continue;
    childrenByParent.set(node.parentId, [...(childrenByParent.get(node.parentId) ?? []), node.id]);
  }
  const categoryById = new Map(organization.units.map((node) => [node.id, node.typeCategory]));

  const descendantPositions = (rootId: string): string[] => {
    const found: string[] = [];
    const seen = new Set<string>([rootId]);
    const queue = [...(childrenByParent.get(rootId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      // Cây tổ chức về lý thuyết không có vòng lặp, nhưng một bản ghi hỏng
      // không được phép làm treo request xác thực quyền.
      if (seen.has(id)) continue;
      seen.add(id);
      if (categoryById.get(id) === 'position') found.push(id);
      queue.push(...(childrenByParent.get(id) ?? []));
    }
    return found;
  };

  return new Map(
    organization.units.map((unit) => {
      const headPositionIds = headPositionsByParent.get(unit.id) ?? [];
      return [
        unit.id,
        {
          parentId: unit.parentId,
          // Có chức danh phụ trách bên dưới cũng tính là "đã có người phụ trách",
          // nếu không thì trách nhiệm sẽ leo lên cấp trên một cách vô cớ.
          hasHead: Boolean(unit.headMembershipId) || headPositionIds.length > 0,
          category: unit.typeCategory,
          headPositionIds,
          memberPositionIds: unit.typeCategory === 'unit' ? descendantPositions(unit.id) : [],
        },
      ];
    }),
  );
}
