import type {
  InstanceReversalGuard,
  ReversalCheck,
} from '../application/instance-reversal-guard.port.js';

/** Route nội bộ của Tài chính cho hồ sơ có bước Tài chính đã sinh phiếu (tính từ `FINANCE_API_URL`). */
export const FINANCE_INSTANCE_REVERSAL_CHECK_PATH = (instanceId: string) =>
  `/v1/internal/instances/${encodeURIComponent(instanceId)}/reversal-check`;

/**
 * Hỏi module nguồn qua route nội bộ chỉ đọc. Không trả lời được thì coi như KHÔNG cho
 * huỷ: thà chặn rồi thử lại còn hơn huỷ một hồ sơ mà module nguồn không hoàn tác được.
 *
 * Mỗi loại nguồn có địa chỉ riêng: đơn từ HRM và phiếu của Tài chính. Nguồn khác (Bảo trì, hồ sơ thủ công) không có
 * gì để hỏi nên luôn cho phép. Riêng hồ sơ có bước Tài chính đã sinh phiếu thì hỏi Tài chính theo id hồ sơ.
 */
export class HttpInstanceReversalGuard implements InstanceReversalGuard {
  constructor(
    private readonly hrmApiUrl: string = process.env['HRM_API_URL'] ??
      'http://localhost:3339/api/hrm',
    private readonly financeApiUrl: string = process.env['FINANCE_API_URL'] ??
      'http://localhost:3341/api/finance',
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
