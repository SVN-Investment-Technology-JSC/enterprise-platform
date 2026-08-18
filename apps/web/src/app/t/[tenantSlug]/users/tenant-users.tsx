'use client';

import {
  ChevronRight,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { TenantCoreUser } from './page';

type FormState = {
  fullName: string;
  email: string;
  password: string;
  systemRole: TenantCoreUser['systemRole'];
  status: TenantCoreUser['status'];
};

const blankForm: FormState = {
  fullName: '',
  email: '',
  password: '',
  systemRole: 'tenant-user',
  status: 'active',
};
const dateFormatter = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' });

function csrfToken() {
  const value = document.cookie
    .split('; ')
    .find((item) => item.startsWith('ep_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
  return value ? decodeURIComponent(value) : '';
}

function errorMessage(payload: { message?: string | string[] }) {
  return Array.isArray(payload.message)
    ? payload.message.join(' ')
    : (payload.message ?? 'Không thể thực hiện thao tác.');
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}

export function TenantUsers({
  initialError,
  initialUsers,
  tenantSlug,
}: {
  initialError?: string;
  initialUsers: TenantCoreUser[];
  tenantSlug: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | TenantCoreUser['status']
  >('all');
  const [roleFilter, setRoleFilter] = useState<
    'all' | TenantCoreUser['systemRole']
  >('all');
  const [editing, setEditing] = useState<TenantCoreUser>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [menuUserId, setMenuUserId] = useState<string>();
  const [form, setForm] = useState<FormState>(blankForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery =
        !needle ||
        `${user.fullName} ${user.email}`.toLowerCase().includes(needle);
      const matchesStatus =
        statusFilter === 'all' || user.status === statusFilter;
      const matchesRole =
        roleFilter === 'all' || user.systemRole === roleFilter;
      return matchesQuery && matchesStatus && matchesRole;
    });
  }, [query, roleFilter, statusFilter, users]);

  function openEditor(user?: TenantCoreUser) {
    setEditing(user);
    setEditorOpen(true);
    setMenuUserId(undefined);
    setError(undefined);
    setForm(
      user
        ? {
            fullName: user.fullName,
            email: user.email,
            password: '',
            systemRole: user.systemRole,
            status: user.status,
          }
        : blankForm,
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(
        editing
          ? `/api/platform/v1/tenant-users/${editing.id}`
          : '/api/platform/v1/tenant-users',
        {
          method: editing ? 'PATCH' : 'POST',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken(),
          },
          body: JSON.stringify(
            editing && !form.password ? { ...form, password: undefined } : form,
          ),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        user?: TenantCoreUser;
        message?: string | string[];
      };
      if (!response.ok || !payload.user) throw new Error(errorMessage(payload));

      const savedUser = payload.user;
      setUsers((current) =>
        editing
          ? current.map((user) => (user.id === savedUser.id ? savedUser : user))
          : [savedUser, ...current],
      );
      setEditorOpen(false);
      setEditing(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Không thể lưu người dùng.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(user: TenantCoreUser) {
    setMenuUserId(undefined);
    setError(undefined);
    const status = user.status === 'active' ? 'disabled' : 'active';
    const response = await fetch(`/api/platform/v1/tenant-users/${user.id}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken(),
      },
      body: JSON.stringify({ status }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      user?: TenantCoreUser;
      message?: string | string[];
    };
    if (!response.ok || !payload.user) {
      setError(errorMessage(payload));
      return;
    }
    setUsers((current) =>
      current.map((item) =>
        item.id === payload.user?.id ? payload.user : item,
      ),
    );
  }

  async function removeUser(user: TenantCoreUser) {
    if (!window.confirm(`Xóa người dùng ${user.fullName}?`)) return;
    setMenuUserId(undefined);
    setError(undefined);
    const response = await fetch(`/api/platform/v1/tenant-users/${user.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken() },
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string | string[];
      };
      setError(errorMessage(payload));
      return;
    }
    setUsers((current) => current.filter((item) => item.id !== user.id));
  }

  const activeCount = users.filter((user) => user.status === 'active').length;
  const disabledCount = users.filter(
    (user) => user.status === 'disabled',
  ).length;

  return (
    <>
      <main className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
        <div className="mb-6">
          <nav
            className="mb-2 flex items-center text-sm text-slate-500"
            aria-label="Breadcrumb"
          >
            <Link className="hover:text-[#091426]" href={`/t/${tenantSlug}`}>
              Tenant Portal
            </Link>
            <ChevronRight className="mx-1 size-4" />
            <span>Quản trị</span>
            <ChevronRight className="mx-1 size-4" />
            <span className="font-medium text-[#0d1c2d]">Người dùng</span>
          </nav>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Người dùng</h1>
              <p className="mt-1 text-sm text-slate-500">
                Quản lý người dùng trong dữ liệu lõi của tenant.
              </p>
            </div>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => openEditor()}
            >
              <Plus />
              Thêm người dùng
            </Button>
          </div>
        </div>

        <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard label="Tổng số" value={users.length} />
          <MetricCard
            accent="text-emerald-700"
            label="Hoạt động"
            value={activeCount}
          />
          <MetricCard
            accent="text-red-700"
            label="Vô hiệu hóa"
            value={disabledCount}
          />
        </section>

        {error ? (
          <p
            className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <section className="overflow-visible rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 bg-[#f8f9ff] p-4 md:flex-row md:items-center">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="bg-white pl-9"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Tìm kiếm theo tên hoặc email..."
                value={query}
              />
            </div>
            <div className="flex gap-2 overflow-x-auto">
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                onChange={(event) =>
                  setStatusFilter(
                    event.currentTarget.value as typeof statusFilter,
                  )
                }
                value={statusFilter}
              >
                <option value="all">Trạng thái</option>
                <option value="active">Hoạt động</option>
                <option value="disabled">Vô hiệu hóa</option>
              </select>
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                onChange={(event) =>
                  setRoleFilter(event.currentTarget.value as typeof roleFilter)
                }
                value={roleFilter}
              >
                <option value="all">Vai trò</option>
                <option value="tenant-admin">Tenant Admin</option>
                <option value="tenant-user">Người dùng</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] border-collapse text-left text-sm">
              <thead className="border-b border-slate-200 bg-[#f8f9ff] text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="w-[250px] px-4 py-3 font-bold">Người dùng</th>
                  <th className="px-4 py-3 font-bold">Email</th>
                  <th className="px-4 py-3 font-bold">Vai trò</th>
                  <th className="px-4 py-3 font-bold">Trạng thái</th>
                  <th className="px-4 py-3 font-bold">Ngày tạo</th>
                  <th className="w-20 px-4 py-3 text-right font-bold">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {filteredUsers.map((user) => (
                  <tr
                    className="transition-colors hover:bg-slate-50"
                    key={user.id}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                          {initials(user.fullName)}
                        </span>
                        <span className="font-medium text-[#0d1c2d]">
                          {user.fullName}
                        </span>
                      </div>
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-3 text-slate-500">
                      {user.email}
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={user.systemRole} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {dateFormatter.format(new Date(user.createdAt))}
                    </td>
                    <td className="relative px-4 py-3 text-right">
                      <Button
                        aria-label={`Thao tác với ${user.fullName}`}
                        className="text-slate-500 hover:bg-slate-100 hover:text-[#091426]"
                        onClick={() =>
                          setMenuUserId((current) =>
                            current === user.id ? undefined : user.id,
                          )
                        }
                        size="icon"
                        variant="ghost"
                      >
                        <MoreVertical className="size-5" />
                      </Button>
                      {menuUserId === user.id ? (
                        <div className="absolute right-8 top-10 z-20 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg">
                          <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100"
                            onClick={() => openEditor(user)}
                            type="button"
                          >
                            <Pencil className="size-4 text-slate-500" />
                            Chỉnh sửa
                          </button>
                          <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-100"
                            onClick={() => void updateStatus(user)}
                            type="button"
                          >
                            <Users className="size-4 text-slate-500" />
                            {user.status === 'active'
                              ? 'Vô hiệu hóa'
                              : 'Kích hoạt'}
                          </button>
                          <div className="my-1 h-px bg-slate-200" />
                          <button
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                            onClick={() => void removeUser(user)}
                            type="button"
                          >
                            <Trash2 className="size-4" />
                            Xóa người dùng
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td
                      className="px-6 py-12 text-center text-slate-500"
                      colSpan={6}
                    >
                      Không tìm thấy người dùng.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 bg-[#f8f9ff] p-4 text-sm text-slate-500">
            <span>
              Hiển thị {filteredUsers.length} trên {users.length} người dùng
            </span>
            <span>Trang 1</span>
          </div>
        </section>
      </main>
      <Sheet
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditing(undefined);
        }}
        open={editorOpen}
      >
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {editing ? 'Cập nhật người dùng' : 'Thêm người dùng'}
            </SheetTitle>
            <SheetDescription>
              {editing
                ? 'Để trống mật khẩu nếu không muốn thay đổi.'
                : 'Mật khẩu phải có ít nhất 12 ký tự.'}
            </SheetDescription>
          </SheetHeader>
          <form className="space-y-4 p-4" onSubmit={submit}>
            <Field label="Họ và tên">
              <Input
                onChange={(event) =>
                  setForm({ ...form, fullName: event.currentTarget.value })
                }
                required
                value={form.fullName}
              />
            </Field>
            <Field label="Email">
              <Input
                onChange={(event) =>
                  setForm({ ...form, email: event.currentTarget.value })
                }
                required
                type="email"
                value={form.email}
              />
            </Field>
            <Field label={editing ? 'Mật khẩu mới' : 'Mật khẩu'}>
              <Input
                minLength={editing ? undefined : 12}
                onChange={(event) =>
                  setForm({ ...form, password: event.currentTarget.value })
                }
                required={!editing}
                type="password"
                value={form.password}
              />
            </Field>
            <Field label="Vai trò">
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) =>
                  setForm({
                    ...form,
                    systemRole: event.currentTarget
                      .value as TenantCoreUser['systemRole'],
                  })
                }
                value={form.systemRole}
              >
                <option value="tenant-user">Người dùng</option>
                <option value="tenant-admin">Tenant Admin</option>
              </select>
            </Field>
            <Field label="Trạng thái">
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) =>
                  setForm({
                    ...form,
                    status: event.currentTarget
                      .value as TenantCoreUser['status'],
                  })
                }
                value={form.status}
              >
                <option value="active">Hoạt động</option>
                <option value="disabled">Vô hiệu hóa</option>
              </select>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                onClick={() => {
                  setEditorOpen(false);
                  setEditing(undefined);
                }}
                type="button"
                variant="outline"
              >
                Hủy
              </Button>
              <Button
                className="bg-[#091426] hover:bg-[#1e293b]"
                disabled={busy}
                type="submit"
              >
                {busy ? 'Đang lưu…' : 'Lưu người dùng'}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

function MetricCard({
  accent = 'text-[#0d1c2d]',
  label,
  value,
}: {
  accent?: string;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-[32px] font-bold leading-tight ${accent}`}>
        {value}
      </p>
    </div>
  );
}

function RoleBadge({ role }: { role: TenantCoreUser['systemRole'] }) {
  const admin = role === 'tenant-admin';
  return (
    <span
      className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${admin ? 'border-purple-200 bg-purple-100 text-purple-800' : 'border-slate-200 bg-slate-100 text-slate-700'}`}
    >
      {admin ? 'Tenant Admin' : 'Người dùng'}
    </span>
  );
}

function StatusBadge({ status }: { status: TenantCoreUser['status'] }) {
  const active = status === 'active';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${active ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}
    >
      <span
        className={`size-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-red-500'}`}
      />
      {active ? 'Hoạt động' : 'Vô hiệu hóa'}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>{label}</span>
      {children}
    </label>
  );
}
