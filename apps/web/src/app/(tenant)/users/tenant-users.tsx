'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Users, Pencil, ShieldCheck, Trash2, Network, Search, UserPen } from 'lucide-react';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  hasTenantAction,
  type TenantRole,
  type TenantPermission,
} from '@enterprise-platform/contracts-identity';
import {
  authorizationRequest,
  searchText,
} from '../authorization/authorization-client';
import { UserRoleEditor } from '../authorization/user-role-editor';
import { CollapsibleGroup } from '../collapsible-group';
import { panelButton, SidePanel } from '../side-panel';
import type { TenantCoreUser } from './page';
import { EmployeeProfilePanel } from './employee-profile-panel';
import {
  buildTenantEmail,
  sanitizeTenantEmailLocal,
} from './tenant-user-email';

interface TenantUsersProps {
  readonly initialError?: string;
  readonly initialUsers: TenantCoreUser[];
  readonly tenantSlug: string;
  readonly permissions?: readonly string[];
  readonly isAdmin?: boolean;
}
type FormState = {
  id?: string;
  fullName: string;
  email: string;
  password: string;
  status: 'active' | 'disabled';
};

const PAGE_SIZE = 15;
const ROW =
  'grid grid-cols-[minmax(200px,1fr)_minmax(160px,0.8fr)_292px] items-center gap-x-3 border-t border-[#f1f3f6] px-5';
const ACTION =
  'flex h-[30px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-[#eef0f3] bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-[#f4f6f9] disabled:cursor-not-allowed disabled:opacity-60';
const FIELD =
  'h-9 w-full rounded-[7px] border border-[#e5e7eb] bg-white px-2.5 text-[13px] text-[#18181b] outline-none focus:border-[#ffc90a]';

function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return `${words[0][0]}${words.length > 1 ? words[words.length - 1][0] : ''}`.toUpperCase();
}

export function TenantUsers({
  initialError,
  initialUsers,
  tenantSlug,
  permissions = [],
  isAdmin = false,
}: TenantUsersProps) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [query, setQuery] = useState('');
  const [profileUser, setProfileUser] = useState<TenantCoreUser>();
  const [status, setStatus] = useState('all');
  const [roleId, setRoleId] = useState('all');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? '');
  const [assignment, setAssignment] = useState<{
    user: TenantCoreUser;
    roles: TenantRole[];
    permissions: TenantPermission[];
  }>();
  const canCreate = hasTenantAction(permissions, 'core.users.create');
  const canUpdate = hasTenantAction(permissions, 'core.users.update');
  const canDelete = hasTenantAction(permissions, 'core.users.delete');
  const roleOptions = [
    ...new Map(
      users
        .flatMap((u) => u.roles ?? [])
        .map((r) => [r.id, { value: r.id, label: r.name }]),
    ).values(),
  ];
  const filtered = users.filter(
    (u) =>
      searchText(u.fullName + ' ' + u.email).includes(searchText(query)) &&
      (status === 'all' || status === u.status) &&
      (roleId === 'all' || u.roleIds?.includes(roleId)),
  );
  // Trang gồm người đang hoạt động trước, vô hiệu hóa sau, để mỗi trang chia
  // thành nhiều nhất hai nhóm theo trạng thái.
  const ordered = [
    ...filtered.filter((u) => u.status === 'active'),
    ...filtered.filter((u) => u.status !== 'active'),
  ];
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const pageRows = ordered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const groups = [
    {
      id: 'active',
      title: 'Hoạt động',
      tone: 'bg-emerald-100 text-emerald-800',
      total: filtered.filter((u) => u.status === 'active').length,
      rows: pageRows.filter((u) => u.status === 'active'),
    },
    {
      id: 'disabled',
      title: 'Vô hiệu hóa',
      tone: 'bg-red-100 text-red-700',
      total: filtered.filter((u) => u.status !== 'active').length,
      rows: pageRows.filter((u) => u.status !== 'active'),
    },
  ].filter((group) => group.rows.length > 0);
  // Người đang được thao tác trong khung bên phải, để tô dòng tương ứng.
  const targetId = form?.id ?? assignment?.user.id ?? profileUser?.id;

  async function reload() {
    const data = await authorizationRequest<{ users: TenantCoreUser[] }>(
      'tenant-users',
    );
    setUsers(data.users);
    router.refresh();
  }
  function closePanels() {
    setForm(undefined);
    setAssignment(undefined);
    setProfileUser(undefined);
  }
  function open(user?: TenantCoreUser) {
    setError('');
    closePanels();
    setForm(
      user
        ? {
            id: user.id,
            fullName: user.fullName,
            email: sanitizeTenantEmailLocal(user.email),
            password: '',
            status: user.status,
          }
        : { fullName: '', email: '', password: '', status: 'active' },
    );
  }
  function openProfile(user: TenantCoreUser) {
    closePanels();
    setProfileUser(user);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setError('');
    try {
      await authorizationRequest(
        'tenant-users' + (form.id ? '/' + form.id : ''),
        form.id ? 'PATCH' : 'POST',
        {
          fullName: form.fullName,
          email: buildTenantEmail(form.email, tenantSlug),
          password: form.password || undefined,
          ...(form.id ? { status: form.status } : {}),
        },
      );
      setForm(undefined);
      await reload();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Không thể lưu người dùng.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(user: TenantCoreUser) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await authorizationRequest('tenant-users/' + user.id, 'DELETE');
      if (targetId === user.id) closePanels();
      await reload();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Không thể xóa người dùng.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function assign(user: TenantCoreUser) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const [r, p, u] = await Promise.all([
        authorizationRequest<{ roles: TenantRole[] }>('tenant-roles'),
        authorizationRequest<{ permissions: TenantPermission[] }>(
          'tenant-permissions',
        ),
        authorizationRequest<{ roleIds: string[] }>(
          'tenant-users/' + user.id + '/roles',
        ),
      ]);
      closePanels();
      setAssignment({
        user: { ...user, roleIds: u.roleIds },
        roles: r.roles,
        permissions: p.permissions,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Không thể tải vai trò.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-4 text-[14px] text-[#18181b]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-[1_1_360px]">
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.3px]">Người dùng</h1>
          <p className="mt-1 text-[13.5px] text-slate-600">
            Quản lý tài khoản và vai trò trong doanh nghiệp.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            disabled={busy}
            className="flex h-[38px] cursor-pointer items-center gap-1.5 rounded-lg bg-[#ffc90a] px-3.5 text-[13px] font-bold text-[#18181b] hover:bg-[#ffd84d] disabled:opacity-60"
            onClick={() => open()}
          >
            <Plus className="size-4" />
            Thêm người dùng
          </button>
        )}
      </div>

      <section
        aria-label="Tổng quan người dùng"
        className="grid grid-cols-3 overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white"
      >
        {(
          [
            ['Tổng số', users.length, ''],
            ['Hoạt động', users.filter((u) => u.status === 'active').length, 'text-emerald-700'],
            ['Vô hiệu hóa', users.filter((u) => u.status === 'disabled').length, 'text-red-700'],
          ] as const
        ).map(([label, count, tone], index) => (
          <div
            key={label}
            className={`flex flex-col px-5 py-3.5 ${index < 2 ? 'border-r border-[#f1f3f6]' : ''}`}
          >
            <span className="text-xs text-slate-500">{label}</span>
            <b className={`text-[22px] leading-tight tabular-nums ${tone}`}>{count}</b>
          </div>
        ))}
      </section>

      {error && !form && (
        <p
          role="alert"
          className="m-0 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex h-[38px] min-w-0 flex-[1_1_240px] items-center gap-2 rounded-lg border border-[#eef0f3] bg-white px-3 text-slate-500 focus-within:border-[#ffc90a]">
              <Search className="size-4 shrink-0" aria-hidden />
              <input
                type="search"
                aria-label="Tìm người dùng"
                placeholder="Tìm theo tên hoặc email…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[#18181b] outline-none placeholder:text-slate-400"
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
                onChange={(v) => {
                  setStatus(v);
                  setPage(1);
                }}
              />
            </div>
            <div className="w-full sm:w-[240px]">
              <SearchableSelect
                clearable={false}
                value={roleId}
                options={[
                  { value: 'all', label: 'Tất cả vai trò' },
                  ...roleOptions,
                ]}
                onChange={(v) => {
                  setRoleId(v);
                  setPage(1);
                }}
              />
            </div>
          </div>

          {groups.map((group) => (
            <CollapsibleGroup
              count={group.total}
              defaultOpen={group.id === 'active' || status === 'disabled'}
              icon={<Users className="size-4" />}
              // Đổi bộ lọc trạng thái thì dựng lại nhóm để áp lại trạng thái mở/đóng mặc định.
              key={`${group.id}-${status}`}
              title={group.title}
              tone={group.tone}
            >
              <div className="overflow-x-auto">
                <div className="min-w-[700px]">
                  <div className={`${ROW} py-2 text-[11px] font-semibold tracking-[0.4px] text-slate-500`}>
                    <span>NGƯỜI DÙNG</span>
                    <span>VAI TRÒ</span>
                    <span className="text-right">THAO TÁC</span>
                  </div>
                  {group.rows.map((user) => {
                    const isTarget = targetId === user.id;
                    return (
                      <div
                        key={user.id}
                        className={`${ROW} py-[11px] ${isTarget ? 'bg-[#fffbeb] shadow-[inset_3px_0_0_#ffc90a]' : 'bg-white hover:bg-[#f4f6f9]/60'}`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="relative shrink-0">
                            <span
                              aria-hidden
                              className="grid size-[34px] place-items-center rounded-full bg-[#f1f3f6] text-xs font-bold text-slate-700"
                            >
                              {initialsOf(user.fullName)}
                            </span>
                            <span
                              aria-hidden
                              className={`absolute -bottom-px -right-px size-2.5 rounded-full border-2 border-white ${user.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`}
                            />
                          </span>
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-semibold">{user.fullName}</span>
                            <span className="truncate text-xs text-slate-500">{user.email}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {user.roles?.map((r) => (
                            <span
                              key={r.id}
                              className="rounded-md border border-blue-100 bg-blue-50 px-2 py-px text-xs text-blue-700"
                            >
                              {r.name}
                            </span>
                          ))}
                          {!user.roles?.length && (
                            <span className="text-xs text-slate-400">Chưa gán vai trò</span>
                          )}
                        </div>
                        <div className="flex justify-end gap-1.5">
                          {hasTenantAction(permissions, 'core.organization.read') && (
                            <button
                              type="button"
                              className={ACTION}
                              onClick={() => openProfile(user)}
                              title="Hồ sơ nhân sự: chức danh và quản lý trực tiếp"
                            >
                              <Network className="size-3.5" />
                              Hồ sơ tổ chức
                            </button>
                          )}
                          {canUpdate &&
                            (isAdmin || user.systemRole !== 'tenant-admin') && (
                              <button
                                type="button"
                                className={ACTION}
                                disabled={busy}
                                onClick={() => open(user)}
                              >
                                <Pencil className="size-3.5" />
                                Sửa
                              </button>
                            )}
                          {isAdmin && (
                            <button
                              type="button"
                              className={ACTION}
                              disabled={busy}
                              onClick={() => void assign(user)}
                            >
                              <ShieldCheck className="size-3.5" />
                              Vai trò
                            </button>
                          )}
                          {canDelete &&
                            (isAdmin || user.systemRole !== 'tenant-admin') && (
                              <Popconfirm
                                title="Xóa người dùng?"
                                description={
                                  'Xóa tài khoản ' +
                                  user.fullName +
                                  ' và thu hồi phiên đăng nhập.'
                                }
                                okText="Xóa"
                                cancelText="Hủy"
                                okType="danger"
                                onConfirm={() => void remove(user)}
                              >
                                <button
                                  type="button"
                                  disabled={busy}
                                  className="grid size-[30px] cursor-pointer place-items-center rounded-[7px] border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  aria-label={'Xóa ' + user.fullName}
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </Popconfirm>
                            )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CollapsibleGroup>
          ))}

          {!filtered.length && (
            <p className="m-0 rounded-[14px] border border-dashed border-slate-200 bg-white p-10 text-center text-slate-500">
              Không tìm thấy người dùng.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-slate-500">
            <span>
              <b className="text-[#18181b]">{filtered.length}</b> / {users.length} người dùng
            </span>
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                className={ACTION}
                disabled={current <= 1}
                onClick={() => setPage(current - 1)}
              >
                Trước
              </button>
              <span className="tabular-nums">
                {current}/{pages}
              </span>
              <button
                type="button"
                className={ACTION}
                disabled={current >= pages}
                onClick={() => setPage(current + 1)}
              >
                Sau
              </button>
            </span>
          </div>
        </div>

        {form ? (
          <SidePanel
            icon={<UserPen className="size-4" />}
            title={form.id ? 'Cập nhật người dùng' : 'Thêm người dùng'}
            subtitle={
              form.id
                ? 'Để trống mật khẩu nếu không thay đổi. Gán vai trò bằng thao tác riêng.'
                : 'Tài khoản mới chưa có quyền. Quản trị viên gán vai trò sau khi tạo.'
            }
            revealKey={form.id ?? 'new'}
            onClose={() => {
              if (!busy) setForm(undefined);
            }}
            footer={
              <>
                <button
                  type="button"
                  className={panelButton.secondary}
                  disabled={busy}
                  onClick={() => setForm(undefined)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  form="tenant-user-form"
                  className={panelButton.primary}
                  disabled={busy}
                >
                  {busy ? 'Đang lưu…' : 'Lưu người dùng'}
                </button>
              </>
            }
          >
            <form id="tenant-user-form" onSubmit={save}>
              <fieldset disabled={busy} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-semibold text-slate-700">Họ và tên</span>
                  <input
                    required
                    maxLength={180}
                    className={FIELD}
                    value={form.fullName}
                    onChange={(e) =>
                      setForm({ ...form, fullName: e.target.value })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-semibold text-slate-700">Email</span>
                  <span className="flex items-center overflow-hidden rounded-[7px] border border-[#e5e7eb] focus-within:border-[#ffc90a]">
                    <input
                      required
                      autoComplete="username"
                      className="h-[34px] min-w-0 flex-1 px-2.5 text-[13px] outline-none"
                      value={form.email}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          email: sanitizeTenantEmailLocal(e.target.value),
                        })
                      }
                    />
                    <span className="flex h-[34px] items-center border-l border-[#e5e7eb] bg-[#f6f7f9] px-2.5 text-slate-500">
                      @{tenantSlug}.com
                    </span>
                  </span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-semibold text-slate-700">
                    {form.id ? 'Mật khẩu mới' : 'Mật khẩu'}
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required={!form.id}
                    minLength={6}
                    maxLength={128}
                    className={FIELD}
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                  />
                  <span className="text-[11.5px] text-slate-500">Từ 6 đến 128 ký tự.</span>
                </label>
                {form.id && (
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold text-slate-700">Trạng thái</span>
                    <SearchableSelect
                      clearable={false}
                      disabled={busy}
                      value={form.status}
                      options={[
                        { value: 'active', label: 'Hoạt động' },
                        { value: 'disabled', label: 'Vô hiệu hóa' },
                      ]}
                      onChange={(v) =>
                        setForm({ ...form, status: v as FormState['status'] })
                      }
                    />
                  </div>
                )}
                {error && (
                  <p role="alert" className="m-0 text-[13px] text-red-700">
                    {error}
                  </p>
                )}
              </fieldset>
            </form>
          </SidePanel>
        ) : null}

        {profileUser ? (
          <EmployeeProfilePanel user={profileUser} onClose={() => setProfileUser(undefined)} />
        ) : null}

        {assignment ? (
          <UserRoleEditor
            key={assignment.user.id}
            {...assignment}
            onClose={() => setAssignment(undefined)}
            onSaved={reload}
          />
        ) : null}
      </div>
    </div>
  );
}
