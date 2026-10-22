import { Logger } from '@nestjs/common';
import type { SocialBirthday, SocialUpcomingBirthday, SocialUserRef } from '@enterprise-platform/contracts-social';
import type {
  BirthdayPerson,
  BirthdayWindow,
  PeopleProfilePort,
  PersonRecord,
} from '../application/ports/people-profile.port.js';
import { daysUntilBirthday, isValidBirthday } from '../domain/social-birthday-rules.js';

/**
 * Hồ sơ người và sinh nhật từ Tenant Core và HRM, đọc qua API nội bộ bằng service token; không sao chép
 * dữ liệu sang `social_schema`.
 *
 * GIẢ ĐỊNH VÀ GIỚI HẠN (đã khảo sát, xem docs/architecture/social-p2-p3-api.md):
 *
 * 1. Tên, email, chức danh, phòng, danh sách người đang làm việc: lấy từ
 *    `GET {TENANT_CORE_ORGANIZATION_CONTEXT_URL}/:tenantId` (`members` + `units`), cùng nguồn với
 *    `HttpOrganizationDirectory`. Chỉ người đang có phân công trong sơ đồ tổ chức mới có mặt, nên người
 *    chưa được xếp vào đơn vị nào không có trong danh sách (kể cả `listActiveUserIds`).
 * 2. Ngày sinh và ngày vào công ty nằm ở hồ sơ nhân sự của HRM. Client này gọi route nội bộ của HRM:
 *      GET {HRM_API_URL}/v1/internal/people/profile-facts   (x-tenant-id, x-service-token)
 *      -> { data: [{ userId, birthMonth?, birthDay?, birthYear?, joinDate? }] }
 *    Năm sinh chỉ dùng để tính tuổi ở trang sinh nhật, không vào hồ sơ hay widget. Khi HRM trả lỗi (5xx,
 *    quá hạn, tenant chưa bật HRM) thì sinh nhật rỗng và hồ sơ thiếu `birthday`/`joinedAt`; mọi phần
 *    khác vẫn chạy.
 * 3. `canOpenInHrm`: quyền HRM của người xem không có trong cổng này và HRM chưa có endpoint kiểm tra,
 *    nên chỉ trả `true` cho chính chủ; quản trị tenant được `SocialProfileService` cho phép riêng. Người
 *    khác nhận `false` (không hiện nút) cho đến khi có endpoint kiểm quyền.
 */
const ORG_CACHE_TTL_MS = 60_000;
const FACTS_CACHE_TTL_MS = 5 * 60_000;
const RETRY_AFTER_MS = 15_000;
const TIMEOUT_MS = 5_000;

interface PersonEntry {
  readonly user: SocialUserRef;
  readonly email?: string;
}

interface PersonFacts {
  readonly birthday?: SocialBirthday;
  /** Chỉ dùng tính tuổi ở trang sinh nhật; không bao giờ vào hồ sơ trả ra ngoài. */
  readonly birthYear?: number;
  readonly joinedAt?: string;
}

interface Cached<TValue> {
  readonly expiresAt: number;
  readonly value: TValue;
}

export interface HttpPeopleProfileOptions {
  readonly organizationContextUrl?: string;
  readonly hrmApiUrl?: string;
  readonly serviceToken?: string;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
}

export class HttpPeopleProfile implements PeopleProfilePort {
  private readonly logger = new Logger(HttpPeopleProfile.name);
  private readonly organizationContextUrl: string;
  private readonly hrmApiUrl: string;
  private readonly serviceToken: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly people = new Map<string, Cached<ReadonlyMap<string, PersonEntry>>>();
  private readonly facts = new Map<string, Cached<ReadonlyMap<string, PersonFacts>>>();

  constructor(options: HttpPeopleProfileOptions = {}) {
    this.organizationContextUrl =
      options.organizationContextUrl ??
      process.env['TENANT_CORE_ORGANIZATION_CONTEXT_URL'] ??
      'http://localhost:3333/api/platform/internal/v1/organization-contexts';
    this.hrmApiUrl = (options.hrmApiUrl ?? process.env['HRM_API_URL'] ?? 'http://localhost:3339/api/hrm').replace(
      /\/+$/,
      '',
    );
    this.serviceToken = options.serviceToken ?? process.env['INTERNAL_SERVICE_TOKEN'] ?? '';
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  async profileOf(tenantId: string, userId: string): Promise<PersonRecord | undefined> {
    const entry = (await this.directory(tenantId)).get(userId.toLowerCase());
    if (!entry) return undefined;
    const facts = (await this.factsOf(tenantId)).get(userId.toLowerCase());
    return {
      user: entry.user,
      ...(entry.user.unitName ? { unitName: entry.user.unitName } : {}),
      ...(entry.user.position ? { position: entry.user.position } : {}),
      ...(entry.email ? { email: entry.email } : {}),
      ...(facts?.birthday ? { birthday: facts.birthday } : {}),
      ...(facts?.joinedAt ? { joinedAt: facts.joinedAt } : {}),
    };
  }

  async birthdays(tenantId: string, window: BirthdayWindow): Promise<readonly SocialUpcomingBirthday[]> {
    const [directory, facts] = await Promise.all([this.directory(tenantId), this.factsOf(tenantId)]);
    const found: SocialUpcomingBirthday[] = [];
    for (const [userId, personFacts] of facts) {
      const entry = directory.get(userId);
      if (!entry || !personFacts.birthday) continue;
      const daysUntil = daysUntilBirthday(window.today, personFacts.birthday);
      if (daysUntil <= window.days) found.push({ user: entry.user, birthday: personFacts.birthday, daysUntil });
    }
    return found.sort(
      (left, right) => left.daysUntil - right.daysUntil || left.user.name.localeCompare(right.user.name, 'vi'),
    );
  }

  async listBirthdayPeople(tenantId: string): Promise<readonly BirthdayPerson[]> {
    const [directory, facts] = await Promise.all([this.directory(tenantId), this.factsOf(tenantId)]);
    const people: BirthdayPerson[] = [];
    for (const [userId, personFacts] of facts) {
      const entry = directory.get(userId);
      if (!entry || !personFacts.birthday) continue;
      people.push({
        user: entry.user,
        birthday: personFacts.birthday,
        ...(personFacts.birthYear ? { birthYear: personFacts.birthYear } : {}),
      });
    }
    return people;
  }

  async listActiveUserIds(tenantId: string): Promise<readonly string[]> {
    return [...(await this.directory(tenantId)).values()].map((entry) => entry.user.id);
  }

  async canOpenInHrm(_tenantId: string, viewerId: string, targetUserId: string): Promise<boolean> {
    return viewerId.toLowerCase() === targetUserId.toLowerCase();
  }

  /** Danh bạ người đang làm việc, khoá là id viết thường. */
  private async directory(tenantId: string): Promise<ReadonlyMap<string, PersonEntry>> {
    return this.cached(this.people, tenantId, ORG_CACHE_TTL_MS, async () => {
      const response = await this.fetcher(`${this.organizationContextUrl}/${encodeURIComponent(tenantId)}`, {
        headers: { 'x-service-token': this.serviceToken },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Tenant Core organization context returned ${response.status}.`);
      return parseOrganization(await response.json());
    });
  }

  /** Ngày sinh (chỉ ngày/tháng) và ngày vào công ty theo người dùng; rỗng khi HRM không trả lời. */
  private async factsOf(tenantId: string): Promise<ReadonlyMap<string, PersonFacts>> {
    return this.cached(this.facts, tenantId, FACTS_CACHE_TTL_MS, async () => {
      const response = await this.fetcher(`${this.hrmApiUrl}/v1/internal/people/profile-facts`, {
        headers: { 'x-tenant-id': tenantId, 'x-service-token': this.serviceToken },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`HRM profile facts returned ${response.status}.`);
      return parseFacts(await response.json());
    });
  }

  /** Bản sao ngắn hạn; lỗi thì dùng bản cũ (hoặc rỗng) và chỉ thử lại sau `RETRY_AFTER_MS`. */
  private async cached<TValue>(
    cache: Map<string, Cached<ReadonlyMap<string, TValue>>>,
    tenantId: string,
    ttlMs: number,
    load: () => Promise<ReadonlyMap<string, TValue>>,
  ): Promise<ReadonlyMap<string, TValue>> {
    const hit = cache.get(tenantId);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    try {
      const value = await load();
      cache.set(tenantId, { expiresAt: this.now() + ttlMs, value });
      return value;
    } catch (error) {
      this.logger.warn(
        `Không đọc được dữ liệu người của tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      const value = hit?.value ?? new Map<string, TValue>();
      cache.set(tenantId, { expiresAt: this.now() + RETRY_AFTER_MS, value });
      return value;
    }
  }
}

/** `members[]` (userId, displayName, email, positionName, unitId) và `units[]` để đi từ chức danh lên phòng. */
export function parseOrganization(payload: unknown): ReadonlyMap<string, PersonEntry> {
  const root = asRecord(payload);
  const members = Array.isArray(root?.['members']) ? (root['members'] as unknown[]) : [];
  const units = Array.isArray(root?.['units']) ? (root['units'] as unknown[]) : [];

  const nodes = new Map<string, { name?: string; parentId?: string; category?: string }>();
  for (const entry of units) {
    const unit = asRecord(entry);
    const id = text(unit?.['id']);
    if (!id) continue;
    nodes.set(id, { name: text(unit?.['name']), parentId: text(unit?.['parentId']), category: text(unit?.['typeCategory']) });
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

  const byId = new Map<string, PersonEntry>();
  for (const entry of members) {
    const member = asRecord(entry);
    const userId = text(member?.['userId']);
    if (!userId || byId.has(userId.toLowerCase())) continue;
    const email = text(member?.['email']);
    const position = text(member?.['positionName']);
    const unit = unitName(text(member?.['unitId']));
    byId.set(userId.toLowerCase(), {
      user: {
        id: userId,
        name: text(member?.['displayName']) ?? email ?? userId,
        ...(position ? { position } : {}),
        ...(unit ? { unitName: unit } : {}),
      },
      ...(email ? { email } : {}),
    });
  }
  return byId;
}

/** `{ data: [{ userId, birthMonth, birthDay, birthYear?, joinDate }] }`; bỏ dòng sai. Năm sinh chỉ giữ để tính tuổi. */
export function parseFacts(payload: unknown): ReadonlyMap<string, PersonFacts> {
  const root = asRecord(payload);
  const rows = Array.isArray(payload) ? payload : Array.isArray(root?.['data']) ? (root['data'] as unknown[]) : [];
  const result = new Map<string, PersonFacts>();
  for (const entry of rows) {
    const row = asRecord(entry);
    const userId = text(row?.['userId']);
    if (!userId) continue;
    const month = Number(row?.['birthMonth']);
    const day = Number(row?.['birthDay']);
    const birthday = isValidBirthday({ month, day }) ? { month, day } : undefined;
    const year = Number(row?.['birthYear']);
    const birthYear = birthday && Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : undefined;
    const joinDate = text(row?.['joinDate']);
    const joinedAt = joinDate && /^\d{4}-\d{2}-\d{2}/.test(joinDate) ? joinDate.slice(0, 10) : undefined;
    if (!birthday && !joinedAt) continue;
    result.set(userId.toLowerCase(), {
      ...(birthday ? { birthday } : {}),
      ...(birthYear ? { birthYear } : {}),
      ...(joinedAt ? { joinedAt } : {}),
    });
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
