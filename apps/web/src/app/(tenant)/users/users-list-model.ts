import { searchText } from '../authorization/authorization-client';
import type { TenantCoreUser } from './user-types';

export const PAGE_SIZE = 15;

export type StatusFilter = 'all' | 'active' | 'disabled';

export interface UsersListState {
  q: string;
  status: StatusFilter;
  role: string;
  page: number;
}

export const DEFAULT_LIST_STATE: UsersListState = {
  q: '',
  status: 'all',
  role: 'all',
  page: 1,
};

interface ParamsReader {
  get(name: string): string | null;
}

/** Đọc bộ lọc từ URL; giá trị sai được đưa về mặc định. */
export function parseListParams(params: ParamsReader): UsersListState {
  const status = params.get('status');
  const page = Number.parseInt(params.get('page') ?? '', 10);
  return {
    q: params.get('q') ?? '',
    status: status === 'active' || status === 'disabled' ? status : 'all',
    role: params.get('role') || 'all',
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/** Ghi bộ lọc ra chuỗi query (không có dấu `?`); giá trị mặc định bị bỏ. */
export function buildListSearch(state: UsersListState): string {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q);
  if (state.status !== 'all') params.set('status', state.status);
  if (state.role !== 'all') params.set('role', state.role);
  if (state.page > 1) params.set('page', String(state.page));
  return params.toString();
}

export function filterUsers(
  users: readonly TenantCoreUser[],
  state: Pick<UsersListState, 'q' | 'status' | 'role'>,
): TenantCoreUser[] {
  const needle = searchText(state.q.trim());
  return users.filter(
    (u) =>
      searchText(`${u.fullName} ${u.email}`).includes(needle) &&
      (state.status === 'all' || u.status === state.status) &&
      (state.role === 'all' || (u.roleIds?.includes(state.role) ?? false)),
  );
}

export interface UserGroup {
  id: 'active' | 'disabled';
  title: string;
  /** Tổng số người của nhóm sau khi lọc (mọi trang). */
  total: number;
  /** Các dòng của nhóm nằm trong trang hiện tại. */
  rows: TenantCoreUser[];
}

export interface UsersPageView {
  page: number;
  pages: number;
  total: number;
  groups: UserGroup[];
}

/**
 * Người đang hoạt động xếp trước, vô hiệu hóa sau, rồi cắt theo trang; nên mỗi
 * trang chia thành nhiều nhất hai nhóm. Trang vượt quá giới hạn được kẹp lại.
 */
export function paginateGroups(
  filtered: readonly TenantCoreUser[],
  requestedPage: number,
  pageSize = PAGE_SIZE,
): UsersPageView {
  const active = filtered.filter((u) => u.status === 'active');
  const disabled = filtered.filter((u) => u.status !== 'active');
  const ordered = [...active, ...disabled];
  const pages = Math.max(1, Math.ceil(ordered.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pages);
  const slice = ordered.slice((page - 1) * pageSize, page * pageSize);
  const groups: UserGroup[] = (
    [
      { id: 'active', title: 'Hoạt động', total: active.length },
      { id: 'disabled', title: 'Vô hiệu hóa', total: disabled.length },
    ] as const
  )
    .map((g) => ({
      ...g,
      rows: slice.filter((u) => (g.id === 'active') === (u.status === 'active')),
    }))
    .filter((g) => g.rows.length > 0);
  return { page, pages, total: ordered.length, groups };
}

export function roleOptionsOf(users: readonly TenantCoreUser[]) {
  return [
    ...new Map(
      users
        .flatMap((u) => u.roles ?? [])
        .map((r) => [r.id, { value: r.id, label: r.name }]),
    ).values(),
  ];
}
