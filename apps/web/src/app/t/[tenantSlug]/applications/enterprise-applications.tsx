'use client';

import type {
  ModuleActivationRequestResponse,
  TenantEntitlementStatus,
  TenantModuleCatalogItem,
} from '@enterprise-platform/contracts-tenancy';
import {
  ArrowRight,
  Boxes,
  FileCog,
  FolderKanban,
  LockOpen,
  PackageOpen,
  Search,
  ServerCog,
  Users,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const moduleIcons: Record<string, LucideIcon> = {
  accounting: FileCog,
  crm: Users,
  dms: FolderKanban,
  hrm: Users,
  maintenance: Wrench,
  'procedure-engine': Workflow,
  workflow: Workflow,
};

const statusLabel: Record<TenantEntitlementStatus, string> = {
  active: 'Đang hoạt động',
  disabled: 'Đã tạm dừng',
  failed: 'Kích hoạt lỗi',
  'not-entitled': 'Chưa đăng ký',
  provisioning: 'Đang kích hoạt',
};

function csrfToken(): string {
  const value = document.cookie
    .split('; ')
    .find((item) => item.startsWith('ep_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
  return value ? decodeURIComponent(value) : '';
}

function apiError(payload: { message?: string | string[] }): string {
  if (Array.isArray(payload.message)) return payload.message.join(' ');
  return payload.message ?? 'Không thể gửi yêu cầu kích hoạt.';
}

function moduleHref(module: TenantModuleCatalogItem, tenantSlug: string) {
  if (module.key === 'crm') return `/t/${tenantSlug}/crm`;
  return module.launchUrl;
}

export function EnterpriseApplications({
  canRequestActivation,
  initialError,
  initialModules,
  tenantSlug,
}: {
  canRequestActivation: boolean;
  initialError?: string;
  initialModules: TenantModuleCatalogItem[];
  tenantSlug: string;
}) {
  const [query, setQuery] = useState('');
  const [requestingKey, setRequestingKey] = useState<string>();
  const [requestedKeys, setRequestedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase('vi');
  const filteredModules = useMemo(
    () =>
      initialModules.filter((module) => {
        if (!normalizedQuery) return true;
        return [module.name, module.description, module.key].some((value) =>
          value.toLocaleLowerCase('vi').includes(normalizedQuery),
        );
      }),
    [initialModules, normalizedQuery],
  );
  const activeModules = filteredModules.filter(
    (module) => module.entitlementStatus === 'active',
  );
  const additionalModules = filteredModules.filter(
    (module) => module.entitlementStatus !== 'active',
  );

  async function requestActivation(module: TenantModuleCatalogItem) {
    setRequestingKey(module.key);
    try {
      const response = await fetch(
        `/api/platform/v1/modules/${encodeURIComponent(module.key)}/activation-requests`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'x-csrf-token': csrfToken() },
        },
      );
      const payload = (await response.json().catch(() => ({}))) as
        | ModuleActivationRequestResponse
        | { message?: string | string[] };
      if (!response.ok) {
        throw new Error(apiError(payload as { message?: string | string[] }));
      }
      setRequestedKeys((current) => new Set(current).add(module.key));
    } finally {
      setRequestingKey(undefined);
    }
  }

  return (
    <main className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="mb-3 flex items-center gap-2 text-sm text-slate-500"
          >
            <Link className="hover:text-slate-900" href={`/t/${tenantSlug}`}>
              Tenant Portal
            </Link>
            <span aria-hidden="true">/</span>
            <span className="font-medium text-slate-900">My Modules</span>
          </nav>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Ứng dụng của doanh nghiệp
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            Quản lý và truy cập các module đã được cấp quyền cho tổ chức của
            bạn.
          </p>
        </div>
        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            aria-label="Tìm kiếm ứng dụng"
            className="h-10 bg-white pl-9"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Tìm kiếm ứng dụng..."
            type="search"
            value={query}
          />
        </div>
      </div>

      {initialError ? (
        <div
          className="mb-8 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {initialError}
        </div>
      ) : null}

      <ModuleSection
        badge={`${activeModules.length} APPLICATION${activeModules.length === 1 ? '' : 'S'}`}
        count={activeModules.length}
        emptyMessage={
          normalizedQuery
            ? 'Không tìm thấy module đang hoạt động phù hợp.'
            : 'Tenant chưa có module đang hoạt động.'
        }
        title="Module đang hoạt động"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {activeModules.map((module) => (
            <ActiveModuleCard
              key={module.key}
              module={module}
              tenantSlug={tenantSlug}
            />
          ))}
        </div>
      </ModuleSection>

      <ModuleSection
        badge={`${additionalModules.length} MODULE${additionalModules.length === 1 ? '' : 'S'}`}
        count={additionalModules.length}
        emptyMessage={
          normalizedQuery
            ? 'Không tìm thấy ứng dụng khác phù hợp.'
            : 'Không còn module nào khác trong danh mục.'
        }
        title="Ứng dụng khác"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {additionalModules.map((module) => (
            <AdditionalModuleCard
              canRequestActivation={canRequestActivation}
              isRequested={requestedKeys.has(module.key)}
              isRequesting={requestingKey === module.key}
              key={module.key}
              module={module}
              onRequest={() =>
                void toast.promise(requestActivation(module), {
                  loading: {
                    title: 'Đang gửi yêu cầu',
                    description: `Đang ghi nhận yêu cầu kích hoạt ${module.name}.`,
                    type: 'loading',
                  },
                  success: {
                    title: 'Đã gửi yêu cầu kích hoạt',
                    description:
                      'Yêu cầu đã được ghi nhận để Platform Admin xử lý.',
                    type: 'success',
                  },
                  error: (error) => ({
                    title: 'Không thể gửi yêu cầu',
                    description:
                      error instanceof Error
                        ? error.message
                        : 'Vui lòng thử lại.',
                    type: 'error',
                  }),
                })
              }
            />
          ))}
        </div>
      </ModuleSection>
    </main>
  );
}

function ModuleSection({
  badge,
  children,
  count,
  emptyMessage,
  title,
}: {
  badge: string;
  children: ReactNode;
  count: number;
  emptyMessage: string;
  title: string;
}) {
  const headingId = `${title.replaceAll(' ', '-').toLocaleLowerCase('vi')}-heading`;
  return (
    <section className="mb-10" aria-labelledby={headingId}>
      <div className="mb-5 flex items-center justify-between border-b border-slate-200 pb-3">
        <h2 className="text-xl font-semibold text-slate-950" id={headingId}>
          {title}
        </h2>
        <Badge
          className="rounded-md border-slate-200 bg-slate-100 text-[10px] font-semibold tracking-wider text-slate-600 hover:bg-slate-100"
          variant="outline"
        >
          {badge}
        </Badge>
      </div>
      {count > 0 ? (
        children
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
          <PackageOpen className="mx-auto mb-3 size-6 text-slate-400" />
          {emptyMessage}
        </div>
      )}
    </section>
  );
}

function ModuleIcon({ module }: { module: TenantModuleCatalogItem }) {
  const Icon = moduleIcons[module.key] ?? Boxes;
  return <Icon className="size-6" />;
}

function ActiveModuleCard({
  module,
  tenantSlug,
}: {
  module: TenantModuleCatalogItem;
  tenantSlug: string;
}) {
  return (
    <article className="flex min-h-60 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="grid size-12 place-items-center rounded-xl bg-slate-100 text-[#091426]">
          <ModuleIcon module={module} />
        </div>
        <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
          <span className="mr-1.5 size-1.5 rounded-full bg-emerald-600" />
          Active
        </Badge>
      </div>
      <h3 className="text-base font-semibold text-slate-950">{module.name}</h3>
      <p className="mt-1 flex-1 text-sm leading-6 text-slate-500">
        {module.description}
      </p>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <span className="text-xs text-slate-500">
          Version: v{module.version}
        </span>
        <Link
          className="inline-flex items-center gap-1 text-sm font-semibold text-[#091426] hover:underline"
          href={moduleHref(module, tenantSlug)}
        >
          Mở ứng dụng <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}

function AdditionalModuleCard({
  canRequestActivation,
  isRequested,
  isRequesting,
  module,
  onRequest,
}: {
  canRequestActivation: boolean;
  isRequested: boolean;
  isRequesting: boolean;
  module: TenantModuleCatalogItem;
  onRequest: () => void;
}) {
  const requestDisabled =
    !canRequestActivation ||
    isRequesting ||
    isRequested ||
    module.entitlementStatus === 'provisioning';
  return (
    <article className="relative flex min-h-72 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="pointer-events-none absolute inset-0 bg-slate-50/35" />
      <div className="relative mb-5 flex items-start justify-between gap-3">
        <div className="grid size-12 place-items-center rounded-xl bg-slate-100 text-slate-500">
          <ModuleIcon module={module} />
        </div>
        <Badge
          className={cn(
            'border bg-white text-slate-600 hover:bg-white',
            module.entitlementStatus === 'failed' &&
              'border-red-200 bg-red-50 text-red-700 hover:bg-red-50',
            module.entitlementStatus === 'provisioning' &&
              'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50',
          )}
          variant="outline"
        >
          {statusLabel[module.entitlementStatus]}
        </Badge>
      </div>
      <div className="relative flex flex-1 flex-col">
        <h3 className="text-base font-semibold text-slate-950">
          {module.name}
        </h3>
        <p className="mt-1 text-sm font-medium text-slate-700">
          {module.description}
        </p>
        <p className="mt-3 flex-1 text-sm leading-6 text-slate-500">
          {module.entitlementStatus === 'disabled'
            ? 'Module đang bị tạm dừng đối với tenant này.'
            : module.entitlementStatus === 'failed'
              ? 'Lần kích hoạt gần nhất chưa hoàn tất. Bạn có thể gửi yêu cầu xử lý lại.'
              : module.entitlementStatus === 'provisioning'
                ? 'Hệ thống đang chuẩn bị module cho tổ chức của bạn.'
                : 'Gói hiện tại của bạn chưa bao gồm module này.'}
        </p>
        <Button
          className="mt-5 w-full bg-white"
          disabled={requestDisabled}
          onClick={onRequest}
          variant="outline"
        >
          {isRequesting ? (
            <ServerCog className="animate-pulse" />
          ) : (
            <LockOpen />
          )}
          {isRequested
            ? 'Đã gửi yêu cầu'
            : module.entitlementStatus === 'provisioning'
              ? 'Đang kích hoạt'
              : 'Yêu cầu kích hoạt'}
        </Button>
        <p className="mt-2 text-center text-xs italic text-slate-500">
          {canRequestActivation
            ? '* Chỉ dành cho Tenant Admin'
            : '* Bạn không có quyền yêu cầu kích hoạt'}
        </p>
      </div>
    </article>
  );
}
