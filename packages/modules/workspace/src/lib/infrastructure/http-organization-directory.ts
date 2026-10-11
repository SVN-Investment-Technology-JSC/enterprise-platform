import {
  DIRECTORY_CACHE_TTL_SECONDS,
  DIRECTORY_TIMEOUT_SECONDS,
  type DirectoryPerson,
  type DirectoryResponse,
} from '@enterprise-platform/contracts-workspace';
import type { OrganizationDirectory } from '../application/organization-directory.port.js';

interface CachedDirectory {
  readonly value: DirectoryResponse;
  readonly expiresAt: number;
}

/**
 * Đọc danh bạ từ organization context của Tenant Core.
 *
 * Cùng endpoint, cùng biến môi trường và cùng `x-service-token` với
 * `TenantOrganizationContextClient` của Bảo trì và Quy trình.
 *
 * **Không import `contracts-organization`**: package đó thuộc scope nền tảng,
 * `module-workspace` không được phụ thuộc vào nó. Vì vậy payload được đọc như
 * `unknown` và chỉ lấy đúng vài trường cần, bỏ qua mọi thứ lạ. Tenant Core
 * đổi hợp đồng thì ở đây rơi về danh sách rỗng chứ không vỡ.
 */
export class HttpOrganizationDirectory implements OrganizationDirectory {
  private readonly cache = new Map<string, CachedDirectory>();

  constructor(
    private readonly root: string = process.env['TENANT_CORE_ORGANIZATION_CONTEXT_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts',
    private readonly serviceToken: string = process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async list(tenantId: string): Promise<DirectoryResponse> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DIRECTORY_TIMEOUT_SECONDS * 1000);
    try {
      const response = await this.fetcher(`${this.root}/${encodeURIComponent(tenantId)}`, {
        headers: { 'x-service-token': this.serviceToken },
        signal: controller.signal,
      });
      if (!response.ok) return this.fallback(tenantId);
      const value: DirectoryResponse = { people: parseDirectory(await response.json()), degraded: false };
      this.cache.set(tenantId, { value, expiresAt: Date.now() + DIRECTORY_CACHE_TTL_SECONDS * 1000 });
      return value;
    } catch {
      return this.fallback(tenantId);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Lỗi thì dùng bản cache đã hết hạn nếu còn, kèm cờ `degraded`. */
  private fallback(tenantId: string): DirectoryResponse {
    const stale = this.cache.get(tenantId);
    return { people: stale?.value.people ?? [], degraded: true };
  }
}

/**
 * Rút danh bạ từ payload organization context.
 *
 * Một người có thể có nhiều membership (nhiều đơn vị, nhiều chức danh) — gộp
 * lại thành một dòng theo `userId`, giữ tên đơn vị không trùng.
 */
export function parseDirectory(payload: unknown): DirectoryPerson[] {
  const root = asRecord(payload);
  const members = Array.isArray(root?.['members']) ? (root['members'] as unknown[]) : [];
  const units = Array.isArray(root?.['units']) ? (root['units'] as unknown[]) : [];

  const nodes = new Map<string, { name?: string; parentId?: string; category?: string }>();
  for (const entry of units) {
    const unit = asRecord(entry);
    const id = text(unit?.['id']);
    if (!id) continue;
    nodes.set(id, {
      name: text(unit?.['name']),
      parentId: text(unit?.['parentId']),
      category: text(unit?.['typeCategory']),
    });
  }

  // Người luôn được bổ nhiệm vào node CHỨC DANH, nên `unitId` của membership
  // trỏ vào chức danh ("Chuyên viên dự án"), không phải phòng ("Phòng Dự án").
  // Đi lên cha gần nhất có loại `unit`. Payload cũ không có `typeCategory` thì
  // giữ nguyên tên node được bổ nhiệm như trước.
  const unitName = (nodeId: string | undefined): string | undefined => {
    const seen = new Set<string>();
    let current = nodeId ? nodes.get(nodeId) : undefined;
    const assigned = current?.name;
    while (current && current.category === 'position' && current.parentId) {
      if (seen.has(current.parentId)) break;
      seen.add(current.parentId);
      current = nodes.get(current.parentId);
    }
    if (current && current.category !== 'position') return current.name ?? assigned;
    return assigned;
  };

  // Node được bổ nhiệm và mọi node cha của nó. Module Quy trình gán vai cho
  // chức danh hoặc cho đơn vị, nên phải giữ cả chuỗi đi lên thì mới đối chiếu
  // được cả hai kiểu gán.
  const nodeChain = (nodeId: string | undefined): string[] => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let currentId = nodeId;
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      chain.push(currentId);
      currentId = nodes.get(currentId)?.parentId;
    }
    return chain;
  };

  const people = new Map<
    string,
    { person: DirectoryPerson; units: Set<string>; nodeIds: Set<string> }
  >();
  for (const entry of members) {
    const member = asRecord(entry);
    const userId = text(member?.['userId']);
    if (!userId) continue;
    const nodeId = text(member?.['unitId']);
    const unit = unitName(nodeId);
    const existing = people.get(userId);
    if (existing) {
      if (unit) existing.units.add(unit);
      for (const id of nodeChain(nodeId)) existing.nodeIds.add(id);
      continue;
    }
    people.set(userId, {
      person: {
        userId,
        displayName: text(member?.['displayName']) || text(member?.['email']) || userId,
        email: text(member?.['email']),
        unitNames: [],
        positionName: text(member?.['positionName']),
      },
      units: new Set(unit ? [unit] : []),
      nodeIds: new Set(nodeChain(nodeId)),
    });
  }

  return [...people.values()]
    .map(({ person, units: names, nodeIds }) => ({
      ...person,
      unitNames: [...names],
      orgNodeIds: [...nodeIds],
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'vi'));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
