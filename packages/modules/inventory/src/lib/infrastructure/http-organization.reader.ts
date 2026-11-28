import type { ApprovalPositionOption } from '@enterprise-platform/contracts-inventory';
import type { InventoryOrganizationPort } from '../application/organization.port.js';
import { InventoryError } from '../domain/inventory.error.js';

const CACHE_TTL_MS = 30_000;
const TIMEOUT_MS = 5_000;

export interface OrganizationSnapshot {
  readonly positions: ApprovalPositionOption[];
  readonly held: ReadonlyMap<string, readonly string[]>;
}

/**
 * Đọc sơ đồ tổ chức từ organization context của Tenant Core, cùng endpoint, biến môi trường và `x-service-token`
 * với Quy trình và HRM. Payload đọc như `unknown`, chỉ lấy vài trường cần.
 * Lỗi thì ném 503, không rơi về bản cũ: kiểm người duyệt phải đóng khi không có dữ liệu chức danh.
 */
export class HttpInventoryOrganizationReader implements InventoryOrganizationPort {
  private readonly cache = new Map<string, { expiresAt: number; snapshot: OrganizationSnapshot }>();

  constructor(
    private readonly root: string = process.env['TENANT_CORE_ORGANIZATION_CONTEXT_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts',
    private readonly serviceToken: string = process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async positions(tenantId: string): Promise<ApprovalPositionOption[]> {
    return [...(await this.snapshot(tenantId)).positions];
  }

  async heldPositionIds(tenantId: string, userId: string): Promise<string[]> {
    return [...((await this.snapshot(tenantId)).held.get(userId) ?? [])];
  }

  private async snapshot(tenantId: string): Promise<OrganizationSnapshot> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
    let payload: unknown;
    try {
      const response = await this.fetcher(`${this.root}/${encodeURIComponent(tenantId)}`, {
        headers: { 'x-service-token': this.serviceToken },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      payload = await response.json();
    } catch {
      throw new InventoryError(
        'ORGANIZATION_UNAVAILABLE',
        'Không lấy được sơ đồ tổ chức để xác định người duyệt. Vui lòng thử lại.',
        503,
      );
    }
    const snapshot = parseOrganization(payload);
    this.cache.set(tenantId, { expiresAt: Date.now() + CACHE_TTL_MS, snapshot });
    return snapshot;
  }
}

/** `units` chứa mọi node kể cả chức danh (`typeCategory = 'position'`); `members[].positionId` hoặc `unitId` là node được bổ nhiệm. */
export function parseOrganization(payload: unknown): OrganizationSnapshot {
  const root = record(payload);
  const units = Array.isArray(root?.['units']) ? (root['units'] as unknown[]) : [];
  const members = Array.isArray(root?.['members']) ? (root['members'] as unknown[]) : [];
  const positions: ApprovalPositionOption[] = [];
  const positionIds = new Set<string>();
  for (const entry of units) {
    const unit = record(entry);
    const id = text(unit?.['id']);
    if (!id || text(unit?.['typeCategory']) !== 'position') continue;
    positionIds.add(id);
    positions.push({ id, name: text(unit?.['name']) ?? id });
  }
  positions.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const held = new Map<string, string[]>();
  for (const entry of members) {
    const member = record(entry);
    const userId = text(member?.['userId']);
    const nodeId = text(member?.['positionId']) ?? text(member?.['unitId']);
    if (!userId || !nodeId || !positionIds.has(nodeId)) continue;
    held.set(userId, [...(held.get(userId) ?? []), nodeId]);
  }
  return { positions, held };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
