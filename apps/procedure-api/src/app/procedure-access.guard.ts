import { TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import type { TenantOrganizationContext } from '@enterprise-platform/contracts-organization';
import type { ProcedureActor } from '@enterprise-platform/module-procedure-engine';
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
    // Platform only decides whether this user may enter the enabled module. It
    // deliberately does not own Procedure's fine-grained rules.
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
