import type {
  SocialBookmarkFolder,
  SocialBookmarkFolderList,
  SocialBookmarkState,
  SocialFeedPage,
  SocialGroupPage,
  SocialGroupSummary,
  SocialInboxCounts,
  SocialMyPostStatus,
  SocialOrgNodePage,
  SocialOrgNodeQuery,
  SocialPostEditHistory,
  SocialPoll,
  SocialPollVoterPage,
  SocialPost,
  SocialReadConfirmationFilter,
  SocialReadConfirmationPage,
  SocialReadConfirmationSummary,
  SocialSettings,
  UpdateSocialSettingsRequest,
} from '@enterprise-platform/contracts-social';
import { json, request } from './social-api';

/** Hàm gọi API của mảng bài viết P2 (bình chọn, xác nhận đã đọc, duyệt, hẹn giờ, đã lưu). */

const post = (id: string) => `/posts/${encodeURIComponent(id)}`;

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const noStore = { cache: 'no-store' } as const;

/* ------------------------------------------------------------------- đã lưu */

/** `folderId`: bỏ trống giữ thư mục cũ, `null` là chưa phân loại. */
export const setBookmark = (
  postId: string,
  bookmarked: boolean,
  folderId?: string | null,
) =>
  request<SocialBookmarkState>(
    `${post(postId)}/bookmark`,
    json(
      'PUT',
      folderId === undefined ? { bookmarked } : { bookmarked, folderId },
    ),
  );

/** `folderId`: mã thư mục, `none` là chưa phân loại, bỏ trống là tất cả. */
export const loadBookmarks = (cursor?: string, limit = 20, folderId?: string) =>
  request<SocialFeedPage>(
    `/bookmarks${query({ cursor, limit, folderId })}`,
    noStore,
  );

export const loadBookmarkFolders = () =>
  request<SocialBookmarkFolderList>('/bookmark-folders', noStore);

export const createBookmarkFolder = (name: string) =>
  request<SocialBookmarkFolder>('/bookmark-folders', json('POST', { name }));

/* ----------------------------------------------------------------- bình chọn */

export const votePoll = (postId: string, optionIds: readonly string[]) =>
  request<SocialPoll>(`${post(postId)}/poll/vote`, json('PUT', { optionIds }));

export const closePoll = (postId: string) =>
  request<SocialPoll>(`${post(postId)}/poll/close`, json('POST'));

export const loadPollVoters = (
  postId: string,
  optionId?: string,
  cursor?: string,
  limit = 30,
) =>
  request<SocialPollVoterPage>(
    `${post(postId)}/poll/voters${query({ optionId, cursor, limit })}`,
    noStore,
  );

/* ---------------------------------------------------------- xác nhận đã đọc */

export const confirmRead = (postId: string) =>
  request<SocialReadConfirmationSummary>(
    `${post(postId)}/read-confirmation`,
    json('PUT'),
  );

export const loadReadConfirmations = (
  postId: string,
  filter: SocialReadConfirmationFilter,
  cursor?: string,
  limit = 30,
) =>
  request<SocialReadConfirmationPage>(
    `${post(postId)}/read-confirmations${query({ filter, cursor, limit })}`,
    noStore,
  );

/* ------------------------------------------------- duyệt bài, hẹn giờ, của tôi */

export const loadModerationPosts = (cursor?: string, limit = 20) =>
  request<SocialFeedPage>(
    `/moderation/posts${query({ cursor, limit })}`,
    noStore,
  );

export const loadMyPosts = (
  status: SocialMyPostStatus,
  cursor?: string,
  limit = 20,
) =>
  request<SocialFeedPage>(
    `/me/posts${query({ status, cursor, limit })}`,
    noStore,
  );

export const loadInbox = () => request<SocialInboxCounts>('/me/inbox', noStore);

export const approvePost = (postId: string) =>
  request<SocialPost>(`${post(postId)}/approve`, json('POST'));

export const rejectPost = (postId: string, reason: string) =>
  request<SocialPost>(`${post(postId)}/reject`, json('POST', { reason }));

export const publishPostNow = (postId: string) =>
  request<SocialPost>(`${post(postId)}/publish-now`, json('POST'));

/* ------------------------------------------------------------------ cài đặt */

export const loadSettings = () => request<SocialSettings>('/settings', noStore);

export const updateSettings = (body: UpdateSocialSettingsRequest) =>
  request<SocialSettings>('/settings', json('PATCH', body));

/* --------------------------------------------------------- nơi đăng (nhóm) */

/** Các nhóm tôi là thành viên, để chọn nơi đăng. Đọc tối đa vài trang. */
export async function loadAllMyGroups(): Promise<readonly SocialGroupSummary[]> {
  const result: SocialGroupSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const data: SocialGroupPage = await request<SocialGroupPage>(
      `/groups${query({ scope: 'mine', cursor, limit: 50 })}`,
      noStore,
    );
    result.push(...data.items);
    cursor = data.nextCursor;
    if (!cursor) break;
  }
  return result;
}

/* ------------------------------------------------- quyền xem, lịch sử sửa */

/** Phòng ban/vị trí để chọn đối tượng xem bài (và nguồn thành viên nhóm). */
export const loadOrgNodes = (params: SocialOrgNodeQuery = {}) =>
  request<SocialOrgNodePage>(
    `/org/nodes${query({ kind: params.kind, query: params.query?.trim(), limit: params.limit })}`,
    noStore,
  );

/** Các bản sửa của bài (bản hiện tại và bản cũ, mới nhất trước). */
export const loadPostEdits = (postId: string) =>
  request<SocialPostEditHistory>(`${post(postId)}/edits`, noStore);
