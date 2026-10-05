import type {
  InitiatorActorResolver,
} from '../application/initiator-actor.port.js';
import type { ProcedureActor } from '../domain/procedure-authorization.js';
import {
  buildProcedureOrgUnits,
  type ProcedureOrganizationSnapshot,
} from '../domain/procedure-org-units.js';

interface OrganizationContextBody extends ProcedureOrganizationSnapshot {
  readonly members: readonly {
    readonly membershipId: string;
    readonly userId: string;
    readonly displayName?: string;
    readonly isHead: boolean;
    readonly unitId?: string;
  }[];
  readonly membershipSubjects: Readonly<
    Record<string, { readonly organizationUnitIds: readonly string[]; readonly positionIds: readonly string[] }>
  >;
}

/** Đọc snapshot tổ chức qua endpoint nội bộ của Core, cùng gốc URL và service token với client tổ chức của procedure-api. */
export class HttpInitiatorActorResolver implements InitiatorActorResolver {
  constructor(
    private readonly organizationContextUrl: string = process.env['TENANT_CORE_ORGANIZATION_CONTEXT_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts',
  ) {}

  async resolve(
    tenantId: string,
    userId: string,
    displayName?: string,
  ): Promise<ProcedureActor | null> {
    const response = await fetch(`${this.organizationContextUrl}/${encodeURIComponent(tenantId)}`, {
      headers: { 'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Sơ đồ tổ chức trả về ${response.status}.`);
    const organization = (await response.json()) as OrganizationContextBody;
    const member = organization.members.find((item) => item.userId === userId);
    if (!member) return null;
    const subjects = organization.membershipSubjects[member.membershipId] ?? {
      organizationUnitIds: [],
      positionIds: [],
    };
    return {
      tenantId,
      userId,
      membershipId: member.membershipId,
      displayName: displayName || member.displayName || userId,
      canDesign: false,
      canPublish: false,
      canCreateInstances: false,
      isOverride: false,
      organizationUnitIds: subjects.organizationUnitIds,
      positionIds: subjects.positionIds,
      orgUnits: buildProcedureOrgUnits(organization),
    };
  }
}
