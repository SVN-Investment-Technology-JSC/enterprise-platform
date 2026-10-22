import { Logger } from '@nestjs/common';
import type { SocialUserRef } from '@enterprise-platform/contracts-social';
import type { OrganizationDirectory } from '../application/organization-directory.port.js';

/** Danh bạ đổi chậm; đọc lại sau mỗi phút. */
const CACHE_TTL_MS = 60_000;
/** Tenant Core lỗi thì 15 giây sau mới hỏi lại. */
const RETRY_AFTER_MS = 15_000;
const TIMEOUT_MS = 5_000;

interface DirectoryEntry {
  readonly user: SocialUserRef;
  /** Tên và email đã bỏ dấu, viết thường, để tìm kiếm. */
  readonly haystack: string;
}

interface DirectorySnapshot {
  readonly byId: ReadonlyMap<string, DirectoryEntry>;
  readonly entries: readonly DirectoryEntry[];
}

const EMPTY: DirectorySnapshot = { byId: new Map(), entries: [] };

/**
 * Đọc người dùng (tên, chức danh, phòng) từ organization context của Tenant
 * Core — cùng endpoint, biến môi trường và `x-service-token` với các phân hệ
 * khác. Tên người dùng không sao chép sang DB của phân hệ.
 *
 * Payload đọc như `unknown`, chỉ lấy vài trường cần. Không đọc được thì dùng
 * bản cũ nếu còn, không thì danh bạ rỗng (tên hiển thị rơi về "không xác định").
 */
export class HttpOrganizationDirectory implements OrganizationDirectory {
  private readonly cache = new Map<string, { expiresAt: number; snapshot: DirectorySnapshot }>();
  private readonly logger = new Logger(HttpOrganizationDirectory.name);

  constructor(
    private readonly root: string = process.env['TENANT_CORE_ORGANIZATION_CONTEXT_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts',
    private readonly serviceToken: string = process.env['INTERNAL_SERVICE_TOKEN'] ?? '',
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async resolve(tenantId: string, userIds: readonly string[]): Promise<ReadonlyMap<string, SocialUserRef>> {
    const snapshot = await this.snapshot(tenantId);
    const result = new Map<string, SocialUserRef>();
    for (const id of userIds) {
      const entry = snapshot.byId.get(id.toLowerCase());
      if (entry) result.set(id.toLowerCase(), entry.user);
    }
    return result;
  }

  async search(tenantId: string, query: string, limit: number): Promise<readonly SocialUserRef[]> {
    const needle = foldText(query);
    if (!needle) return [];
    const snapshot = await this.snapshot(tenantId);
    const matches = snapshot.entries.filter((entry) => entry.haystack.includes(needle));
    // Khớp đầu tên lên trước.
    matches.sort((left, right) => {
      const leftStarts = foldText(left.user.name).startsWith(needle) ? 0 : 1;
      const rightStarts = foldText(right.user.name).startsWith(needle) ? 0 : 1;
      return leftStarts - rightStarts || left.user.name.localeCompare(right.user.name, 'vi');
    });
    return matches.slice(0, limit).map((entry) => entry.user);
  }

  private async snapshot(tenantId: string): Promise<DirectorySnapshot> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
    try {
      const response = await this.fetcher(`${this.root}/${encodeURIComponent(tenantId)}`, {
        headers: { 'x-service-token': this.serviceToken },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Tenant Core organization context returned ${response.status}.`);
      const snapshot = parseDirectory(await response.json());
      this.cache.set(tenantId, { expiresAt: Date.now() + CACHE_TTL_MS, snapshot });
      return snapshot;
    } catch (error) {
      this.logger.warn(
        `Không đọc được danh bạ của tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      const fallback = cached?.snapshot ?? EMPTY;
      this.cache.set(tenantId, { expiresAt: Date.now() + RETRY_AFTER_MS, snapshot: fallback });
      return fallback;
    }
  }
}

/** Bỏ dấu tiếng Việt, hạ chữ thường: "Nguyễn" khớp "nguyen". */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/**
 * Người dùng từ payload organization context: `members[]` (userId, displayName,
 * email, positionName, unitId) và `units[]` để đi từ chức danh lên phòng.
 * Một người có nhiều membership thì gộp thành một dòng theo `userId`.
 */
export function parseDirectory(payload: unknown): DirectorySnapshot {
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

  /** Người được bổ nhiệm vào node chức danh; đi lên cha gần nhất không phải chức danh để ra tên phòng. */
  const unitName = (nodeId: string | undefined): string | undefined => {
    const seen = new Set<string>();
    let current = nodeId ? nodes.get(nodeId) : undefined;
    const assigned = current?.name;
    while (current && current.category === 'position' && current.parentId) {
      if (seen.has(current.parentId)) break;
      seen.add(current.parentId);
      current = nodes.get(current.parentId);
    }
    return current && current.category !== 'position' ? (current.name ?? assigned) : assigned;
  };

  const byId = new Map<string, DirectoryEntry>();
  for (const entry of members) {
    const member = asRecord(entry);
    const userId = text(member?.['userId']);
    if (!userId || byId.has(userId.toLowerCase())) continue;
    const email = text(member?.['email']);
    const name = text(member?.['displayName']) ?? email ?? userId;
    const position = text(member?.['positionName']);
    const unit = unitName(text(member?.['unitId']));
    byId.set(userId.toLowerCase(), {
      user: {
        id: userId,
        name,
        ...(position ? { position } : {}),
        ...(unit ? { unitName: unit } : {}),
      },
      haystack: foldText(`${name} ${email ?? ''}`),
    });
  }
  return { byId, entries: [...byId.values()] };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
