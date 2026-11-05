import type { CrmCustomerReference, CrmCustomerReferencePage } from '@enterprise-platform/contracts-integration';
import type { CrmCustomerDirectory } from '../application/crm-customer.port.js';
import { WorkspaceError } from '../domain/workspace.error.js';

/** Kết quả "tenant có bật Bán hàng" giữ 30 giây để mỗi lần mở form không phải hỏi Platform. */
const ENTITLEMENT_CACHE_MS = 30_000;
const MAX_CACHE_ENTRIES = 500;
const TIMEOUT_MS = 5_000;

/**
 * Hai lời gọi server-to-server bằng `x-service-token`:
 *
 * 1. Tenant có bật Bán hàng: endpoint tra database của Platform
 *    (`/internal/v1/tenant-databases/:tenantId?moduleKey=crm`) — cùng cơ chế
 *    các API dùng để kiểm entitlement cho lời gọi nội bộ; 403
 *    `MODULE_NOT_ENTITLED` là chưa bật.
 * 2. Tra khách: `GET /v1/internal/customers` của Bán hàng (`CRM_API_URL`).
 *
 * Platform không trả lời thì coi như chưa bật (Workspace chạy như cũ); Bán
 * hàng không trả lời thì báo 503 để người dùng thử lại, không đoán.
 */
export class HttpCrmCustomerDirectory implements CrmCustomerDirectory {
  private readonly cache = new Map<string, { readonly value: boolean; readonly expiresAt: number }>();

  constructor(
    private readonly crmApiUrl: string = process.env['CRM_API_URL'] ?? 'http://localhost:3344/api/crm',
    private readonly tenantDatabaseApiUrl: string = process.env['PLATFORM_TENANT_DATABASE_API_URL'] ??
      process.env['PLATFORM_TENANT_DATABASE_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/tenant-databases',
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  async enabled(tenantId: string): Promise<boolean> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const token = process.env['INTERNAL_SERVICE_TOKEN'];
    if (!token) return false;
    let value = false;
    try {
      const response = await this.fetcher(
        `${this.tenantDatabaseApiUrl}/${encodeURIComponent(tenantId)}?moduleKey=crm`,
        { headers: { 'x-service-token': token }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' },
      );
      // Chỉ 200 và 403 là câu trả lời thật; lỗi khác không ghi cache để lần sau hỏi lại.
      if (response.ok) value = true;
      else if (response.status !== 403) return false;
    } catch {
      return false;
    }
    if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(tenantId, { value, expiresAt: this.now() + ENTITLEMENT_CACHE_MS });
    return value;
  }

  async lookup(
    tenantId: string,
    query: { readonly search?: string; readonly ids?: readonly string[]; readonly limit?: number },
  ): Promise<readonly CrmCustomerReference[]> {
    const token = process.env['INTERNAL_SERVICE_TOKEN'];
    if (!token) throw unavailable('Chưa cấu hình kết nối tới CRM.');
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.ids?.length) params.set('ids', query.ids.join(','));
    if (query.limit) params.set('limit', String(query.limit));
    try {
      const response = await this.fetcher(`${this.crmApiUrl}/v1/internal/customers?${params}`, {
        headers: { 'x-tenant-id': tenantId, 'x-service-token': token },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) throw unavailable(`CRM không trả lời danh sách khách hàng (${response.status}).`);
      const body = (await response.json()) as Partial<CrmCustomerReferencePage>;
      return Array.isArray(body.items) ? body.items : [];
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw unavailable('Không kết nối được CRM để lấy danh sách khách hàng.');
    }
  }
}

function unavailable(message: string): WorkspaceError {
  return new WorkspaceError('CRM_UNAVAILABLE', message, 503);
}
