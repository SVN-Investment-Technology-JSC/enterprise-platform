'use client';

import type {
  CreateTenantRequest,
  CreateTenantResponse,
  TenantSummary,
} from '@enterprise-platform/contracts-tenancy';
import {
  CircleCheck,
  Database,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface TenantManagementProps {
  initialTenants: readonly TenantSummary[];
}
interface ApiErrorPayload {
  message?: string | string[];
}

function csrfToken(): string {
  const encoded = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('ep_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
  return encoded ? decodeURIComponent(encoded) : '';
}
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function errorMessage(payload: ApiErrorPayload, fallback: string): string {
  return Array.isArray(payload.message)
    ? payload.message.join(' ')
    : (payload.message ?? fallback);
}
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : isoDate;
}
const resetExpiryFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export function TenantManagement({ initialTenants }: TenantManagementProps) {
  const [tenants, setTenants] = useState([...initialTenants]);
  const [showCreate, setShowCreate] = useState(false);
  const [resetLink, setResetLink] = useState<{ url: string; expiresAt: string }>();
  const [resettingId, setResettingId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState<string>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'disabled'
  >('all');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [adminDisplayName, setAdminDisplayName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [databaseName, setDatabaseName] = useState('');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('55436');
  const [secretRef, setSecretRef] = useState('');
  const [ssl, setSsl] = useState(false);

  const counts = useMemo(
    () => ({
      total: tenants.length,
      active: tenants.filter((tenant) => tenant.status === 'active').length,
      disabled: tenants.filter((tenant) => tenant.status === 'disabled').length,
      configuredDatabases: tenants.filter((tenant) => tenant.database).length,
      uniqueModules: new Set(
        tenants.flatMap((tenant) => tenant.modules.map((module) => module.key)),
      ).size,
    }),
    [tenants],
  );
  const filteredTenants = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('vi');
    return tenants.filter((tenant) => {
      const searchTarget = [
        tenant.name,
        tenant.slug,
        tenant.admin?.email,
        tenant.database?.databaseName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('vi');
      return (
        (statusFilter === 'all' || tenant.status === statusFilter) &&
        (!needle || searchTarget.includes(needle))
      );
    });
  }, [query, statusFilter, tenants]);
  const displayedTenants = useMemo(
    () =>
      filteredTenants.map((tenant) => ({
        tenant,
        createdAtLabel: formatDate(tenant.createdAt),
      })),
    [filteredTenants],
  );

  function updateName(value: string) {
    setName(value);
    const nextSlug = slugify(value);
    setSlug(nextSlug);
    setDatabaseName(nextSlug.replaceAll('-', '_'));
    setSecretRef(
      nextSlug
        ? `TENANT_${nextSlug.replaceAll('-', '_').toUpperCase()}_DATABASE_URL`
        : '',
    );
  }
  function resetForm() {
    setName('');
    setSlug('');
    setAdminDisplayName('');
    setAdminEmail('');
    setInitialPassword('');
    setDatabaseName('');
    setHost('localhost');
    setPort('55436');
    setSecretRef('');
    setSsl(false);
  }
  function closeCreate() {
    setShowCreate(false);
    resetForm();
  }

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setSuccess(undefined);
    const input: CreateTenantRequest = {
      name,
      slug,
      admin: {
        displayName: adminDisplayName,
        email: adminEmail,
        initialPassword,
      },
      database: { databaseName, host, port: Number(port), secretRef, ssl },
    };
    try {
      const response = await fetch('/api/platform/v1/tenants', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => ({}))) as ApiErrorPayload;
        throw new Error(errorMessage(payload, 'Không thể tạo tenant.'));
      }
      const payload = (await response.json()) as CreateTenantResponse;
      setTenants((current) =>
        [...current, payload.tenant].sort((left, right) =>
          left.name.localeCompare(right.name, 'vi'),
        ),
      );
      setSuccess(
        `Đã tạo ${payload.tenant.name} và tài khoản ${payload.tenant.admin?.email}.`,
      );
      closeCreate();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Không thể tạo tenant.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function toggleStatus(tenant: TenantSummary) {
    const status = tenant.status === 'active' ? 'disabled' : 'active';
    setUpdatingId(tenant.id);
    setError(undefined);
    setSuccess(undefined);
    try {
      const response = await fetch(`/api/platform/v1/tenants/${tenant.id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => ({}))) as ApiErrorPayload;
        throw new Error(errorMessage(payload, 'Không thể cập nhật tenant.'));
      }
      const payload = (await response.json()) as { tenant?: TenantSummary };
      if (!payload.tenant) throw new Error('Không thể cập nhật tenant.');
      setTenants((current) =>
        current.map((item) =>
          item.id === tenant.id ? (payload.tenant as TenantSummary) : item,
        ),
      );
      setSuccess(
        `${tenant.name} đã được ${status === 'active' ? 'kích hoạt' : 'khóa'}.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Không thể cập nhật tenant.',
      );
    } finally {
      setUpdatingId(undefined);
    }
  }
  async function createPasswordResetLink(tenant: TenantSummary) {
    setResettingId(tenant.id);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/platform/v1/tenants/${tenant.id}/admin/password-reset-link`,
        {
          method: 'POST', credentials: 'same-origin',
          headers: { 'x-csrf-token': csrfToken() },
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
        throw new Error(errorMessage(payload, 'Không thể tạo liên kết đặt lại mật khẩu.'));
      }
      setResetLink(await response.json() as { url: string; expiresAt: string });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tạo liên kết đặt lại mật khẩu.');
    } finally {
      setResettingId(undefined);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">
            Quản lý Tenant
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Quản lý doanh nghiệp, subscription, module và Dedicated Database.
          </p>
        </div>
        <Button
          className="bg-[#091426] hover:bg-[#1e293b]"
          render={<Link href="/platform/tenants/create" />}
        >
          <Plus />
          Tạo Tenant
        </Button>
      </section>
      <section
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
        aria-label="Chỉ số tenant"
      >
        <Metric label="Tổng Tenant" value={counts.total} />
        <Metric label="Đang hoạt động" value={counts.active} tone="success" />
        <Metric label="Tạm khóa" value={counts.disabled} tone="warning" />
        <Metric
          label="Database đã cấu hình"
          value={counts.configuredDatabases}
        />
        <Metric label="Module độc nhất" value={counts.uniqueModules} />
      </section>
      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          role="status"
        >
          {success}
        </p>
      ) : null}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center">
          <div className="relative w-full lg:max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-9 bg-white pl-9"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Tìm theo tên tenant, mã tenant, email hoặc database..."
              value={query}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Lọc theo trạng thái tenant"
              className="h-9 rounded-lg border bg-white px-3 text-sm outline-none focus:border-[#091426] focus:ring-2 focus:ring-slate-200"
              onChange={(event) =>
                setStatusFilter(
                  event.currentTarget.value as typeof statusFilter,
                )
              }
              value={statusFilter}
            >
              <option value="all">Trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="disabled">Tạm khóa</option>
            </select>
            <Button className="text-slate-600" size="sm" variant="ghost">
              <SlidersHorizontal />
              Bộ lọc
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Tenant</th>
                <th className="px-4 py-3 font-medium">Mã Tenant</th>
                <th className="px-4 py-3 font-medium">Modules</th>
                <th className="px-4 py-3 font-medium">Database</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-4 py-3 font-medium">Ngày tạo</th>
                <th className="px-4 py-3 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {displayedTenants.map(({ tenant, createdAtLabel }) => (
                <tr
                  className="border-b last:border-b-0 hover:bg-slate-50/70"
                  key={tenant.id}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid size-8 place-items-center rounded-md bg-slate-100 text-xs font-bold text-[#091426]">
                        {tenant.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <p className="font-medium">{tenant.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {tenant.admin?.email ?? 'Chưa có tenant admin'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {tenant.slug}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex max-w-48 flex-wrap gap-1">
                      {tenant.modules.slice(0, 3).map((module) => (
                        <Badge
                          className="bg-slate-100 text-slate-700 hover:bg-slate-100"
                          key={module.key}
                          variant="outline"
                        >
                          {module.key}
                        </Badge>
                      ))}
                      {tenant.modules.length > 3 ? (
                        <Badge variant="outline">
                          +{tenant.modules.length - 3}
                        </Badge>
                      ) : null}
                      {tenant.modules.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          Chưa cấp
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {tenant.database ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                        <CircleCheck className="size-3.5" />
                        Đã cấu hình
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                        <Database className="size-3.5" />
                        Chưa cấu hình
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={tenant.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {createdAtLabel}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        className="text-xs font-semibold text-[#091426] hover:underline"
                        href={`/platform/tenants/${tenant.id}`}
                      >
                        Entitlement
                      </Link>
                      <Button
                        disabled={!tenant.admin || resettingId === tenant.id}
                        onClick={() => createPasswordResetLink(tenant)}
                        size="xs"
                        variant="outline"
                      >
                        {resettingId === tenant.id ? 'Đang tạo…' : 'Reset mật khẩu'}
                      </Button>
                      <Button
                        disabled={updatingId === tenant.id}
                        onClick={() => toggleStatus(tenant)}
                        size="xs"
                        variant={
                          tenant.status === 'active' ? 'destructive' : 'outline'
                        }
                      >
                        {updatingId === tenant.id
                          ? 'Đang cập nhật…'
                          : tenant.status === 'active'
                            ? 'Khóa'
                            : 'Kích hoạt'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredTenants.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-12 text-center text-muted-foreground"
                    colSpan={7}
                  >
                    Không tìm thấy tenant phù hợp.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t bg-slate-50 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            Hiển thị{' '}
            <strong className="text-slate-900">{filteredTenants.length}</strong>{' '}
            trong số{' '}
            <strong className="text-slate-900">{tenants.length}</strong> tenant
          </p>
          <p>Trang 1 / 1</p>
        </div>
      </Card>
      <Sheet
        onOpenChange={(open) => {
          setShowCreate(open);
          if (!open) resetForm();
        }}
        open={showCreate}
      >
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Tạo Tenant mới</SheetTitle>
            <SheetDescription>
              Thiết lập doanh nghiệp, tenant admin và Dedicated Database.
            </SheetDescription>
          </SheetHeader>
          <form className="space-y-6 p-4" onSubmit={createTenant}>
            <FormSection
              description="Tenant được kích hoạt ngay nhưng chưa có module cho tới khi được cấp entitlement."
              title="Thông tin tenant"
            >
              <Field label="Tên tenant">
                <Input
                  onChange={(event) => updateName(event.currentTarget.value)}
                  required
                  value={name}
                />
              </Field>
              <Field label="Slug">
                <Input
                  onChange={(event) => setSlug(event.currentTarget.value)}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  required
                  value={slug}
                />
              </Field>
            </FormSection>
            <FormSection
              description="Tài khoản được tạo với role tenant-admin."
              title="Tenant Admin"
            >
              <Field label="Tên hiển thị">
                <Input
                  onChange={(event) =>
                    setAdminDisplayName(event.currentTarget.value)
                  }
                  required
                  value={adminDisplayName}
                />
              </Field>
              <Field label="Email admin">
                <Input
                  autoComplete="off"
                  onChange={(event) => setAdminEmail(event.currentTarget.value)}
                  required
                  type="email"
                  value={adminEmail}
                />
              </Field>
              <Field label="Mật khẩu khởi tạo">
                <Input
                  autoComplete="new-password"
                  minLength={12}
                  onChange={(event) =>
                    setInitialPassword(event.currentTarget.value)
                  }
                  required
                  type="password"
                  value={initialPassword}
                />
              </Field>
            </FormSection>
            <FormSection
              description="Platform chỉ lưu secret reference, không lưu connection string rõ."
              title="Dedicated Database"
            >
              <Field label="Database name">
                <Input
                  onChange={(event) =>
                    setDatabaseName(event.currentTarget.value)
                  }
                  pattern="[a-z][a-z0-9_]{0,62}"
                  required
                  value={databaseName}
                />
              </Field>
              <Field label="Secret reference">
                <Input
                  onChange={(event) => setSecretRef(event.currentTarget.value)}
                  pattern="[A-Z][A-Z0-9_]*"
                  required
                  value={secretRef}
                />
              </Field>
              <Field label="Host">
                <Input
                  onChange={(event) => setHost(event.currentTarget.value)}
                  required
                  value={host}
                />
              </Field>
              <Field label="Port">
                <Input
                  max="65535"
                  min="1"
                  onChange={(event) => setPort(event.currentTarget.value)}
                  required
                  type="number"
                  value={port}
                />
              </Field>
              <label className="col-span-full flex items-center gap-2 text-sm">
                <input
                  checked={ssl}
                  className="size-4"
                  onChange={(event) => setSsl(event.currentTarget.checked)}
                  type="checkbox"
                />
                Sử dụng SSL
              </label>
            </FormSection>
            <div className="flex justify-end gap-2">
              <Button onClick={closeCreate} type="button" variant="outline">
                Hủy
              </Button>
              <Button
                className="bg-[#091426] hover:bg-[#1e293b]"
                disabled={busy}
                type="submit"
              >
                {busy ? 'Đang tạo…' : 'Tạo tenant và admin'}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
      <Sheet open={Boolean(resetLink)} onOpenChange={(open) => !open && setResetLink(undefined)}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Liên kết đặt lại mật khẩu</SheetTitle>
            <SheetDescription>
              Liên kết này chỉ hiển thị một lần, có hiệu lực trong 1 giờ và sẽ vô hiệu hóa các liên kết trước đó.
            </SheetDescription>
          </SheetHeader>
          {resetLink ? (
            <div className="space-y-4 p-4">
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Liên kết gửi cho Tenant Admin
                <textarea className="min-h-28 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700" readOnly value={resetLink.url} />
              </label>
              <p className="text-sm text-muted-foreground">Hết hạn lúc: {resetExpiryFormatter.format(new Date(resetLink.expiresAt))}</p>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setResetLink(undefined)} variant="outline">Đóng</Button>
                <Button className="bg-[#091426] hover:bg-[#1e293b]" onClick={async () => { await navigator.clipboard.writeText(resetLink.url); setSuccess('Đã sao chép liên kết đặt lại mật khẩu.'); }}>
                  Sao chép liên kết
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'warning';
}) {
  return (
    <Card className="gap-0 border-slate-200 py-4 shadow-sm">
      <CardContent>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p
          className={
            tone === 'success'
              ? 'mt-1 text-2xl font-bold text-emerald-700'
              : tone === 'warning'
                ? 'mt-1 text-2xl font-bold text-amber-600'
                : 'mt-1 text-2xl font-bold'
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
function StatusBadge({ status }: { status: TenantSummary['status'] }) {
  return status === 'active' ? (
    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
      Đang hoạt động
    </Badge>
  ) : (
    <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
      Tạm khóa
    </Badge>
  );
}
function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-t pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      {children}
    </label>
  );
}
