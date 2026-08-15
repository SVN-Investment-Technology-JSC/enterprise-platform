export interface AuthenticatedUserContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly isPlatformAdmin: boolean;
}
