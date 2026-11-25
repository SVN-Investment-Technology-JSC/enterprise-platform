import type { WorkspaceLinkSettingsReader } from '../application/workspace-link-settings.port.js';
import {
  DEFAULT_PROCEDURE_ENGINE_SETTINGS,
  normalizeProcedureEngineSettings,
  type ProcedureEngineSettings,
} from '../application/workspace-link-settings.js';

/** Route nội bộ của Workspace (tính từ `WORKSPACE_API_URL`). */
export const WORKSPACE_PROCEDURE_LINK_SETTINGS_PATH = '/v1/internal/procedure-link-settings';

const TTL_MS = 30_000;
const TIMEOUT_MS = 3_000;
const WARN_INTERVAL_MS = 60_000;
const FAILURE_RETRY_MS = 5_000;

interface Entry {
  readonly value: ProcedureEngineSettings;
  readonly expiresAt: number;
}

/**
 * Hỏi Workspace qua route nội bộ chỉ đọc, cache 30 giây theo tenant (đổi cài đặt có hiệu lực sau tối đa ~30 giây),
 * gom các lời gọi đồng thời. Lỗi mạng/HTTP/JSON thì trả giá trị cache cũ nếu có, không thì mặc định, và ghi cảnh báo
 * tối đa một lần mỗi phút mỗi tenant.
 *
 * Hệ quả: Workspace sập thì tenant tạm quay về mặc định (= hành vi cũ); quy tắc đã siết lúc đó không được áp.
 */
export class HttpWorkspaceLinkSettingsReader implements WorkspaceLinkSettingsReader {
  private readonly cache = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<ProcedureEngineSettings>>();
  private readonly lastWarn = new Map<string, number>();

  constructor(
    private readonly baseUrl: string = process.env['WORKSPACE_API_URL'] ?? 'http://localhost:3337/api/workspace',
    private readonly now: () => number = () => Date.now(),
    private readonly warn: (message: string) => void = (message) => console.warn(message),
  ) {}

  async get(tenantId: string): Promise<ProcedureEngineSettings> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const pending = this.inflight.get(tenantId);
    if (pending) return pending;
    const request = this.fetchSettings(tenantId, cached?.value).finally(() => this.inflight.delete(tenantId));
    this.inflight.set(tenantId, request);
    return request;
  }

  private async fetchSettings(tenantId: string, stale?: ProcedureEngineSettings): Promise<ProcedureEngineSettings> {
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${WORKSPACE_PROCEDURE_LINK_SETTINGS_PATH}`, {
        headers: {
          'x-tenant-id': tenantId,
          'x-service-token': process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = normalizeProcedureEngineSettings(await response.json());
      this.cache.set(tenantId, { value, expiresAt: this.now() + TTL_MS });
      return value;
    } catch (error) {
      this.warnOnce(tenantId, error);
      const fallback = stale ?? DEFAULT_PROCEDURE_ENGINE_SETTINGS;
      // Cache ngắn kết quả dự phòng để Workspace sập không làm mỗi thao tác chờ hết timeout.
      this.cache.set(tenantId, { value: fallback, expiresAt: this.now() + FAILURE_RETRY_MS });
      return fallback;
    }
  }

  private warnOnce(tenantId: string, error: unknown): void {
    const at = this.now();
    const previous = this.lastWarn.get(tenantId);
    if (previous !== undefined && at - previous < WARN_INTERVAL_MS) return;
    this.lastWarn.set(tenantId, at);
    this.warn(
      `Không đọc được cài đặt Công việc gắn quy trình của Workspace (tenant ${tenantId}); dùng giá trị cũ hoặc mặc định: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
