'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Users, Pencil, ShieldCheck, Trash2, Network } from 'lucide-react';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import {
  hasTenantAction,
  type TenantRole,
  type TenantPermission,
} from '@enterprise-platform/contracts-identity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  authorizationRequest,
  searchText,
} from '../authorization/authorization-client';
import { UserRoleEditor } from '../authorization/user-role-editor';
import type { TenantCoreUser } from './page';
import { EmployeeProfileSheet } from './employee-profile-sheet';
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
  const pages = Math.max(1, Math.ceil(filtered.length / 15));
  const current = Math.min(page, pages);
  async function reload() {
    const data = await authorizationRequest<{ users: TenantCoreUser[] }>(
      'tenant-users',
    );
    setUsers(data.users);
    router.refresh();
  }
  function open(user?: TenantCoreUser) {
    setError('');
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
    <>
      <main className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Users className="size-6 text-blue-600" />
              Người dùng
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Quản lý tài khoản và vai trò trong doanh nghiệp.
            </p>
          </div>
          {canCreate && (
            <Button
              disabled={busy}
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => open()}
            >
              <Plus className="size-4" />
              Thêm người dùng
            </Button>
          )}
        </header>
        <div className="grid grid-cols-3 gap-3">
          {[
            ['Tổng số', users.length],
            ['Hoạt động', users.filter((u) => u.status === 'active').length],
            [
              'Vô hiệu hóa',
              users.filter((u) => u.status === 'disabled').length,
            ],
          ].map(([label, count]) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200 bg-white p-3"
            >
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-bold">{count}</p>
            </div>
          ))}
        </div>
        {error && !form && (
          <p
            role="alert"
            className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid gap-2 border-b p-3 md:grid-cols-[1fr_240px_240px]">
            <Input
              aria-label="Tìm người dùng"
              placeholder="Tìm theo tên hoặc email…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
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
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
                <tr>
                  {[
                    'Người dùng',
                    'Email',
                    'Vai trò',
                    'Trạng thái',
                    'Thao tác',
                  ].map((label) => (
                    <th key={label} className="p-3">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered
                  .slice((current - 1) * 15, current * 15)
                  .map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50">
                      <td className="p-3 font-semibold">{user.fullName}</td>
                      <td className="p-3 text-slate-500">{user.email}</td>
                      <td className="max-w-64 p-3">
                        <div className="flex flex-wrap gap-1">
                          {user.roles?.map((r) => (
                            <span
                              key={r.id}
                              className="rounded border bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                            >
                              {r.name}
                            </span>
                          ))}
                          {!user.roles?.length && (
                            <span className="text-xs text-slate-400">
                              Chưa gán vai trò
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <span
                          className={
                            'rounded-full px-2 py-1 text-xs ' +
                            (user.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-red-50 text-red-700')
                          }
                        >
                          {user.status === 'active'
                            ? 'Hoạt động'
                            : 'Vô hiệu hóa'}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1.5">
                          {hasTenantAction(permissions, 'core.organization.read') && <Button size="sm" variant="outline" onClick={() => setProfileUser(user)} title="Hồ sơ nhân sự: chức danh và quản lý trực tiếp"><Network className="size-3.5" />Hồ sơ tổ chức</Button>}
                          {canUpdate &&
                            (isAdmin || user.systemRole !== 'tenant-admin') && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => open(user)}
                              >
                                <Pencil className="size-3.5" />
                                Sửa
                              </Button>
                            )}
                          {isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void assign(user)}
                            >
                              <ShieldCheck className="size-3.5" />
                              Vai trò
                            </Button>
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
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  className="text-red-600"
                                  aria-label={'Xóa ' + user.fullName}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </Popconfirm>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                {!filtered.length && (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-slate-500">
                      Không tìm thấy người dùng.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <footer className="flex items-center justify-between border-t bg-slate-50 p-3 text-xs text-slate-500">
            <span>
              {filtered.length} / {users.length} người dùng
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={current <= 1}
                onClick={() => setPage(current - 1)}
              >
                Trước
              </Button>
              {current}/{pages}
              <Button
                size="sm"
                variant="outline"
                disabled={current >= pages}
                onClick={() => setPage(current + 1)}
              >
                Sau
              </Button>
            </div>
          </footer>
        </section>
      </main>
      <Dialog
        open={!!form}
        onOpenChange={(v) => {
          if (!v && !busy) setForm(undefined);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto p-6">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? 'Cập nhật' : 'Thêm'} người dùng
            </DialogTitle>
            <DialogDescription>
              {form?.id
                ? 'Để trống mật khẩu nếu không thay đổi. Gán vai trò bằng thao tác riêng.'
                : 'Tài khoản mới chưa có quyền. Quản trị viên gán vai trò sau khi tạo.'}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={save} className="mt-4 space-y-4">
              <fieldset disabled={busy} className="space-y-4">
                <label className="grid gap-1 text-sm font-medium">
                  Họ và tên
                  <Input
                    required
                    maxLength={180}
                    value={form.fullName}
                    onChange={(e) =>
                      setForm({ ...form, fullName: e.target.value })
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Email
                  <div className="flex items-center gap-2">
                    <Input
                      required
                      autoComplete="username"
                      value={form.email}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          email: sanitizeTenantEmailLocal(e.target.value),
                        })
                      }
                    />
                    <span className="text-slate-500">@{tenantSlug}.com</span>
                  </div>
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  {form.id ? 'Mật khẩu mới' : 'Mật khẩu'}
                  <Input
                    type="password"
                    autoComplete="new-password"
                    required={!form.id}
                    minLength={12}
                    maxLength={128}
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                  />
                  <span className="text-xs text-slate-500">
                    Từ 12 đến 128 ký tự.
                  </span>
                </label>
                {form.id && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Trạng thái</p>
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
                  <p role="alert" className="text-sm text-red-700">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-2 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setForm(undefined)}
                  >
                    Hủy
                  </Button>
                  <Button
                    type="submit"
                    className="bg-blue-600 text-white hover:bg-blue-700"
                  >
                    {busy ? 'Đang lưu…' : 'Lưu người dùng'}
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <EmployeeProfileSheet user={profileUser} onClose={() => setProfileUser(undefined)} />
      {assignment && (
        <UserRoleEditor
          key={assignment.user.id}
          {...assignment}
          onClose={() => setAssignment(undefined)}
          onSaved={reload}
        />
      )}
    </>
  );
}
