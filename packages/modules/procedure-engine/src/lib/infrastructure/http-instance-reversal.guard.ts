import type {
  InstanceReversalGuard,
  ReversalCheck,
} from '../application/instance-reversal-guard.port.js';

/**
 * Hỏi module nguồn qua route nội bộ chỉ đọc. Không trả lời được thì coi như KHÔNG cho
 * huỷ: thà chặn rồi thử lại còn hơn huỷ một hồ sơ mà module nguồn không hoàn tác được.
 *
 * Mỗi loại nguồn có địa chỉ riêng: đơn từ HRM và phiếu của Tài chính. Nguồn khác (Bảo trì, hồ sơ thủ công) không có
 * gì để hỏi nên luôn cho phép.
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
    try {
      const response = await fetch(
        `${endpoint.base}/v1/internal/procedure-links/${encodeURIComponent(source.sourceId)}/reversal-check`,
        {
          headers: {
            'x-tenant-id': tenantId,
            'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
          },
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) {
        return { allowed: false, reason: `${endpoint.label} không trả lời được (HTTP ${response.status}); thử lại sau.` };
      }
      const body = (await response.json()) as { allowed?: boolean; reason?: string };
      return { allowed: body.allowed === true, reason: body.reason };
    } catch {
      return { allowed: false, reason: `Không liên lạc được ${endpoint.label} để kiểm tra; thử lại sau.` };
    }
  }
}
