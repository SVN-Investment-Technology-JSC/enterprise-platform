import { Logger } from '@nestjs/common';
import type { SocialOrgNode, SocialOrgNodeKind, SocialUnitRef } from '@enterprise-platform/contracts-social';
import type {
  OrgNodeSelection,
  OrgStructurePort,
  ViewerScope,
  ViewerScopePort,
} from '../application/ports/viewer-scope.port.js';
import { foldText } from './http-organization-directory.js';

/** Sơ đồ tổ chức đổi chậm; đọc lại sau mỗi phút (như danh bạ). */
const CACHE_TTL_MS = 60_000;
/** Tenant Core lỗi thì 15 giây sau mới hỏi lại, để mỗi lượt gọi không phải chờ hết thời gian chờ. */
const RETRY_AFTER_MS = 15_000;
const TIMEOUT_MS = 5_000;

interface OrgNodeEntry {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  readonly kind: SocialOrgNodeKind;
}

/** Ảnh chụp sơ đồ tổ chức đã dựng sẵn các chỉ mục cần để trả lời không cần đọc mạng. */
export interface OrgSnapshot {
  /** Khoá là id nút viết thường. */
  readonly nodes: ReadonlyMap<string, OrgNodeEntry>;
  /** Mỗi người (id viết thường) và các nút được bổ nhiệm, theo thứ tự trong `members[]`. */
  readonly assignments: ReadonlyMap<string, readonly string[]>;
}

const EMPTY: OrgSnapshot = { nodes: new Map(), assignments: new Map() };

/**
 * Hiện thực `ViewerScopePort` và `OrgStructurePort` trên organization context của Tenant Core (cùng
 * endpoint, biến môi trường và `x-service-token` với `HttpOrganizationDirectory`). Mọi câu hỏi trả lời từ
 * một ảnh chụp lưu 60 giây theo tenant, không gọi mạng cho mỗi truy vấn.
 *
 * Lỗi Core: dùng ảnh cũ nếu còn, không thì sơ đồ rỗng: `unitIds` rỗng, người xem chỉ thấy bài công khai
 * và bài của mình (KHÔNG mở rộng quyền khi lỗi).
 *
 * Giả định payload (đọc như `unknown`, chỉ lấy vài trường): `units[]` {id, name, parentId, typeCategory},
 * `members[]` {userId, unitId | positionId}, `positions[]` {id, name, unitId} (chỉ dùng khi chức danh
 * không có trong `units[]`). Mọi `members[]` là người đang làm việc.
 */
export class HttpOrgStructure implements ViewerScopePort, OrgStructurePort {
  private readonly cache = new Map<string, { expiresAt: number; snapshot: OrgSnapshot }>();
  private readonly logger = new Logger(HttpOrgStructure.name);

  constructor(
    private readonly root: string = process.env['TENANT_CORE_ORGANIZATION_CONTEXT_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts',
    private readonly serviceToken: string = process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /* ------------------------------------------------------- ViewerScopePort */

  async scopeOf(tenantId: string, userId: string): Promise<ViewerScope> {
    const scopes = await this.scopesOf(tenantId, [userId]);
    return scopes.get(userId.toLowerCase()) ?? { userId, unitIds: [] };
  }

  async scopesOf(tenantId: string, userIds: readonly string[]): Promise<ReadonlyMap<string, ViewerScope>> {
    const snapshot = await this.snapshot(tenantId);
    const result = new Map<string, ViewerScope>();
    for (const userId of userIds) {
      const key = userId.toLowerCase();
      if (result.has(key)) continue;
      const unitIds = new Set<string>();
      for (const nodeId of snapshot.assignments.get(key) ?? []) {
        for (const ancestor of lineage(snapshot, nodeId)) unitIds.add(ancestor.id.toLowerCase());
      }
      result.set(key, { userId, unitIds: [...unitIds] });
    }
    return result;
  }

  async authorUnitOf(tenantId: string, userId: string): Promise<string | undefined> {
    const snapshot = await this.snapshot(tenantId);
    for (const nodeId of snapshot.assignments.get(userId.toLowerCase()) ?? []) {
      const unit = lineage(snapshot, nodeId).find((node) => node.kind === 'unit');
      if (unit) return unit.id.toLowerCase();
    }
    return undefined;
  }

  /* ------------------------------------------------------- OrgStructurePort */

  async listNodes(
    tenantId: string,
    query: { readonly kind?: SocialOrgNodeKind; readonly query?: string; readonly limit: number },
  ): Promise<readonly SocialOrgNode[]> {
    const snapshot = await this.snapshot(tenantId);
    const needle = query.query ? foldText(query.query) : '';
    const counts = memberCounts(snapshot);
    const items: SocialOrgNode[] = [];
    for (const node of snapshot.nodes.values()) {
      if (query.kind && node.kind !== query.kind) continue;
      if (needle && !foldText(node.name).includes(needle)) continue;
      const parent = node.parentId ? snapshot.nodes.get(node.parentId.toLowerCase()) : undefined;
      items.push({
        id: node.id,
        name: node.name,
        kind: node.kind,
        ...(parent ? { parentName: parent.name } : {}),
        ...(node.parentId ? { parentId: node.parentId } : {}),
        memberCount: counts.get(node.id.toLowerCase())?.size ?? 0,
      });
    }
    items.sort((left, right) => left.name.localeCompare(right.name, 'vi') || left.id.localeCompare(right.id));
    return items.slice(0, Math.max(0, query.limit));
  }

  async nodeRefs(tenantId: string, nodeIds: readonly string[]): Promise<ReadonlyMap<string, SocialUnitRef>> {
    const snapshot = await this.snapshot(tenantId);
    const result = new Map<string, SocialUnitRef>();
    for (const requested of nodeIds) {
      const node = snapshot.nodes.get(requested.toLowerCase());
      if (!node) continue;
      const parent = node.parentId ? snapshot.nodes.get(node.parentId.toLowerCase()) : undefined;
      result.set(requested.toLowerCase(), {
        id: node.id,
        name: node.name,
        kind: node.kind,
        ...(parent ? { parentName: parent.name } : {}),
      });
    }
    return result;
  }

  async memberIdsOf(tenantId: string, selections: readonly OrgNodeSelection[]): Promise<readonly string[]> {
    const snapshot = await this.snapshot(tenantId);
    const direct = new Set<string>();
    const withDescendants = new Set<string>();
    for (const selection of selections) {
      const id = selection.id.toLowerCase();
      if (selection.includeDescendants === false) direct.add(id);
      else withDescendants.add(id);
    }
    const members: string[] = [];
    for (const [userKey, nodeIds] of snapshot.assignments) {
      const matches = nodeIds.some(
        (nodeId) =>
          direct.has(nodeId.toLowerCase()) ||
          lineage(snapshot, nodeId).some((ancestor) => withDescendants.has(ancestor.id.toLowerCase())),
      );
      if (matches) members.push(userKey);
    }
    return members;
  }

  /* ----------------------------------------------------------------- nội bộ */

  private async snapshot(tenantId: string): Promise<OrgSnapshot> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > this.now()) return cached.snapshot;
    try {
      const response = await this.fetcher(`${this.root}/${encodeURIComponent(tenantId)}`, {
        headers: { 'x-service-token': this.serviceToken },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Tenant Core organization context returned ${response.status}.`);
      const snapshot = parseOrgStructure(await response.json());
      this.cache.set(tenantId, { expiresAt: this.now() + CACHE_TTL_MS, snapshot });
      return snapshot;
    } catch (error) {
      this.logger.warn(
        `Không đọc được sơ đồ tổ chức của tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      const fallback = cached?.snapshot ?? EMPTY;
      this.cache.set(tenantId, { expiresAt: this.now() + RETRY_AFTER_MS, snapshot: fallback });
      return fallback;
    }
  }
}

/** Nút và các nút cha của nó lên tới gốc (nút đứng trước). Chặn vòng lặp do dữ liệu hỏng. */
function lineage(snapshot: OrgSnapshot, nodeId: string): OrgNodeEntry[] {
  const chain: OrgNodeEntry[] = [];
  const seen = new Set<string>();
  let current = snapshot.nodes.get(nodeId.toLowerCase());
  while (current && !seen.has(current.id.toLowerCase())) {
    seen.add(current.id.toLowerCase());
    chain.push(current);
    current = current.parentId ? snapshot.nodes.get(current.parentId.toLowerCase()) : undefined;
  }
  return chain;
}

/** Người đang làm việc ở mỗi nút và các nút con của nó (khoá là id nút viết thường). */
function memberCounts(snapshot: OrgSnapshot): Map<string, Set<string>> {
  const counts = new Map<string, Set<string>>();
  for (const [userKey, nodeIds] of snapshot.assignments) {
    for (const nodeId of nodeIds) {
      for (const node of lineage(snapshot, nodeId)) {
        const key = node.id.toLowerCase();
        const set = counts.get(key) ?? new Set<string>();
        set.add(userKey);
        counts.set(key, set);
      }
    }
  }
  return counts;
}

/** Dựng ảnh chụp từ payload organization context (xem giả định ở đầu lớp). */
export function parseOrgStructure(payload: unknown): OrgSnapshot {
  const root = asRecord(payload);
  const units = Array.isArray(root?.['units']) ? (root['units'] as unknown[]) : [];
  const positions = Array.isArray(root?.['positions']) ? (root['positions'] as unknown[]) : [];
  const members = Array.isArray(root?.['members']) ? (root['members'] as unknown[]) : [];

  const nodes = new Map<string, OrgNodeEntry>();
  for (const entry of units) {
    const unit = asRecord(entry);
    const id = text(unit?.['id']);
    if (!id) continue;
    const parentId = text(unit?.['parentId']);
    nodes.set(id.toLowerCase(), {
      id,
      name: text(unit?.['name']) ?? id,
      ...(parentId ? { parentId } : {}),
      kind: text(unit?.['typeCategory']) === 'position' ? 'position' : 'unit',
    });
  }
  for (const entry of positions) {
    const position = asRecord(entry);
    const id = text(position?.['id']);
    if (!id || nodes.has(id.toLowerCase())) continue;
    const parentId = text(position?.['unitId']);
    nodes.set(id.toLowerCase(), {
      id,
      name: text(position?.['name']) ?? id,
      ...(parentId ? { parentId } : {}),
      kind: 'position',
    });
  }

  const assignments = new Map<string, string[]>();
  for (const entry of members) {
    const member = asRecord(entry);
    const userId = text(member?.['userId']);
    const nodeId = text(member?.['unitId']) ?? text(member?.['positionId']);
    if (!userId || !nodeId || !nodes.has(nodeId.toLowerCase())) continue;
    const key = userId.toLowerCase();
    const current = assignments.get(key) ?? [];
    if (!current.includes(nodeId)) current.push(nodeId);
    assignments.set(key, current);
  }
  return { nodes, assignments };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
