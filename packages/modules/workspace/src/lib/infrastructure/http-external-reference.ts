import {
  EXTERNAL_CACHE_TTL_SECONDS,
  EXTERNAL_TIMEOUT_SECONDS,
  type ExternalModuleKey,
} from '@enterprise-platform/contracts-workspace';
import type {
  ExternalReferenceReader,
  ExternalSnapshot,
  ExternalViewer,
} from '../application/external-reference.port.js';

interface CacheEntry {
  readonly expiresAt: number;
  readonly snapshots: ReadonlyMap<string, ExternalSnapshot>;
}

/** Trần số khoá cache; vượt thì bỏ khoá cũ nhất để bộ nhớ không phình mãi. */
const MAX_CACHE_ENTRIES = 500;

/**
 * Đọc trạng thái hồ sơ ở module khác qua API công khai của chính module đó.
 *
 * Ba ràng buộc bắt buộc:
 *
 * 1. **Timeout 3 giây.** Module kia chậm thì Workspace không được chậm theo.
 * 2. **Cache 60 giây, khoá có `userId`.** Hai người nhìn cùng một hồ sơ có thể
 *    thấy khác nhau ở module gốc tuỳ quyền của từng người. Khoá cache chỉ theo
 *    tenant sẽ để người thứ hai đọc được thứ mà người thứ nhất mới có quyền.
 * 3. **Degrade mềm.** Lớp này được phép ném lỗi; tầng application bắt lại và
 *    trả nhãn cache kèm cờ `degraded`, để trang vẫn dùng được khi module kia
 *    đang tắt.
 *
 * Hiện chỉ đọc được module Quy trình — module duy nhất Workspace tạo hồ sơ
 * sang. Các `moduleKey` khác trả rỗng, và giao diện hiện nhãn cache.
 */
export class HttpExternalReferenceClient implements ExternalReferenceReader {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly procedureApiUrl: string = process.env['PROCEDURE_API_URL'] ??
      'http://localhost:3334/api/procedure',
  ) {}

  async read(
    viewer: ExternalViewer,
    moduleKey: ExternalModuleKey,
    externalIds: readonly string[],
  ): Promise<ReadonlyMap<string, ExternalSnapshot>> {
    if (externalIds.length === 0) return new Map();
    if (moduleKey !== 'procedure-engine') return new Map();

    const key = `${viewer.tenantId}:${viewer.userId}:${moduleKey}`;
    const cached = this.cache.get(key);
    const snapshots =
      cached && cached.expiresAt > Date.now()
        ? cached.snapshots
        : await this.fetchProcedureInstances(viewer, key);

    const wanted = new Set(externalIds);
    return new Map([...snapshots].filter(([id]) => wanted.has(id)));
  }

  /**
   * Quy trình không có endpoint đọc một hồ sơ lẻ; `GET /v1/workspace` trả
   * toàn bộ hồ sơ người dùng được thấy. Đọc một lần rồi cache cả tập — nhiều
   * công việc trong cùng một dự án thì chỉ tốn một lượt gọi.
   */
  private async fetchProcedureInstances(
    viewer: ExternalViewer,
    key: string,
  ): Promise<ReadonlyMap<string, ExternalSnapshot>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_SECONDS * 1000);

    try {
      const response = await fetch(`${this.procedureApiUrl}/v1/workspace`, {
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${viewer.accessToken}`,
          'x-tenant-id': viewer.tenantId,
        },
      });
      if (!response.ok) {
        throw new Error(`Quy trình trả về ${response.status}.`);
      }
      const body = (await response.json()) as {
        instances?: { id: string; code?: string; title?: string; status?: string }[];
      };

      const snapshots = new Map<string, ExternalSnapshot>(
        (body.instances ?? []).map((instance) => [
          instance.id,
          {
            externalId: instance.id,
            code: instance.code,
            label: instance.title,
            status: instance.status,
          },
        ]),
      );
      this.remember(key, snapshots);
      return snapshots;
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(key: string, snapshots: ReadonlyMap<string, ExternalSnapshot>): void {
    // `Map` giữ thứ tự chèn, nên khoá đầu tiên luôn là khoá cũ nhất.
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.delete(key);
    this.cache.set(key, {
      expiresAt: Date.now() + EXTERNAL_CACHE_TTL_SECONDS * 1000,
      snapshots,
    });
  }
}
