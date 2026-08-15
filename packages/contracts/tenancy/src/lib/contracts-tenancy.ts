export interface TenantRequestContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly correlationId: string;
}

export interface TenantDatabaseReference {
  readonly tenantId: string;
  readonly databaseName: string;
  readonly host: string;
  readonly port: number;
  readonly secretRef: string;
}
