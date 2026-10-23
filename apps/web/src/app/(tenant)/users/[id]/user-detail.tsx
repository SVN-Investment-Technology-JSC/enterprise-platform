'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  History,
  ShieldCheck,
  Trash2,
  UserRound,
  UserCheck,
  UserX,
} from 'lucide-react';
import { hasTenantAction } from '@enterprise-platform/contracts-identity';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { useAppSelector } from '@/store/organization-layout-store';
import {
  tenantApi,
  useDeleteUserMutation,
  useGetUserQuery,
  useUpdateUserMutation,
} from '@/store/tenant-api';
import { UserAccessEditor } from '../../authorization/user-role-editor';
import { errorMessage } from '../../authorization/user-permission-grants-dialog';
import type { TenantCoreUser } from '../user-types';
import {
  ExtraGrantsBadge,
  formatDate,
  RoleChips,
  StatusBadge,
  UserAvatar,
  UserCard,
} from '../user-ui';
import {
  availableTabs,
  resolveTab,
  TAB_LABELS,
  tabAfterKey,
  type DetailTab,
} from './detail-tabs';
import { HistoryTab } from './history-tab';
import { OverviewTab } from './overview-tab';

const BTN =
  'inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-60';
const BTN_PRIMARY = `${BTN} bg-[#ffc90a] font-bold text-[#18181b] hover:bg-[#ffd84d]`;
const BTN_SECONDARY = `${BTN} border border-[#e5e7eb] bg-white text-slate-700 hover:bg-[#f4f6f9]`;
const BTN_DANGER = `${BTN} border border-red-200 bg-white text-red-700 hover:bg-red-50`;

const TAB_ICONS: Record<DetailTab, typeof UserRound> = {
  overview: UserRound,
  access: ShieldCheck,
  history: History,
};

/** API trả lỗi dạng `{ message }`; id lạ được máy chủ trả bằng câu "không tìm thấy" tiếng Việt hoặc HTTP 404. */
const NOT_FOUND = /không tìm thấy|\b404\b|not found/i;

interface UserDetailProps {
  readonly userId: string;
  readonly tenantSlug: string;
  readonly permissions: readonly string[];
  readonly isAdmin: boolean;
}

export function UserDetail({
  userId,
  tenantSlug,
  permissions,
  isAdmin,
}: UserDetailProps) {
  const router = useRouter();
  const [deleted, setDeleted] = useState(false);
  const query = useGetUserQuery(userId, { skip: deleted });
  // Vào từ danh sách thì đã có người này trong bộ nhớ đệm: hiện ngay, bản đầy đủ về sau thay vào.
  const fromList = useAppSelector((state) =>
    tenantApi.endpoints.getUsers
      .select()(state)
      .data?.find((u) => u.id === userId),
  );
  const user: TenantCoreUser | undefined = query.data ?? fromList;

  if (deleted) {
    return (
      <p role="status" className="m-0 p-6 text-[14px] text-slate-500">
        Đã xóa người dùng. Đang quay về danh sách…
      </p>
    );
  }

  if (query.error && NOT_FOUND.test(query.error.message ?? '')) {
    return (
      <StatePanel title="Không tìm thấy người dùng" role="status">
        Người dùng này không tồn tại hoặc đã bị xóa.
        <BackLink
          className={`${BTN_SECONDARY} mt-3 w-fit`}
          label="Về danh sách người dùng"
        />
      </StatePanel>
    );
  }

  if (!user) {
    if (query.error) {
      return (
        <StatePanel title="Không thể tải người dùng" role="alert">
          {query.error.message}
          <button
            type="button"
            aria-label="Thử tải lại người dùng"
            className={`${BTN_PRIMARY} mt-3 w-fit`}
            onClick={() => void query.refetch()}
          >
            Thử lại
          </button>
        </StatePanel>
      );
    }
    return <DetailSkeleton />;
  }

  return (
    <DetailContent
      user={user}
      tenantSlug={tenantSlug}
      permissions={permissions}
      isAdmin={isAdmin}
      refreshError={query.error?.message}
      onRetry={() => void query.refetch()}
      onDeleted={() => {
        setDeleted(true);
        router.push('/users');
      }}
    />
  );
}

function DetailContent({
  user,
  tenantSlug,
  permissions,
  isAdmin,
  refreshError,
  onRetry,
  onDeleted,
}: {
  user: TenantCoreUser;
  tenantSlug: string;
  permissions: readonly string[];
  isAdmin: boolean;
  refreshError?: string;
  onRetry: () => void;
  onDeleted: () => void;
}) {
  const searchParams = useSearchParams();
  const [updateUser, { isLoading: updating }] = useUpdateUserMutation();
  const [deleteUser, { isLoading: deleting }] = useDeleteUserMutation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const tabs = availableTabs({ isAdmin });
  const [tab, setTab] = useState<DetailTab>(() =>
    resolveTab(searchParams.get('tab'), tabs),
  );
  // Tab đã mở giữ nguyên trong DOM (ẩn bằng `hidden`) nên quay lại tab không tải lại dữ liệu.
  const [visited, setVisited] = useState<readonly DetailTab[]>([tab]);
  const tabRefs = useRef(new Map<DetailTab, HTMLButtonElement>());

  // Chỉ quản trị tenant mới sửa được tài khoản quản trị; máy chủ vẫn là nơi quyết định.
  const editable = user.systemRole !== 'tenant-admin' || isAdmin;
  const canUpdate =
    hasTenantAction(permissions, 'core.users.update') && editable;
  const canDelete =
    hasTenantAction(permissions, 'core.users.delete') && editable;
  const active = user.status === 'active';

  function selectTab(next: DetailTab) {
    setTab(next);
    setVisited((cur) => (cur.includes(next) ? cur : [...cur, next]));
    // Ghi tab vào URL không đi qua router để khỏi gọi lại máy chủ khi đổi tab.
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url);
  }

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const next = tabAfterKey(tab, tabs, e.key);
    if (!next) return;
    e.preventDefault();
    selectTab(next);
    tabRefs.current.get(next)?.focus();
  }

  async function toggleStatus() {
    if (updating) return;
    try {
      await updateUser({
        id: user.id,
        patch: { status: active ? 'disabled' : 'active' },
      }).unwrap();
      toast.success(
        active
          ? `Đã vô hiệu hóa "${user.fullName}".`
          : `Đã kích hoạt "${user.fullName}".`,
      );
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thể đổi trạng thái người dùng.'));
    }
  }

  async function remove() {
    if (deleting) return;
    try {
      await deleteUser(user.id).unwrap();
      toast.success(`Đã xóa người dùng "${user.fullName}".`);
      onDeleted();
    } catch (cause) {
      setConfirmingDelete(false);
      toast.error(errorMessage(cause, 'Không thể xóa người dùng.'));
    }
  }

  const extraCount = user.directActionKeys?.length ?? 0;

  return (
    <div className="flex min-w-0 flex-col gap-4 text-[14px] text-[#18181b]">
      <nav
        aria-label="Điều hướng trang"
        className="flex flex-wrap items-center gap-2 text-[13px] text-slate-500"
      >
        <BackLink
          className="inline-flex items-center gap-1 rounded-md font-semibold text-[#1d4ed8] hover:underline"
          label="Người dùng"
          icon
        />
        <span aria-hidden>/</span>
        <span
          aria-current="page"
          className="min-w-0 truncate font-semibold text-slate-700"
        >
          {user.fullName}
        </span>
      </nav>

      {refreshError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-red-700"
        >
          <span className="min-w-0 flex-1">
            Không thể làm mới dữ liệu: {refreshError}
          </span>
          <button
            type="button"
            aria-label="Thử làm mới người dùng"
            className={BTN_SECONDARY}
            onClick={onRetry}
          >
            Thử lại
          </button>
        </div>
      ) : null}

      <UserCard
        aria-label="Hồ sơ người dùng"
        className="flex flex-wrap items-start gap-4 p-4 sm:p-5"
      >
        <UserAvatar name={user.fullName} userId={user.id} size={64} muted={!active} />
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2">
          <div className="min-w-0">
            <h1 className="m-0 break-words text-[22px] font-bold leading-tight tracking-[-0.3px]">
              {user.fullName}
            </h1>
            <p className="m-0 mt-0.5 break-all text-[14px] text-slate-500">
              {user.email}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={user.status} />
            <RoleChips roles={user.roles} max={Number.MAX_SAFE_INTEGER} />
            <ExtraGrantsBadge
              count={extraCount}
              testId="user-detail-extra-grants"
            />
          </div>
          <p className="m-0 text-[12px] text-slate-500">
            Tạo ngày {formatDate(user.createdAt)}
          </p>
        </div>
        {canUpdate || canDelete ? (
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
            {canUpdate ? (
              <button
                type="button"
                aria-label={
                  active
                    ? `Vô hiệu hóa ${user.fullName}`
                    : `Kích hoạt ${user.fullName}`
                }
                className={active ? BTN_SECONDARY : BTN_PRIMARY}
                disabled={updating}
                onClick={() => void toggleStatus()}
              >
                {active ? (
                  <UserX className="size-4" aria-hidden />
                ) : (
                  <UserCheck className="size-4" aria-hidden />
                )}
                {active ? 'Vô hiệu hóa' : 'Kích hoạt'}
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                aria-label={`Xóa người dùng ${user.fullName}`}
                className={BTN_DANGER}
                disabled={deleting}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="size-4" aria-hidden />
                Xóa người dùng
              </button>
            ) : null}
          </div>
        ) : null}
      </UserCard>

      <Dialog
        open={confirmingDelete}
        onOpenChange={(next) => {
          if (!deleting) setConfirmingDelete(next);
        }}
      >
        <DialogContent
          data-testid="delete-user-dialog"
          className="max-w-md rounded-[10px] p-6"
        >
          <DialogHeader>
            <DialogTitle>Xóa người dùng?</DialogTitle>
            <DialogDescription>
              Xóa tài khoản <b className="text-[#18181b]">{user.fullName}</b> và
              thu hồi phiên đăng nhập. Không hoàn tác được.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={BTN_SECONDARY}
              disabled={deleting}
              onClick={() => setConfirmingDelete(false)}
            >
              Hủy
            </button>
            <button
              type="button"
              data-testid="confirm-delete-user"
              className={`${BTN} bg-red-600 text-white hover:bg-red-700`}
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? 'Đang xóa…' : 'Xóa người dùng'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex min-w-0 flex-col gap-4">
        <div
          role="tablist"
          aria-label="Thông tin người dùng"
          className="flex gap-1 overflow-x-auto border-b border-[#e5e7eb] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((id) => {
            const Icon = TAB_ICONS[id];
            const selected = id === tab;
            return (
              <button
                key={id}
                ref={(node) => {
                  if (node) tabRefs.current.set(id, node);
                  else tabRefs.current.delete(id);
                }}
                type="button"
                role="tab"
                id={`user-tab-${id}`}
                aria-selected={selected}
                aria-controls={`user-panel-${id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(id)}
                onKeyDown={onTabKeyDown}
                className={`-mb-px inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[14px] ${
                  selected
                    ? 'border-[#ffc90a] font-bold text-[#18181b]'
                    : 'border-transparent font-medium text-slate-500 hover:text-[#18181b]'
                }`}
              >
                <Icon className="size-4" aria-hidden />
                {TAB_LABELS[id]}
              </button>
            );
          })}
        </div>

        {visited.map((id) => (
          <div
            key={id}
            role="tabpanel"
            id={`user-panel-${id}`}
            aria-labelledby={`user-tab-${id}`}
            hidden={id !== tab}
            className="min-w-0"
          >
            {id === 'overview' ? (
              <OverviewTab
                user={user}
                tenantSlug={tenantSlug}
                canEdit={canUpdate}
                canReadOrganization={hasTenantAction(
                  permissions,
                  'core.organization.read',
                )}
              />
            ) : null}
            {id === 'access' ? <UserAccessEditor user={user} /> : null}
            {id === 'history' ? <HistoryTab userId={user.id} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Về danh sách. Nếu trang liền trước trong lịch sử là danh sách thì quay lại đúng trang đó (giữ nguyên bộ lọc,
 * vị trí cuộn); không thì đi tới /users như liên kết thường.
 */
function BackLink({
  className,
  label,
  icon = false,
}: {
  className: string;
  label: string;
  icon?: boolean;
}) {
  const router = useRouter();
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const nav = (
      window as unknown as {
        navigation?: {
          currentEntry?: { index: number };
          entries(): { url?: string | null }[];
        };
      }
    ).navigation;
    const index = nav?.currentEntry?.index ?? -1;
    const previous = index > 0 ? nav?.entries()[index - 1]?.url : undefined;
    if (
      previous &&
      new URL(previous).pathname.replace(/\/$/, '') === '/users'
    ) {
      e.preventDefault();
      router.back();
    }
  }
  return (
    <Link
      href="/users"
      aria-label="Về danh sách người dùng"
      className={className}
      onClick={onClick}
    >
      {icon ? <ArrowLeft className="size-3.5" aria-hidden /> : null}
      {label}
    </Link>
  );
}

function StatePanel({
  title,
  role,
  children,
}: {
  title: string;
  role: 'alert' | 'status';
  children: ReactNode;
}) {
  return (
    <UserCard className="flex max-w-xl flex-col items-start gap-1 p-6" as="div">
      <div
        role={role}
        className="flex flex-col items-start gap-1 text-[14px] text-slate-600"
      >
        <h1 className="m-0 text-[18px] font-bold text-[#18181b]">{title}</h1>
        {children}
      </div>
    </UserCard>
  );
}

function DetailSkeleton() {
  return (
    <div
      className="flex flex-col gap-4"
      aria-busy="true"
      aria-label="Đang tải người dùng"
    >
      <div className="h-4 w-40 animate-pulse rounded-md bg-slate-100" />
      <div className="h-32 animate-pulse rounded-[10px] bg-slate-100" />
      <div className="h-10 w-full animate-pulse rounded-md bg-slate-100" />
      <div className="h-64 animate-pulse rounded-[10px] bg-slate-100" />
    </div>
  );
}
