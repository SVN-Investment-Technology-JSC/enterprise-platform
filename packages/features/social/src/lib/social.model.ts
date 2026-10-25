import {
  SOCIAL_ALLOWED_CONTENT_TYPES,
  SOCIAL_ATTACHMENT_MAX_BYTES,
  SOCIAL_MAX_ATTACHMENTS_PER_POST,
  type SocialFeedQuery,
  type SocialFeedSource,
  type SocialInboxCounts,
  type SocialPermission,
  type SocialPost,
  type SocialUserRef,
} from '@enterprise-platform/contracts-social';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const pad = (value: number) => String(value).padStart(2, '0');

/** Thời gian đầy đủ `dd/mm/yyyy HH:mm` (giờ máy người dùng), để hiện khi rê chuột. */
export function formatFullTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Thời gian tương đối: "Vừa xong", "5 phút trước", "3 giờ trước", "2 ngày trước"; từ 7 ngày trở đi là ngày tháng. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const diff = now - time;
  if (diff < MINUTE) return 'Vừa xong';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} phút trước`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} giờ trước`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} ngày trước`;
  const date = new Date(time);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`;
}

/** Chữ cái đầu của tên (tối đa hai chữ) cho avatar. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/** Chuỗi truy vấn của bảng tin: bỏ giá trị rỗng, giữ thứ tự cố định. */
export function buildFeedQuery(query: SocialFeedQuery): string {
  const params = new URLSearchParams();
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.topicId) params.set('topicId', query.topicId);
  if (query.kind) params.set('kind', query.kind);
  if (query.authorId) params.set('authorId', query.authorId);
  // `groupId` có thì server bỏ qua `scope`; không gửi cho gọn.
  if (query.groupId) {
    params.set('groupId', query.groupId);
    if (query.groupTopicId) params.set('groupTopicId', query.groupTopicId);
  } else if (query.scope) params.set('scope', query.scope);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Phạm vi một danh sách bài cho `SocialFeed`. */
export interface SocialFeedScope {
  readonly groupId?: string;
  /** Chủ đề của nhóm (cần `groupId`). */
  readonly groupTopicId?: string;
  readonly authorId?: string;
  readonly topicId?: string;
  readonly kind?: 'post' | 'announcement';
  /** Danh sách "Đã lưu": gọi `GET /bookmarks`, bỏ qua các bộ lọc còn lại. */
  readonly bookmarked?: boolean;
  /** Nguồn bài của `GET /feed`. Mặc định: `all` khi có `authorId`, ngược lại `wall`. */
  readonly source?: SocialFeedSource;
}

/** Đường API (sau tiền tố `/v1`) kèm chuỗi truy vấn để lấy một trang bài theo phạm vi. */
export function buildFeedRequestPath(
  scope: SocialFeedScope,
  page: { readonly cursor?: string; readonly limit?: number },
): string {
  if (scope.bookmarked) return `/bookmarks${buildFeedQuery({ cursor: page.cursor, limit: page.limit })}`;
  const source = scope.groupId ? undefined : (scope.source ?? (scope.authorId ? 'all' : 'wall'));
  return `/feed${buildFeedQuery({
    cursor: page.cursor,
    limit: page.limit,
    topicId: scope.topicId,
    kind: scope.kind,
    authorId: scope.authorId,
    groupId: scope.groupId,
    groupTopicId: scope.groupId ? scope.groupTopicId : undefined,
    scope: source,
  })}`;
}

/* ------------------------------------------------------------ định tuyến theo đường dẫn */

/** Tiền tố `basePath` của app Next.js (`apps/social-web/next.config.js`). */
export const SOCIAL_BASE_PATH = '/modules/social';

export type SocialRoute =
  | { readonly name: 'feed'; readonly topicId?: string }
  | { readonly name: 'wall'; readonly topicId?: string; readonly announcementsOnly: boolean }
  | { readonly name: 'groups' }
  | { readonly name: 'group'; readonly groupId: string; readonly section?: string }
  | { readonly name: 'saved' }
  | { readonly name: 'pending' }
  | { readonly name: 'scheduled' }
  | { readonly name: 'profile'; readonly userId: string }
  | { readonly name: 'search'; readonly query: string }
  | { readonly name: 'post'; readonly postId: string; readonly commentId?: string }
  | { readonly name: 'birthday' };

/** Đoạn phụ của `/wall` để chỉ xem bài Thông báo; không trùng với id chuyên mục (UUID). */
export const WALL_ANNOUNCEMENTS_SEGMENT = 'announcements';

function decodePart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Lõi chung: các đoạn đường dẫn (không có tiền tố) và tham số truy vấn thành tuyến. Lạ hoặc thiếu id thì về `feed`. */
function routeFromSegments(segments: readonly string[], params: URLSearchParams): SocialRoute {
  const [head = '', first, second, third] = segments;
  const arg = decodePart(first);

  switch (head) {
    case 'feed':
      return { name: 'feed', topicId: arg };
    case 'wall':
      return arg === WALL_ANNOUNCEMENTS_SEGMENT
        ? { name: 'wall', announcementsOnly: true }
        : { name: 'wall', topicId: arg, announcementsOnly: false };
    case 'groups':
      return arg ? { name: 'group', groupId: arg, section: decodePart(second) } : { name: 'groups' };
    case 'saved':
      return { name: 'saved' };
    case 'pending':
    case 'moderation':
      return { name: 'pending' };
    case 'scheduled':
      return { name: 'scheduled' };
    case 'my-posts':
      return { name: arg === 'scheduled' ? 'scheduled' : 'pending' };
    case 'profile':
    case 'people':
      return arg ? { name: 'profile', userId: arg } : { name: 'feed' };
    case 'search':
      return { name: 'search', query: (params.get('q') ?? arg ?? '').trim() };
    case 'posts':
      return arg
        ? {
            name: 'post',
            postId: arg,
            // `comments` là dạng chuẩn; `comment` là dạng cũ của liên kết hash.
            commentId: second === 'comments' || second === 'comment' ? decodePart(third) : undefined,
          }
        : { name: 'feed' };
    case 'birthday':
    case 'birthdays':
      return { name: 'birthday' };
    default:
      return { name: 'feed' };
  }
}

/** Bỏ tiền tố `basePath` (nếu có) và dấu `/` thừa khỏi một đường dẫn. */
export function stripSocialBasePath(pathname: string): string {
  let path = pathname;
  if (path === SOCIAL_BASE_PATH || path.startsWith(`${SOCIAL_BASE_PATH}/`)) {
    path = path.slice(SOCIAL_BASE_PATH.length);
  }
  return path.replace(/^\/+|\/+$/g, '');
}

/**
 * Đọc đường dẫn và chuỗi truy vấn của trình duyệt thành tuyến. `pathname` có hoặc không có tiền tố
 * `/modules/social` đều được; `search` có hoặc không có dấu `?`.
 */
export function parseSocialPath(pathname: string, search = ''): SocialRoute {
  const path = stripSocialBasePath(pathname);
  const segments = path ? path.split('/') : [];
  return routeFromSegments(segments, new URLSearchParams(search));
}

/**
 * Đọc `location.hash` kiểu cũ (`#posts/<id>`, `#groups/<id>`, `#search?q=...`) thành tuyến, để các liên kết cũ
 * (thông báo, đường dẫn đã lưu) còn mở được. Hash dạng đường dẫn (`#/modules/social/groups/x`) cũng được nhận.
 */
export function parseSocialRoute(hash: string): SocialRoute {
  const raw = hash.replace(/^#/, '');
  const queryAt = raw.indexOf('?');
  const path = queryAt < 0 ? raw : raw.slice(0, queryAt);
  const search = queryAt < 0 ? '' : raw.slice(queryAt);
  return parseSocialPath(path, search);
}

/** Hash có mang tuyến cũ cần chuyển sang đường dẫn không (`#groups/x`...)? Neo trang lạ như `#main` thì không. */
export function isLegacySocialHash(hash: string): boolean {
  if (hash.length <= 1) return false;
  return parseSocialRoute(hash).name !== 'feed' || /^#\/?(modules\/social\/)?feed(\/|$)/.test(hash);
}

const enc = encodeURIComponent;

/** Đường dẫn của một tuyến, KHÔNG có `basePath` (dạng `/groups/<id>`); gốc là `/`. Ngược lại với `parseSocialPath`. */
export function buildSocialPath(route: SocialRoute): string {
  switch (route.name) {
    case 'feed':
      return route.topicId ? `/feed/${enc(route.topicId)}` : '/';
    case 'wall':
      if (route.announcementsOnly) return `/wall/${WALL_ANNOUNCEMENTS_SEGMENT}`;
      return route.topicId ? `/wall/${enc(route.topicId)}` : '/wall';
    case 'group':
      return `/groups/${enc(route.groupId)}${route.section ? `/${enc(route.section)}` : ''}`;
    case 'profile':
      return `/profile/${enc(route.userId)}`;
    case 'search':
      return route.query ? `/search?q=${enc(route.query)}` : '/search';
    case 'post':
      return `/posts/${enc(route.postId)}${route.commentId ? `/comments/${enc(route.commentId)}` : ''}`;
    default:
      return `/${route.name}`;
  }
}

/** Giá trị cho `<a href>` và `history.pushState`: đường dẫn kèm `basePath` (`/modules/social/groups/<id>`). */
export function socialHref(route: SocialRoute): string {
  const path = buildSocialPath(route);
  return path === '/' ? SOCIAL_BASE_PATH : `${SOCIAL_BASE_PATH}${path}`;
}

/**
 * @deprecated Giữ tên cũ cho mã chưa chuyển; trả về `socialHref(route)` (đường dẫn, KHÔNG còn `#`).
 * Dùng `<a href={socialHref(route)}>` cùng `navigateSocial(route)`.
 */
export function buildSocialHash(route: SocialRoute): string {
  return socialHref(route);
}

/** Thẻ điều hướng chính. */
export type SocialTabId = 'feed' | 'wall' | 'groups' | 'saved' | 'pending' | 'scheduled';

export interface SocialTab {
  readonly id: SocialTabId;
  readonly label: string;
  /** Số hiện cạnh nhãn; thiếu hoặc 0 là không hiện. */
  readonly badge?: number;
}

export function isModerator(permissions: readonly SocialPermission[]): boolean {
  return permissions.includes('social.post.moderate');
}

/**
 * Các thẻ hiển thị. "Chờ duyệt" cho moderator (số bài cần duyệt) và cho người có bài của mình đang chờ
 * duyệt hoặc bị từ chối; "Hẹn giờ" chỉ khi có bài hẹn giờ. Chưa biết số đếm thì chỉ hiện thẻ cố định
 * (và "Chờ duyệt" cho moderator).
 */
export function visibleTabs(
  permissions: readonly SocialPermission[],
  counts: SocialInboxCounts | undefined,
): readonly SocialTab[] {
  const tabs: SocialTab[] = [
    { id: 'feed', label: 'Bảng tin' },
    { id: 'wall', label: 'Tường công ty' },
    { id: 'groups', label: 'Nhóm' },
    { id: 'saved', label: 'Đã lưu' },
  ];
  const mine = (counts?.myPending ?? 0) + (counts?.myRejected ?? 0);
  const moderator = isModerator(permissions);
  if (moderator || mine > 0) {
    tabs.push({ id: 'pending', label: 'Chờ duyệt', badge: moderator ? (counts?.toModerate ?? 0) + mine : mine });
  }
  if ((counts?.myScheduled ?? 0) > 0) tabs.push({ id: 'scheduled', label: 'Hẹn giờ', badge: counts?.myScheduled });
  return tabs;
}

/**
 * Sắp nhóm của tôi cho cột trái: nhóm đã ưu tiên (mới ưu tiên trước) đứng đầu, còn lại giữ thứ tự máy chủ.
 */
export function orderMyGroups<T extends { readonly myPriorityAt?: string }>(groups: readonly T[]): readonly T[] {
  const priority = groups.filter((group) => group.myPriorityAt);
  const rest = groups.filter((group) => !group.myPriorityAt);
  priority.sort((a, b) => Date.parse(b.myPriorityAt ?? '') - Date.parse(a.myPriorityAt ?? ''));
  return [...priority, ...rest];
}

/** Tuyến mà một thẻ điều hướng dẫn tới. */
export function routeForTab(id: SocialTabId): SocialRoute {
  return id === 'wall' ? { name: 'wall', announcementsOnly: false } : { name: id };
}

/** Thẻ nào sáng cho một tuyến; `undefined` khi tuyến không thuộc thẻ nào (hồ sơ, tìm kiếm). */
export function tabForRoute(route: SocialRoute): SocialTabId | undefined {
  switch (route.name) {
    case 'feed':
    case 'wall':
    case 'groups':
    case 'saved':
    case 'pending':
    case 'scheduled':
      return route.name;
    case 'group':
      return 'groups';
    case 'post':
      return 'feed';
    default:
      return undefined;
  }
}

/** Văn bản thuần rút gọn từ HTML của bài, cho dòng "Thông báo đã ghim". */
export function plainExcerpt(html: string, max = 80): string {
  const text = html
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Mọi chuyên mục của bài (theo thứ tự tác giả chọn); bản máy chủ cũ chỉ trả `topic` thì lấy chuyên mục đó. */
export function postTopics(post: Pick<SocialPost, 'topic' | 'topics'>): readonly { readonly id: string; readonly name: string }[] {
  if (post.topics && post.topics.length > 0) return post.topics;
  return post.topic ? [post.topic] : [];
}

/** Dòng tiêu đề ngắn của bài cho danh sách gọn: tiêu đề nếu có, không thì đầu nội dung. */
export function postHeadline(post: Pick<SocialPost, 'title' | 'bodyHtml'>, max = 80): string {
  return post.title?.trim() || plainExcerpt(post.bodyHtml, max) || 'Bài viết';
}

/** Nối trang mới vào danh sách đã có, bỏ mục trùng id (mục đã có giữ nguyên vị trí). */
export function mergePages<T extends { readonly id: string }>(
  existing: readonly T[],
  incoming: readonly T[],
): readonly T[] {
  const seen = new Set(existing.map((item) => item.id));
  const added = incoming.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return added.length === 0 ? existing : [...existing, ...added];
}

/** Thay một bài trong danh sách; trả về chính danh sách cũ nếu không có bài đó. */
export function replacePost(posts: readonly SocialPost[], next: SocialPost): readonly SocialPost[] {
  return posts.some((post) => post.id === next.id)
    ? posts.map((post) => (post.id === next.id ? next : post))
    : posts;
}

/** Kiểm tra một tệp trước khi tải lên; trả về lời nhắn lỗi hoặc `undefined` nếu hợp lệ. */
export function validateAttachment(
  file: { readonly name: string; readonly type: string; readonly size: number },
  currentCount: number,
): string | undefined {
  if (currentCount >= SOCIAL_MAX_ATTACHMENTS_PER_POST) {
    return `Mỗi bài tối đa ${SOCIAL_MAX_ATTACHMENTS_PER_POST} tệp đính kèm.`;
  }
  if (!SOCIAL_ALLOWED_CONTENT_TYPES.includes(file.type)) {
    return `Không nhận định dạng của tệp "${file.name}".`;
  }
  if (file.size <= 0) return `Tệp "${file.name}" không có nội dung.`;
  if (file.size > SOCIAL_ATTACHMENT_MAX_BYTES) {
    return `Tệp "${file.name}" vượt quá ${formatBytes(SOCIAL_ATTACHMENT_MAX_BYTES)}.`;
  }
  return undefined;
}

/** HTML của trình soạn có thật sự trống không (chỉ còn thẻ rỗng, `<br>`, khoảng trắng). */
export function isEmptyHtml(html: string): boolean {
  const text = html
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return text.length === 0;
}

/** Chuẩn hoá địa chỉ liên kết người dùng nhập: thêm https:// nếu thiếu, chỉ nhận http, https, mailto. */
export function normalizeLink(input: string): string | undefined {
  const value = input.trim();
  if (!value) return undefined;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  const url = hasScheme ? value : `https://${value}`;
  return /^(https?:\/\/|mailto:)\S+$/i.test(url) ? url : undefined;
}

export interface MentionPick {
  readonly id: string;
  readonly name: string;
}

/**
 * Đổi `@Tên` trong văn bản bình luận thành `@[userId]` theo các người đã chọn.
 * Tên dài khớp trước để "@Nguyễn Văn An" không bị cắt thành "@Nguyễn Văn". Trả về
 * văn bản đã mã hoá và danh sách id thực sự còn xuất hiện.
 */
export function encodeMentions(
  text: string,
  picks: readonly MentionPick[],
): { readonly body: string; readonly userIds: readonly string[] } {
  const ordered = [...picks].sort((a, b) => b.name.length - a.name.length);
  const ids: string[] = [];
  let body = text;
  for (const pick of ordered) {
    const token = `@${pick.name}`;
    if (!body.includes(token)) continue;
    body = body.split(token).join(`@[${pick.id}]`);
    if (!ids.includes(pick.id)) ids.push(pick.id);
  }
  return { body, userIds: ids };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface MentionSegment {
  readonly text: string;
  readonly mention: boolean;
}

/**
 * Tách văn bản đang gõ thành đoạn thường và đoạn `@Tên` của các người đã chọn (cùng cách khớp với `encodeMentions`),
 * để ô nhập tô màu tên được nhắc.
 */
export function splitMentionTokens(text: string, picks: readonly MentionPick[]): readonly MentionSegment[] {
  const tokens = [...new Set(picks.map((pick) => `@${pick.name}`))].sort((a, b) => b.length - a.length);
  if (tokens.length === 0 || text.length === 0) return text ? [{ text, mention: false }] : [];
  const pattern = new RegExp(tokens.map(escapeRegExp).join('|'), 'g');
  const segments: MentionSegment[] = [];
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index), mention: false });
    segments.push({ text: match[0], mention: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), mention: false });
  return segments;
}

/** Từ khoá đang gõ sau `@` đã là tên đầy đủ của một người đã chọn (không cần gợi ý nữa)? */
export function isMentionComplete(query: string, picks: readonly MentionPick[]): boolean {
  return picks.some((pick) => query === pick.name || query.startsWith(`${pick.name} `));
}

/** Ngược lại với `encodeMentions`: `@[userId]` thành `@Tên` để sửa; trả về cả danh sách người nhắc. */
export function decodeMentions(
  body: string,
  mentions: readonly SocialUserRef[],
): { readonly text: string; readonly picks: readonly MentionPick[] } {
  const byId = new Map(mentions.map((user) => [user.id, user]));
  const picks: MentionPick[] = [];
  const text = body.replace(/@\[([^\]]+)\]/g, (whole, id: string) => {
    const user = byId.get(id);
    if (!user) return whole;
    if (!picks.some((pick) => pick.id === id)) picks.push({ id, name: user.name });
    return `@${user.name}`;
  });
  return { text, picks };
}

export type CommentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'mention'; readonly userId: string; readonly name: string };

/** Tách thân bình luận thành đoạn chữ và đoạn nhắc tên để hiển thị. Mention không rõ người thì giữ nguyên chữ. */
export function parseCommentBody(body: string, mentions: readonly SocialUserRef[]): readonly CommentPart[] {
  const byId = new Map(mentions.map((user) => [user.id, user.name]));
  const parts: CommentPart[] = [];
  let last = 0;
  const pattern = /@\[([^\]]+)\]/g;
  for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
    const userId = match[1] ?? '';
    const name = byId.get(userId);
    if (!name) continue;
    if (match.index > last) parts.push({ type: 'text', text: body.slice(last, match.index) });
    parts.push({ type: 'mention', userId, name });
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push({ type: 'text', text: body.slice(last) });
  return parts;
}

/** Từ khoá `@...` đang gõ ngay trước con trỏ (để gợi ý người); `undefined` nếu không ở trong một mention. */
export function activeMentionQuery(
  text: string,
  caret: number,
): { readonly query: string; readonly start: number } | undefined {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return undefined;
  if (at > 0 && !/\s/.test(before[at - 1] ?? '')) return undefined;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n\r]/.test(query)) return undefined;
  return { query, start: at };
}

/**
 * Liên kết bài từ thông báo: `/posts/<postId>[/comments/<commentId>]` (có hoặc không có `basePath`),
 * hoặc dạng hash cũ `#posts/<postId>[/comment/<commentId>]`.
 */
export function parsePostLink(
  link: string,
): { readonly postId: string; readonly commentId?: string } | undefined {
  const text = link.replace(/^#/, '').split('?')[0] ?? '';
  const match = /^\/?(?:modules\/social\/)?posts\/([^/]+)(?:\/comments?\/([^/]+))?\/?$/.exec(text);
  if (!match?.[1]) return undefined;
  return {
    postId: decodeURIComponent(match[1]),
    commentId: match[2] ? decodeURIComponent(match[2]) : undefined,
  };
}
