import type {
  InstanceReversalGuard,
  ReversalCheck,
} from '../application/instance-reversal-guard.port.js';

/**
 * Hỏi HRM qua route nội bộ chỉ đọc. Không trả lời được thì coi như KHÔNG cho
 * huỷ: thà chặn rồi thử lại còn hơn huỷ một hồ sơ mà HRM không hoàn tác được.
 */
export class HttpInstanceReversalGuard implements InstanceReversalGuard {
  constructor(
    private readonly hrmApiUrl: string = process.env['HRM_API_URL'] ??
      'http://localhost:3339/api/hrm',
  ) {}

  async check(
    tenantId: string,
    source: { readonly sourceType: string; readonly sourceId: string },
  ): Promise<ReversalCheck> {
    if (source.sourceType !== 'hrm_request') return { allowed: true };
    try {
      const response = await fetch(
        `${this.hrmApiUrl}/v1/internal/procedure-links/${encodeURIComponent(source.sourceId)}/reversal-check`,
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
        return { allowed: false, reason: `HRM không trả lời được (HTTP ${response.status}); thử lại sau.` };
      }
      const body = (await response.json()) as { allowed?: boolean; reason?: string };
      return { allowed: body.allowed === true, reason: body.reason };
    } catch {
      return { allowed: false, reason: 'Không liên lạc được HRM để kiểm tra; thử lại sau.' };
    }
  }
}
