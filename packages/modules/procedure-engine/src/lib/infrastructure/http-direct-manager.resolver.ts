import type { ProcedureManagerChainLink } from '@enterprise-platform/contracts-procedure-engine';
import type { DirectManagerChain, DirectManagerResolver } from '../application/direct-manager.port.js';

/**
 * Hỏi Platform Core chuỗi quản lý qua endpoint nội bộ, cùng gốc URL và service
 * token với client ngữ cảnh tổ chức của procedure-api.
 */
export class HttpDirectManagerResolver implements DirectManagerResolver {
  constructor(
    private readonly organizationContextUrl: string = process.env['TENANT_CORE_ORGANIZATION_CONTEXT_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts',
  ) {}

  async chain(tenantId: string, userId: string, positionId?: string): Promise<DirectManagerChain> {
    const query = positionId ? `?positionId=${encodeURIComponent(positionId)}` : '';
    const response = await fetch(
      `${this.organizationContextUrl}/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}/manager-chain${query}`,
      { headers: { 'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '' } },
    );
    if (!response.ok) throw new Error(`Sơ đồ tổ chức trả về ${response.status}.`);
    const body = (await response.json()) as {
      initiatorPositionId?: string | null;
      chain?: ProcedureManagerChainLink[];
    };
    return {
      initiatorPositionId: body.initiatorPositionId ?? undefined,
      chain: Array.isArray(body.chain) ? body.chain : [],
    };
  }
}
