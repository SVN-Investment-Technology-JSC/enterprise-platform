import type {
  InstanceReversalGuard,
  ReversalCheck,
} from '../application/instance-reversal-guard.port.js';

/** Route nội bộ của Tài chính cho hồ sơ có bước Tài chính đã sinh phiếu (tính từ `FINANCE_API_URL`). */
export const FINANCE_INSTANCE_REVERSAL_CHECK_PATH = (instanceId: string) =>
  `/v1/internal/instances/${encodeURIComponent(instanceId)}/reversal-check`;

/**
 * Route nội bộ của Bán hàng cho phiên duyệt báo giá, đơn bán (tính từ `CRM_API_URL`). Bán hàng nhận id hồ sơ hoặc
 * id lần gửi duyệt (`sourceId`, id của `crm_schema.procedure_links`); Quy trình gửi `sourceId`.
 */
export const CRM_INSTANCE_REVERSAL_CHECK_PATH = (instanceId: string) =>
  `/v1/internal/instances/${encodeURIComponent(instanceId)}/reversal-check`;

/** Nguồn của Bán hàng: hỏi theo id hồ sơ (`crm_quote`, `crm_order_credit`). */
const CRM_SOURCE_TYPES: readonly string[] = ['crm_quote', 'crm_order_credit'];

/**
 * Hỏi module nguồn qua route nội bộ chỉ đọc. Không trả lời được thì coi như KHÔNG cho
 * huỷ: thà chặn rồi thử lại còn hơn huỷ một hồ sơ mà module nguồn không hoàn tác được.
 *
 * Mỗi loại nguồn có địa chỉ riêng: đơn từ HRM, phiếu của Tài chính, báo giá và đơn bán của Bán hàng. Nguồn khác (Bảo trì, hồ sơ thủ công) không có
 * gì để hỏi nên luôn cho phép. Riêng hồ sơ có bước Tài chính đã sinh phiếu thì hỏi Tài chính theo id hồ sơ.
 */
export class HttpInstanceReversalGuard implements InstanceReversalGuard {
  constructor(
    private readonly hrmApiUrl: string = process.env['HRM_API_URL'] ??
      'http://localhost:3339/api/hrm',
    private readonly financeApiUrl: string = process.env['FINANCE_API_URL'] ??
      'http://localhost:3341/api/finance',
    private readonly crmApiUrl: string = process.env['CRM_API_URL'] ??
      'http://localhost:3344/api/crm',
  ) {}

  private endpoint(sourceType: string): { base: string; label: string } | null {
    if (sourceType === 'hrm_request') return { base: this.hrmApiUrl, label: 'HRM' };
    if (sourceType === 'finance_voucher') return { base: this.financeApiUrl, label: 'Tài chính' };
    return null;
  }

  async check(
    tenantId: string,
    source: { readonly sourceType: string; readonly sourceId: string },
  ): Promise<ReversalCheck> {
    if (CRM_SOURCE_TYPES.includes(source.sourceType)) {
      return this.ask(tenantId, `${this.crmApiUrl}${CRM_INSTANCE_REVERSAL_CHECK_PATH(source.sourceId)}`, 'CRM');
    }
    const endpoint = this.endpoint(source.sourceType);
    if (!endpoint) return { allowed: true };
    return this.ask(
      tenantId,
      `${endpoint.base}/v1/internal/procedure-links/${encodeURIComponent(source.sourceId)}/reversal-check`,
      endpoint.label,
    );
  }

  async checkFinanceStep(tenantId: string, instanceId: string): Promise<ReversalCheck> {
    return this.ask(tenantId, `${this.financeApiUrl}${FINANCE_INSTANCE_REVERSAL_CHECK_PATH(instanceId)}`, 'Tài chính');
  }

  private async ask(tenantId: string, url: string, label: string): Promise<ReversalCheck> {
    try {
      const response = await fetch(url, {
        headers: {
          'x-tenant-id': tenantId,
          'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return { allowed: false, reason: `${label} không trả lời được (HTTP ${response.status}); thử lại sau.` };
      }
      const body = (await response.json()) as { allowed?: boolean; reason?: string };
      return { allowed: body.allowed === true, reason: body.reason };
    } catch {
      return { allowed: false, reason: `Không liên lạc được ${label} để kiểm tra; thử lại sau.` };
    }
  }
}
