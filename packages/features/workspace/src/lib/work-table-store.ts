import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback, useEffect } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';

/** Các cỡ trang của bảng công việc; phần tử đầu là mặc định. */
export const WORK_TABLE_PAGE_SIZES = [10, 20, 50] as const;
export const WORK_TABLE_PAGE_SIZE = WORK_TABLE_PAGE_SIZES[0];

/** Các cột của bảng công việc (trừ cột Công việc luôn hiện), kèm bề ngang cố định của cột (px). */
export const WORK_COLUMNS = [
  { id: 'people', label: 'Người thực hiện', width: 150 },
  { id: 'priority', label: 'Ưu tiên', width: 104 },
  { id: 'status', label: 'Trạng thái', width: 108 },
  { id: 'start', label: 'Bắt đầu', width: 84 },
  { id: 'due', label: 'Thời hạn', width: 84 },
  { id: 'last', label: 'Trạng thái cuối', width: 124 },
  { id: 'progress', label: 'Tiến độ', width: 124 },
  { id: 'process', label: 'Quy trình', width: 130 },
] as const;
export type WorkColumnId = (typeof WORK_COLUMNS)[number]['id'];

/** Bề ngang tối thiểu của cột Công việc (px); phần còn lại của khung dồn cho cột này. */
export const WORK_TITLE_MIN_WIDTH = 220;

const COLUMN_IDS: ReadonlySet<string> = new Set(WORK_COLUMNS.map((column) => column.id));
const storageKey = (userId: string) => `workspace:work-table:hidden-columns:${userId}`;

/** Cột đã ẩn của người dùng; `undefined` là chưa tuỳ chỉnh (dùng bố cục mặc định, tự bớt cột khi khung hẹp). */
function readHidden(userId: string): string[] | undefined {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && COLUMN_IDS.has(id)) : undefined;
  } catch {
    return undefined;
  }
}

function writeHidden(userId: string, hidden: readonly string[] | undefined): void {
  try {
    if (hidden === undefined) window.localStorage.removeItem(storageKey(userId));
    else window.localStorage.setItem(storageKey(userId), JSON.stringify(hidden));
  } catch {
    // Trình duyệt chặn lưu trữ: tuỳ chọn chỉ có hiệu lực trong phiên này.
  }
}

type ProjectState = Record<string, unknown>;

/**
 * Trạng thái xem của bảng công việc theo TỪNG dự án: kiểu xem, bộ lọc, sắp xếp, nhánh đang thu gọn, trang và cỡ
 * trang. Nằm trong Redux (ngoài vòng đời của tab) nên đổi sang tab khác rồi quay lại, hay mở một công việc rồi đóng,
 * bảng vẫn đúng trang và đúng bộ lọc đang xem. Mất khi tải lại trang.
 */
const workTableSlice = createSlice({
  name: 'workTable',
  initialState: {} as Record<string, ProjectState>,
  reducers: {
    setField(state, action: PayloadAction<{ projectId: string; key: string; value: unknown }>) {
      const { projectId, key, value } = action.payload;
      state[projectId] = { ...state[projectId], [key]: value };
    },
  },
});

/**
 * Cột ẩn của bảng công việc theo NGƯỜI DÙNG (áp cho mọi dự án): mỗi người tự chọn cột cần xem. Lưu trong localStorage
 * theo mã người dùng để lần sau và trên cùng máy vẫn giữ; `userId` ở đây là người đã nạp tuỳ chọn vào store.
 */
const columnsSlice = createSlice({
  name: 'workColumns',
  initialState: { userId: undefined as string | undefined, hidden: undefined as string[] | undefined },
  reducers: {
    load(state, action: PayloadAction<{ userId: string; hidden?: string[] }>) {
      state.userId = action.payload.userId;
      state.hidden = action.payload.hidden;
    },
    setHidden(state, action: PayloadAction<string[] | undefined>) {
      state.hidden = action.payload;
    },
  },
});

export const workTableStore = configureStore({
  reducer: { workTable: workTableSlice.reducer, workColumns: columnsSlice.reducer },
});
type RootState = ReturnType<typeof workTableStore.getState>;

/**
 * Một trường trạng thái của bảng công việc, dùng như `useState`: trả `[giá trị, đặt]`, `đặt` nhận giá trị hoặc hàm
 * cập nhật. `initial` phải là hằng ổn định (không dựng mới mỗi lần vẽ) vì nó là giá trị khi chưa có gì được lưu.
 */
export function useWorkTableField<T>(
  projectId: string,
  key: string,
  initial: T,
): [T, (next: T | ((current: T) => T)) => void] {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const value = useSelector((state: RootState) => (state.workTable[projectId]?.[key] as T | undefined) ?? initial);
  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = (store.getState().workTable[projectId]?.[key] as T | undefined) ?? initial;
      const resolved = typeof next === 'function' ? (next as (value: T) => T)(current) : next;
      dispatch(workTableSlice.actions.setField({ projectId, key, value: resolved }));
    },
    [dispatch, store, projectId, key, initial],
  );
  return [value, set];
}

const NO_HIDDEN: readonly string[] = [];

/**
 * Cột ẩn của người dùng hiện tại. `customized` là đã từng tuỳ chỉnh: chưa thì bảng dùng bố cục mặc định (tự bớt cột
 * phụ khi khung hẹp), rồi thì hiện đúng các cột đã chọn và cuộn ngang nếu không vừa.
 */
export function useWorkColumns(userId: string): {
  hidden: ReadonlySet<string>;
  customized: boolean;
  setHidden: (next: readonly string[]) => void;
  reset: () => void;
} {
  const dispatch = useDispatch();
  const loadedFor = useSelector((state: RootState) => state.workColumns.userId);
  const stored = useSelector((state: RootState) => state.workColumns.hidden);
  // Nạp tuỳ chọn của người dùng này một lần (đổi người dùng thì nạp lại).
  useEffect(() => {
    if (loadedFor !== userId) dispatch(columnsSlice.actions.load({ userId, hidden: readHidden(userId) }));
  }, [dispatch, loadedFor, userId]);
  const ready = loadedFor === userId;
  const hidden = ready ? stored : undefined;
  const setHidden = useCallback(
    (next: readonly string[]) => {
      const clean = [...new Set(next)].filter((id) => COLUMN_IDS.has(id));
      writeHidden(userId, clean);
      dispatch(columnsSlice.actions.setHidden(clean));
    },
    [dispatch, userId],
  );
  const reset = useCallback(() => {
    writeHidden(userId, undefined);
    dispatch(columnsSlice.actions.setHidden(undefined));
  }, [dispatch, userId]);
  return { hidden: new Set(hidden ?? NO_HIDDEN), customized: hidden !== undefined, setHidden, reset };
}
