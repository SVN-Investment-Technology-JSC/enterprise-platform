import { Logger } from '@nestjs/common';
import type { StorageQuotaPort } from '../application/ports/storage-quota.port.js';
import { SocialStorageQuotaExceededError } from '../domain/social.error.js';

/**
 * Hỏi Hệ dùng chung còn hạn mức dung lượng không, qua route nội bộ:
 *   POST {SHARED_API_URL}/v1/internal/storage/capacity-check   (x-tenant-id, x-service-token)
 *   body { sizeBytes } -> { allowed: true } | { allowed: false, message }
 *
 * Chỉ chặn khi Hệ dùng chung trả lời rõ `allowed: false`. Lỗi mạng, quá hạn, 5xx hay dữ liệu lạ thì ghi
 * cảnh báo và cho qua: Hệ dùng chung trục trặc không được làm Mạng nội bộ không tải nổi tệp.
 */
const TIMEOUT_MS = 3_000;

export interface HttpStorageQuotaOptions {
  readonly sharedApiUrl?: string;
  readonly serviceToken?: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

export class HttpStorageQuota implements StorageQuotaPort {
  private readonly logger = new Logger(HttpStorageQuota.name);
  private readonly sharedApiUrl: string;
  private readonly serviceToken: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpStorageQuotaOptions = {}) {
    this.sharedApiUrl = (
      options.sharedApiUrl ??
      process.env['SHARED_API_URL'] ??
      'http://localhost:3342/api/shared'
    ).replace(/\/+$/, '');
    this.serviceToken = options.serviceToken ?? process.env['INTERNAL_SERVICE_TOKEN'] ?? '';
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  }

  async ensureCapacity(tenantId: string, additionalBytes: number): Promise<void> {
    let verdict: { allowed: boolean; message?: string };
    try {
      const response = await this.fetcher(`${this.sharedApiUrl}/v1/internal/storage/capacity-check`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': this.serviceToken,
          'x-tenant-id': tenantId,
        },
        body: JSON.stringify({ sizeBytes: additionalBytes }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`Hệ dùng chung trả về ${response.status}.`);
      const body = (await response.json()) as { allowed?: unknown; message?: unknown } | null;
      if (typeof body?.allowed !== 'boolean') throw new Error('Phản hồi kiểm hạn mức không hợp lệ.');
      verdict = {
        allowed: body.allowed,
        message: typeof body.message === 'string' ? body.message : undefined,
      };
    } catch (error) {
      this.logger.warn(
        `Không kiểm được hạn mức dung lượng của tenant ${tenantId}, cho qua: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (!verdict.allowed) throw new SocialStorageQuotaExceededError(verdict.message);
  }
}
