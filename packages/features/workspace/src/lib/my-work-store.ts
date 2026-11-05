import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import {
  MY_WORK_DEFAULT_PAGE_SIZE,
  type MyWorkFilter,
  type MyWorkItemsPage,
  type MyWorkOverview,
  type MyWorkSortKey,
  type MyWorkStandalonePage,
} from '@enterprise-platform/contracts-workspace';
import { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import * as api from './workspace-api';

export interface MyWorkError {
  readonly message: string;
}

/** Tham số của tổng quan: bộ lọc và cách xếp nằm trong khoá bộ nhớ đệm, mỗi tổ hợp một mục. */
export interface MyWorkOverviewArgs extends MyWorkFilter {
  readonly sort: MyWorkSortKey;
}

/** Tham số của một trang dòng việc trong một nhóm dự án. */
export interface MyWorkGroupItemsArgs {
  readonly projectId: string;
  readonly status?: MyWorkFilter['status'];
  readonly priority?: MyWorkFilter['priority'];
  readonly sort: MyWorkSortKey;
  readonly page: number;
  readonly pageSize: number;
}

export interface MyWorkStandaloneArgs {
  readonly sort: MyWorkSortKey;
  readonly page: number;
  readonly pageSize: number;
}

const failure = (cause: unknown, fallback: string): { error: MyWorkError } => ({
  error: { message: (cause as { message?: string })?.message ?? fallback },
});

/** Giữ một mục trong bộ nhớ sau khi không còn ai dùng: quay lại trang trong ngần này thì có ngay dữ liệu. */
const KEEP_SECONDS = 300;
/** Mở lại trang hoặc đổi tham số mà mục trong bộ nhớ cũ hơn ngần này (giây) thì nạp lại; mới hơn thì dùng luôn. */
const STALE_AFTER_SECONDS = 30;

/**
 * Bộ nhớ đệm của trang "Công việc của tôi" (RTK Query), ba truy vấn:
 * - `myWorkOverview`: số liệu, tóm tắt từng nhóm dự án, nhắc tên, thẻ module khác;
 * - `myWorkGroupItems`: MỘT trang dòng việc của một nhóm dự án; mỗi (dự án, bộ lọc, xếp, trang, cỡ trang) một mục,
 *   nên sang trang 2 mới gọi trang 2 và về trang 1 lấy từ bộ nhớ;
 * - `myWorkStandalone`: một trang việc ngoài dự án.
 *
 * Mọi truy vấn cùng mang tag `MyWork`: thao tác ghi gọi `invalidateMyWork()` thì mục đang xem tự nạp lại, mục không còn
 * ai xem bị bỏ và nạp mới khi quay tới.
 */
export const myWorkApi = createApi({
  reducerPath: 'workspaceMyWork',
  baseQuery: fakeBaseQuery<MyWorkError>(),
  tagTypes: ['MyWork'],
  keepUnusedDataFor: KEEP_SECONDS,
  refetchOnMountOrArgChange: STALE_AFTER_SECONDS,
  endpoints: (build) => ({
    myWorkOverview: build.query<MyWorkOverview, MyWorkOverviewArgs>({
      queryFn: async ({ sort, ...filter }) => {
        try {
          return { data: await api.loadMyWorkOverview(filter, sort) };
        } catch (cause) {
          return failure(cause, 'Không tải được dữ liệu.');
        }
      },
      // Dạng hàm để truy vấn LỖI cũng mang tag: invalidateMyWork() mới nạp lại được cả những truy vấn đang báo lỗi.
      providesTags: () => ['MyWork'],
    }),
    myWorkGroupItems: build.query<MyWorkItemsPage, MyWorkGroupItemsArgs>({
      queryFn: async ({ projectId, status, priority, sort, page, pageSize }) => {
        try {
          return { data: await api.loadMyWorkGroupItems(projectId, { status, priority }, sort, page, pageSize) };
        } catch (cause) {
          return failure(cause, 'Không tải được công việc của dự án.');
        }
      },
      providesTags: () => ['MyWork'],
    }),
    myWorkStandalone: build.query<MyWorkStandalonePage, MyWorkStandaloneArgs>({
      queryFn: async ({ sort, page, pageSize }) => {
        try {
          return { data: await api.loadMyWorkStandalonePage(sort, page, pageSize) };
        } catch (cause) {
          return failure(cause, 'Không tải được công việc ngoài dự án.');
        }
      },
      providesTags: () => ['MyWork'],
    }),
  }),
});

export const { useMyWorkOverviewQuery, useMyWorkGroupItemsQuery, useMyWorkStandaloneQuery } = myWorkApi;

/** Khoá trang của khối "Việc ngoài dự án" trong `pages`. */
export const MY_WORK_STANDALONE_KEY = '__standalone';

/**
 * Trạng thái xem của trang, nằm ngoài vòng đời của view nên rời trang rồi quay lại vẫn đúng bộ lọc, nhóm đang mở và
 * trang đang xem (như trang Dự án nhớ nhóm mở). Mất khi tải lại trang. Rỗng ở bộ lọc nghĩa là không lọc.
 */
export interface MyWorkUiState {
  readonly status: string;
  readonly priority: string;
  readonly projectId: string;
  readonly sort: MyWorkSortKey;
  /** Mã các dự án đang mở nhóm. */
  readonly expanded: readonly string[];
  readonly standaloneOpen: boolean;
  /** Cỡ trang dùng chung cho mọi nhóm. */
  readonly pageSize: number;
  /** Trang hiện tại của từng nhóm (khoá là mã dự án hoặc `MY_WORK_STANDALONE_KEY`); vắng là trang 1. */
  readonly pages: Readonly<Record<string, number>>;
}

const initialUi: MyWorkUiState = {
  status: '',
  priority: '',
  projectId: '',
  sort: 'due',
  expanded: [],
  standaloneOpen: false,
  pageSize: MY_WORK_DEFAULT_PAGE_SIZE,
  pages: {},
};

const uiSlice = createSlice({
  name: 'myWorkUi',
  initialState: initialUi,
  reducers: {
    /** Đổi bộ lọc thì mọi nhóm về trang 1: số việc của nhóm có thể đã khác. */
    setFilter(state, action: PayloadAction<Partial<Pick<MyWorkUiState, 'status' | 'priority' | 'projectId'>>>) {
      Object.assign(state, action.payload);
      state.pages = {};
    },
    setSort(state, action: PayloadAction<MyWorkSortKey>) {
      state.sort = action.payload;
      state.pages = {};
    },
    clearFilter(state) {
      state.status = '';
      state.priority = '';
      state.projectId = '';
      state.sort = 'due';
      state.pages = {};
    },
    toggleGroup(state, action: PayloadAction<string>) {
      const at = state.expanded.indexOf(action.payload);
      if (at >= 0) state.expanded.splice(at, 1);
      else state.expanded.push(action.payload);
    },
    toggleStandalone(state) {
      state.standaloneOpen = !state.standaloneOpen;
    },
    setPage(state, action: PayloadAction<{ key: string; page: number }>) {
      state.pages[action.payload.key] = Math.max(1, action.payload.page);
    },
    setPageSize(state, action: PayloadAction<number>) {
      state.pageSize = action.payload;
      state.pages = {};
    },
    reset: () => initialUi,
  },
});

/** Store riêng của trang, sống suốt phiên: bộ nhớ đệm và trạng thái xem không mất khi chuyển trang. */
export const myWorkStore = configureStore({
  reducer: { [myWorkApi.reducerPath]: myWorkApi.reducer, myWorkUi: uiSlice.reducer },
  middleware: (getDefault) => getDefault().concat(myWorkApi.middleware),
});
type RootState = ReturnType<typeof myWorkStore.getState>;

/**
 * Gọi sau MỌI thao tác ghi làm đổi "Công việc của tôi" (đổi trạng thái, sửa việc, tạo việc, trả lời lời mời, Trợ lý vừa
 * lưu...): các truy vấn đang xem nạp lại ngay, số đếm và nhóm hạn cập nhật theo.
 */
export const invalidateMyWork = () => myWorkStore.dispatch(myWorkApi.util.invalidateTags(['MyWork']));

/** Xoá sạch bộ nhớ đệm và trạng thái xem (dùng khi đăng xuất, hoặc giữa các ca kiểm thử). */
export const resetMyWork = () => {
  myWorkStore.dispatch(myWorkApi.util.resetApiState());
  myWorkStore.dispatch(uiSlice.actions.reset());
};

/** Trạng thái xem của trang và các hàm đổi nó, dùng gọn trong view. */
export function useMyWorkUi() {
  const dispatch = useDispatch();
  const ui = useSelector((state: RootState) => state.myWorkUi);
  const actions = useMemo(
    () => ({
      setFilter: (patch: Partial<Pick<MyWorkUiState, 'status' | 'priority' | 'projectId'>>) =>
        dispatch(uiSlice.actions.setFilter(patch)),
      setSort: (sort: MyWorkSortKey) => dispatch(uiSlice.actions.setSort(sort)),
      clearFilter: () => dispatch(uiSlice.actions.clearFilter()),
      toggleGroup: (projectId: string) => dispatch(uiSlice.actions.toggleGroup(projectId)),
      toggleStandalone: () => dispatch(uiSlice.actions.toggleStandalone()),
      setPage: (key: string, page: number) => dispatch(uiSlice.actions.setPage({ key, page })),
      setPageSize: (size: number) => dispatch(uiSlice.actions.setPageSize(size)),
    }),
    [dispatch],
  );
  return { ui, ...actions };
}
