import { Logger } from '@nestjs/common';
import type { ReportingLineReader } from '../application/organization-scope.port.js';
import { CrmOrganizationUnavailableError } from '../domain/crm.error.js';
import type {
  ReportingAssignment,
  ReportingLineSnapshot,
  ReportingPosition,
} from '../domain/reporting-line.js';

/** Cơ cấu tổ chức đổi chậm; đọc lại sau mỗi phút như Hệ dùng chung và Workspace. */
const CACHE_TTL_MS = 60_000;
/** Tenant Core lỗi mà còn bản cũ thì dùng bản cũ, 15 giây sau mới hỏi lại. */
const RETRY_AFTER_MS = 15_000;
const TIMEOUT_MS = 5_000;

/**
 * Đọc quan hệ "Báo cáo cho" từ organization context của Tenant Core — cùng
 * endpoint, cùng biến môi trường và `x-service-token` với Hệ dùng chung, Quy
 * trình, Workspace.
 *
 * Payload đọc như `unknown` và chỉ lấy vài trường cần: Tenant Core thêm trường
 * thì ở đây không vỡ. Không đọc được thì dùng bản cũ nếu còn; chưa có bản nào
 * thì ném 503, vì đoán phạm vi (rộng hơn hay hẹp hơn) đều sai.
 */
export class HttpOrganizationScope implements ReportingLineReader {
  private readonly cache = new Map<string, { expiresAt: number; snapshot: ReportingLineSnapshot }>();
  private readonly logger = new Logger(HttpOrganizationScope.name);

  constructor(
    private readonly root: string = process.env['TENANT_CORE_ORGANIZATION_CONTEXT_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts',
    private readonly serviceToken: string = process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  async snapshot(tenantId: string): Promise<ReportingLineSnapshot> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > this.now()) return cached.snapshot;
    try {
      const response = await this.fetcher(`${this.root}/${encodeURIComponent(tenantId)}`, {
        headers: { 'x-service-token': this.serviceToken },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Tenant Core organization context returned ${response.status}.`);
      const snapshot = parseReportingLines(await response.json());
      this.cache.set(tenantId, { expiresAt: this.now() + CACHE_TTL_MS, snapshot });
      return snapshot;
    } catch (error) {
      this.logger.warn(
        `Không đọc được cơ cấu tổ chức của tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!cached) throw new CrmOrganizationUnavailableError();
      this.cache.set(tenantId, { expiresAt: this.now() + RETRY_AFTER_MS, snapshot: cached.snapshot });
      return cached.snapshot;
    }
  }
}

/**
 * Quan hệ "Báo cáo cho" từ payload organization context.
 *
 * `units` chứa mọi node, kể cả chức danh; `positions` (nếu có) ghi đè cho cùng
 * id, như HRM. `members[]` là phân công: node được bổ nhiệm lấy `positionId`,
 * dữ liệu cũ không có thì lấy `unitId`.
 */
export function parseReportingLines(payload: unknown): ReportingLineSnapshot {
  const root = asRecord(payload);
  const byId = new Map<string, ReportingPosition>();
  for (const key of ['units', 'positions']) {
    const list = Array.isArray(root?.[key]) ? (root[key] as unknown[]) : [];
    for (const entry of list) {
      const node = asRecord(entry);
      const id = text(node?.['id']);
      if (!id) continue;
      byId.set(id, { id, reportsToPositionId: text(node?.['reportsToPositionId']) ?? null });
    }
  }

  const members = Array.isArray(root?.['members']) ? (root['members'] as unknown[]) : [];
  const assignments: ReportingAssignment[] = [];
  for (const entry of members) {
    const member = asRecord(entry);
    const userId = text(member?.['userId']);
    const positionId = text(member?.['positionId']) ?? text(member?.['unitId']);
    if (!userId || !positionId) continue;
    assignments.push({
      userId,
      positionId,
      reportsToOverrideId: text(member?.['reportsToPositionOverrideId']) ?? null,
    });
  }

  return { positions: [...byId.values()], assignments };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
