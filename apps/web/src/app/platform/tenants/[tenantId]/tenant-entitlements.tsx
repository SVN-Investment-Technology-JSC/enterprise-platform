'use client';

import type {
  SetTenantEntitlementResponse,
  TenantEntitlementOverview,
  TenantEntitlementStatus,
  TenantModuleEntitlement,
} from '@enterprise-platform/contracts-tenancy';
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  CircleAlert,
  Database,
  LoaderCircle,
  MoreVertical,
  PackageCheck,
  Search,
  Settings2,
  Users,
  Workflow,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ApiErrorPayload {
  readonly message?: string | readonly string[];
}

type DraftEntitlements = Record<string, boolean>;

const STATUS: Readonly<
  Record<
    TenantEntitlementStatus,
    { label: string; className: string; description: string }
  >
> = {
  'not-entitled': {
    label: 'Chưa cấp',
    className: 'border-slate-200 bg-slate-100 text-slate-600',
    description: 'Tenant chưa được cấp quyền sử dụng module này.',
  },
  provisioning: {
    label: 'Đang provisioning',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    description: 'Worker đang tạo hoặc nâng cấp schema trong Dedicated DB.',
  },
  active: {
    label: 'Đang hoạt động',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    description: 'Module đang hiển thị trong Tenant Portal.',
  },
  disabled: {
    label: 'Đã thu hồi',
    className: 'border-slate-200 bg-slate-100 text-slate-600',
    description: 'Entitlement đã thu hồi; schema và dữ liệu vẫn được giữ.',
  },
  failed: {
    label: 'Provisioning lỗi',
    className: 'border-red-200 bg-red-50 text-red-700',
    description: 'Lần provisioning gần nhất chưa hoàn thành.',
  },
};

const MODULE_ICONS: Record<string, LucideIcon> = {
  crm: Users,
  maintenance: Wrench,
  'procedure-engine': Workflow,
};

function csrfToken(): string {
  const encoded = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('ep_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
  return encoded ? decodeURIComponent(encoded) : '';
}

function errorMessage(payload: ApiErrorPayload, fallback: string): string {
  if (Array.isArray(payload.message)) return payload.message.join(' ');
  return typeof payload.message === 'string' ? payload.message : fallback;
}

function isEnabled(module: TenantModuleEntitlement): boolean {
  return (
    module.entitlementStatus === 'active' ||
    module.entitlementStatus === 'provisioning'
  );
}

function moduleDraft(
  modules: readonly TenantModuleEntitlement[],
): DraftEntitlements {
  return Object.fromEntries(
    modules.map((module) => [module.key, isEnabled(module)]),
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function moduleIcon(moduleKey: string): LucideIcon {
  return MODULE_ICONS[moduleKey] ?? Boxes;
}

export function TenantEntitlements({
  initialOverview,
}: {
  initialOverview: TenantEntitlementOverview;
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [managerOpen, setManagerOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(
    initialOverview.modules[0]?.key ?? '',
  );
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<DraftEntitlements>(() =>
    moduleDraft(initialOverview.modules),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const hasProvisioning = overview.modules.some(
    (module) => module.entitlementStatus === 'provisioning',
  );
  const enabledCount = overview.modules.filter(isEnabled).length;
  const selectedModule =
    overview.modules.find((module) => module.key === selectedKey) ??
    overview.modules[0];
  const filteredModules = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('vi');
    if (!needle) return overview.modules;
    return overview.modules.filter((module) =>
      [module.name, module.key, module.description]
        .join(' ')
        .toLocaleLowerCase('vi')
        .includes(needle),
    );
  }, [overview.modules, query]);
  const changedModules = useMemo(
    () =>
      overview.modules.filter(
        (module) =>
          module.entitlementStatus !== 'provisioning' &&
          draft[module.key] !== isEnabled(module),
      ),
    [draft, overview.modules],
  );

  useEffect(() => {
    if (!hasProvisioning) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/platform/v1/tenants/${overview.tenant.id}/modules`,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        if (response.ok) {
          const next = (await response.json()) as TenantEntitlementOverview;
          setOverview(next);
          setDraft((current) =>
            managerOpen ? current : moduleDraft(next.modules),
          );
        }
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError('Mất kết nối khi theo dõi tiến trình provisioning.');
        }
      } finally {
        if (!controller.signal.aborted) {
          timer = window.setTimeout(() => void refresh(), 2_000);
        }
      }
    };
    void refresh();
    return () => {
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [hasProvisioning, managerOpen, overview.tenant.id]);

  function openManager(moduleKey?: string) {
    setDraft(moduleDraft(overview.modules));
    setSelectedKey(moduleKey ?? overview.modules[0]?.key ?? '');
    setQuery('');
    setError(undefined);
    setManagerOpen(true);
  }

  function closeManager() {
    if (saving) return;
    setManagerOpen(false);
    setQuery('');
  }

  async function updateEntitlement(
    module: TenantModuleEntitlement,
    enabled: boolean,
  ): Promise<TenantEntitlementStatus> {
    const response = await fetch(
      `/api/platform/v1/tenants/${overview.tenant.id}/entitlements/${encodeURIComponent(module.key)}`,
      {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        body: JSON.stringify({ enabled }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as
      | SetTenantEntitlementResponse
      | ApiErrorPayload;
    if (!response.ok) {
      throw new Error(
        errorMessage(
          payload as ApiErrorPayload,
          `Không thể cập nhật ${module.name}.`,
        ),
      );
    }
    return (payload as SetTenantEntitlementResponse).status;
  }

  async function saveChanges() {
    if (changedModules.length === 0) return;
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    let completed = 0;
    try {
      for (const module of changedModules) {
        const status = await updateEntitlement(module, draft[module.key]);
        setOverview((current) => ({
          ...current,
          modules: current.modules.map((item) =>
            item.key === module.key
              ? { ...item, entitlementStatus: status }
              : item,
          ),
        }));
        completed += 1;
      }
      setNotice(
        `Đã cập nhật ${completed} module. Module mới được cấp đang chờ worker provisioning.`,
      );
      setManagerOpen(false);
    } catch (cause) {
      setError(
        `${completed > 0 ? `Đã cập nhật ${completed} module. ` : ''}${cause instanceof Error ? cause.message : 'Không thể lưu thay đổi.'}`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link
          className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-[#091426] hover:underline"
          href="/platform/tenants"
        >
          <ArrowLeft className="size-4" />
          Danh sách tenant
        </Link>
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => openManager()}
        >
          <Settings2 />
          Quản lý Modules
        </Button>
      </div>

      <section
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        aria-label="Tổng quan entitlement"
      >
        <MetricCard
          icon={PackageCheck}
          label="Enabled Modules"
          tone="success"
          value={enabledCount}
        />
        <MetricCard
          icon={Boxes}
          label="Available Modules"
          value={overview.modules.length}
        />
        <MetricCard
          icon={Database}
          label="Dedicated Database"
          textValue={overview.tenant.database?.databaseName ?? 'Chưa cấu hình'}
        />
        <MetricCard
          icon={Users}
          label="Tenant Admin"
          textValue={overview.tenant.admin?.email ?? 'Chưa có'}
        />
      </section>

      {error ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          role="alert"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          role="status"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          {notice}
        </div>
      ) : null}

      <Card className="overflow-hidden border-slate-200 py-0 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Module</th>
                <th className="px-5 py-3 font-semibold">Phiên bản</th>
                <th className="px-5 py-3 font-semibold">Entitlement</th>
                <th className="px-5 py-3 font-semibold">Trạng thái</th>
                <th className="px-5 py-3 font-semibold">Cập nhật</th>
                <th className="px-5 py-3 text-right font-semibold">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {overview.modules.map((module) => {
                const Icon = moduleIcon(module.key);
                const entitled = isEnabled(module);
                return (
                  <tr
                    className="transition-colors hover:bg-slate-50/80"
                    key={module.key}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-[#091426]">
                          <Icon className="size-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-950">
                            {module.name}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {module.key}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      v{module.version}
                    </td>
                    <td className="px-5 py-4">
                      <Badge
                        className={
                          entitled
                            ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50'
                            : 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-100'
                        }
                        variant="outline"
                      >
                        {entitled ? 'Entitled' : 'Not Entitled'}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={module.entitlementStatus} />
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500">
                      {formatDate(module.updatedAt)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Button
                        aria-label={`Quản lý ${module.name}`}
                        onClick={() => openManager(module.key)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <MoreVertical />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
          Hiển thị {overview.modules.length} module từ Module Registry
        </div>
      </Card>

      {managerOpen ? (
        <ModuleManagerDialog
          changedCount={changedModules.length}
          draft={draft}
          filteredModules={filteredModules}
          onClose={closeManager}
          onQueryChange={setQuery}
          onSave={() => void saveChanges()}
          onSelect={setSelectedKey}
          onToggle={(module) =>
            setDraft((current) => ({
              ...current,
              [module.key]: !current[module.key],
            }))
          }
          query={query}
          saving={saving}
          selectedModule={selectedModule}
        />
      ) : null}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  textValue,
  tone = 'default',
  value,
}: {
  icon: LucideIcon;
  label: string;
  textValue?: string;
  tone?: 'default' | 'success';
  value?: number;
}) {
  return (
    <Card className="gap-0 border-slate-200 py-5 shadow-sm">
      <CardContent className="flex items-center gap-4">
        <span
          className={cn(
            'grid size-12 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600',
            tone === 'success' && 'bg-emerald-50 text-emerald-600',
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </p>
          <p
            className={cn(
              'mt-1 truncate font-bold text-slate-950',
              textValue ? 'text-sm' : 'text-2xl',
            )}
            title={textValue}
          >
            {textValue ?? value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: TenantEntitlementStatus }) {
  const config = STATUS[status];
  return (
    <Badge
      className={cn('whitespace-nowrap hover:bg-inherit', config.className)}
      variant="outline"
    >
      {status === 'provisioning' ? (
        <LoaderCircle className="mr-1 size-3 animate-spin" />
      ) : null}
      {config.label}
    </Badge>
  );
}

function ModuleManagerDialog({
  changedCount,
  draft,
  filteredModules,
  onClose,
  onQueryChange,
  onSave,
  onSelect,
  onToggle,
  query,
  saving,
  selectedModule,
}: {
  changedCount: number;
  draft: DraftEntitlements;
  filteredModules: readonly TenantModuleEntitlement[];
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSave: () => void;
  onSelect: (moduleKey: string) => void;
  onToggle: (module: TenantModuleEntitlement) => void;
  query: string;
  saving: boolean;
  selectedModule?: TenantModuleEntitlement;
}) {
  return (
    <dialog
      aria-labelledby="module-manager-title"
      aria-modal="true"
      className="fixed inset-0 z-[100] m-0 grid h-full max-h-none w-full max-w-none place-items-center overflow-y-auto border-0 bg-[#091426]/45 p-4 backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      open
    >
      <section className="flex max-h-[min(900px,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <h2
              className="text-xl font-semibold text-slate-950"
              id="module-manager-title"
            >
              Quản lý Module
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Chọn module cần cấp hoặc thu hồi cho tenant.
            </p>
          </div>
          <Button
            aria-label="Đóng cửa sổ quản lý module"
            disabled={saving}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>

        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              autoFocus
              className="bg-white pl-9"
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              placeholder="Tìm kiếm module..."
              value={query}
            />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto bg-[#f8f9ff] lg:grid-cols-12">
          <div className="space-y-2 p-5 lg:col-span-7">
            {filteredModules.map((module) => {
              const selected = selectedModule?.key === module.key;
              const provisioning = module.entitlementStatus === 'provisioning';
              const Icon = moduleIcon(module.key);
              return (
                <div
                  className={cn(
                    'relative flex items-start gap-3 rounded-lg border bg-white p-4 transition-colors hover:bg-slate-50',
                    selected && 'border-blue-500 bg-blue-50 hover:bg-blue-50',
                  )}
                  key={module.key}
                >
                  {selected ? (
                    <span className="absolute inset-y-0 left-0 w-1 rounded-l-lg bg-blue-600" />
                  ) : null}
                  <button
                    aria-checked={Boolean(draft[module.key])}
                    aria-label={`${draft[module.key] ? 'Thu hồi' : 'Cấp'} ${module.name}`}
                    className={cn(
                      'relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors disabled:cursor-wait disabled:opacity-60',
                      draft[module.key] && 'bg-blue-600',
                    )}
                    disabled={provisioning || saving}
                    onClick={() => onToggle(module)}
                    role="switch"
                    type="button"
                  >
                    <span
                      className={cn(
                        'absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform',
                        draft[module.key] && 'translate-x-4',
                      )}
                    />
                  </button>
                  <button
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    onClick={() => onSelect(module.key)}
                    type="button"
                  >
                    <Icon
                      className={cn(
                        'mt-0.5 size-5 shrink-0 text-slate-500',
                        selected && 'text-blue-600',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-950">
                          {module.name}
                        </span>
                        {isEnabled(module) ? (
                          <Badge className="border-blue-200 bg-blue-100 text-[10px] text-blue-700 hover:bg-blue-100">
                            ACTIVE
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        {module.description}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
            {filteredModules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                Không tìm thấy module phù hợp.
              </div>
            ) : null}
          </div>

          <aside className="border-t border-slate-200 bg-white p-5 lg:col-span-5 lg:border-l lg:border-t-0">
            {selectedModule ? (
              <ModuleDetails module={selectedModule} />
            ) : (
              <p className="text-sm text-slate-500">
                Chọn một module để xem thông tin.
              </p>
            )}
          </aside>
        </div>

        <div className="border-t border-blue-200 bg-blue-50 px-5 py-3">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 size-5 shrink-0 text-[#091426]" />
            <p className="text-xs leading-5 text-slate-600">
              <strong className="block text-sm text-slate-900">
                Lưu ý kiến trúc
              </strong>
              Cấp module mới sẽ tạo hoặc migrate schema tương ứng trong
              Dedicated Database. Quá trình có thể mất vài phút; thu hồi
              entitlement không xóa schema và dữ liệu hiện có.
            </p>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <Button disabled={saving} onClick={onClose} variant="outline">
            Hủy
          </Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700"
            disabled={saving || changedCount === 0}
            onClick={onSave}
          >
            {saving ? <LoaderCircle className="animate-spin" /> : <Settings2 />}
            {saving
              ? 'Đang lưu…'
              : changedCount > 0
                ? `Lưu ${changedCount} thay đổi`
                : 'Lưu thay đổi'}
          </Button>
        </footer>
      </section>
    </dialog>
  );
}

function ModuleDetails({ module }: { module: TenantModuleEntitlement }) {
  const Icon = moduleIcon(module.key);
  const status = STATUS[module.entitlementStatus];
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Cấu hình chi tiết
        </p>
        <h3 className="mt-2 flex items-center gap-2 font-semibold text-slate-950">
          <Icon className="size-5 text-blue-600" />
          {module.name} Entitlement
        </h3>
      </div>
      <dl className="divide-y divide-slate-100 text-sm">
        <Detail label="Module key" value={module.key} mono />
        <Detail label="Phiên bản registry" value={`v${module.version}`} />
        <Detail
          label="Phiên bản đã provision"
          value={
            module.provisionedVersion
              ? `v${module.provisionedVersion}`
              : 'Chưa provision'
          }
        />
        <Detail label="Launch URL" value={module.launchUrl} mono />
        <Detail
          label="Cập nhật lần cuối"
          value={formatDate(module.updatedAt)}
        />
      </dl>
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <StatusBadge status={module.entitlementStatus} />
        <p className="mt-2 text-xs leading-5 text-slate-600">
          {status.description}
        </p>
      </div>
      {module.latestJob?.error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">
          <strong className="block">Lỗi provisioning gần nhất</strong>
          {module.latestJob.error}
        </div>
      ) : null}
    </div>
  );
}

function Detail({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={cn(
          'max-w-[60%] break-words text-right font-medium text-slate-900',
          mono && 'font-mono text-xs',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
