'use client';

import type { TenantRole } from '@enterprise-platform/contracts-identity';
import type { TenantModuleCatalogItem } from '@enterprise-platform/contracts-tenancy';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { panelButton } from '../side-panel';
import { searchText } from './authorization-client';
import { buildActionMatrix, type MatrixItem } from './action-matrix';
import type { RoleMemberUser } from './role-members';

export interface ModuleRow {
  readonly module: TenantModuleCatalogItem;
  readonly groups: readonly { group: string; items: readonly { key: string; label: string }[] }[];
  readonly roleCount: number;
}

export interface PersonRow {
  readonly id: string;
  readonly user: RoleMemberUser | undefined;
  readonly roles: readonly TenantRole[];
}

export interface RoleSummary {
  readonly actionCount: number;
  readonly moduleNames: readonly string[];
}

interface Props {
  readonly kind: 'modules' | 'people' | undefined;
  readonly onClose: () => void;
  readonly activeModules: number;
  readonly totalModules: number;
  readonly moduleRows: readonly ModuleRow[];
  readonly assigned: readonly PersonRow[];
  readonly unassigned: readonly RoleMemberUser[];
  readonly roles: readonly TenantRole[];
  readonly roleSummary: ReadonlyMap<string, RoleSummary>;
  readonly onOpenRole: (role: TenantRole) => void;
}

const PEOPLE_PAGE = 30;

/** Ngăn kéo của hai thẻ tổng quan: mặc định gọn (một dòng mỗi mục), chi tiết chỉ mở khi bấm, có tìm kiếm và lọc. */
export function AuthorizationKpiSheet(props: Props) {
  const { kind, onClose } = props;
  return (
    <Sheet open={kind !== undefined} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className={cn(
          // Sheet gốc đặt `data-[side=right]:w-3/4` và `data-[side=right]:sm:max-w-sm`; cần đúng biến thể này mới ghi đè được.
          'gap-0 border-l border-slate-200 bg-white p-0 data-[side=right]:w-[94vw]',
          kind === 'people' ? 'data-[side=right]:sm:max-w-6xl' : 'data-[side=right]:sm:max-w-5xl',
        )}
        data-testid="auth-kpi-sheet"
      >
        {kind === 'modules' ? <ModulesBody {...props} /> : null}
        {kind === 'people' ? <PeopleBody {...props} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (next: T) => void;
}) {
  return (
    <div aria-label={label} className="flex max-w-full gap-0.5 overflow-x-auto rounded-[9px] bg-[#f1f3f6] p-[3px]" role="group">
      {options.map(([v, text]) => (
        <button
          aria-pressed={value === v}
          className={cn(
            'h-7 cursor-pointer whitespace-nowrap rounded-[7px] px-2.5 text-[13px] font-semibold',
            value === v ? 'bg-white text-[#18181b] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-slate-500 hover:text-[#18181b]',
          )}
          key={v}
          onClick={() => onChange(v)}
          type="button"
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function SearchBox({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex h-9 min-w-0 flex-[1_1_200px] items-center gap-2 rounded-lg border border-[#eef0f3] bg-white px-2.5 text-slate-500 focus-within:border-[#ffc90a]">
      <Search aria-hidden className="size-4 shrink-0" />
      <input
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[14px] text-[#18181b] outline-none placeholder:text-slate-400"
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </label>
  );
}

function FilterBar({ children, summary, onReset, canReset }: { children: ReactNode; summary: string; onReset: () => void; canReset: boolean }) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-[#eef0f3] bg-[#fafbfc] px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <div className="flex items-center gap-2 text-xs text-slate-500" data-testid="auth-kpi-summary">
        <span>{summary}</span>
        {canReset ? (
          <button
            className="flex cursor-pointer items-center gap-1 font-semibold text-slate-600 hover:text-[#18181b]"
            onClick={onReset}
            type="button"
          >
            <X aria-hidden className="size-3" />
            Đặt lại
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Thao tác của một nhóm quyền, gom theo đối tượng (hàng) và mức quyền (cột); thao tác khớp từ khóa tìm được tô vàng. */
function GroupMatrix({ items, needle }: { items: readonly MatrixItem[]; needle: string }) {
  const matrix = useMemo(() => buildActionMatrix(items), [items]);
  const cell = (list: readonly MatrixItem[]) =>
    list.length === 0 ? (
      <span aria-hidden className="text-slate-300">
        &mdash;
      </span>
    ) : (
      <span className="flex flex-col gap-0.5">
        {list.map((item) => {
          const hit = needle !== '' && searchText(`${item.label} ${item.key}`).includes(needle);
          return (
            <span
              className={cn('rounded px-1 py-px text-[12px] leading-snug', hit ? 'bg-[#ffe58a] text-[#18181b]' : 'text-slate-700')}
              key={item.key}
              title={item.key}
            >
              {item.label}
            </span>
          );
        })}
      </span>
    );
  return (
    <div className="flex flex-col gap-1.5" data-testid="auth-kpi-matrix">
      <p className="m-0 text-[12px] text-slate-500">
        <b className="font-semibold text-slate-700">Hàng</b> là đối tượng được thao tác,{' '}
        <b className="font-semibold text-slate-700">cột</b> là mức quyền được cấp trên đối tượng đó.
      </p>
      <div className="overflow-x-auto rounded-lg border border-[#e5e7eb] bg-white">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr>
              <th className="w-[140px] border-b border-r border-[#e5e7eb] bg-[#f1f3f6] px-2.5 py-2 align-bottom text-[12px] font-bold tracking-[0.4px] text-slate-600">
                ĐỐI TƯỢNG
              </th>
              {matrix.columns.map((c) => (
                <th className={'border-b border-r border-[#e5e7eb] bg-[#f1f3f6] px-2.5 py-2 align-bottom text-slate-700 last:border-r-0'} key={c.level}>
                  <span className="block text-[13px] font-bold">{c.title}</span>
                  <span className="block text-[12px] font-normal opacity-80">{c.hint}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr className="border-b border-[#eef0f3] last:border-b-0" key={row.object || '_'}>
                <th className="border-r border-[#e5e7eb] bg-[#fafbfc] px-2.5 py-2 align-top text-[13px] font-semibold text-slate-800">
                  {row.title}
                </th>
                {matrix.columns.map((c) => (
                  <td className="border-r border-[#eef0f3] px-2.5 py-2 align-top last:border-r-0" key={c.level}>
                    {cell(row.cells[c.level])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModulesBody({ activeModules, totalModules, moduleRows }: Props) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [openKey, setOpenKey] = useState<string>();
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [expandAll, setExpandAll] = useState(false);

  const needle = searchText(q.trim());
  const rows = useMemo(() => {
    return moduleRows
      .filter(({ module }) =>
        status === 'all' ? true : status === 'active' ? module.entitlementStatus === 'active' : module.entitlementStatus !== 'active',
      )
      .map((row) => {
        if (!needle) return { row, nameMatch: true, matchedGroups: new Set<string>() };
        const nameMatch = searchText(`${row.module.name} ${row.module.key}`).includes(needle);
        const matchedGroups = new Set(
          row.groups
            .filter(
              (g) =>
                searchText(g.group).includes(needle) ||
                g.items.some((i) => searchText(`${i.label} ${i.key}`).includes(needle)),
            )
            .map((g) => g.group),
        );
        return { row, nameMatch, matchedGroups };
      })
      .filter(({ nameMatch, matchedGroups }) => nameMatch || matchedGroups.size > 0);
  }, [moduleRows, status, needle]);

  const toggleGroup = (id: string) =>
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const dirty = q !== '' || status !== 'all';

  return (
    <>
      <SheetHeader className="border-b border-[#eef0f3] px-5 py-4">
        <SheetTitle className="text-base font-bold text-slate-900">Module gói cấp</SheetTitle>
        <SheetDescription className="text-[14px] text-slate-500">
          {activeModules} / {totalModules} module đang hoạt động; quyền của module chưa kích hoạt chưa có tác dụng.
        </SheetDescription>
      </SheetHeader>
      <FilterBar
        canReset={dirty}
        onReset={() => {
          setQ('');
          setStatus('all');
        }}
        summary={`${rows.length} / ${moduleRows.length} module`}
      >
        <SearchBox label="Tìm module hoặc quyền" onChange={setQ} placeholder="Tìm module hoặc quyền..." value={q} />
        <Segmented
          label="Lọc trạng thái module"
          onChange={setStatus}
          options={[
            ['all', 'Tất cả'],
            ['active', 'Đang hoạt động'],
            ['inactive', 'Chưa kích hoạt'],
          ]}
          value={status}
        />
        <button
          className="h-7 cursor-pointer rounded-[7px] border border-[#eef0f3] bg-white px-2.5 text-[13px] font-semibold text-slate-700 hover:bg-[#f4f6f9]"
          onClick={() => {
            setExpandAll((v) => !v);
            setOpenKey(undefined);
          }}
          type="button"
        >
          {expandAll ? 'Thu gọn tất cả' : 'Mở rộng tất cả'}
        </button>
      </FilterBar>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rows.map(({ row, matchedGroups }) => {
            const { module, groups, roleCount } = row;
            const total = groups.reduce((n, g) => n + g.items.length, 0);
            // Đang tìm theo quyền thì tự mở module có nhóm khớp; không thì chỉ mở khi bấm (một module một lúc).
            const open = expandAll || openKey === module.key || (needle !== '' && matchedGroups.size > 0);
            return (
              <li className="rounded-[10px] border border-[#f1f3f6]" data-testid="auth-kpi-module-row" key={module.key}>
                <button
                  aria-expanded={open}
                  className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[#fafbfc]"
                  onClick={() => {
                    setExpandAll(false);
                    setOpenKey(openKey === module.key ? undefined : module.key);
                  }}
                  type="button"
                >
                  {open ? <ChevronDown aria-hidden className="size-4 shrink-0 text-slate-500" /> : <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-500" />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate text-[14px] font-semibold">{module.name}</b>
                    <span className="text-xs text-slate-500">
                      {roleCount} vai trò · {total} thao tác
                    </span>
                  </span>
                  <span
                    className={cn(
                      'whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      module.entitlementStatus === 'active'
                        ? 'bg-emerald-100 text-emerald-800'
                        : module.entitlementStatus === 'provisioning'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-[#f1f3f6] text-slate-700',
                    )}
                  >
                    {module.entitlementStatus === 'active'
                      ? 'Đang hoạt động'
                      : module.entitlementStatus === 'provisioning'
                        ? 'Đang khởi tạo'
                        : 'Chưa kích hoạt'}
                  </span>
                </button>
                {open ? (
                  <div className="flex flex-col gap-2 border-t border-[#f1f3f6] px-3 py-2.5" data-testid="auth-kpi-module-groups">
                    {groups.length === 0 ? (
                      <p className="m-0 text-xs text-slate-500">Module này không có thao tác riêng để cấp theo vai trò.</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          {groups.map((g) => {
                            const id = `${module.key}::${g.group}`;
                            const groupOpen = expandAll || openGroups.has(id) || (needle !== '' && matchedGroups.has(g.group));
                            return (
                              <button
                                aria-pressed={groupOpen}
                                className={cn(
                                  'flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-semibold',
                                  groupOpen ? 'border-[#ffc90a] bg-[#fffbeb] text-[#8a6400]' : 'border-[#eef0f3] bg-white text-slate-700 hover:bg-[#f4f6f9]',
                                )}
                                data-testid="auth-kpi-group-chip"
                                key={g.group}
                                onClick={() => toggleGroup(id)}
                                type="button"
                              >
                                {g.group}
                                <span className="rounded-full bg-slate-200 px-1.5 text-[12px] text-slate-600">{g.items.length}</span>
                              </button>
                            );
                          })}
                        </div>
                        {groups
                          .filter((g) => expandAll || openGroups.has(`${module.key}::${g.group}`) || (needle !== '' && matchedGroups.has(g.group)))
                          .map((g) => (
                            <div className="flex flex-col gap-1 rounded-lg bg-[#fafbfc] px-2.5 py-2" data-testid="auth-kpi-group-items" key={g.group}>
                              <span className="text-[12px] font-bold tracking-[0.4px] text-slate-600">{g.group.toUpperCase()}</span>
                              <GroupMatrix items={g.items} needle={needle} />
                            </div>
                          ))}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
          {rows.length === 0 ? <li className="py-8 text-center text-[14px] text-slate-500">Không có module phù hợp.</li> : null}
        </ul>
      </div>
    </>
  );
}

function PeopleBody({ assigned, unassigned, roles, roleSummary, onOpenRole }: Props) {
  const [q, setQ] = useState('');
  const [roleId, setRoleId] = useState('all');
  const [mode, setMode] = useState<'all' | 'multi' | 'disabled'>('all');
  const [openId, setOpenId] = useState<ReadonlySet<string>>(() => new Set());
  const [expandAll, setExpandAll] = useState(false);
  const [limit, setLimit] = useState(PEOPLE_PAGE);
  const [unassignedOpen, setUnassignedOpen] = useState(false);

  const needle = searchText(q.trim());
  const matchUser = (user: RoleMemberUser | undefined) =>
    !needle || (user !== undefined && searchText(`${user.fullName} ${user.email}`).includes(needle));

  const rows = useMemo(
    () =>
      assigned.filter(
        (p) =>
          matchUser(p.user) &&
          (roleId === 'all' || p.roles.some((r) => r.id === roleId)) &&
          (mode === 'all' || (mode === 'multi' ? p.roles.length > 1 : p.user?.status === 'disabled')),
      ),
    [assigned, needle, roleId, mode],
  );
  const missing = unassigned.filter(matchUser);
  const shown = rows.slice(0, limit);
  const dirty = q !== '' || roleId !== 'all' || mode !== 'all';
  const reset = () => {
    setQ('');
    setRoleId('all');
    setMode('all');
    setLimit(PEOPLE_PAGE);
  };
  const toggle = (id: string) =>
    setOpenId((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <SheetHeader className="border-b border-[#eef0f3] px-5 py-4">
        <SheetTitle className="text-base font-bold text-slate-900">Nhân sự phân quyền</SheetTitle>
        <SheetDescription className="text-[14px] text-slate-500">
          {assigned.length} người đã có vai trò, {unassigned.length} người chưa có vai trò nào.
        </SheetDescription>
      </SheetHeader>
      <FilterBar
        canReset={dirty}
        onReset={reset}
        summary={`${rows.length} / ${assigned.length} người${roleId !== 'all' || mode !== 'all' || q ? ' phù hợp' : ''}`}
      >
        <SearchBox
          label="Tìm nhân sự"
          onChange={(v) => {
            setQ(v);
            setLimit(PEOPLE_PAGE);
          }}
          placeholder="Tìm tên hoặc email..."
          value={q}
        />
        <div className="w-full sm:w-[200px]">
          <SearchableSelect
            clearable={false}
            onChange={(v) => {
              setRoleId(v);
              setLimit(PEOPLE_PAGE);
            }}
            options={[{ value: 'all', label: 'Tất cả vai trò' }, ...roles.map((r) => ({ value: r.id, label: r.name }))]}
            value={roleId}
          />
        </div>
        <Segmented
          label="Lọc nhân sự"
          onChange={(v) => {
            setMode(v);
            setLimit(PEOPLE_PAGE);
          }}
          options={[
            ['all', 'Tất cả'],
            ['multi', 'Nhiều vai trò'],
            ['disabled', 'Vô hiệu hóa'],
          ]}
          value={mode}
        />
        <button
          className="h-7 cursor-pointer rounded-[7px] border border-[#eef0f3] bg-white px-2.5 text-[13px] font-semibold text-slate-700 hover:bg-[#f4f6f9]"
          onClick={() => {
            setExpandAll((v) => !v);
            setOpenId(new Set());
          }}
          type="button"
        >
          {expandAll ? 'Thu gọn tất cả' : 'Mở rộng tất cả'}
        </button>
      </FilterBar>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {shown.map(({ id, user, roles: userRoles }) => {
            const open = expandAll || openId.has(id);
            const chips = userRoles.slice(0, 2);
            return (
              <li className="rounded-[10px] border border-[#eef0f3]" data-testid="auth-kpi-person-row" key={id}>
                <button
                  aria-expanded={open}
                  className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[#fafbfc]"
                  onClick={() => {
                    setExpandAll(false);
                    toggle(id);
                  }}
                  type="button"
                >
                  {open ? <ChevronDown aria-hidden className="size-4 shrink-0 text-slate-500" /> : <ChevronRight aria-hidden className="size-4 shrink-0 text-slate-500" />}
                  <span className="flex min-w-0 flex-[1_1_180px] flex-col">
                    <b className="truncate text-[14px] font-semibold">{user?.fullName ?? 'Người dùng đã bị xóa'}</b>
                    {user?.email ? <span className="truncate text-xs text-slate-500">{user.email}</span> : null}
                  </span>
                  {user?.status === 'disabled' ? (
                    <span className="shrink-0 rounded-md bg-red-50 px-[7px] text-[12px] font-semibold text-red-700">Vô hiệu hóa</span>
                  ) : null}
                  <span className="flex min-w-0 flex-[1_1_200px] flex-wrap justify-end gap-1">
                    {chips.map((r) => (
                      <span className="max-w-[160px] truncate rounded-md bg-[#f1f3f6] px-[7px] py-px text-[12px] text-slate-700" key={r.id}>
                        {r.name}
                      </span>
                    ))}
                    {userRoles.length > chips.length ? (
                      <span className="rounded-md bg-[#fff6d6] px-[7px] py-px text-[12px] font-semibold text-[#8a6400]">+{userRoles.length - chips.length}</span>
                    ) : null}
                  </span>
                </button>
                {open ? (
                  <ul className="m-0 flex list-none flex-col gap-1.5 border-t border-[#f1f3f6] bg-[#fafbfc] p-2.5" data-testid="auth-kpi-person-roles">
                    {userRoles.map((r) => {
                      const summary = roleSummary.get(r.id);
                      return (
                        <li className="flex items-center gap-2.5 rounded-lg border border-[#f1f3f6] bg-white px-2.5 py-2" key={r.id}>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="flex items-center gap-1.5">
                              <b className="min-w-0 truncate text-[14px] font-semibold">{r.name}</b>
                              <span className="shrink-0 rounded-md bg-[#f1f3f6] px-1.5 text-[12px] font-semibold text-slate-600">
                                {r.isSystem ? 'Hệ thống' : 'Tự tạo'}
                              </span>
                            </span>
                            <span className="text-[12px] text-slate-500">
                              {r.key === 'tenant-admin' ? 'Toàn quyền' : `${summary?.actionCount ?? 0} thao tác`}
                              {' · '}
                              {(summary?.moduleNames.length ?? 0) > 0 ? summary?.moduleNames.join(', ') : 'Chưa có module'}
                            </span>
                          </span>
                          <button
                            className={cn(panelButton.secondary, 'h-8 shrink-0 px-2.5 text-[13px]')}
                            data-testid="auth-kpi-person-role"
                            onClick={() => onOpenRole(r)}
                            type="button"
                          >
                            Mở vai trò
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
          {rows.length === 0 ? <li className="py-8 text-center text-[14px] text-slate-500">Không có nhân sự phù hợp.</li> : null}
        </ul>
        {rows.length > shown.length ? (
          <button
            className={cn(panelButton.secondary, 'mt-2 w-full')}
            data-testid="auth-kpi-more"
            onClick={() => setLimit((n) => n + PEOPLE_PAGE)}
            type="button"
          >
            Xem thêm ({rows.length - shown.length} người)
          </button>
        ) : null}

        {missing.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2" data-testid="auth-kpi-unassigned">
            <button
              aria-expanded={unassignedOpen}
              className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-[#e5e7eb] px-3 py-2.5 text-left text-[14px] font-semibold hover:bg-[#fafbfc]"
              onClick={() => setUnassignedOpen((v) => !v)}
              type="button"
            >
              {unassignedOpen ? <ChevronDown aria-hidden className="size-4 text-slate-500" /> : <ChevronRight aria-hidden className="size-4 text-slate-500" />}
              <span className="flex-1">Chưa có vai trò</span>
              <span className="rounded-full bg-amber-100 px-2 text-xs text-[#8a6400]">{missing.length}</span>
            </button>
            {unassignedOpen ? (
              <>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {missing.map((u) => (
                    <li className="flex items-center gap-2 rounded-[10px] border border-[#f1f3f6] px-3 py-2 text-[14px]" key={u.id}>
                      <span className="min-w-0 flex-1 truncate">{u.fullName}</span>
                      <span className="truncate text-xs text-slate-500">{u.email}</span>
                    </li>
                  ))}
                </ul>
                <Link className={cn(panelButton.secondary, 'inline-flex items-center self-start')} href="/users">
                  Gán vai trò ở trang Người dùng
                </Link>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
