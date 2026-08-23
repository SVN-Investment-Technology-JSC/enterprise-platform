import type { TenantOrganizationContext } from '@enterprise-platform/contracts-organization';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/** Maintenance consumes Tenant Core's published organization contract only. */
@Injectable()
export class TenantOrganizationContextClient {
  async load(tenantId: string): Promise<TenantOrganizationContext> {
    const root = process.env.TENANT_CORE_ORGANIZATION_CONTEXT_URL ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts';
    try {
      const response = await fetch(`${root}/${encodeURIComponent(tenantId)}`, {
        headers: { 'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' },
      });
      if (!response.ok) throw new Error(`Tenant Core organization context returned ${response.status}.`);
      return await response.json() as TenantOrganizationContext;
    } catch {
      throw new ServiceUnavailableException({
        code: 'TENANT_CORE_ORGANIZATION_UNAVAILABLE',
        message: 'Không thể lấy ngữ cảnh sơ đồ tổ chức từ Tenant Core.',
      });
    }
  }
}
