import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { buildProcedureOrgUnits as buildOrgUnits, type ProcedureActor } from '@enterprise-platform/module-procedure-engine';
import { ModuleAccess } from '@enterprise-platform/platform-module-access';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TenantOrganizationContextClient } from './tenant-organization-context.client';

interface ProcedureRequest extends Request {
  procedureActor?: ProcedureActor;
}

/**
 * JWT, CSRF, access-decision và service token nằm ở `ModuleAccess` dùng chung;
 * guard này chỉ giữ phần riêng của Procedure — cổng `module.access` và dựng
 * actor kèm ngữ cảnh tổ chức.
 */
@Injectable()
export class ProcedureAccessGuard implements CanActivate {
  private readonly access = new ModuleAccess({ moduleKey: 'procedure-engine' });

  constructor(
    private readonly databases: TenantDatabaseRegistry,
    private readonly organizationContexts: TenantOrganizationContextClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ProcedureRequest>();
    if (this.access.isHealthCheck(request)) return true;
    // Service-to-service routes carry no browser session, so CSRF and the
    // user access-decision do not apply; they authenticate by service token.
    // Bên gọi nội bộ chỉ được phân giải database, không gắn actor: controller
    // nội bộ tự đọc tenant từ `x-tenant-id`.
    if (this.access.isInternal(request)) {
      const caller = await this.access.authorizeService(request);
      this.databases.register(caller.database);
      return true;
    }
    this.access.requireCsrfForMutation(request);
    const principal = await this.access.tenantUser(request);
    // Core resolves module admission and supported capabilities from current
    // role assignments. Procedure owns all per-instance RACI decisions.
    const decision = await this.access.decision(principal, 'module.access');
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
      // Core grants capabilities; Procedure still owns per-instance RACI rules.
      canDesign: decision.principal.permissions.includes('procedure.definition.manage'),
      canPublish: decision.principal.permissions.includes('procedure.definition.publish'),
      canCreateInstances: decision.principal.permissions.includes('procedure.instance.create'),
      isOverride: decision.principal.permissions.includes('procedure.instance.override'),
      organizationUnitIds: subjects.organizationUnitIds,
      positionIds: subjects.positionIds,
      // Lets authorization escalate a step assigned to a headless unit up to the
      // nearest ancestor that has a head, and route a unit-level assignment down
      // to the head position that answers for that unit.
      orgUnits: buildOrgUnits(organization),
    };
    return true;
  }
}
