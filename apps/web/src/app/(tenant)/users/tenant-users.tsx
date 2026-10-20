'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { hasTenantAction } from '@enterprise-platform/contracts-identity';
import { useGetUsersQuery } from '@/store/tenant-api';
import { UserFormDialog } from './user-form-dialog';
import { UserCard } from './user-ui';
import {
  buildListSearch,
  filterUsers,
  paginateGroups,
  parseListParams,
  roleOptionsOf,
  type StatusFilter,
  type UsersListState,
} from './users-list-model';
import { UsersTable } from './users-table';

interface TenantUsersProps {
  readonly tenantSlug: string;
  readonly permissions?: readonly string[];
  readonly isAdmin?: boolean;
}

const BUTTON =
  'flex h-9 cursor-pointer items-center rounded-md border border-[#e5e7eb] bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-[#f4f6f9] disabled:cursor-not-allowed disabled:opacity-60';

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Đang tải danh sách người dùng" className="flex flex-col">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-[#f1f3f6] px-4 py-3 last:border-b-0"
        >
          <div className="size-9 animate-pulse rounded-md bg-slate-100" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-3.5 w-40 animate-pulse rounded-md bg-slate-100" />
            <div className="h-3 w-56 max-w-full animate-pulse rounded-md bg-slate-100" />
          </div>
          <div className="hidden h-5 w-24 animate-pulse rounded-md bg-slate-100 sm:block" />
        </div>
      ))}
    </div>
  );
}

function TenantUsersView({
  tenantSlug,
  permissions = [],
}: TenantUsersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, isLoading, isFetching, error, refetch } = useGetUsersQuery();
  const [creating, setCreating] = useState(false);
  const canCreate = hasTenantAction(permissions, 'core.users.create');

  const urlState = useMemo(
    () => parseListParams(searchParams),
    [searchParams],
  );
  // Ô tìm kiếm giữ giá trị cục bộ để gõ mượt; URL được cập nhật sau một nhịp ngắn.
  const [query, setQuery] = useState(urlState.q);
  const { status, role, page } = urlState;

  const navigate = useCallback(
    (patch: Partial<UsersListState>) => {
      const search = buildListSearch({ ...urlState, ...patch });
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [urlState, pathname, router],
  );

  useEffect(() => {
    if (query === urlState.q) return;
    const timer = setTimeout(() => navigate({ q: query, page: 1 }), 250);
    return () => clearTimeout(timer);
  }, [query, urlState.q, navigate]);

  const users = useMemo(() => data ?? [], [data]);
  const roleOptions = useMemo(() => roleOptionsOf(users), [users]);
  const filtered = useMemo(
    () => filterUsers(users, { q: query, status, role }),
    [users, query, status, role],
  );
  const view = useMemo(() => paginateGroups(filtered, page), [filtered, page]);

  const activeCount = users.filter((u) => u.status === 'active').length;
  const disabledCount = users.filter((u) => u.status === 'disabled').length;

  return (
    <div className="flex min-w-0 flex-col gap-4 text-[14px] text-[#18181b]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-[1_1_360px]">
          <h1 className="m-0 text-[20px] font-bold tracking-[-0.3px]">Người dùng</h1>
          <p className="mt-1 text-[14px] text-slate-600">
            Quản lý tài khoản và vai trò trong doanh nghiệp.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            className="flex h-[38px] cursor-pointer items-center gap-1.5 rounded-md bg-[#ffc90a] px-3.5 text-[14px] font-bold text-[#18181b] hover:bg-[#ffd84d]"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-4" />
            Thêm người dùng
          </button>
        )}
      </div>

      <UserCard
        aria-label="Tổng quan người dùng"
        className="grid grid-cols-3 overflow-hidden"
      >
        {(
          [
            ['Tổng số', users.length, '', 'all'],
            ['Hoạt động', activeCount, 'text-emerald-700', 'active'],
            ['Vô hiệu hóa', disabledCount, 'text-red-700', 'disabled'],
          ] as const
        ).map(([label, count, tone, value], index) => {
          const selected = status === value;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={selected}
              data-testid={`users-stat-${value}`}
              // Bấm thẻ: lọc theo trạng thái (xóa tìm kiếm và vai trò để số khớp); bấm lại thì bỏ lọc.
              onClick={() => {
                setQuery('');
                navigate({
                  q: '',
                  role: 'all',
                  page: 1,
                  status: (selected ? 'all' : value) as StatusFilter,
                });
              }}
              className={`flex cursor-pointer flex-col px-5 py-3.5 text-left hover:bg-[#fafbfc] ${
                index < 2 ? 'border-r border-[#f1f3f6]' : ''
              } ${selected && value !== 'all' ? 'bg-[#fffbeb] shadow-[inset_0_-3px_0_#ffc90a]' : ''}`}
            >
              <span className="text-xs text-slate-500">{label}</span>
              <b className={`text-[20px] leading-tight tabular-nums ${tone}`}>
                {isLoading ? '–' : count}
              </b>
            </button>
          );
        })}
      </UserCard>

      <UserCard
        aria-label="Bộ lọc người dùng"
        className="flex flex-wrap items-center gap-2.5 p-3"
      >
        <label className="flex h-9 min-w-0 flex-[1_1_240px] items-center gap-2 rounded-md border border-[#e5e7eb] bg-white px-3 text-slate-500 focus-within:border-[#ffc90a]">
          <Search className="size-4 shrink-0" aria-hidden />
          <input
            type="search"
            aria-label="Tìm người dùng"
            placeholder="Tìm theo tên hoặc email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-[#18181b] outline-none placeholder:text-slate-400"
          />
        </label>
        <div className="w-full sm:w-[200px]">
          <SearchableSelect
            clearable={false}
            value={status}
            options={[
              { value: 'all', label: 'Tất cả trạng thái' },
              { value: 'active', label: 'Hoạt động' },
              { value: 'disabled', label: 'Vô hiệu hóa' },
            ]}
            onChange={(v) => navigate({ status: v as StatusFilter, page: 1 })}
          />
        </div>
        <div className="w-full sm:w-[240px]">
          <SearchableSelect
            clearable={false}
            value={role}
            options={[{ value: 'all', label: 'Tất cả vai trò' }, ...roleOptions]}
            onChange={(v) => navigate({ role: v, page: 1 })}
          />
        </div>
      </UserCard>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <span>
            {error.message || 'Không thể tải danh sách người dùng.'}
          </span>
          <button
            type="button"
            className={BUTTON}
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? 'Đang tải…' : 'Thử lại'}
          </button>
        </div>
      )}

      <UserCard as="section" aria-label="Danh sách người dùng" className="overflow-hidden">
        {isLoading ? (
          <ListSkeleton />
        ) : view.groups.length > 0 ? (
          <UsersTable groups={view.groups} />
        ) : (
          !error && (
            <p className="m-0 p-10 text-center text-slate-500">
              Không tìm thấy người dùng.
            </p>
          )
        )}
        {!isLoading && !error && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e2e8f0] bg-[#f8fafc] px-4 py-2.5 text-[12px] text-slate-500">
            <span>
              <b className="text-[#18181b]">{filtered.length}</b> / {users.length}{' '}
              người dùng
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                className={BUTTON}
                disabled={view.page <= 1}
                onClick={() => navigate({ page: view.page - 1 })}
              >
                Trước
              </button>
              <span className="font-bold tabular-nums text-[#0f172a]">
                {view.page} / {view.pages}
              </span>
              <button
                type="button"
                className={BUTTON}
                disabled={view.page >= view.pages}
                onClick={() => navigate({ page: view.page + 1 })}
              >
                Sau
              </button>
            </span>
          </div>
        )}
      </UserCard>

      {canCreate && (
        <UserFormDialog
          open={creating}
          onOpenChange={setCreating}
          tenantSlug={tenantSlug}
        />
      )}
    </div>
  );
}

export function TenantUsers(props: TenantUsersProps) {
  return (
    <Suspense
      fallback={
        <UserCard className="overflow-hidden">
          <ListSkeleton />
        </UserCard>
      }
    >
      <TenantUsersView {...props} />
    </Suspense>
  );
}
