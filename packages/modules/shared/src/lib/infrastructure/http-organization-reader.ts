import { Logger } from '@nestjs/common';
import type {
  OrganizationAssignment,
  OrganizationNode,
  OrganizationReader,
  OrganizationSnapshot,
} from '../application/organization.port.js';

/** Sơ đồ tổ chức đổi chậm; đọc lại sau mỗi phút như danh bạ của Workspace. */
const CACHE_TTL_MS = 60_000;
/** Tenant Core lỗi thì 15 giây sau mới hỏi lại, để mỗi lượt gọi không phải chờ hết thời gian chờ. */
const RETRY_AFTER_MS = 15_000;
const TIMEOUT_MS = 5_000;

/**
 * Đọc sơ đồ tổ chức từ organization context của Tenant Core — cùng endpoint,
 * cùng biến môi trường và `x-service-token` với Quy trình, Bảo trì, Workspace.
 *
 * Payload đọc như `unknown` và chỉ lấy vài trường cần: Tenant Core thêm trường
 * thì ở đây không vỡ. Không đọc được thì dùng bản cũ nếu còn, kèm `degraded`.
 */
export class HttpOrganizationReader implements OrganizationReader {
  private readonly cache = new Map<string, { expiresAt: number; snapshot: OrganizationSnapshot }>();
  private readonly logger = new Logger(HttpOrganizationReader.name);

  constructor(
    private readonly root: string = process.env['TENANT_CORE_ORGANIZATION_CONTEXT_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts',
    private readonly serviceToken: string = process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async snapshot(tenantId: string): Promise<OrganizationSnapshot> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
    try {
      const response = await this.fetcher(`${this.root}/${encodeURIComponent(tenantId)}`, {
        headers: { 'x-service-token': this.serviceToken },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Tenant Core organization context returned ${response.status}.`);
      const snapshot = parseOrganization(await response.json());
      this.cache.set(tenantId, { expiresAt: Date.now() + CACHE_TTL_MS, snapshot });
      return snapshot;
    } catch (error) {
      this.logger.warn(
        `Không đọc được sơ đồ tổ chức của tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      const fallback: OrganizationSnapshot = cached
        ? { ...cached.snapshot, degraded: true }
        : { nodes: [], assignments: [], degraded: true };
      this.cache.set(tenantId, { expiresAt: Date.now() + RETRY_AFTER_MS, snapshot: fallback });
      return fallback;
    }
  }
}

/**
 * Node và phân công từ payload organization context.
 *
 * `units` chứa mọi node, kể cả chức danh (`typeCategory = 'position'`);
 * `members[].unitId` là node được bổ nhiệm — thường là một chức danh.
 */
export function parseOrganization(payload: unknown): OrganizationSnapshot {
  const root = asRecord(payload);
  const units = Array.isArray(root?.['units']) ? (root['units'] as unknown[]) : [];
  const members = Array.isArray(root?.['members']) ? (root['members'] as unknown[]) : [];

  const nodes: OrganizationNode[] = [];
  for (const entry of units) {
    const unit = asRecord(entry);
    const id = text(unit?.['id']);
    if (!id) continue;
    nodes.push({
      id,
      name: text(unit?.['name']) ?? id,
      parentId: text(unit?.['parentId']),
      kind: text(unit?.['typeCategory']) === 'position' ? 'position' : 'unit',
    });
  }

  const assignments: OrganizationAssignment[] = [];
  for (const entry of members) {
    const member = asRecord(entry);
    const userId = text(member?.['userId']);
    const nodeId = text(member?.['unitId']) ?? text(member?.['positionId']);
    if (userId && nodeId) assignments.push({ userId, nodeId });
  }

  return { nodes, assignments, degraded: false };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
