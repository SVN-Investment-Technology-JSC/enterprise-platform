import type {
  TenantDatabaseReference,
  TenantRequestContext,
} from '@enterprise-platform/contracts-tenancy';

export interface TenantDatabaseConfigProvider {
  findByTenantId(tenantId: string): Promise<TenantDatabaseReference | null>;
}

export interface TenantDataSourceResolver<TDataSource> {
  resolve(context: TenantRequestContext): Promise<TDataSource>;
  release(tenantId: string): Promise<void>;
}
