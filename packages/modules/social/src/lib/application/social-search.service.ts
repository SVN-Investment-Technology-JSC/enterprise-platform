import {
  SOCIAL_SEARCH_OVERVIEW_LIMIT,
  type SocialFeedPage,
  type SocialGroupPage,
  type SocialGroupSummary,
  type SocialSearchGroupsQuery,
  type SocialSearchOverview,
  type SocialSearchPeopleQuery,
  type SocialSearchPeopleResponse,
  type SocialSearchPostsQuery,
} from '@enterprise-platform/contracts-social';
import { normalizeSearchQuery } from '../domain/social-search-text.js';
import { decodeCursor, encodeCursor, normalizeLimit, requireUuid, toIso } from '../domain/social-rules.js';
import { SocialValidationError } from '../domain/social.error.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { ExtendedPostRow } from './ports/post-read-model.js';
import type { PostViewAssembler } from './ports/post-view-assembler.port.js';
import type { PostVisibilityPort } from './ports/post-visibility.port.js';
import type { SocialActor } from './social-actor.js';
import type { GroupSearchRow, SocialSearchStore } from './social-search-store.port.js';

const PEOPLE_DEFAULT_LIMIT = 10;
const PEOPLE_MAX_LIMIT = 20;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tìm kiếm bài, người, nhóm. Bài và nhóm đi qua luật nhìn thấy (`PostVisibilityPort`) nên không lộ bài
 * nhóm riêng tư, bài chờ duyệt, hẹn giờ hay bị từ chối. Người lấy từ danh bạ `OrganizationDirectory`.
 * Sắp xếp mới nhất trước, không xếp hạng độ khớp.
 */
export class SocialSearchService {
  constructor(
    private readonly store: SocialSearchStore,
    private readonly visibility: PostVisibilityPort,
    private readonly assembler: PostViewAssembler,
    private readonly directory: OrganizationDirectory,
  ) {}

  async overview(actor: SocialActor, rawQuery: unknown): Promise<SocialSearchOverview> {
    const query = normalizeSearchQuery(rawQuery);
    const scope = await this.visibility.scopeFor(actor);
    const [rows, people, groups] = await Promise.all([
      this.store.searchPosts(actor.tenantId, scope, { tokens: query.tokens, limit: SOCIAL_SEARCH_OVERVIEW_LIMIT }),
      this.directory.search(actor.tenantId, query.text, SOCIAL_SEARCH_OVERVIEW_LIMIT),
      this.store.searchGroups(actor.tenantId, scope, { tokens: query.tokens, limit: SOCIAL_SEARCH_OVERVIEW_LIMIT }),
    ]);
    return {
      query: query.text,
      posts: await this.assembler.assemble(actor, rows),
      people: [...people],
      groups: groups.map(toGroupSummary),
    };
  }

  async posts(actor: SocialActor, request: SocialSearchPostsQuery): Promise<SocialFeedPage> {
    const query = normalizeSearchQuery(request.q);
    const limit = normalizeLimit(request.limit);
    const cursor = decodeCursor(request.cursor);
    const range = normalizeRange(request.from, request.to);
    const scope = await this.visibility.scopeFor(actor);

    const rows = await this.store.searchPosts(actor.tenantId, scope, {
      tokens: query.tokens,
      ...(request.topicId ? { topicId: requireUuid(request.topicId, 'Chuyên mục') } : {}),
      ...(request.groupId ? { groupId: requireUuid(request.groupId, 'Nhóm') } : {}),
      ...(request.authorId ? { authorId: requireUuid(request.authorId, 'Tác giả') } : {}),
      ...range,
      limit: limit + 1,
      cursor,
    });
    const page = rows.length > limit ? rows.slice(0, limit) : rows;
    const last: ExtendedPostRow | undefined = page[page.length - 1];
    return {
      items: await this.assembler.assemble(actor, page),
      ...(rows.length > limit && last ? { nextCursor: encodeCursor({ at: last.publishedAt, id: last.id }) } : {}),
    };
  }

  async people(actor: SocialActor, request: SocialSearchPeopleQuery): Promise<SocialSearchPeopleResponse> {
    const query = normalizeSearchQuery(request.q);
    const limit = Math.min(normalizeLimit(request.limit, PEOPLE_DEFAULT_LIMIT), PEOPLE_MAX_LIMIT);
    return { items: [...(await this.directory.search(actor.tenantId, query.text, limit))] };
  }

  async groups(actor: SocialActor, request: SocialSearchGroupsQuery): Promise<SocialGroupPage> {
    const query = normalizeSearchQuery(request.q);
    const limit = normalizeLimit(request.limit);
    const cursor = decodeCursor(request.cursor);
    const scope = await this.visibility.scopeFor(actor);
    const rows = await this.store.searchGroups(actor.tenantId, scope, {
      tokens: query.tokens,
      limit: limit + 1,
      cursor,
    });
    const page = rows.length > limit ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(toGroupSummary),
      ...(rows.length > limit && last ? { nextCursor: encodeCursor({ at: last.createdAt, id: last.id }) } : {}),
    };
  }
}

function toGroupSummary(row: GroupSearchRow): SocialGroupSummary {
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    privacy: row.privacy,
    color: row.color,
    icon: row.icon,
    memberCount: row.memberCount,
    ...(row.myRole && row.myJoinedAt ? { myMembership: { role: row.myRole, joinedAt: toIso(row.myJoinedAt) } } : {}),
    ...(row.myJoinRequestId ? { myJoinRequestId: row.myJoinRequestId } : {}),
    createdAt: toIso(row.createdAt),
  };
}

/** Khoảng `from`–`to` bao gồm hai đầu; ngày không kèm giờ ở `to` tính đến hết ngày (UTC). */
function normalizeRange(from: unknown, to: unknown): { from?: string; to?: string } {
  const parse = (value: unknown, endOfDay: boolean): string | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') throw new SocialValidationError('Khoảng thời gian không hợp lệ.');
    const time = Date.parse(value);
    if (Number.isNaN(time)) throw new SocialValidationError('Khoảng thời gian không hợp lệ.');
    return new Date(endOfDay && DATE_ONLY.test(value) ? time + 86_399_999 : time).toISOString();
  };
  const start = parse(from, false);
  const end = parse(to, true);
  if (start && end && start > end) {
    throw new SocialValidationError('Khoảng thời gian không hợp lệ: ngày bắt đầu sau ngày kết thúc.');
  }
  return { ...(start ? { from: start } : {}), ...(end ? { to: end } : {}) };
}
