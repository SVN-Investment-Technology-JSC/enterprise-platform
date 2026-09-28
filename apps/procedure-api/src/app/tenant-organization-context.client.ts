import type { TenantOrganizationContext } from '@enterprise-platform/contracts-organization';
import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';

/** Integration boundary: Procedure consumes Tenant Core's read-only contract. */
@Injectable()
export class TenantOrganizationContextClient {
  async load(tenantId: string): Promise<TenantOrganizationContext> {
    const root = process.env.TENANT_CORE_ORGANIZATION_CONTEXT_URL ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts';
    try {
      const response = await fetch(`${root}/${encodeURIComponent(tenantId)}`, {
        headers: { 'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' },
      });
      if (!response.ok)
        throw new Error(`Tenant Core organization context returned ${response.status}.`);
      return await response.json() as TenantOrganizationContext;
    } catch {
      throw new ServiceUnavailableException({
        code: 'TENANT_CORE_ORGANIZATION_UNAVAILABLE',
        message: 'Không thể lấy ngữ cảnh sơ đồ tổ chức từ Tenant Core.',
      });
    }
  }

  /**
   * Ghi "Báo cáo cho" của một chức danh qua Core. Procedure không bao giờ ghi
   * thẳng vào `core_schema`; lỗi nghiệp vụ của Core (vòng lặp, khác sơ đồ...)
   * được trả nguyên thông điệp để màn hình hiển thị.
   */
  async setPositionReportsTo(
    tenantId: string,
    positionId: string,
    reportsToPositionId: string | null,
  ): Promise<{ id: string; reportsToPositionId: string | null }> {
    const root = process.env.TENANT_CORE_ORGANIZATION_CONTEXT_URL ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts';
    let response: Response;
    try {
      response = await fetch(
        `${root}/${encodeURIComponent(tenantId)}/positions/${encodeURIComponent(positionId)}/reports-to`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
          },
          body: JSON.stringify({ reportsToPositionId }),
        },
      );
    } catch {
      throw new ServiceUnavailableException({
        code: 'TENANT_CORE_ORGANIZATION_UNAVAILABLE',
        message: 'Không thể kết nối Tenant Core để lưu "Báo cáo cho".',
      });
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new HttpException(
        { statusCode: response.status, message: body['message'] ?? 'Không lưu được "Báo cáo cho".' },
        response.status,
      );
    }
    return body as { id: string; reportsToPositionId: string | null };
  }
}
