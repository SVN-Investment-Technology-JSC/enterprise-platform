import { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import type {
  AuthenticatedPrincipal,
  HrmAction,
} from '@enterprise-platform/contracts-identity';
import { PlatformIdentityService } from '@enterprise-platform/platform-identity';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Pool } from 'pg';
import { isProcedureReachable } from './hrm-procedure-api.js';

@Injectable()
export class HrmContextService {
  private readonly jwks = createRemoteJWKSet(
    new URL(
      process.env.PLATFORM_JWKS_URL ?? 'http://localhost:3333/api/auth/v1/jwks',
    ),
  );

  constructor(
    private readonly identity: PlatformIdentityService,
    private readonly pools: PostgresPoolRegistry,
  ) {}

  async resolveEmployee(pool: Pool, tenantId: string, userId: string) {
    const result = await pool.query(
      `SELECT e.id, e.full_name FROM core_schema.employees e
      JOIN hrm_schema.employee_profiles ep ON ep.employee_id = e.id AND ep.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1 AND e.user_id = $2 AND e.deleted_at IS NULL AND ep.deleted_at IS NULL`,
      [tenantId, userId],
    );
    if (!result.rows[0])
      throw new NotFoundException({
        code: 'HRM_EMPLOYEE_NOT_FOUND',
        message: 'Tài khoản chưa được liên kết hồ sơ nhân viên',
      });
    return {
      employeeId: result.rows[0].id as string,
      fullName: result.rows[0].full_name as string,
    };
  }

  async getRequestContext(
    request: Request,
    requestedEmployeeId?: string,
    otherPermission: HrmAction = 'hrm.request.manage',
    selfPermission: HrmAction = 'hrm.self.request',
  ) {
    const context = await this.getContext(request, 'hrm.read');
    if (requestedEmployeeId && this.has(context, otherPermission))
      return { ...context, employeeId: requestedEmployeeId };
    if (!requestedEmployeeId) {
      await this.getContext(request, selfPermission);
      return {
        ...context,
        ...(await this.resolveEmployee(
          context.pool,
          context.tenantId,
          context.principal.userId,
        )),
      };
    }
    const own = await context.pool.query(
      `SELECT id FROM core_schema.employees WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND deleted_at IS NULL`,
      [context.tenantId, context.principal.userId, requestedEmployeeId],
    );
    await this.getContext(
      request,
      own.rowCount ? selfPermission : otherPermission,
    );
    return { ...context, employeeId: requestedEmployeeId };
  }

  private readonly procedureAvailability = new Map<
    string,
    { value: boolean; expiresAt: number }
  >();

  /**
   * Procedure dùng được cho tenant: entitlement `procedure-engine` còn hiệu lực (dịch vụ
   * entitlement của Platform) và API Procedure trả lời. Không đọc DB của Procedure.
   * Cache ngắn để màn hình không gọi mạng ở mọi lần tải.
   */
  async procedureAvailable(tenantId: string): Promise<boolean> {
    const cached = this.procedureAvailability.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    let value = false;
    try {
      const entitled = await this.identity.serviceDatabase(
        tenantId,
        'procedure-engine',
      );
      value = entitled !== null && (await isProcedureReachable(tenantId));
    } catch {
      value = false;
    }
    this.procedureAvailability.set(tenantId, {
      value,
      expiresAt: Date.now() + 10_000,
    });
    return value;
  }

  has(context: { principal: AuthenticatedPrincipal }, permission: HrmAction) {
    return (
      context.principal.permissions?.includes(permission) ||
      context.principal.permissions?.includes('tenant.manage') ||
      context.principal.permissions?.includes('hrm.manage')
    );
  }

  async scoped(
    request: Request,
    permission: HrmAction,
    requestedEmployeeId?: string,
  ) {
    const context = await this.getContext(request, 'hrm.read');
    if (this.has(context, permission))
      return { ...context, employeeId: requestedEmployeeId };
    await this.getContext(request, 'hrm.self.read');
    const own = await this.resolveEmployee(
      context.pool,
      context.tenantId,
      context.principal.userId,
    );
    if (requestedEmployeeId && requestedEmployeeId !== own.employeeId)
      throw new ForbiddenException('Chỉ được xem dữ liệu của bản thân');
    return { ...context, employeeId: own.employeeId };
  }

  async getContext(
    request: Request,
    requiredPermission: HrmAction | 'module.access' = 'hrm.read',
  ): Promise<{
    principal: AuthenticatedPrincipal;
    tenantId: string;
    pool: Pool;
  }> {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !request.headers.authorization?.startsWith('Bearer ')
    ) {
      const header = request.headers['x-csrf-token'];
      const supplied = Array.isArray(header) ? header[0] : header;
      if (!supplied || supplied !== request.cookies?.ep_csrf) {
        throw new ForbiddenException({
          code: 'CSRF_INVALID',
          message: 'CSRF token không hợp lệ.',
        });
      }
    }
    const bearer = request.headers.authorization;
    let token = bearer?.startsWith('Bearer ')
      ? bearer.slice(7)
      : (request.cookies?.ep_access as string | undefined);

    // Fallback: parse raw cookie header if request.cookies is not populated by middleware
    if (!token && request.headers.cookie) {
      const match = request.headers.cookie.match(/(?:^|;\s*)ep_access=([^;]+)/);
      if (match) {
        token = decodeURIComponent(match[1]);
      }
    }

    if (!token) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Missing authentication token',
      });
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
      throw new ForbiddenException({
        code: 'PLATFORM_ADMIN_NOT_ALLOWED',
        message: 'Only tenant users can access HRM',
      });
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

    const pool = (await this.pools.forTenant(
      decision.database,
    )) as unknown as Pool;
    return {
      principal: decision.principal ?? principal,
      tenantId: principal.tenantId,
      pool,
    };
  }
}
