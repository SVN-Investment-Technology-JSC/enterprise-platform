import type {
  CreateSocialCommentRequest,
  CreateSocialPostRequest,
  CreateSocialTopicRequest,
  InitiateSocialAttachmentRequest,
  SocialAttachmentPurpose,
  InitiateSocialAttachmentResponse,
  SocialAttachment,
  SocialComment,
  SocialCommentPage,
  SocialFeedPage,
  SocialFeedQuery,
  SocialGroupPage,
  SocialGroupSummary,
  SocialInboxCounts,
  SocialMe,
  SocialPost,
  SocialReactionSummary,
  SocialReactionType,
  SocialReactor,
  SocialTopic,
  SocialUserRef,
  UpdateSocialCommentRequest,
  UpdateSocialPostRequest,
  UpdateSocialTopicRequest,
} from '@enterprise-platform/contracts-social';
import { authFetch } from '@enterprise-platform/shared-ui';
import { buildFeedQuery, buildFeedRequestPath, type SocialFeedScope } from './social.model';

const API = '/api/social/v1';

/** Lỗi API: thân lỗi đã có `code` và `message` tiếng Việt. */
export interface SocialApiError {
  readonly code?: string;
  readonly message?: string;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // `authFetch` tự gắn cookie phiên, `x-csrf-token` và làm mới phiên một lần khi gặp 401.
  const response = await authFetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (response.status === 401) {
    window.location.assign('/');
    throw { code: 'UNAUTHENTICATED', message: 'Phiên đăng nhập đã hết.' } satisfies SocialApiError;
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw body as SocialApiError;
  return body as T;
}

export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** Lời nhắn lỗi để hiện thẳng cho người dùng. */
export function errorMessage(cause: unknown, fallback: string): string {
  const message = (cause as SocialApiError | undefined)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/** Đường về Tenant Portal cho nút Trang chủ trên thanh bên. */
export async function loadTenantHomePath(): Promise<string> {
  try {
    const response = await authFetch('/api/auth/v1/me');
    return response.ok ? '/applications' : '/';
  } catch {
    return '/';
  }
}

export const loadMe = () => request<SocialMe>('/me', { cache: 'no-store' });

/** Danh sách người để nhắc tên; `query` rỗng cho ra vài người đầu. Chấp nhận cả mảng lẫn `{ items }`. */
export async function searchPeople(query: string): Promise<readonly SocialUserRef[]> {
  const result = await request<readonly SocialUserRef[] | { readonly items: readonly SocialUserRef[] }>(
    `/people?query=${encodeURIComponent(query)}`,
    { cache: 'no-store' },
  );
  return Array.isArray(result) ? result : ((result as { items?: readonly SocialUserRef[] }).items ?? []);
}

/* ------------------------------------------------------------- chuyên mục */

export const loadTopics = async (): Promise<readonly SocialTopic[]> =>
  (await request<{ readonly items: readonly SocialTopic[] }>('/topics', { cache: 'no-store' })).items;

export const createTopic = (body: CreateSocialTopicRequest) =>
  request<SocialTopic>('/topics', json('POST', body));

export const updateTopic = (id: string, body: UpdateSocialTopicRequest) =>
  request<SocialTopic>(`/topics/${encodeURIComponent(id)}`, json('PATCH', body));

/* ---------------------------------------------------------------- bài viết */

export const loadFeed = (query: SocialFeedQuery) =>
  request<SocialFeedPage>(`/posts${buildFeedQuery(query)}`, { cache: 'no-store' });

export const loadPost = (id: string) =>
  request<SocialPost>(`/posts/${encodeURIComponent(id)}`, { cache: 'no-store' });

export const createPost = (body: CreateSocialPostRequest) => request<SocialPost>('/posts', json('POST', body));

export const updatePost = (id: string, body: UpdateSocialPostRequest) =>
  request<SocialPost>(`/posts/${encodeURIComponent(id)}`, json('PATCH', body));

export const deletePost = (id: string) =>
  request<void>(`/posts/${encodeURIComponent(id)}`, json('DELETE'));

export const pinPost = (id: string, pinned: boolean) =>
  request<SocialPost>(`/posts/${encodeURIComponent(id)}/pin`, json('PUT', { pinned }));

/* ---------------------------------------------------------------- phản ứng */

export const setReaction = (postId: string, type: SocialReactionType | null) =>
  request<SocialReactionSummary>(`/posts/${encodeURIComponent(postId)}/reaction`, json('PUT', { type }));

export const reactToComment = (commentId: string, type: SocialReactionType | null) =>
  request<SocialReactionSummary>(`/comments/${encodeURIComponent(commentId)}/reaction`, json('PUT', { type }));

export const loadCommentReactors = async (commentId: string): Promise<readonly SocialReactor[]> =>
  (await request<{ readonly items: readonly SocialReactor[] }>(`/comments/${encodeURIComponent(commentId)}/reactions`, { cache: 'no-store' })).items;

export const loadReactors = async (postId: string): Promise<readonly SocialReactor[]> =>
  (await request<{ readonly items: readonly SocialReactor[] }>(`/posts/${encodeURIComponent(postId)}/reactions`, { cache: 'no-store' })).items;

/* --------------------------------------------------------------- bình luận */

/** `parentId` rỗng: bình luận gốc; có `parentId`: các trả lời của bình luận đó. */
export function loadComments(postId: string, options: { parentId?: string; cursor?: string } = {}) {
  const params = new URLSearchParams();
  if (options.parentId) params.set('parentId', options.parentId);
  if (options.cursor) params.set('cursor', options.cursor);
  const text = params.toString();
  return request<SocialCommentPage>(
    `/posts/${encodeURIComponent(postId)}/comments${text ? `?${text}` : ''}`,
    { cache: 'no-store' },
  );
}

export const createComment = (postId: string, body: CreateSocialCommentRequest) =>
  request<SocialComment>(`/posts/${encodeURIComponent(postId)}/comments`, json('POST', body));

export const updateComment = (commentId: string, body: UpdateSocialCommentRequest) =>
  request<SocialComment>(`/comments/${encodeURIComponent(commentId)}`, json('PATCH', body));

export const deleteComment = (commentId: string) =>
  request<void>(`/comments/${encodeURIComponent(commentId)}`, json('DELETE'));

/* ------------------------------------------------------------ tệp đính kèm */

/**
 * Tải một tệp lên theo hai bước rồi xác nhận: xin URL ký sẵn, PUT thẳng nội dung lên
 * đó (không qua `authFetch`, URL đã ký), rồi báo hoàn tất để server kiểm tra tệp.
 */
export async function uploadAttachment(
  file: File,
  purpose: SocialAttachmentPurpose = 'post',
): Promise<SocialAttachment> {
  const initiate: InitiateSocialAttachmentRequest = {
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
    purpose,
  };
  const ticket = await request<InitiateSocialAttachmentResponse>('/attachments/uploads', json('POST', initiate));
  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!put.ok) throw { message: `Không tải được tệp "${file.name}" lên kho lưu trữ.` } satisfies SocialApiError;
  return request<SocialAttachment>(
    `/attachments/${encodeURIComponent(ticket.attachmentId)}/complete`,
    json('POST'),
  );
}

/* ------------------------------------------------- bố cục: bảng tin, thẻ, cột phải */

/** Một trang bài theo phạm vi: `GET /feed` (hoặc `GET /bookmarks` cho "Đã lưu"). */
export const loadScopedFeed = (
  scope: SocialFeedScope,
  page: { readonly cursor?: string; readonly limit?: number },
) => request<SocialFeedPage>(buildFeedRequestPath(scope, page), { cache: 'no-store' });

/** Số mục chờ xử lý cho chấm số trên thanh thẻ. */
export const loadInboxCounts = () => request<SocialInboxCounts>('/me/inbox', { cache: 'no-store' });

/** Vài nhóm tôi đang tham gia cho cột phải. */
export const loadMyGroups = async (limit = 6): Promise<readonly SocialGroupSummary[]> =>
  (await request<SocialGroupPage>(`/groups?scope=mine&limit=${limit}`, { cache: 'no-store' })).items;
