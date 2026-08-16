export interface TenantRequestContext {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly correlationId: string;
}

export interface TenantDatabaseReference {
  readonly tenantId: string;
  readonly databaseName: string;
  readonly host: string;
  readonly port: number;
  readonly secretRef: string;
  readonly ssl: boolean;
  readonly configVersion: number;
}

export type TenantStatus = 'active' | 'disabled';

export interface TenantAdminSummary {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
}

export interface TenantDatabaseSummary {
  readonly databaseName: string;
  readonly host: string;
  readonly port: number;
  readonly secretRef: string;
  readonly ssl: boolean;
  readonly status: string;
}

export interface TenantModuleSummary {
  readonly key: string;
  readonly name: string;
  readonly version: string;
  readonly status: string;
}

export interface TenantSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly createdAt: string;
  readonly admin: TenantAdminSummary | null;
  readonly database: TenantDatabaseSummary | null;
  readonly modules: readonly TenantModuleSummary[];
}

export interface CreateTenantRequest {
  readonly slug: string;
  readonly name: string;
  readonly admin: {
    readonly email: string;
    readonly displayName: string;
    readonly initialPassword: string;
  };
  readonly database: {
    readonly databaseName: string;
    readonly host: string;
    readonly port: number;
    readonly secretRef: string;
    readonly ssl?: boolean;
  };
}

export interface CreateTenantResponse {
  readonly tenant: TenantSummary;
}

export interface UpdateTenantRequest {
  readonly name?: string;
  readonly status?: TenantStatus;
}

export type TenantEntitlementStatus =
  | 'not-entitled'
  | 'provisioning'
  | 'active'
  | 'disabled'
  | 'failed';

export interface TenantModuleEntitlement {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly launchUrl: string;
  readonly icon: string | null;
  readonly version: string;
  readonly entitlementStatus: TenantEntitlementStatus;
  readonly provisionedVersion: string | null;
  readonly updatedAt: string | null;
  readonly latestJob: {
    readonly status: string;
    readonly targetVersion: string;
    readonly error: string | null;
    readonly createdAt: string;
    readonly completedAt: string | null;
  } | null;
}

export interface TenantEntitlementOverview {
  readonly tenant: TenantSummary;
  readonly modules: readonly TenantModuleEntitlement[];
}

export interface SetTenantEntitlementRequest {
  readonly enabled: boolean;
}

export interface SetTenantEntitlementResponse {
  readonly status: TenantEntitlementStatus;
}
