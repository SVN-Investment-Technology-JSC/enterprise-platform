import type { Pipeline } from '@enterprise-platform/contracts-crm';
import type { PipelineConfigProvider, PipelineConfigReader } from './pipeline-config.port.js';

/** Thời gian giữ cache cấu hình luồng (mili giây). Ngắn để bản chạy nhiều tiến trình tự đồng bộ. */
export const PIPELINE_CONFIG_TTL_MS = 30_000;

interface Entry {
  readonly expiresAt: number;
  readonly value: Promise<readonly Pipeline[]>;
}

/**
 * Cache ngắn theo tenant bọc `PipelineConfigReader`. Gom các lần tải đồng thời
 * thành một; lần tải lỗi không bị giữ lại. `invalidate` huỷ ngay.
 */
export class CachedPipelineConfig implements PipelineConfigProvider {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly reader: PipelineConfigReader,
    private readonly ttlMs: number = PIPELINE_CONFIG_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  pipelines(tenantId: string): Promise<readonly Pipeline[]> {
    const cached = this.entries.get(tenantId);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const value = this.reader.loadPipelines(tenantId);
    const entry: Entry = { expiresAt: this.now() + this.ttlMs, value };
    this.entries.set(tenantId, entry);
    value.catch(() => {
      if (this.entries.get(tenantId) === entry) this.entries.delete(tenantId);
    });
    return value;
  }

  invalidate(tenantId?: string): void {
    if (tenantId === undefined) this.entries.clear();
    else this.entries.delete(tenantId);
  }
}
