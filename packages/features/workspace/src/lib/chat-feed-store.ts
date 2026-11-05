import { configureStore } from '@reduxjs/toolkit';
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import type { ProjectChatFeedPage, ProjectChatThread } from '@enterprise-platform/contracts-workspace';
import { subscribeRealtime, subscribeRealtimeStatus } from '@enterprise-platform/shared-ui';
import * as api from './workspace-api';

export interface ChatFeedArgs {
  readonly projectId: string;
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly onlyWithChat?: boolean;
}

export interface ChatFeedThreadArgs {
  readonly projectId: string;
  readonly workItemId: string;
}

export interface ChatFeedError {
  readonly message: string;
}

const failure = (cause: unknown, fallback: string): { error: ChatFeedError } => ({
  error: { message: (cause as { message?: string })?.message ?? fallback },
});

/** Thời gian giữ một mục trong bộ nhớ sau khi không còn ai dùng: quay lại trong ngần này thì không gọi lại API. */
const KEEP_SECONDS = 600;

/**
 * Bộ nhớ đệm của màn "Trao đổi công việc" (RTK Query):
 * - `chatFeedPage`: mỗi (dự án, trang, cỡ trang, từ khoá, bộ lọc) là một mục; qua trang 2 mới gọi trang 2, về lại
 *   trang 1 lấy từ bộ nhớ;
 * - `chatFeedThread`: trao đổi của một công việc, gọi khi chọn công việc đó và nhớ lại. Là truy vấn nhiều trang:
 *   trang đầu là các tin mới nhất, "Xem tin cũ hơn" nối thêm trang liền trước (`before` = id tin cũ nhất đang có).
 *
 * Có tin mới (realtime) thì huỷ các mục liên quan bằng tag: mục đang xem tự tải lại, mục khác tải lại khi quay tới.
 */
export const chatFeedApi = createApi({
  reducerPath: 'workspaceChatFeed',
  baseQuery: fakeBaseQuery<ChatFeedError>(),
  tagTypes: ['ChatFeed', 'ChatThread'],
  keepUnusedDataFor: KEEP_SECONDS,
  endpoints: (build) => ({
    chatFeedPage: build.query<ProjectChatFeedPage, ChatFeedArgs>({
      queryFn: async ({ projectId, page, pageSize, search, onlyWithChat }) => {
        try {
          return { data: await api.loadProjectChatFeed(projectId, page, pageSize, { search, onlyWithChat }) };
        } catch (cause) {
          return failure(cause, 'Không tải được danh sách trao đổi của dự án.');
        }
      },
      providesTags: (_result, _error, { projectId }) => [{ type: 'ChatFeed', id: projectId }],
    }),
    chatFeedThread: build.infiniteQuery<ProjectChatThread, ChatFeedThreadArgs, string | null>({
      infiniteQueryOptions: {
        // `null` là trang đầu (tin mới nhất); các trang sau mang id tin cũ nhất của trang liền trước.
        initialPageParam: null,
        getNextPageParam: (lastPage) =>
          lastPage.hasMore && lastPage.messages[0] ? lastPage.messages[0].id : undefined,
      },
      queryFn: async ({ queryArg, pageParam }) => {
        try {
          return {
            data: await api.loadProjectChatThread(queryArg.projectId, queryArg.workItemId, pageParam ?? undefined),
          };
        } catch (cause) {
          return failure(cause, 'Không tải được trao đổi của công việc.');
        }
      },
      providesTags: (_result, _error, { workItemId }) => [{ type: 'ChatThread', id: workItemId }],
    }),
  }),
});

export const { useChatFeedPageQuery, useChatFeedThreadInfiniteQuery } = chatFeedApi;

/** Store riêng của màn này, sống suốt phiên trang: bộ nhớ đệm không mất khi chuyển tab hay đóng mở lại. */
export const chatFeedStore = configureStore({
  reducer: { [chatFeedApi.reducerPath]: chatFeedApi.reducer },
  middleware: (getDefault) => getDefault().concat(chatFeedApi.middleware),
});

/**
 * Có tin mới/sửa/thu hồi: danh sách (tin xem trước, thứ tự, bộ lọc) của dự án đã cũ, và trao đổi của
 * những công việc đó nếu biết là công việc nào.
 */
export const invalidateChatFeed = (projectId: string, workItemIds: readonly string[] = []) =>
  chatFeedStore.dispatch(
    chatFeedApi.util.invalidateTags([
      { type: 'ChatFeed', id: projectId },
      ...workItemIds.map((id) => ({ type: 'ChatThread' as const, id })),
    ]),
  );

/** Gộp nhiều tín hiệu realtime dồn dập thành một lần huỷ bộ nhớ. */
const REALTIME_DEBOUNCE_MS = 300;

/**
 * Nghe tín hiệu chat realtime ở cấp module (không gắn với tab), nên bộ nhớ đệm luôn được huỷ đúng lúc kể cả khi
 * tab "Trao đổi công việc" đang đóng: mở lại tab thấy dữ liệu mới thay vì bản cũ trong 10 phút. Tín hiệu "đã đọc"
 * bỏ qua vì không đổi nội dung. Mất rồi nối lại socket thì huỷ hết, vì có thể đã lỡ tín hiệu.
 *
 * Tín hiệu KHÔNG gửi cho chính người nhắn; tin của mình được báo tại chỗ bằng `invalidateChatFeed` (xem projects-view).
 */
function listenRealtime(): void {
  const pending = new Map<string, Set<string>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    for (const [projectId, workItemIds] of pending) invalidateChatFeed(projectId, [...workItemIds]);
    pending.clear();
  };
  subscribeRealtime((event) => {
    if (event.event !== 'workspace.chat.changed') return;
    const signal = event.data as Partial<{
      projectId: string;
      entityType: string;
      entityId: string;
      change: string;
    }>;
    if (!signal?.projectId || signal.change === 'read') return;
    const ids = pending.get(signal.projectId) ?? new Set<string>();
    if (signal.entityType === 'work_item' && signal.entityId) ids.add(signal.entityId);
    pending.set(signal.projectId, ids);
    clearTimeout(timer);
    timer = setTimeout(flush, REALTIME_DEBOUNCE_MS);
  });
  subscribeRealtimeStatus((connected) => {
    if (connected) chatFeedStore.dispatch(chatFeedApi.util.invalidateTags(['ChatFeed', 'ChatThread']));
  });
}

if (typeof window !== 'undefined') listenRealtime();
