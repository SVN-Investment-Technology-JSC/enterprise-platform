/**
 * 'unit' là đơn vị (phòng, khối, ban), 'position' là chức danh.
 *
 * Người chỉ được bổ nhiệm vào node 'position'; module cần phân biệt hai loại để
 * phân giải "gán cho đơn vị" thành "giao cho trưởng đơn vị đó".
 */
export type OrganizationNodeCategory = 'unit' | 'position';

export interface OrganizationUnitType {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly category: OrganizationNodeCategory;
  readonly usageCount: number;
  readonly createdAt: string;
}

export interface OrganizationPosition {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly unitId: string;
  readonly createdAt: string;
}

export interface OrganizationMember {
  readonly membershipId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly unitId?: string;
  readonly positionId?: string;
  readonly positionName?: string;
  readonly isHead: boolean;
}

export interface OrganizationUnit {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly typeId: string;
  readonly typeName: string;
  readonly typeCategory: OrganizationNodeCategory;
  readonly parentId?: string;
  readonly headMembershipId?: string;
  readonly headName?: string;
  readonly memberCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TenantOrganizationSnapshot {
  readonly tenantId: string;
  readonly generatedAt: string;
  readonly unitTypes: readonly OrganizationUnitType[];
  readonly units: readonly OrganizationUnit[];
  readonly positions: readonly OrganizationPosition[];
  readonly members: readonly OrganizationMember[];
  readonly membershipSubjects: Readonly<
    Record<
      string,
      {
        readonly organizationUnitIds: readonly string[];
        readonly positionIds: readonly string[];
      }
    >
  >;
}

/**
 * Read-only organization view published by Tenant Core for other modules.
 * Consumers must treat this as a contract, never as permission to access
 * core_schema tables directly.
 */
export interface TenantOrganizationContext extends TenantOrganizationSnapshot {
  readonly version: 1;
  readonly source: 'tenant-core';
}

export interface CreateOrganizationUnitTypeRequest {
  readonly key: string;
  readonly name: string;
}

export interface UpdateOrganizationUnitTypeRequest {
  readonly name: string;
}

export interface CreateOrganizationUnitRequest {
  readonly code: string;
  readonly name: string;
  readonly typeId: string;
  readonly parentId?: string;
  readonly headMembershipId?: string;
}

export interface UpdateOrganizationUnitRequest {
  readonly name?: string;
  readonly typeId?: string;
  readonly parentId?: string | null;
  readonly headMembershipId?: string | null;
}

export interface CreateOrganizationPositionRequest {
  readonly key: string;
  readonly name: string;
  readonly unitId: string;
}

export interface AssignOrganizationMemberRequest {
  readonly membershipId: string;
  readonly positionId?: string;
  readonly isHead?: boolean;
}
