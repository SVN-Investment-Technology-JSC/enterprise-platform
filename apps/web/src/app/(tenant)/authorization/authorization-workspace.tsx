'use client';

import {
  TENANT_PERMISSION_ACTIONS,
  type TenantPermission,
  type TenantRole,
} from '@enterprise-platform/contracts-identity';
import type { TenantModuleCatalogItem } from '@enterprise-platform/contracts-tenancy';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useMemo, type FormEvent } from 'react';
import {
  ShieldCheck,
  Shield,
  KeyRound,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Search,
  X,
  Users,
  Layers,
  Workflow,
  Wrench,
  Boxes,
  FileText,
  BarChart3,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Info,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { PermissionPicker } from './permission-picker';
import { authorizationRequest, searchText } from './authorization-client';

interface AuthorizationWorkspaceProps {
  readonly initialRoles: TenantRole[];
  readonly initialPermissions: TenantPermission[];
  readonly modules: TenantModuleCatalogItem[];
}

type Editor = {
  id?: string;
  name: string;
  key?: string;
  description: string;
  actionKeys: string[];
  permissionIds: string[];
  moduleKeys: string[];
};

const emptyEditor: Editor = {
  name: '',
  key: '',
  description: '',
  actionKeys: [],
  permissionIds: [],
  moduleKeys: [],
};

function getModuleIcon(key: string) {
  switch (key) {
    case 'procedure-engine':
    case 'procedure':
      return Workflow;
    case 'maintenance':
      return Wrench;
    case 'inventory':
      return Boxes;
    case 'docs':
    case 'documents':
      return FileText;
    case 'analytics':
    case 'bi':
      return BarChart3;
    default:
      return Layers;
  }
}

export function AuthorizationWorkspace({
  initialRoles,
  initialPermissions,
  modules,
}: AuthorizationWorkspaceProps) {
  const router = useRouter();
  const [roles, setRoles] = useState(initialRoles);
  const [permissions, setPermissions] = useState(initialPermissions);
  const [tab, setTab] = useState<'roles' | 'permissions'>('roles');
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialRoles[0]?.id,
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Editor>();
  const [busy, setBusy] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Statistics calculation
  const stats = useMemo(() => {
    const totalRoles = roles.length;
    const systemRoles = roles.filter((r) => r.isSystem).length;
    const customRoles = totalRoles - systemRoles;
    const activeModules = modules.filter(
      (m) => m.entitlementStatus === 'active',
    ).length;
    const totalPermissions = permissions.length;
    const totalAssignedUsers = new Set(roles.flatMap((r) => r.userIds)).size;

    return {
      totalRoles,
      systemRoles,
      customRoles,
      activeModules,
      totalPermissions,
      totalAssignedUsers,
    };
  }, [roles, permissions, modules]);

  // Filtered list of items
  const items = useMemo(() => {
    const source = tab === 'roles' ? roles : permissions;
    const q = searchText(query);

    return source.filter((item) => {
      const matchQuery =
        !q ||
        searchText(`${item.name} ${item.description}`).includes(q) ||
        ('key' in item && searchText(item.key).includes(q));

      if (!matchQuery) return false;

      if (tab === 'roles' && filter !== 'all') {
        const isSys = (item as TenantRole).isSystem;
        if (filter === 'system' && !isSys) return false;
        if (filter === 'custom' && isSys) return false;
      }

      return true;
    });
  }, [tab, roles, permissions, query, filter]);

  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pages);

  const selected = useMemo(() => {
    return items.find((item) => item.id === selectedId) ?? items[0];
  }, [items, selectedId]);

  const role = tab === 'roles' ? (selected as TenantRole | undefined) : undefined;
  const permission =
    tab === 'permissions' ? (selected as TenantPermission | undefined) : undefined;

  const actions = useMemo(() => {
    if (role) {
      return [
        ...new Set(
          permissions
            .filter((p) => role.permissionIds.includes(p.id))
            .flatMap((p) => p.actionKeys),
        ),
      ];
    }
    return permission?.actionKeys ?? [];
  }, [role, permission, permissions]);

  const used = role ? role.userIds.length : (permission?.roleIds.length ?? 0);

  async function reload() {
    setIsRefreshing(true);
    try {
      const [r, p] = await Promise.all([
        authorizationRequest<{ roles: TenantRole[] }>('tenant-roles'),
        authorizationRequest<{ permissions: TenantPermission[] }>(
          'tenant-permissions',
        ),
      ]);
      setRoles(r.roles);
      setPermissions(p.permissions);
      router.refresh();
      toast.info('Đã làm mới dữ liệu phân quyền thành công.');
    } catch {
      toast.error('Không thể tải lại dữ liệu phân quyền.');
    } finally {
      setIsRefreshing(false);
    }
  }

  function edit() {
    if (!selected) return;
    setEditor({
      ...emptyEditor,
      ...selected,
      key: 'key' in selected ? (selected as TenantRole).key : '',
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || busy) return;

    if (!editor.name.trim()) {
      toast.error('Vui lòng nhập tên định danh.');
      return;
    }

    setBusy(true);
    try {
      const body =
        tab === 'roles'
          ? {
              name: editor.name.trim(),
              description: editor.description.trim(),
              permissionIds: editor.permissionIds,
              moduleKeys: editor.moduleKeys,
            }
          : {
              name: editor.name.trim(),
              description: editor.description.trim(),
              actionKeys: editor.actionKeys,
            };

      const result = await authorizationRequest<{ id: string }>(
        `tenant-${tab}${editor.id ? `/${editor.id}` : ''}`,
        editor.id ? 'PATCH' : 'POST',
        body,
      );

      setEditor(undefined);
      setSelectedId(result.id);
      toast.success(
        `Đã lưu ${tab === 'roles' ? 'vai trò' : 'permission'} "${editor.name}" thành công!`,
      );
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Không thể lưu.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected || busy) return;
    setBusy(true);

    try {
      await authorizationRequest(`tenant-${tab}/${selected.id}`, 'DELETE');
      toast.success(`Đã xóa ${tab === 'roles' ? 'vai trò' : 'permission'} thành công.`);
      setSelectedId(undefined);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Không thể xóa mục này.');
    } finally {
      setBusy(false);
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Đã sao chép mã "${text}" vào bộ nhớ tạm.`);
  };

  return (
    <main className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden bg-[#f8f9ff] p-4 sm:p-6 text-slate-900">
      {/* 1. TOP HEADER & METRIC CARDS */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <nav
              aria-label="Breadcrumb"
              className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-500 font-medium"
            >
              <Link href="/dashboard" className="hover:text-blue-600 transition-colors">
                Tenant Portal
              </Link>
              <span className="text-slate-400">/</span>
              <span className="hover:text-blue-600 transition-colors">Quản trị</span>
              <span className="text-slate-400">/</span>
              <span className="text-slate-800 font-semibold">Phân quyền & Vai trò</span>
            </nav>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-500/20">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  Vai trò & Phân quyền
                </h1>
                <p className="text-xs text-slate-500">
                  Cấu hình quyền thao tác Core, quyền thao tác module và quyền truy cập module cho người dùng tenant.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              disabled={isRefreshing}
              onClick={() => void reload()}
              className="h-9 gap-1.5 border-slate-200 bg-white shadow-2xs hover:bg-slate-50"
            >
              <RefreshCw
                className={`size-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : 'text-slate-600'}`}
              />
              <span className="hidden sm:inline">Làm mới</span>
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setEditor({ ...emptyEditor });
              }}
              className="h-9 gap-1.5 bg-blue-600 text-white shadow-sm shadow-blue-500/25 hover:bg-blue-700"
            >
              <Plus className="size-4 stroke-[2.5]" />
              <span>Tạo {tab === 'roles' ? 'vai trò' : 'permission'}</span>
            </Button>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Shield className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                Tổng vai trò
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-slate-900">{stats.totalRoles}</span>
                <span className="text-[11px] text-slate-400">
                  ({stats.systemRoles} hệ thống / {stats.customRoles} tự tạo)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <KeyRound className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                Permission
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-slate-900">
                  {stats.totalPermissions}
                </span>
                <span className="text-[11px] text-slate-400">quyền tiêu chuẩn</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Layers className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                Module gói cấp
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-emerald-700">
                  {stats.activeModules}
                </span>
                <span className="text-[11px] text-slate-400">/ {modules.length} kích hoạt</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
              <Users className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                Nhân sự phân quyền
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-slate-900">
                  {stats.totalAssignedUsers}
                </span>
                <span className="text-[11px] text-slate-400">người dùng</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 2. MASTER - DETAIL 16:9 SPLIT GRID */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[40%_60%] xl:grid-cols-[38%_62%]">
        {/* LEFT COLUMN: MASTER LIST */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
          {/* Tabs bar */}
          <div className="flex items-center justify-between border-b border-slate-200 px-3 pt-3 pb-2">
            <div
              className="flex rounded-lg bg-slate-100 p-0.5"
              role="tablist"
              aria-label="Loại phân quyền"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'roles'}
                onClick={() => {
                  setTab('roles');
                  setQuery('');
                  setPage(1);
                  setSelectedId(undefined);
                }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  tab === 'roles'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Shield className="size-3.5" />
                <span>Vai trò</span>
                <Badge
                  variant={tab === 'roles' ? 'default' : 'secondary'}
                  className={`ml-1 px-1.5 py-0 text-[10px] ${
                    tab === 'roles' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {roles.length}
                </Badge>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={tab === 'permissions'}
                onClick={() => {
                  setTab('permissions');
                  setQuery('');
                  setPage(1);
                  setSelectedId(undefined);
                }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  tab === 'permissions'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <KeyRound className="size-3.5" />
                <span>Permission</span>
                <Badge
                  variant={tab === 'permissions' ? 'default' : 'secondary'}
                  className={`ml-1 px-1.5 py-0 text-[10px] ${
                    tab === 'permissions'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {permissions.length}
                </Badge>
              </button>
            </div>

            <span className="text-xs text-slate-400">
              {items.length} kết quả
            </span>
          </div>

          {/* Search & Filter tools (Single Row) */}
          <div className="border-b border-slate-200/80 bg-slate-50/60 p-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  aria-label="Tìm kiếm vai trò hoặc permission"
                  placeholder="Tìm theo tên, mã hoặc mô tả..."
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  className="h-9 bg-white pl-9 pr-8 text-xs sm:text-sm"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Xóa từ khóa tìm kiếm"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              {tab === 'roles' && (
                <div className="w-44 shrink-0 sm:w-48">
                  <SearchableSelect
                    value={filter}
                    clearable={false}
                    options={[
                      { value: 'all', label: 'Tất cả vai trò' },
                      { value: 'custom', label: 'Vai trò tùy chỉnh' },
                      { value: 'system', label: 'Vai trò hệ thống' },
                    ]}
                    onChange={(v) => {
                      setFilter(v);
                      setPage(1);
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Items List (Scrollable) */}
          <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-100">
            {items
              .slice((currentPage - 1) * pageSize, currentPage * pageSize)
              .map((item) => {
                const isSelected = selected?.id === item.id;
                const isRole = 'userIds' in item;
                const isSys = 'isSystem' in item && item.isSystem;

                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    aria-pressed={isSelected}
                    className={`group relative flex w-full flex-col gap-1.5 p-3.5 text-left transition-all ${
                      isSelected
                        ? 'border-l-4 border-l-blue-600 bg-blue-50/70 text-slate-900 shadow-2xs'
                        : 'border-l-4 border-l-transparent hover:bg-slate-50/80 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {isRole ? (
                          <Shield
                            className={`size-4 shrink-0 ${
                              isSelected ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'
                            }`}
                          />
                        ) : (
                          <KeyRound
                            className={`size-4 shrink-0 ${
                              isSelected ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'
                            }`}
                          />
                        )}
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {item.name}
                        </span>
                      </div>

                      {isSys ? (
                        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                          Hệ thống
                        </span>
                      ) : isRole ? (
                        <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                          Tùy chỉnh
                        </span>
                      ) : null}
                    </div>

                    <p className="line-clamp-2 text-xs text-slate-500 leading-relaxed">
                      {item.description || 'Không có mô tả chi tiết.'}
                    </p>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      {isRole ? (
                        <>
                          <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                            <Users className="size-3" />
                            {(item as TenantRole).userIds.length} người dùng
                          </span>
                          <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                            <Layers className="size-3" />
                            {(item as TenantRole).moduleKeys.includes('*')
                              ? 'Tất cả module'
                              : `${(item as TenantRole).moduleKeys.length} module`}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                            <Shield className="size-3" />
                            {(item as TenantPermission).roleIds.length} vai trò
                          </span>
                          <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                            {(item as TenantPermission).actionKeys.length} hành động
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}

            {!items.length && (
              <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <Search className="mb-2 size-8 opacity-30" />
                <p className="text-sm font-medium text-slate-600">Không tìm thấy dữ liệu</p>
                <p className="mt-1 text-xs text-slate-400">
                  Thử tìm kiếm với từ khóa khác hoặc điều chỉnh bộ lọc.
                </p>
              </div>
            )}
          </div>

          {/* Pagination */}
          <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
            <span>
              Trang {currentPage} / {pages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                className="h-7 px-2 text-xs"
              >
                <ChevronLeft className="mr-0.5 size-3.5" />
                Trước
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage >= pages}
                onClick={() => setPage(currentPage + 1)}
                className="h-7 px-2 text-xs"
              >
                Sau
                <ChevronRight className="ml-0.5 size-3.5" />
              </Button>
            </div>
          </footer>
        </section>

        {/* RIGHT COLUMN: DETAIL & ACTION CONSOLE */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
          {selected ? (
            <div className="flex h-full flex-col overflow-y-auto p-5 sm:p-6 space-y-6">
              {/* Detail Header Hero */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                      {role ? <ShieldCheck className="size-6" /> : <KeyRound className="size-6" />}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-bold tracking-tight text-slate-900">
                          {selected.name}
                        </h2>
                        {role?.isSystem ? (
                          <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                            Hệ thống
                          </span>
                        ) : role ? (
                          <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                            Vai trò tùy chỉnh
                          </span>
                        ) : null}
                      </div>

                      {role && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-slate-400">Key:</span>
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700">
                            {role.key}
                          </code>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(role.key)}
                            className="text-slate-400 hover:text-slate-600"
                            aria-label="Sao chép key"
                          >
                            <Copy className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                    {selected.description || 'Chưa thiết lập mô tả cho mục này.'}
                  </p>
                </div>

                {/* Top Action Buttons (Edit / Delete) */}
                {!role?.isSystem && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={edit}
                      className="h-8 gap-1.5 text-xs font-medium border-slate-200 shadow-2xs hover:bg-slate-50"
                    >
                      <Pencil className="size-3.5 text-slate-600" />
                      <span>Chỉnh sửa</span>
                    </Button>

                    <Popconfirm
                      title="Xác nhận xóa phân quyền?"
                      description="Hành động này sẽ thu hồi quyền ngay lập tức và không thể khôi phục."
                      okText="Xóa mục này"
                      cancelText="Hủy"
                      okType="danger"
                      onConfirm={() => void remove()}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || used > 0}
                        className="h-8 gap-1.5 text-xs font-medium text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="size-3.5" />
                        <span>Xóa</span>
                      </Button>
                    </Popconfirm>
                  </div>
                )}
              </div>

              {/* Special alert for System Roles */}
              {role?.key === 'tenant-admin' && (
                <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-900">
                  <Info className="size-5 shrink-0 text-blue-600 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-blue-950">
                      Vai trò Quản trị viên cấp cao (tenant-admin)
                    </p>
                    <p className="text-xs text-blue-800 leading-relaxed">
                      Sở hữu toàn bộ quyền thao tác Core và module đang kích hoạt cho tenant. Đây là vai trò hệ thống, không thể thay đổi hoặc xóa bỏ.
                    </p>
                  </div>
                </div>
              )}

              {/* SECTION: MODULE ENTITLEMENTS (IF ROLE) */}
              {role && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers className="size-4.5 text-blue-600" />
                      <h3 className="text-sm font-bold text-slate-900">
                        Phạm vi Module tính năng được cấp phép
                      </h3>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {role.moduleKeys.includes('*')
                        ? 'Toàn quyền Module'
                        : `${role.moduleKeys.length} module được chọn`}
                    </Badge>
                  </div>

                  {role.moduleKeys.includes('*') ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-900 flex items-center gap-2.5">
                      <CheckCircle2 className="size-4.5 text-emerald-600 shrink-0" />
                      <span>
                        Vai trò này được cấu hình quyền <strong>tất cả module (*)</strong>. Người dùng sẽ truy cập được bất kỳ module nào mà doanh nghiệp đang kích hoạt.
                      </span>
                    </div>
                  ) : null}

                  {/* Modules Cards Grid */}
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {modules.map((m) => {
                      const isGranted =
                        role.moduleKeys.includes('*') || role.moduleKeys.includes(m.key);
                      const isModuleActive = m.entitlementStatus === 'active';
                      const ModIcon = getModuleIcon(m.key);

                      return (
                        <div
                          key={m.key}
                          className={`flex items-start gap-3 rounded-xl border p-3.5 transition-all ${
                            isGranted
                              ? 'border-blue-200 bg-blue-50/30 shadow-2xs'
                              : 'border-slate-200/80 bg-slate-50/50 opacity-70'
                          }`}
                        >
                          <div
                            className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                              isGranted
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-200 text-slate-500'
                            }`}
                          >
                            <ModIcon className="size-4.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="truncate text-xs font-bold text-slate-900">
                                {m.name}
                              </span>
                              {isModuleActive ? (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 shrink-0">
                                  Trong gói
                                </span>
                              ) : (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 shrink-0">
                                  Chưa kích hoạt
                                </span>
                              )}
                            </div>
                            <p className="mt-1 line-clamp-1 text-[11px] text-slate-500">
                              {m.description || 'Không có mô tả phân hệ.'}
                            </p>
                            <div className="mt-2 flex items-center justify-between text-[11px]">
                              <span className="text-slate-400 font-mono text-[10px]">
                                {m.key}
                              </span>
                              <span
                                className={`font-semibold ${
                                  isGranted ? 'text-blue-600' : 'text-slate-400'
                                }`}
                              >
                                {isGranted ? 'Được cấp quyền' : 'Không phân bổ'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SECTION: CORE ACTIONS & PERMISSIONS */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound className="size-4.5 text-blue-600" />
                    <h3 className="text-sm font-bold text-slate-900">
                      Hành động & Quyền thao tác ({actions.length})
                    </h3>
                  </div>
                </div>

                {actions.length > 0 ? (
                  <div className="rounded-xl border border-slate-200/90 bg-slate-50/50 p-4">
                    <div className="flex flex-wrap gap-2">
                      {actions.map((act) => {
                        const actDef = TENANT_PERMISSION_ACTIONS.find(
                          (item) => item.key === act,
                        );
                        return (
                          <div
                            key={act}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs shadow-2xs"
                          >
                            <Check className="size-3 text-emerald-600 stroke-[3]" />
                            <span className="font-medium text-slate-800">
                              {actDef?.label ?? act}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              ({act})
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                    Không cấp quyền thao tác Core hoặc module.
                  </div>
                )}
              </div>

              {/* SECTION: AUDIT & USER ASSIGNMENT */}
              <div className="rounded-xl border border-slate-200/90 bg-slate-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="size-4.5 text-blue-600" />
                    <h3 className="text-sm font-bold text-slate-900">
                      Phân bổ người dùng & Kiểm toán
                    </h3>
                  </div>
                  <span className="text-xs text-slate-500">
                    {used} {role ? 'người dùng đang gán vai trò này' : 'vai trò sử dụng permission'}
                  </span>
                </div>

                {used > 0 && !role?.isSystem ? (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    <AlertCircle className="size-4 shrink-0 text-amber-600" />
                    <span>
                      Vai trò này hiện đang được gán cho <strong>{used} người dùng</strong>. Vui lòng gỡ hoặc chuyển đổi vai trò cho người dùng trước khi thực hiện xóa.
                    </span>
                  </div>
                ) : null}

                {role ? (
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs text-slate-500">
                      Cần gán vai trò này cho nhân sự trong tổ chức?
                    </p>
                    <Link
                      href="/users"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      <Users className="size-3.5" />
                      <span>Quản lý người dùng & Gán vai trò</span>
                      <ExternalLink className="size-3" />
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-400">
              <Shield className="mb-2 size-10 opacity-30" />
              <p className="text-sm font-medium text-slate-600">
                Chọn một mục bên danh sách để xem chi tiết
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Bạn có thể xem các quyền, module được cấp và danh sách người dùng được phân bổ.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* 3. DIALOG CREATION / EDIT MODAL */}
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(undefined);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto p-6">
          <DialogHeader className="border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                {tab === 'roles' ? <ShieldCheck className="size-5" /> : <KeyRound className="size-5" />}
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-slate-900">
                  {editor?.id ? 'Chỉnh sửa' : 'Tạo mới'}{' '}
                  {tab === 'roles' ? 'vai trò người dùng' : 'permission'}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  {tab === 'roles'
                    ? 'Khai báo thông tin định danh và phân định quyền truy cập module tính năng.'
                    : 'Chọn các hành động Core hoặc module. Quyền truy cập module được cấp riêng trong role.'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {editor && (
            <form onSubmit={save} className="mt-4 space-y-6">
              <fieldset disabled={busy} className="space-y-6">
                {/* PHẦN 1: THÔNG TIN CƠ BẢN */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      1. Thông tin định danh
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Mục có dấu (<span className="text-red-500">*</span>) là bắt buộc
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
                      <span>
                        Tên {tab === 'roles' ? 'vai trò' : 'permission'}{' '}
                        <span className="text-red-500">*</span>
                      </span>
                      <Input
                        required
                        maxLength={180}
                        placeholder={
                          tab === 'roles'
                            ? 'Ví dụ: Quản lý Bảo trì, Nhân viên Kho...'
                            : 'Ví dụ: Quản lý dữ liệu người dùng...'
                        }
                        value={editor.name}
                        onChange={(e) =>
                          setEditor({ ...editor, name: e.target.value })
                        }
                        className="h-9 text-sm"
                      />
                    </label>

                    {tab === 'roles' && (
                      <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
                        <span>Mô tả ngắn gọn</span>
                        <Input
                          maxLength={2000}
                          placeholder="Mục đích sử dụng của vai trò này..."
                          value={editor.description}
                          onChange={(e) =>
                            setEditor({ ...editor, description: e.target.value })
                          }
                          className="h-9 text-sm"
                        />
                      </label>
                    )}
                  </div>
                </div>

                {/* PHẦN 2: CHỌN MODULE (CHỈ CHO VAI TRÒ) */}
                {tab === 'roles' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                      <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        2. Phân hệ Module truy cập
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const allActive = modules
                              .filter((m) => m.entitlementStatus === 'active')
                              .map((m) => m.key);
                            setEditor({ ...editor, moduleKeys: allActive });
                          }}
                          className="h-6 text-[11px] text-blue-600 hover:text-blue-700 p-0"
                        >
                          Chọn tất cả trong gói
                        </Button>
                        <span className="text-slate-300">|</span>
                        <span className="text-xs text-blue-700 font-semibold">
                          Đã chọn: {editor.moduleKeys.length} module
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {modules.map((m) => {
                        const isChecked = editor.moduleKeys.includes(m.key);
                        const isActive = m.entitlementStatus === 'active';
                        const ModIcon = getModuleIcon(m.key);

                        return (
                          <label
                            key={m.key}
                            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all ${
                              isChecked
                                ? 'border-blue-400 bg-blue-50/60 shadow-2xs'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 size-4 rounded accent-blue-600"
                              checked={isChecked}
                              onChange={(e) => {
                                const newModules = e.target.checked
                                  ? [...editor.moduleKeys, m.key]
                                  : editor.moduleKeys.filter((k) => k !== m.key);
                                setEditor({ ...editor, moduleKeys: newModules });
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <ModIcon className="size-3.5 shrink-0 text-blue-600" />
                                  <span className="truncate text-xs font-bold text-slate-900">
                                    {m.name}
                                  </span>
                                </div>
                                {isActive ? (
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                    Trong gói
                                  </span>
                                ) : (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                                    Chưa mở
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
                                {m.description || 'Không có mô tả phân hệ.'}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* PHẦN 3: PERMISSION & HÀNH ĐỘNG CORE */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      {tab === 'roles' ? '3. Quyền thao tác' : '2. Danh mục hành động'}
                    </span>
                  </div>

                  {tab === 'permissions' ? (
                    <>
                    <p className="text-xs text-slate-500">
                      Inventory/Maintenance: cấp thêm quyền Xem khi chọn quyền giao dịch hoặc xử lý đợt. Quyền Quản lý bao gồm Xem và xử lý. Quyền vào module được chọn riêng trong vai trò.
                    </p>
                    <PermissionPicker
                      label="Hành động Core và module"
                      options={TENANT_PERMISSION_ACTIONS.map((a) => ({
                        id: a.key,
                        label: a.label,
                        description: a.key,
                        group: a.group,
                      }))}
                      values={editor.actionKeys}
                      onChange={(actionKeys) =>
                        setEditor({ ...editor, actionKeys })
                      }
                    />
                    </>
                  ) : (
                    <PermissionPicker
                      label="Permission"
                      options={permissions.map((p) => ({
                        id: p.id,
                        label: p.name,
                        description: p.description,
                      }))}
                      values={editor.permissionIds}
                      onChange={(permissionIds) =>
                        setEditor({ ...editor, permissionIds })
                      }
                    />
                  )}
                </div>

                {/* FOOTER ACTIONS */}
                <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditor(undefined)}
                    disabled={busy}
                  >
                    Hủy bỏ
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      busy ||
                      !editor.name.trim() ||
                      (tab === 'permissions' && !editor.actionKeys.length)
                    }
                    className="bg-blue-600 text-white hover:bg-blue-700 min-w-24"
                  >
                    {busy ? 'Đang lưu…' : 'Lưu lại'}
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
