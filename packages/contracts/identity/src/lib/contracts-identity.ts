interface PrincipalBase {
  readonly userId: string;
  readonly sessionId: string;
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface PlatformAdminPrincipal extends PrincipalBase {
  readonly kind: 'platform-admin';
}

export interface TenantUserPrincipal extends PrincipalBase {
  readonly kind: 'tenant-user';
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly membershipId: string;
}

export type AuthenticatedPrincipal =
  | PlatformAdminPrincipal
  | TenantUserPrincipal;

export type LoginPortal = 'platform' | 'tenant';

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
  readonly portal: LoginPortal;
}

export interface LoginResponse {
  readonly principal: AuthenticatedPrincipal;
  readonly redirectTo: string;
}

export interface AccessDecisionRequest {
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly moduleKey: string;
  readonly permission: string;
}

export interface AccessDecisionResponse {
  readonly allowed: boolean;
  readonly code?:
    | 'SESSION_INACTIVE'
    | 'MEMBERSHIP_INACTIVE'
    | 'MODULE_NOT_ENTITLED'
    | 'PERMISSION_DENIED';
  readonly principal?: TenantUserPrincipal;
  readonly database?: import('@enterprise-platform/contracts-tenancy').TenantDatabaseReference;
  readonly expiresAt?: string;
}
