import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import {
  ArrowRight,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  GitBranch,
  PackageCheck,
  ShieldAlert,
  Users,
  Wrench,
  Workflow,
} from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  InventorySummaryChart,
  MaintenanceSummaryChart,
  ProcedureSummaryCharts,
} from './snapshot-charts';

type Module = {
  key: string;
  name: string;
  description: string;
  launchUrl: string;
  version: string;
  status: string;
};
type Procedure = {
  instances?: {
    id: string;
    code: string;
    title: string;
    status: string;
    definitionName?: string;
    assetCode?: string;
    managerName?: string;
    currentStepId?: string;
    steps?: { id: string; name: string; currentRoleStage?: string | null }[];
    authorization?: { availableActions?: string[]; myRoles?: string[] };
  }[];
  definitions?: { status: string }[];
};
type Maintenance = {
  metrics?: {
    activeSchedules: number;
    upcomingOccurrences: number;
    openIncidents: number;
  };
  occurrences?: {
    id: string;
    code?: string;
    title: string;
    kind: string;
    status: string;
    assetCode: string;
    assetName?: string;
    priority: string;
    assigneeName?: string;
    dueAt: string;
  }[];
};
type UserPayload = { users: { status: string }[] };
type OrganizationNode = {
  id: string;
  treeId: string;
  parentId?: string;
  nodeTypeId?: string;
  name: string;
  code: string;
  sortOrder?: number;
};
type Organization = {
  trees: { id: string; name: string; code: string }[];
  nodeTypes: { id: string; name: string }[];
  nodes: OrganizationNode[];
  assignments: {
    nodeId: string;
    userId: string;
    isPrimary: boolean;
    status: string;
  }[];
  users: { id: string; fullName: string }[];
};
type Warehouse = { code: string; isActive: boolean };
type Material = {
  id: string;
  code: string;
  name: string;
  minStock: number;
  isActive: boolean;
};
type MaterialInventory = { materialId: string; available: number };
const icons: Record<string, typeof Boxes> = {
  'procedure-engine': Workflow,
  maintenance: Wrench,
  inventory: PackageCheck,
};
async function read<T>(url: string, cookie: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { headers: { cookie }, cache: 'no-store' });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

export default async function TenantPortalPage() {
  const cookie = (await cookies()).toString(),
    api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const [me, modulesRes, organization] = await Promise.all([
    fetch(`${api}/api/auth/v1/me`, { headers: { cookie }, cache: 'no-store' }),
    fetch(`${api}/api/platform/v1/modules`, {
      headers: { cookie },
      cache: 'no-store',
    }),
    read<Organization>(
      `${api}/api/platform/v1/tenant-organization/core-snapshot`,
      cookie,
    ),
  ]);
  if (!me.ok || !modulesRes.ok) redirect('/');
  const principal = (await me.json()) as AuthenticatedPrincipal;
  if (principal.kind === 'platform-admin') redirect('/platform');
  const modules = ((await modulesRes.json()) as Module[]).filter(
    (item) => item.status === 'active',
  ),
    manager = principal.permissions.includes('tenant.manage');
  const has = (key: string) => modules.some((item) => item.key === key);
  const inventoryApi =
    process.env.INVENTORY_API_BASE_URL ?? 'http://localhost:3336';
  const [users, procedure, maintenance, warehouses, materials] =
    await Promise.all([
      manager
        ? read<UserPayload>(`${api}/api/platform/v1/tenant-users`, cookie)
        : Promise.resolve(undefined),
      has('procedure-engine')
        ? read<Procedure>(
          `${process.env.PROCEDURE_API_BASE_URL ?? 'http://localhost:3334'}/api/procedure/v1/workspace`,
          cookie,
        )
        : Promise.resolve(undefined),
      has('maintenance')
        ? read<Maintenance>(
          `${process.env.MAINTENANCE_API_BASE_URL ?? 'http://localhost:3335'}/api/maintenance/v1/workspace`,
          cookie,
        )
        : Promise.resolve(undefined),
      has('inventory')
        ? read<Warehouse[]>(
          `${inventoryApi}/api/inventory/v1/warehouses`,
          cookie,
        )
        : Promise.resolve(undefined),
      has('inventory')
        ? read<Material[]>(`${inventoryApi}/api/inventory/v1/materials`, cookie)
        : Promise.resolve(undefined),
    ]);
  const stocks = warehouses
    ? await Promise.all(
      warehouses.map((warehouse) =>
        read<MaterialInventory[]>(
          `${inventoryApi}/api/inventory/v1/warehouses/${encodeURIComponent(warehouse.code)}/stock`,
          cookie,
        ),
      ),
    )
    : undefined;
  const availableByMaterial = new Map<string, number>();
  for (const stock of stocks ?? [])
    for (const item of stock ?? [])
      availableByMaterial.set(
        item.materialId,
        (availableByMaterial.get(item.materialId) ?? 0) + item.available,
      );
  const lowStock =
    materials?.filter(
      (item) =>
        item.isActive &&
        item.minStock > 0 &&
        (availableByMaterial.get(item.id) ?? 0) < item.minStock,
    ) ?? [];
  const actionable = (procedure?.instances ?? []).filter(
    (item) =>
      item.status === 'running' &&
      item.authorization?.availableActions?.some(
        (action) => action !== 'comment',
      ),
  );
  const incidents = (maintenance?.occurrences ?? []).filter(
    (item) => item.kind === 'incident' && item.status !== 'completed',
  );
  const procedureStatus = procedure
    ? [
      ['running', 'Đang chạy', '#2563eb'],
      ['completed', 'Hoàn thành', '#10b981'],
      ['rejected', 'Từ chối', '#f59e0b'],
      ['cancelled', 'Đã huỷ', '#94a3b8'],
    ].map(([status, label, color]) => ({
      label,
      color,
      value: (procedure.instances ?? []).filter(
        (item) => item.status === status,
      ).length,
    }))
    : undefined;
  const procedureStages = procedure
    ? [
      ['S', 'Khởi tạo', '#8b5cf6'],
      ['R', 'Xem xét', '#2563eb'],
      ['E', 'Thực hiện', '#f97316'],
      ['C', 'Kiểm soát', '#a855f7'],
      ['A', 'Phê duyệt', '#eab308'],
    ].map(([stage, label, color]) => ({
      label,
      color,
      value: (procedure.instances ?? []).filter((instance) => {
        const currentStep = instance.steps?.find(
          (step) => step.id === instance.currentStepId,
        );
        return (
          instance.status === 'running' && currentStep?.currentRoleStage === stage
        );
      }).length,
    }))
    : undefined;
  const maintenancePriority = maintenance
    ? [
      ['High', 'Cao', '#ef4444'],
      ['Normal', 'Bình thường', '#f59e0b'],
      ['Low', 'Thấp', '#38bdf8'],
    ].map(([priority, label, color]) => ({
      label,
      color,
      value: incidents.filter((item) => item.priority === priority).length,
    }))
    : undefined;
  const stockHealth = materials
    ? [
      {
        label: 'Cần bổ sung',
        color: '#ef4444',
        value: lowStock.length,
      },
      {
        label: 'Đủ tồn',
        color: '#10b981',
        value: materials.filter(
          (item) =>
            item.isActive &&
            item.minStock > 0 &&
            (availableByMaterial.get(item.id) ?? 0) >= item.minStock,
        ).length,
      },
      {
        label: 'Chưa đặt ngưỡng',
        color: '#94a3b8',
        value: materials.filter(
          (item) => item.isActive && item.minStock <= 0,
        ).length,
      },
    ]
    : undefined;
  const attention = [
    ...actionable.map((item) => {
      const currentStep = item.steps?.find(
        (step) => step.id === item.currentStepId,
      );
      return {
        ...item,
        type: 'Quy trình',
        href: '/modules/procedure',
        state: 'Cần xử lý',
        details: [
          item.code,
          item.definitionName,
          currentStep ? `Bước: ${currentStep.name}` : undefined,
          item.assetCode ? `Thiết bị: ${item.assetCode}` : undefined,
          item.managerName ? `Phụ trách: ${item.managerName}` : undefined,
        ].filter(Boolean) as string[],
      };
    }),
    ...incidents.map((item) => ({
      ...item,
      type: 'Bảo trì',
      href: '/modules/maintenance',
      state: 'Sự cố mở',
      details: [
        item.code,
        item.assetName ?? `Thiết bị: ${item.assetCode}`,
        `Ưu tiên: ${item.priority}`,
        item.assigneeName ? `Phụ trách: ${item.assigneeName}` : undefined,
      ].filter(Boolean) as string[],
    })),
    ...lowStock.map((item) => ({
      id: item.id,
      title: item.name,
      type: 'Kho vật tư',
      href: '/modules/inventory',
      state: `Dưới mức tối thiểu (${availableByMaterial.get(item.id) ?? 0}/${item.minStock})`,
      details: [
        item.code,
        `Tồn khả dụng: ${availableByMaterial.get(item.id) ?? 0}`,
        `Mức tối thiểu: ${item.minStock}`,
      ],
    })),
  ];
  const activeUsers = users?.users.filter(
    (item) => item.status === 'active',
  ).length;
  const organizationTree = organization?.trees[0];
  const treeNodes = organizationTree
    ? (organization?.nodes.filter((node) => node.treeId === organizationTree.id) ?? [])
    : [];
  const rootNode =
    treeNodes.find((node) => !node.parentId) ?? treeNodes[0];
  const directChildren = rootNode
    ? treeNodes.filter((node) => node.parentId === rootNode.id)
    : [];
  const topBranches =
    directChildren.length > 0
      ? directChildren
      : treeNodes.filter((node) => node.id !== rootNode?.id);
  const displayBranches = topBranches.slice(0, 3);
  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <p className="text-sm font-medium text-slate-500">
          Tenant Portal · {principal.tenantSlug}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Tổng quan doanh nghiệp
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Theo dõi vận hành từ các ứng dụng doanh nghiệp đang hoạt động.
        </p>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-8">
        <section className="rounded-md border border-blue-300/40 bg-gradient-to-r from-blue-100 via-white to-sky-100 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:col-span-2 xl:col-span-4">
          <div className="flex h-full flex-col justify-between gap-5">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-sm text-slate-500">Xin chào</p>
                <h2 className="text-xl font-bold text-slate-950">
                  {principal.displayName || 'Quản trị viên'}
                </h2>
                <p className="text-sm text-slate-600">
                  Chúc bạn một ngày làm việc hiệu quả.
                </p>
              </div>
            </div>
            {manager ? (
              <div className="flex flex-wrap gap-2">
                <Quick href="/users" icon={Users} label="Quản lý người dùng" />
                <Quick
                  href="/organization"
                  icon={Building2}
                  label="Thiết lập tổ chức"
                />
                <Quick
                  href="/applications"
                  icon={Boxes}
                  label="Quản lý ứng dụng"
                />
              </div>
            ) : null}
          </div>
        </section>
        <Metric
          icon={Users}
          label="Người dùng hoạt động"
          value={activeUsers ?? '—'}
          note={
            activeUsers === undefined
              ? 'Chỉ Tenant Admin được xem'
              : 'Tài khoản đang hoạt động'
          }
        />
        <Metric
          icon={Boxes}
          label="Ứng dụng đang bật"
          value={modules.length}
          note="Theo entitlement hiện tại"
        />
        <Metric
          icon={ClipboardList}
          label="Hồ sơ chờ xử lý"
          value={actionable.length}
          note="Quy trình cần bạn thao tác"
          tone="amber"
        />
        <Metric
          icon={ShieldAlert}
          label="Sự cố đang xử lý"
          value={maintenance?.metrics?.openIncidents ?? '—'}
          note={maintenance ? 'Sự cố chưa đóng' : 'Không truy cập được Bảo trì'}
          tone="red"
        />
      </section>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,0.6fr)_minmax(0,0.4fr)]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex items-center justify-between border-b border-slate-100/50 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">
                    Điểm cần chú ý
                  </h2>
                  <p className="text-sm text-slate-500">
                    Các việc thực tế cần mở module để xử lý.
                  </p>
                </div>
                {attention.length > 0 ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200/60">
                    {attention.length}
                  </span>
                ) : null}
              </div>
              <ShieldAlert className="size-5 text-amber-500" />
            </div>
            {attention.length ? (
              <div className="h-[360px] overflow-y-auto divide-y divide-slate-100/50">
                {attention.map((item) => (
                  <a
                    key={`${item.type}-${item.id}`}
                    href={item.href}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                      <ArrowRight className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-sm font-semibold text-slate-800">
                        {item.title}
                      </b>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                        <small className="font-medium text-slate-600">
                          {item.type}
                        </small>
                        {item.details.map((detail) => (
                          <small
                            key={detail}
                            className="max-w-48 truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                            title={detail}
                          >
                            {detail}
                          </small>
                        ))}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                      {item.state}
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="flex h-[360px] flex-col items-center justify-center p-6 text-center text-slate-500">
                <CheckCircle2 className="mb-2 size-8 text-emerald-500" />
                <p className="text-base font-semibold text-slate-800">
                  Không có việc cần chú ý
                </p>
                <p className="mt-1 max-w-sm text-sm text-slate-500">
                  Tất cả quy trình và công việc từ các module bạn truy cập đều đang ổn định.
                </p>
              </div>
            )}
          </section>
          <div className="grid items-stretch gap-5 lg:grid-cols-2">
            <section className="rounded-md border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="mb-4 flex justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">
                    Ứng dụng doanh nghiệp
                  </h2>
                  <p className="text-sm text-slate-500">
                    Truy cập nhanh các ứng dụng chính.
                  </p>
                </div>
                <Link
                  href="/applications"
                  className="text-sm font-semibold text-blue-700 hover:underline"
                >
                  Xem tất cả
                </Link>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {modules.map((module) => (
                  <ModuleCard key={module.key} module={module} />
                ))}
              </div>
            </section>
            <section className="rounded-md border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">
                    Sơ đồ tổ chức
                  </h2>
                  <p className="text-sm text-slate-500">
                    Quy mô tổ chức hiện tại.
                  </p>
                </div>
                <Link
                  href="/organization"
                  className="group inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-800 hover:underline"
                >
                  <span>Xem chi tiết</span>
                  <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,0.3fr)_minmax(0,0.7fr)]">
                {/* 3 Metric Pills (Cột trái 30%, xếp hàng dọc) */}
                <div className="flex flex-col justify-between gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-2 sm:gap-2.5 sm:px-2.5">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md border border-blue-100/70 bg-blue-50 text-blue-600">
                      <GitBranch className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium text-slate-500">
                        Sơ đồ
                      </p>
                      <p className="mt-0.5 text-base font-bold leading-none text-slate-950">
                        {organization?.trees.length ?? '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-2 sm:gap-2.5 sm:px-2.5">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md border border-indigo-100/70 bg-indigo-50 text-indigo-600">
                      <Building2 className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium text-slate-500">
                        Node tổ chức
                      </p>
                      <p className="mt-0.5 text-base font-bold leading-none text-slate-950">
                        {organization?.nodes.length ?? '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-2 sm:gap-2.5 sm:px-2.5">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md border border-emerald-100/70 bg-emerald-50 text-emerald-600">
                      <Users className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium text-slate-500">
                        Bổ nhiệm
                      </p>
                      <p className="mt-0.5 text-base font-bold leading-none text-slate-950">
                        {organization?.assignments.length ?? '—'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Tree Diagram Preview (Cột phải 70%) */}
                {organizationTree && rootNode ? (
                  <div className="relative flex flex-col justify-between rounded-lg border border-slate-200/70 bg-slate-50/40 p-2.5 sm:p-3">
                    <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-200/50 pb-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="size-1.5 shrink-0 rounded-full bg-blue-600" />
                        <span
                          className="truncate text-xs font-semibold text-slate-800"
                          title={organizationTree.name}
                        >
                          {organizationTree.name}
                        </span>
                      </div>
                      <span className="shrink-0 rounded border border-blue-100/70 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                        Cây chính
                      </span>
                    </div>

                    <div className="my-auto flex flex-col items-center">
                      {/* Root node */}
                      <div
                        className="inline-flex max-w-[95%] items-center gap-1.5 rounded-md border border-blue-200/80 bg-white px-3 py-1.5 shadow-[0_1px_2px_rgba(37,99,235,0.06)]"
                        title={`${rootNode.code} · ${rootNode.name}`}
                      >
                        <Building2 className="size-3.5 shrink-0 text-blue-600" />
                        <span className="truncate text-xs font-semibold text-slate-900">
                          {rootNode.name}
                        </span>
                      </div>

                      {displayBranches.length > 0 ? (
                        <div className="w-full">
                          {/* Stem from root */}
                          <div className="mx-auto h-2 w-px bg-slate-300" />

                          {/* Crossbar */}
                          {displayBranches.length > 1 ? (
                            <div
                              className="mx-auto h-px bg-slate-300"
                              style={{
                                width:
                                  displayBranches.length === 2
                                    ? '50%'
                                    : '66.6%',
                              }}
                            />
                          ) : null}

                          {/* Branches */}
                          <div
                            className={`grid gap-2 pt-2 ${displayBranches.length === 1
                                ? 'mx-auto max-w-[220px] grid-cols-1'
                                : displayBranches.length === 2
                                  ? 'grid-cols-2'
                                  : 'grid-cols-3'
                              }`}
                          >
                            {displayBranches.map((child) => (
                              <div
                                key={child.id}
                                className="relative flex flex-col items-center"
                              >
                                {displayBranches.length > 1 ? (
                                  <div className="absolute -top-2 h-2 w-px bg-slate-300" />
                                ) : null}
                                <div
                                  className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-center shadow-xs transition-colors hover:border-blue-300 hover:bg-blue-50/20"
                                  title={`${child.code} · ${child.name}`}
                                >
                                  <p className="truncate text-[11px] font-medium text-slate-700">
                                    {child.name}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-24 place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50/40 p-4 text-center">
                    <Building2 className="size-6 text-slate-300" />
                    <p className="mt-1 text-xs text-slate-500">
                      Chưa thiết lập sơ đồ tổ chức
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
        <aside className="flex h-full flex-col gap-4">
          <Summary
            fill
            icon={Workflow}
            title="Quy trình"
            href="/modules/procedure"
            rows={[
              'Đang chạy',
              (procedure?.instances ?? []).filter(
                (item) => item.status === 'running',
              ).length,
              'Chờ xử lý',
              actionable.length,
              'Đã công bố',
              (procedure?.definitions ?? []).filter(
                (item) => item.status === 'published',
              ).length,
            ]}
            chart={
              <ProcedureSummaryCharts
                status={procedureStatus}
                stages={procedureStages}
              />
            }
          />
          <Summary
            fill
            icon={Wrench}
            title="Bảo trì"
            href="/modules/maintenance"
            rows={[
              'Lịch đang chạy',
              maintenance?.metrics?.activeSchedules ?? '—',
              'Sắp đến hạn',
              maintenance?.metrics?.upcomingOccurrences ?? '—',
              'Sự cố mở',
              maintenance?.metrics?.openIncidents ?? '—',
            ]}
            chart={<MaintenanceSummaryChart data={maintenancePriority} />}
          />
          <Summary
            fill
            icon={PackageCheck}
            title="Kho vật tư"
            href="/modules/inventory"
            rows={[
              'Kho hoạt động',
              warehouses?.filter((item) => item.isActive).length ?? '—',
              'Mã vật tư',
              materials?.filter((item) => item.isActive).length ?? '—',
              'Sắp thiếu',
              materials ? lowStock.length : '—',
            ]}
            chart={<InventorySummaryChart data={stockHealth} />}
          />
        </aside>
      </div>
    </main>
  );
}
function Quick({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof Users;
  label: string;
}) {
  return (
    <Button
      nativeButton={false}
      render={<Link href={href} />}
      className="h-10 bg-blue-600 px-4 text-sm text-white hover:bg-blue-700"
      size="lg"
    >
      <Icon className="size-5" />
      {label}
    </Button>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  note,
  tone = 'blue',
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  note: string;
  tone?: 'blue' | 'amber' | 'red';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <Card className="rounded-md border-slate-200 py-0 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <CardContent className="p-5">
        <div className="flex justify-between gap-2">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <span
            className={`grid size-9 shrink-0 place-items-center rounded-xl ${colors[tone]}`}
          >
            <Icon className="size-4" />
          </span>
        </div>
        <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
        <p className="mt-1 text-xs text-slate-500">{note}</p>
      </CardContent>
    </Card>
  );
}
function Summary({
  fill = false,
  icon: Icon,
  title,
  href,
  rows,
  chart,
}: {
  fill?: boolean;
  icon: typeof Workflow;
  title: string;
  href: string;
  rows: (string | number)[];
  chart?: React.ReactNode;
}) {
  return (
    <Card
      className={`rounded-md border-slate-200 bg-white py-0 shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${fill ? 'flex-1' : ''}`}
    >
      <CardContent
        className={`p-5 ${fill ? 'flex h-full flex-col gap-4 sm:flex-row sm:items-stretch' : ''}`}
      >
        <div className="min-w-0 flex-1 sm:w-[40%] sm:flex-none sm:flex sm:flex-col">
          <div className="flex justify-between items-center gap-3">
            <h3 className="text-xl font-bold text-slate-900">{title}</h3>
            <a
              href={href}
              className="shrink-0 text-sm font-semibold text-blue-700 hover:underline"
            >
              Mở module
            </a>
          </div>
          <dl className="my-8 grid grid-cols-3 gap-2">
            {[0, 2, 4].map((i) => (
              <div key={String(rows[i])}>
                <dt className="text-md text-slate-500">{rows[i]}</dt>
                <dd className="mt-1 text-xl font-bold text-slate-900">
                  {rows[i + 1]}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        {chart ? (
          <div className="flex min-w-0 shrink-0 items-center border-t border-slate-100 pt-3 sm:w-[65%] sm:border-t-0 sm:border-l sm:pl-4 sm:pt-0">
            {chart}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
function ModuleCard({ module }: { module: Module }) {
  const Icon = icons[module.key] ?? Boxes;
  return (
    <a
      href={module.launchUrl}
      className="flex min-h-36 flex-col rounded-md border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-blue-200 hover:bg-blue-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-md bg-slate-100 text-blue-700">
          <Icon className="size-5" />
        </span>
        <h3 className="text-base font-bold text-slate-950">{module.name}</h3>
      </div>
      <p className="mt-1 flex-1 text-sm text-slate-500">
        {module.description}
      </p>
    </a>
  );
}

