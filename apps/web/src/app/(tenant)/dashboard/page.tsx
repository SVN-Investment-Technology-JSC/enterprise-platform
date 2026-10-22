import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import { isLauncherOnlyModule } from '@enterprise-platform/feature-module-shell';
import { Building2, GitFork, ListChecks, Package, Users, Wrench } from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { CollapsibleGroup } from '../collapsible-group';
import { RefreshOnFocus } from './refresh-on-focus';

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
/** Phần của `GET /api/workspace/v1/my-work` mà trang chủ dùng. */
type WorkspaceWork = {
  items?: {
    item: {
      id: string;
      projectId: string;
      code: string;
      title: string;
      status: string;
      priority: string;
      plannedEnd?: string;
    };
    bucket: string;
    projectCode: string;
    projectName: string;
  }[];
  standaloneTasks?: {
    task: { id: string; code: string; title: string; status: string; priority: string; dueDate?: string };
    bucket: string;
    myRole: string;
    awaitingMyApproval: boolean;
  }[];
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

/** Số dòng mỗi nhóm việc; còn nữa thì có link mở module để xem đủ. */
const GROUP_ROWS = 5;

/**
 * Link từ trang chủ vào một việc cần xử lý mang theo `returnTo`: xử lý xong (duyệt, hoàn thành…) module
 * tự quay về trang chủ.
 */
const RETURN_HOME = `returnTo=${encodeURIComponent('/dashboard')}`;

/** Thứ tự nhóm hạn của "Công việc cần xử lý": quá hạn lên đầu. */
const BUCKET_ORDER = ['overdue', 'today', 'this_week', 'later', 'no_due'];

const WORK_PRIORITY: Record<string, { label: string; dot: string }> = {
  urgent: { label: 'Khẩn', dot: 'bg-red-600 shadow-[0_0_0_4px_rgba(220,38,38,.12)]' },
  high: { label: 'Cao', dot: 'bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,.12)]' },
  normal: { label: 'Bình thường', dot: 'bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,.12)]' },
  low: { label: 'Thấp', dot: 'bg-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,.12)]' },
};

const WORK_STATUS: Record<string, { label: string; className: string }> = {
  todo: { label: 'Chưa làm', className: 'bg-slate-100 text-slate-700' },
  in_progress: { label: 'Đang làm', className: 'bg-blue-50 text-blue-700' },
  review: { label: 'Chờ duyệt', className: 'bg-[#fff6d6] text-[#8a6400]' },
};

const BUCKET_LABEL: Record<string, string> = {
  overdue: 'Quá hạn',
  today: 'Hôm nay',
  this_week: 'Tuần này',
  later: 'Sau này',
  no_due: 'Chưa có hạn',
};

const PRIORITY_LABELS: Record<string, { label: string; dot: string }> = {
  High: { label: 'Cao', dot: 'bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,.12)]' },
  Normal: { label: 'Bình thường', dot: 'bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,.12)]' },
  Low: { label: 'Thấp', dot: 'bg-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,.12)]' },
};

const VN_DATE = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});
const VN_WEEKDAY_DATE = new Intl.DateTimeFormat('vi-VN', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

async function read<T>(url: string, cookie: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { headers: { cookie }, cache: 'no-store' });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Chữ viết tắt giống khối người dùng trên thanh bên: chữ đầu của họ và tên. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'EP';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
}

/** Ghép các vế bằng dấu phẩy, vế cuối nối bằng "và". */
function joinClauses(parts: ReactNode[]): ReactNode {
  return parts.map((part, index) => (
    <span key={index}>
      {index === 0 ? null : index === parts.length - 1 ? ' và ' : ', '}
      {part}
    </span>
  ));
}

export default async function TenantPortalPage() {
  const cookie = (await cookies()).toString(),
    api = process.env.API_BASE_URL ?? 'http://localhost:3333';
  const [me, modulesRes] = await Promise.all([
    fetch(`${api}/api/auth/v1/me`, { headers: { cookie }, cache: 'no-store' }),
    fetch(`${api}/api/platform/v1/modules`, {
      headers: { cookie },
      cache: 'no-store',
    }),
  ]);
  if (!me.ok || !modulesRes.ok) redirect('/');
  const principal = (await me.json()) as AuthenticatedPrincipal;
  if (principal.kind === 'platform-admin') redirect('/platform');
  const modules = ((await modulesRes.json()) as Module[]).filter(
    (item) => item.status === 'active' && !isLauncherOnlyModule(item.key),
  ),
    manager = principal.permissions.includes('tenant.manage');
  const has = (key: string) => modules.some((item) => item.key === key);
  const inventoryApi =
    process.env.INVENTORY_API_BASE_URL ?? 'http://localhost:3336';
  const [users, procedure, maintenance, warehouses, materials, workspace] =
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
      has('workspace')
        ? read<WorkspaceWork>(
          `${process.env.WORKSPACE_API_BASE_URL ?? 'http://localhost:3337'}/api/workspace/v1/my-work`,
          cookie,
        )
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
  // Công việc của tôi bên Workspace: việc dự án đang mở được giao cho tôi, cộng "Công việc khác" tôi làm
  // hoặc đang chờ tôi duyệt. Quá hạn lên đầu.
  const bucketRank = (bucket: string) => {
    const index = BUCKET_ORDER.indexOf(bucket);
    return index < 0 ? BUCKET_ORDER.length : index;
  };
  const workToDo = [
    ...(workspace?.items ?? []).map((entry) => ({
      key: `item-${entry.item.id}`,
      code: entry.item.code,
      title: entry.item.title,
      where: entry.projectCode,
      whereTitle: entry.projectName,
      priority: entry.item.priority,
      status: entry.item.status,
      bucket: entry.bucket,
      href: `/modules/workspace?project=${encodeURIComponent(entry.item.projectId)}&${RETURN_HOME}#projects/work-item/${encodeURIComponent(entry.item.id)}`,
    })),
    ...(workspace?.standaloneTasks ?? []).map((entry) => ({
      key: `task-${entry.task.id}`,
      code: entry.task.code,
      title: entry.task.title,
      where: 'Công việc khác',
      whereTitle: entry.awaitingMyApproval ? 'Chờ bạn duyệt' : 'Công việc khác',
      priority: entry.task.priority,
      status: entry.awaitingMyApproval ? 'review' : entry.task.status,
      bucket: entry.bucket,
      href: `/modules/workspace?${RETURN_HOME}#tasks/${encodeURIComponent(entry.task.id)}`,
    })),
  ].sort((left, right) => bucketRank(left.bucket) - bucketRank(right.bucket));
  const incidents = (maintenance?.occurrences ?? []).filter(
    (item) => item.kind === 'incident' && item.status !== 'completed',
  );
  const runningInstances = (procedure?.instances ?? []).filter(
    (item) => item.status === 'running',
  );
  const procedureStages = [
    ['S', 'Khởi tạo', '#1e3a8a'],
    ['R', 'Xem xét', '#2563eb'],
    ['E', 'Thực hiện', '#60a5fa'],
    ['C', 'Kiểm soát', '#93c5fd'],
    ['A', 'Phê duyệt', '#c7d2fe'],
  ].map(([stage, label, color]) => ({
    label,
    color,
    value: runningInstances.filter((instance) => {
      const currentStep = instance.steps?.find(
        (step) => step.id === instance.currentStepId,
      );
      return currentStep?.currentRoleStage === stage;
    }).length,
  }));
  const stockHealth = materials
    ? [
      { label: 'Cần bổ sung', color: '#ef4444', value: lowStock.length },
      {
        label: 'đủ tồn',
        color: '#10b981',
        value: materials.filter(
          (item) =>
            item.isActive &&
            item.minStock > 0 &&
            (availableByMaterial.get(item.id) ?? 0) >= item.minStock,
        ).length,
      },
      {
        label: 'chưa đặt ngưỡng',
        color: '#d1d5db',
        value: materials.filter((item) => item.isActive && item.minStock <= 0)
          .length,
      },
    ]
    : undefined;
  const nextRound = (maintenance?.occurrences ?? [])
    .filter((item) => item.kind !== 'incident' && item.status !== 'completed')
    .map((item) => new Date(item.dueAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const activeUsers = users?.users.filter(
    (item) => item.status === 'active',
  ).length;
  const displayName = principal.displayName || 'Quản trị viên';

  const workClauses: ReactNode[] = [
    ...(procedure
      ? [<><Strong>{actionable.length} hồ sơ</Strong> quy trình chờ bạn thao tác</>]
      : []),
    ...(workspace
      ? [<><Strong>{workToDo.length} công việc</Strong> cần xử lý</>]
      : []),
    ...(maintenance
      ? [<><Strong>{incidents.length} sự cố</Strong> bảo trì đang mở</>]
      : []),
    ...(materials
      ? [<><Strong>{lowStock.length} vật tư</Strong> dưới mức tối thiểu</>]
      : []),
  ];

  const ops: {
    key: string;
    name: string;
    abbr: string;
    tint: string;
    href: string;
    facts: { value: string | number; label: string }[];
    bar?: { value: number; color: string }[];
    caption?: string;
  }[] = [
    ...(procedure
      ? [{
        key: 'procedure',
        name: 'Quy trình',
        abbr: 'PE',
        tint: 'bg-violet-100 text-violet-700',
        href: '/modules/procedure',
        facts: [
          {
            value: (procedure.definitions ?? []).filter((item) => item.status === 'published').length,
            label: 'quy trình đã công bố',
          },
          { value: runningInstances.length, label: 'hồ sơ đang chạy' },
        ],
        bar: procedureStages,
        caption: procedureStages.some((stage) => stage.value > 0)
          ? `Đang ở bước: ${procedureStages
            .filter((stage) => stage.value > 0)
            .map((stage) => `${stage.label} ${stage.value}`)
            .join(' · ')}`
          : 'Chưa có hồ sơ nào đang chạy',
      }]
      : []),
    ...(maintenance
      ? [{
        key: 'maintenance',
        name: 'Bảo trì',
        abbr: 'MT',
        tint: 'bg-amber-100 text-amber-700',
        href: '/modules/maintenance',
        facts: [
          { value: maintenance.metrics?.activeSchedules ?? '—', label: 'lịch đang chạy' },
          { value: maintenance.metrics?.upcomingOccurrences ?? '—', label: 'sắp đến hạn' },
        ],
        caption: nextRound ? `Đợt gần nhất: ${VN_DATE.format(nextRound)}` : undefined,
      }]
      : []),
    ...(materials && stockHealth
      ? [{
        key: 'inventory',
        name: 'Kho vật tư',
        abbr: 'IV',
        tint: 'bg-blue-100 text-blue-800',
        href: '/modules/inventory',
        facts: [
          { value: warehouses?.filter((item) => item.isActive).length ?? '—', label: 'kho hoạt động' },
          { value: materials.filter((item) => item.isActive).length, label: 'mã vật tư' },
        ],
        bar: stockHealth,
        caption: stockHealth
          .slice(1)
          .map((item) => `${item.value} ${item.label}`)
          .join(' · '),
      }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4 text-[14px] text-[#18181b]">
      <RefreshOnFocus />

      <section
        aria-label="Lời chào và tóm tắt"
        className="relative mb-2 flex flex-wrap items-center gap-7 overflow-hidden rounded-2xl border border-[#ffc90a]/20 bg-gradient-to-br from-[#1c1c20] to-[#2a2a2f] px-6 py-6 sm:px-8 sm:py-7"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-36 size-[360px] rounded-full bg-[radial-gradient(circle,rgba(255,201,10,.18)_0%,transparent_70%)]"
        />
        <div aria-hidden className="relative grid size-24 shrink-0 place-items-center">
          <span className="absolute -inset-3.5 rounded-full bg-[radial-gradient(circle,rgba(255,201,10,.25)_0%,transparent_65%)]" />
          <span className="relative grid size-[84px] place-items-center rounded-full bg-gradient-to-br from-[#ffc90a] to-[#d9ab00] text-[28px] font-extrabold text-[#18181b]">
            {initialsOf(displayName)}
          </span>
        </div>
        <div className="relative flex min-w-0 flex-[1_1_360px] flex-col gap-1.5">
          <span className="text-[12px] font-semibold tracking-[1.2px] text-[#ffc90a]">
            TENANT PORTAL · {principal.tenantSlug.toUpperCase()}
          </span>
          <h1 className="m-0 text-[26px] font-bold leading-[1.3] tracking-[-0.3px] text-white">
            Xin chào, <span className="text-[#ffc90a]">{displayName}</span>
          </h1>
          <p className="m-0 text-[14px] leading-relaxed text-white/80">
            {workClauses.length > 0 ? <>Hôm nay có {joinClauses(workClauses)}. </> : null}
            {activeUsers !== undefined ? (
              <>
                Doanh nghiệp có <Strong>{activeUsers} người dùng</Strong> hoạt động trên{' '}
                <Strong>{modules.length} ứng dụng</Strong>.
              </>
            ) : (
              <>
                Doanh nghiệp đang dùng <Strong>{modules.length} ứng dụng</Strong>.
              </>
            )}
          </p>
          {manager ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <QuickLink href="/users" icon={<Users className="size-4" />}>
                Quản lý người dùng
              </QuickLink>
              <QuickLink href="/organization" icon={<Building2 className="size-4" />}>
                Thiết lập tổ chức
              </QuickLink>
              <QuickLink href="/applications" icon={<Package className="size-4" />} accent>
                Quản lý ứng dụng
              </QuickLink>
            </div>
          ) : null}
        </div>
      </section>

      {procedure ? (
        <CollapsibleGroup
          title="Hồ sơ cần bạn xử lý"
          count={actionable.length}
          tone="bg-violet-100 text-violet-700"
          icon={<GitFork className="size-4" />}
        >
          {actionable.length > 0 ? (
            <GroupTable
              columns="22px minmax(220px,1fr) 170px 150px 190px 100px"
              headings={['HỒ SƠ', 'MÃ HỒ SƠ', 'QUY TRÌNH', 'BƯỚC HIỆN TẠI', 'TRẠNG THÁI']}
              footer={
                actionable.length > GROUP_ROWS ? (
                  <a href="/modules/procedure#workspace" className="font-semibold text-blue-700 hover:text-blue-800">
                    Xem đủ {actionable.length} hồ sơ trong Quy trình
                  </a>
                ) : undefined
              }
            >
              {actionable.slice(0, GROUP_ROWS).map((item) => {
                const currentStep = item.steps?.find((step) => step.id === item.currentStepId);
                return (
                  <GroupRow
                    key={item.id}
                    columns="22px minmax(220px,1fr) 170px 150px 190px 100px"
                    href={`/modules/procedure?${RETURN_HOME}#workspace/${encodeURIComponent(item.id)}`}
                  >
                    <Dot className="bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,.12)]" />
                    <Cell strong title={item.title}>{item.title}</Cell>
                    <Cell muted title={item.code}>{item.code}</Cell>
                    <Cell small>
                      {item.definitionName ? (
                        <span className="rounded-md bg-violet-50 px-2 py-0.5 text-violet-800">
                          {item.definitionName}
                        </span>
                      ) : '—'}
                    </Cell>
                    <Cell small title={currentStep?.name}>{currentStep?.name ?? '—'}</Cell>
                    <span>
                      <Pill className="bg-[#fff6d6] text-[#8a6400]">Cần xử lý</Pill>
                    </span>
                  </GroupRow>
                );
              })}
            </GroupTable>
          ) : (
            <Empty>Không có hồ sơ nào chờ bạn thao tác.</Empty>
          )}
        </CollapsibleGroup>
      ) : null}

      {workspace ? (
        <CollapsibleGroup
          title="Công việc cần xử lý"
          count={workToDo.length}
          tone="bg-amber-100 text-amber-800"
          icon={<ListChecks className="size-4" />}
        >
          {workToDo.length > 0 ? (
            <GroupTable
              columns="22px minmax(220px,1fr) 150px 130px 120px 110px"
              headings={['CÔNG VIỆC', 'DỰ ÁN', 'ƯU TIÊN', 'HẠN', 'TRẠNG THÁI']}
              footer={
                workToDo.length > GROUP_ROWS ? (
                  <a href="/modules/workspace#my-work" className="font-semibold text-blue-700 hover:text-blue-800">
                    Xem đủ {workToDo.length} công việc trong Workspace
                  </a>
                ) : undefined
              }
            >
              {workToDo.slice(0, GROUP_ROWS).map((work) => {
                const priority = WORK_PRIORITY[work.priority];
                const status = WORK_STATUS[work.status];
                return (
                  <GroupRow
                    key={work.key}
                    columns="22px minmax(220px,1fr) 150px 130px 120px 110px"
                    href={work.href}
                  >
                    <Dot className={priority?.dot ?? 'bg-amber-500'} />
                    <Cell strong title={`${work.code} · ${work.title}`}>
                      <span className="mr-1.5 font-normal text-slate-500">{work.code}</span>
                      {work.title}
                    </Cell>
                    <Cell muted title={work.whereTitle}>{work.where}</Cell>
                    <Cell small>{priority?.label ?? work.priority}</Cell>
                    <Cell small>
                      <span className={work.bucket === 'overdue' ? 'font-semibold text-red-600' : undefined}>
                        {BUCKET_LABEL[work.bucket] ?? '—'}
                      </span>
                    </Cell>
                    <span>
                      <Pill className={status?.className ?? 'bg-slate-100 text-slate-700'}>
                        {status?.label ?? work.status}
                      </Pill>
                    </span>
                  </GroupRow>
                );
              })}
            </GroupTable>
          ) : (
            <Empty>Không có công việc nào cần bạn xử lý.</Empty>
          )}
        </CollapsibleGroup>
      ) : null}

      {maintenance ? (
        <CollapsibleGroup
          title="Sự cố bảo trì đang mở"
          count={incidents.length}
          tone="bg-amber-100 text-amber-700"
          icon={<Wrench className="size-4" />}
        >
          {incidents.length > 0 ? (
            <GroupTable
              columns="22px minmax(220px,1fr) 150px 190px 120px 110px"
              headings={['SỰ CỐ', 'MÃ', 'THIẾT BỊ', 'ƯU TIÊN', 'TRẠNG THÁI']}
              footer={
                incidents.length > GROUP_ROWS ? (
                  <a href="/modules/maintenance#history" className="font-semibold text-blue-700 hover:text-blue-800">
                    Xem đủ {incidents.length} sự cố trong Bảo trì
                  </a>
                ) : undefined
              }
            >
              {incidents.slice(0, GROUP_ROWS).map((item) => {
                const priority = PRIORITY_LABELS[item.priority];
                return (
                  <GroupRow
                    key={item.id}
                    columns="22px minmax(220px,1fr) 150px 190px 120px 110px"
                    href={`/modules/maintenance#history/${encodeURIComponent(item.id)}`}
                  >
                    <Dot className={priority?.dot ?? 'bg-amber-500'} />
                    <Cell strong title={item.title}>{item.title}</Cell>
                    <Cell muted>{item.code ?? '—'}</Cell>
                    <Cell small title={item.assetName ?? item.assetCode}>
                      {item.assetName ?? item.assetCode}
                    </Cell>
                    <Cell small>{priority?.label ?? item.priority}</Cell>
                    <span>
                      <Pill className="bg-red-100 text-red-700">Sự cố mở</Pill>
                    </span>
                  </GroupRow>
                );
              })}
            </GroupTable>
          ) : (
            <Empty>Không có sự cố nào đang mở.</Empty>
          )}
        </CollapsibleGroup>
      ) : null}

      {materials ? (
        <CollapsibleGroup
          title="Vật tư dưới mức tối thiểu"
          count={lowStock.length}
          tone="bg-blue-100 text-blue-800"
          icon={<Package className="size-4" />}
        >
          {lowStock.length > 0 ? (
            <GroupTable
              columns="22px minmax(220px,1fr) 170px 340px 190px"
              headings={['VẬT TƯ', 'MÃ VẬT TƯ', 'TỒN KHẢ DỤNG / MỨC TỐI THIỂU', 'TRẠNG THÁI']}
              footer={
                lowStock.length > GROUP_ROWS ? (
                  <a href="/modules/inventory#stock" className="font-semibold text-blue-700 hover:text-blue-800">
                    Xem đủ {lowStock.length} vật tư trong Kho
                  </a>
                ) : undefined
              }
            >
              {lowStock.slice(0, GROUP_ROWS).map((item) => {
                const available = availableByMaterial.get(item.id) ?? 0;
                const ratio = Math.max(0, Math.min(1, available / item.minStock));
                return (
                  <GroupRow
                    key={item.id}
                    columns="22px minmax(220px,1fr) 170px 340px 190px"
                    href={`/modules/inventory#stock/${encodeURIComponent(item.id)}`}
                  >
                    <Dot className="bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,.12)]" />
                    <Cell strong title={item.name}>{item.name}</Cell>
                    <Cell muted>{item.code}</Cell>
                    <span className="flex items-center gap-2.5 text-[13px] text-slate-700">
                      <span aria-hidden className="h-1.5 w-[120px] shrink-0 overflow-hidden rounded-full bg-[#f1f3f6]">
                        <span className="block h-full bg-red-500" style={{ width: `${ratio * 100}%` }} />
                      </span>
                      Tồn khả dụng: {available} · Mức tối thiểu: {item.minStock}
                    </span>
                    <span>
                      <Pill className="bg-red-100 text-red-700">
                        Dưới mức tối thiểu ({available}/{item.minStock})
                      </Pill>
                    </span>
                  </GroupRow>
                );
              })}
            </GroupTable>
          ) : (
            <Empty>Không có vật tư nào dưới mức tối thiểu.</Empty>
          )}
        </CollapsibleGroup>
      ) : null}

      {ops.length > 0 ? (
        <section
          aria-labelledby="ops-title"
          className="mt-2 overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-[#fafbfc] px-5 py-3">
            <h2 id="ops-title" className="m-0 flex-1 text-[16px] font-bold">
              Tình hình vận hành
            </h2>
            <span className="rounded-md border border-[#eef0f3] bg-white px-2.5 py-0.5 text-[13px] font-medium text-slate-500">
              {VN_WEEKDAY_DATE.format(new Date())}
            </span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[680px]">
              {ops.map((row) => {
                const total = row.bar?.reduce((sum, item) => sum + item.value, 0) ?? 0;
                return (
                  <div
                    key={row.key}
                    className="grid grid-cols-[28px_110px_minmax(220px,1fr)_200px_84px] items-center gap-x-3.5 border-t border-[#f1f3f6] px-5 py-[11px] text-[14px]"
                  >
                    <span aria-hidden className={`grid size-7 place-items-center rounded-[7px] text-[12px] font-extrabold ${row.tint}`}>
                      {row.abbr}
                    </span>
                    <b className="font-semibold">{row.name}</b>
                    <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-slate-600">
                      {row.facts.map((fact) => (
                        <span key={fact.label} className="flex items-center gap-1.5 whitespace-nowrap">
                          <b className="text-[#18181b] tabular-nums">{fact.value}</b>
                          {fact.label}
                        </span>
                      ))}
                    </span>
                    <span className="flex flex-col gap-1">
                      {row.bar ? (
                        <span aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-[#f1f3f6]">
                          {total > 0
                            ? row.bar.map((segment) => (
                              <span
                                key={segment.color}
                                style={{
                                  width: `${(segment.value / total) * 100}%`,
                                  background: segment.color,
                                }}
                              />
                            ))
                            : null}
                        </span>
                      ) : null}
                      {row.caption ? (
                        <span className="text-[12px] text-slate-500">{row.caption}</span>
                      ) : null}
                    </span>
                    <a
                      href={row.href}
                      className="justify-self-end text-[13px] font-semibold text-blue-700 hover:text-blue-800"
                    >
                      Mở module
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return <b className="font-semibold text-[#ffd84d]">{children}</b>;
}

function QuickLink({
  href,
  icon,
  accent = false,
  children,
}: {
  href: string;
  icon: ReactNode;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex h-[34px] items-center gap-1.5 rounded-lg border px-3 text-[14px] font-semibold ${accent
        ? 'border-[#ffc90a]/50 bg-[#ffc90a]/12 text-[#ffd84d] hover:bg-[#ffc90a]/20'
        : 'border-white/20 bg-white/5 text-white hover:bg-white/10'
        }`}
    >
      {icon}
      {children}
    </Link>
  );
}

function GroupTable({
  columns,
  headings,
  footer,
  children,
}: {
  columns: string;
  headings: string[];
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px] py-1">
        <div
          className="grid items-center gap-x-3 px-5 py-2 text-[12px] font-semibold tracking-[0.4px] text-slate-500"
          style={{ gridTemplateColumns: columns }}
        >
          <span />
          {headings.map((heading) => (
            <span key={heading}>{heading}</span>
          ))}
        </div>
        {children}
        {footer ? (
          <div className="border-t border-[#f1f3f6] px-5 py-2.5 text-[14px]">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

function GroupRow({
  columns,
  href,
  children,
}: {
  columns: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="grid items-center gap-x-3 border-t border-[#f1f3f6] px-5 py-[11px] text-[14px] text-[#18181b] hover:bg-[#f4f6f9]"
      style={{ gridTemplateColumns: columns }}
    >
      {children}
    </a>
  );
}

function Cell({
  strong = false,
  muted = false,
  small = false,
  title,
  children,
}: {
  strong?: boolean;
  muted?: boolean;
  small?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`truncate ${strong ? 'font-medium' : ''} ${muted ? 'text-[13px] tabular-nums text-slate-600' : ''
        } ${small ? 'text-[13px] text-slate-700' : ''}`}
    >
      {children}
    </span>
  );
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`size-2.5 rounded-full ${className}`} />;
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 px-5 py-[18px] text-center text-[14px] text-slate-500">{children}</p>;
}
