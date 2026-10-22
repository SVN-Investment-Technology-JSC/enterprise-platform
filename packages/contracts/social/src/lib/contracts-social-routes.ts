/**
 * Đường dẫn của Mạng nội bộ ở trình duyệt (đợt 2): dùng path thay cho `#hash`.
 *
 * Bảng đường dẫn và quy tắc tương thích: docs/architecture/social-p2-p3-api.md, mục "Đợt 2".
 * Mọi liên kết (thông báo, nút, chia sẻ) dựng bằng `SOCIAL_ROUTES`; không ghép chuỗi tay.
 * Hash cũ (`#posts/<id>`, `#groups/<id>/requests`...) vẫn mở được: `legacyHashToPath` đổi sang path
 * để giao diện chuyển hướng (`router.replace`).
 */
import { SOCIAL_LAUNCH_URL } from './contracts-social.js';

export const SOCIAL_BASE_PATH = SOCIAL_LAUNCH_URL;

/** Mục con của một nhóm: `/groups/:id/<mục>`. Thiếu mục là tab bài viết. */
export const SOCIAL_GROUP_SECTIONS = ['members', 'requests', 'announcements', 'topics', 'reports'] as const;
export type SocialGroupSection = (typeof SOCIAL_GROUP_SECTIONS)[number];

/** Thẻ của trang `/pending`: bài của tôi chờ duyệt (mặc định), bị từ chối, hàng đợi duyệt bài và hàng đợi báo cáo (moderator). */
export const SOCIAL_PENDING_TABS = ['mine', 'rejected', 'moderation', 'reports'] as const;
export type SocialPendingTab = (typeof SOCIAL_PENDING_TABS)[number];

export type SocialRouteTarget =
  /** Bảng tin: Tường công ty + nhóm tôi thấy được (`scope=all`). */
  | { readonly name: 'feed'; readonly topicId?: string }
  /** Tường công ty (`scope=wall`). */
  | { readonly name: 'wall'; readonly topicId?: string; readonly announcementsOnly: boolean }
  | { readonly name: 'groups' }
  | { readonly name: 'group'; readonly groupId: string; readonly section?: SocialGroupSection; readonly topicId?: string }
  | { readonly name: 'saved' }
  | { readonly name: 'pending'; readonly tab?: SocialPendingTab }
  | { readonly name: 'scheduled' }
  | { readonly name: 'profile'; readonly userId: string }
  | { readonly name: 'search'; readonly query: string }
  | { readonly name: 'post'; readonly postId: string; readonly commentId?: string }
  | { readonly name: 'birthday' };

const enc = encodeURIComponent;

function withQuery(path: string, params: Readonly<Record<string, string | undefined>>): string {
  const entries = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (entries.length === 0) return path;
  return `${path}?${entries.map(([key, value]) => `${key}=${enc(value)}`).join('&')}`;
}

/** Hàm dựng path (không có origin). Kết quả luôn bắt đầu bằng `SOCIAL_BASE_PATH`. */
export const SOCIAL_ROUTES = {
  feed: (options: { topicId?: string } = {}): string => withQuery(SOCIAL_BASE_PATH, { topic: options.topicId }),
  wall: (options: { topicId?: string; announcementsOnly?: boolean } = {}): string =>
    withQuery(`${SOCIAL_BASE_PATH}/wall`, {
      topic: options.topicId,
      kind: options.announcementsOnly ? 'announcement' : undefined,
    }),
  groups: (): string => `${SOCIAL_BASE_PATH}/groups`,
  group: (groupId: string, section?: SocialGroupSection, options: { topicId?: string } = {}): string =>
    withQuery(`${SOCIAL_BASE_PATH}/groups/${enc(groupId)}${section ? `/${section}` : ''}`, {
      topic: options.topicId,
    }),
  saved: (): string => `${SOCIAL_BASE_PATH}/saved`,
  pending: (tab?: SocialPendingTab): string =>
    withQuery(`${SOCIAL_BASE_PATH}/pending`, { tab: tab && tab !== 'mine' ? tab : undefined }),
  scheduled: (): string => `${SOCIAL_BASE_PATH}/scheduled`,
  profile: (userId: string): string => `${SOCIAL_BASE_PATH}/profile/${enc(userId)}`,
  search: (query?: string): string => withQuery(`${SOCIAL_BASE_PATH}/search`, { q: query?.trim() || undefined }),
  post: (postId: string, commentId?: string): string =>
    `${SOCIAL_BASE_PATH}/posts/${enc(postId)}${commentId ? `/comments/${enc(commentId)}` : ''}`,
  birthday: (): string => `${SOCIAL_BASE_PATH}/birthday`,
} as const;

/** Dựng path từ một đích đã phân tích; ngược lại của `parseSocialPath`. */
export function buildSocialPath(target: SocialRouteTarget): string {
  switch (target.name) {
    case 'feed':
      return SOCIAL_ROUTES.feed({ topicId: target.topicId });
    case 'wall':
      return SOCIAL_ROUTES.wall({ topicId: target.topicId, announcementsOnly: target.announcementsOnly });
    case 'groups':
      return SOCIAL_ROUTES.groups();
    case 'group':
      return SOCIAL_ROUTES.group(target.groupId, target.section, { topicId: target.topicId });
    case 'saved':
      return SOCIAL_ROUTES.saved();
    case 'pending':
      return SOCIAL_ROUTES.pending(target.tab);
    case 'scheduled':
      return SOCIAL_ROUTES.scheduled();
    case 'profile':
      return SOCIAL_ROUTES.profile(target.userId);
    case 'search':
      return SOCIAL_ROUTES.search(target.query);
    case 'post':
      return SOCIAL_ROUTES.post(target.postId, target.commentId);
    case 'birthday':
      return SOCIAL_ROUTES.birthday();
  }
}

function decodePart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isGroupSection(value: string | undefined): value is SocialGroupSection {
  return SOCIAL_GROUP_SECTIONS.includes(value as SocialGroupSection);
}

function isPendingTab(value: string | null | undefined): value is SocialPendingTab {
  return SOCIAL_PENDING_TABS.includes(value as SocialPendingTab);
}

/** Bỏ phần đầu `/modules/social` (nếu có), dấu `/` thừa và chuẩn hoá thành các đoạn. */
function segmentsOf(pathname: string): string[] {
  let path = pathname.split(/[?#]/, 1)[0] ?? '';
  if (path === SOCIAL_BASE_PATH || path.startsWith(`${SOCIAL_BASE_PATH}/`)) {
    path = path.slice(SOCIAL_BASE_PATH.length);
  }
  return path.split('/').filter((part) => part.length > 0);
}

/**
 * Đọc path (và query) của trang thành đích. Nhận path đầy đủ (`/modules/social/groups/<id>`) hoặc
 * path tương đối so với `basePath` của Next (`/groups/<id>`). Path lạ hoặc thiếu id trả `feed`.
 * `search` là chuỗi query, có hoặc không có `?` đầu.
 */
export function parseSocialPath(pathname: string, search = ''): SocialRouteTarget {
  const [head, first, second, third] = segmentsOf(pathname);
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  const arg = decodePart(first);
  const topic = params.get('topic')?.trim() || undefined;

  switch (head) {
    case undefined:
      return { name: 'feed', topicId: topic };
    case 'wall':
      return { name: 'wall', topicId: topic, announcementsOnly: params.get('kind') === 'announcement' };
    case 'groups': {
      if (!arg) return { name: 'groups' };
      return {
        name: 'group',
        groupId: arg,
        section: isGroupSection(second) ? second : undefined,
        topicId: topic,
      };
    }
    case 'saved':
      return { name: 'saved' };
    case 'pending': {
      const tab = params.get('tab');
      return { name: 'pending', tab: isPendingTab(tab) ? tab : undefined };
    }
    case 'scheduled':
      return { name: 'scheduled' };
    case 'profile':
      return arg ? { name: 'profile', userId: arg } : { name: 'feed' };
    case 'search':
      return { name: 'search', query: (params.get('q') ?? '').trim() };
    case 'posts':
      return arg
        ? { name: 'post', postId: arg, commentId: second === 'comments' ? decodePart(third) : undefined }
        : { name: 'feed' };
    case 'birthday':
      return { name: 'birthday' };
    default:
      return { name: 'feed' };
  }
}

/**
 * Đọc hash CŨ (đợt 1) thành đích. Trả `undefined` khi hash rỗng (không có gì để chuyển hướng).
 * Hash lạ trả `feed`. Chấp nhận mọi tên đã từng dùng: `#feed`, `#wall[/<chuyên mục>|/announcements]`,
 * `#groups[/<id>[/<mục>]]`, `#saved`, `#pending`, `#moderation`, `#scheduled`, `#my-posts/<trạng thái>`,
 * `#profile/<id>`, `#people/<id>`, `#search?q=` hoặc `#search/<từ khoá>`, `#posts/<id>[/comment/<id>]`.
 */
export function parseLegacySocialHash(hash: string): SocialRouteTarget | undefined {
  const raw = hash.replace(/^#/, '');
  if (!raw) return undefined;
  const queryAt = raw.indexOf('?');
  const path = queryAt < 0 ? raw : raw.slice(0, queryAt);
  const params = new URLSearchParams(queryAt < 0 ? '' : raw.slice(queryAt + 1));
  const [head = '', first, second, third] = path.split('/');
  const arg = decodePart(first);

  switch (head) {
    case 'feed':
      return { name: 'feed', topicId: arg };
    case 'wall':
      return arg === 'announcements'
        ? { name: 'wall', announcementsOnly: true }
        : { name: 'wall', topicId: arg, announcementsOnly: false };
    case 'groups': {
      if (!arg) return { name: 'groups' };
      const section = decodePart(second);
      return { name: 'group', groupId: arg, section: isGroupSection(section) ? section : undefined };
    }
    case 'saved':
      return { name: 'saved' };
    case 'moderation':
      return { name: 'pending', tab: 'moderation' };
    case 'pending':
      return { name: 'pending' };
    case 'scheduled':
      return { name: 'scheduled' };
    case 'my-posts':
      if (arg === 'scheduled') return { name: 'scheduled' };
      return arg === 'rejected' ? { name: 'pending', tab: 'rejected' } : { name: 'pending' };
    case 'profile':
    case 'people':
      return arg ? { name: 'profile', userId: arg } : { name: 'feed' };
    case 'search':
      return { name: 'search', query: (params.get('q') ?? arg ?? '').trim() };
    case 'posts':
      return arg
        ? { name: 'post', postId: arg, commentId: second === 'comment' ? decodePart(third) : undefined }
        : { name: 'feed' };
    default:
      return { name: 'feed' };
  }
}

/** Hash cũ -> path mới, hoặc `undefined` nếu hash rỗng. */
export function legacyHashToPath(hash: string): string | undefined {
  const target = parseLegacySocialHash(hash);
  return target ? buildSocialPath(target) : undefined;
}
