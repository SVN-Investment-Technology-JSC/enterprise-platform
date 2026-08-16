export interface OrganizationUnitType {
  readonly id: string;
  readonly key: string;
  readonly name: string;
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

