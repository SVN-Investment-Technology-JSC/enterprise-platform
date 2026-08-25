import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/**
 * Maintenance consumes Tenant Core's published organization contract only.
 *
 * Trả `unknown` chứ không phải `TenantOrganizationContext`: tầng này chuyển
 * nguyên payload cho web client, không đọc một trường nào. Khai kiểu ở đây sẽ
 * kéo `contracts-organization` (`scope:platform`) vào `scope:maintenance` — điều
 * mà `@nx/enforce-module-boundaries` cấm, và cũng dựng một bản sao thứ hai của
 * hợp đồng ngay tại chỗ không cần biết hợp đồng. Phía web mới là nơi đọc các
 * trường, và ở đó nó tự khai kiểu.
 */
@Injectable()
export class TenantOrganizationContextClient {
  async load(tenantId: string): Promise<unknown> {
    const root = process.env.TENANT_CORE_ORGANIZATION_CONTEXT_URL ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts';
    try {
      const response = await fetch(`${root}/${encodeURIComponent(tenantId)}`, {
        headers: { 'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' },
      });
      if (!response.ok) throw new Error(`Tenant Core organization context returned ${response.status}.`);
      return await response.json();
    } catch {
      throw new ServiceUnavailableException({
        code: 'TENANT_CORE_ORGANIZATION_UNAVAILABLE',
        message: 'Không thể lấy ngữ cảnh sơ đồ tổ chức từ Tenant Core.',
      });
    }
  }
}
