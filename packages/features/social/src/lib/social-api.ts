import type {
  CreateSocialCommentRequest,
  DiscardSocialAttachmentRequest,
  CreateSocialPostRequest,
  CreateSocialTopicRequest,
  SocialAttachmentPurpose,
  InitiateSocialAttachmentResponse,
  RefreshSocialUploadPartsResponse,
  SocialAttachment,
  SocialAttachmentStatusRequest,
  SocialAttachmentStatusResponse,
  SocialComment,
  SocialCommentPage,
  SocialFeedPage,
  SocialFeedQuery,
  SocialGroupPage,
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
import { uploadAttachmentWithProgress, type AttachmentUploadApi } from './attachment-upload';
import { readImageSize, type ImageSize } from './image-size';
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

const ATTACHMENT_ERROR_FALLBACKS: Readonly<Record<string, string>> = {
  SOCIAL_UNATTACHED_BYTES_EXCEEDED:
    'Bạn đang có quá nhiều tệp tải lên chưa gửi. Hãy gửi hoặc gỡ bớt tệp rồi thử lại.',
  SOCIAL_VIDEO_TOO_MANY_PROCESSING:
    'Bạn đang có quá nhiều video chờ xử lý. Hãy đợi các video đó xong rồi tải tiếp.',
  SOCIAL_VIDEO_FAILED: 'Video xử lý lỗi, chưa thể đăng. Hãy gỡ video rồi thử lại.',
};

/** Như `errorMessage`, nhưng có lời nhắn tiếng Việt riêng cho các mã lỗi tệp và video khi server không kèm lời nhắn. */
export function attachmentErrorMessage(cause: unknown, fallback: string): string {
  const { code, message } = (cause as SocialApiError | undefined) ?? {};
  if (typeof message === 'string' && message) return message;
  return (code !== undefined ? ATTACHMENT_ERROR_FALLBACKS[code] : undefined) ?? fallback;
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

/** Danh sách người để chọn hoặc nhắc tên; `query` rỗng trả danh sách nhân viên mặc định. Chấp nhận cả mảng lẫn `{ items }`. */
export async function searchPeople(query = '', limit?: number): Promise<readonly SocialUserRef[]> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  const result = await request<readonly SocialUserRef[] | { readonly items: readonly SocialUserRef[] }>(
    `/people${qs ? `?${qs}` : ''}`,
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

const attachmentUploadApi: AttachmentUploadApi = {
  initiate: (body) => request<InitiateSocialAttachmentResponse>('/attachments/uploads', json('POST', body)),
  complete: (id, body) =>
    request<SocialAttachment>(`/attachments/${encodeURIComponent(id)}/complete`, json('POST', body)),
  abort: (id, body) => request<void>(`/attachments/${encodeURIComponent(id)}/abort`, json('POST', body)),
  refreshParts: (id, body) =>
    request<RefreshSocialUploadPartsResponse>(`/attachments/${encodeURIComponent(id)}/parts`, json('POST', body)),
};

/** Bỏ tệp của mình chưa gắn vào bài hay bình luận nào (mọi trạng thái); server trả 204. */
export const attachmentDiscardApi = {
  discard: (id: string, body: DiscardSocialAttachmentRequest = {}) =>
    request<void>(`/attachments/${encodeURIComponent(id)}/discard`, json('POST', body)),
};

/** Trạng thái xử lý (chuyển mã) của tối đa 10 tệp do chính mình tải lên. */
export const attachmentStatusApi = {
  status: async (ids: readonly string[]): Promise<readonly SocialAttachment[]> =>
    (
      await request<SocialAttachmentStatusResponse>(
        '/attachments/status',
        { ...json('POST', { ids } satisfies SocialAttachmentStatusRequest), cache: 'no-store' },
      )
    ).items,
};

/** Bỏ một tệp chưa gắn; dùng khi người dùng gỡ tệp khỏi ô soạn. Lỗi do nơi gọi quyết định bỏ qua. */
export const discardAttachment = (id: string, uploadId?: string) =>
  attachmentDiscardApi.discard(id, uploadId ? { uploadId } : {});

/**
 * Bỏ tệp khi trang đang đóng: `fetch` với `keepalive` vẫn được gửi sau khi trang bị huỷ (giới hạn thân 64 KB, ở đây
 * chỉ vài byte). Đi qua `authFetch` nên gắn cookie phiên và `x-csrf-token` như mọi lời gọi khác; không chờ, không ném lỗi.
 */
export function discardAttachmentKeepalive(id: string, uploadId?: string): void {
  try {
    void authFetch(`${API}/attachments/${encodeURIComponent(id)}/discard`, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(uploadId ? { uploadId } : {}),
    }).catch(() => undefined);
  } catch {
    // Trang đang đóng: không còn gì để làm.
  }
}

/** Huỷ lần tải dang dở: server xoá dòng tệp và dọn các phần đã tải. */
export const abortAttachment = (id: string, uploadId?: string) =>
  attachmentUploadApi.abort(id, uploadId ? { uploadId } : {});

/**
 * Tải một tệp lên: xin URL ký sẵn, PUT thẳng nội dung lên kho (một lệnh hoặc nhiều phần, có tiến trình
 * và huỷ được), rồi báo hoàn tất để server kiểm tra tệp. Lỗi do huỷ nhận biết bằng `isUploadAborted`.
 */
export function uploadAttachment(
  file: File,
  purpose: SocialAttachmentPurpose = 'post',
  options: {
    readonly onProgress?: (fraction: number) => void;
    readonly onInitiated?: (ticket: { readonly attachmentId: string; readonly uploadId?: string }) => void;
    readonly signal?: AbortSignal;
    /** Chỉ ảnh: kích thước đã biết; thiếu thì tự đọc từ `file` (tệp cuối cùng được tải lên). */
    readonly dimensions?: ImageSize;
  } = {},
): Promise<SocialAttachment> {
  // Ảnh: đọc kích thước song song với `initiate` và việc tải; đọc lỗi thì chỉ thiếu kích thước.
  const dimensions =
    options.dimensions ?? (file.type.startsWith('image/') ? readImageSize(file) : undefined);
  return uploadAttachmentWithProgress(file, purpose, { ...options, dimensions, api: attachmentUploadApi });
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
export const loadMyGroups = (limit = 6): Promise<SocialGroupPage> =>
  request<SocialGroupPage>(`/groups?scope=mine&limit=${limit}`, { cache: 'no-store' });
