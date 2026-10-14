'use client';

import {
  TENANT_PERMISSION_ACTIONS,
  type TenantPermission,
  type TenantRole,
} from '@enterprise-platform/contracts-identity';
import type { TenantModuleCatalogItem } from '@enterprise-platform/contracts-tenancy';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { panelButton } from '../side-panel';
import { PermissionPicker } from './permission-picker';
import { RoleMembers, type RoleMemberUser } from './role-members';
import { authorizationRequest, searchText } from './authorization-client';

interface AuthorizationWorkspaceProps {
  readonly initialRoles: TenantRole[];
  readonly initialPermissions: TenantPermission[];
  readonly modules: TenantModuleCatalogItem[];
  readonly users: readonly RoleMemberUser[];
}

type Editor = {
  id?: string;
  name: string;
  key?: string;
  description: string;
  actionKeys: string[];
  permissionIds: string[];
};

const emptyEditor: Editor = {
  name: '',
  key: '',
  description: '',
  actionKeys: [],
  permissionIds: [],
};

export function AuthorizationWorkspace({
  initialRoles,
  initialPermissions,
  modules,
  users,
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
  const [detailPick, setDetailPick] = useState<{ id: string; tab: 'actions' | 'members' }>();
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
  // Quản trị tenant có toàn quyền nên chỉ hiện người giữ vai trò; vai trò khác chia tab để danh sách quyền dài không đẩy phần người dùng xuống.
  const showDetailTabs = !!role && role.key !== 'tenant-admin';
  const detailTab: 'actions' | 'members' = !role
    ? 'actions'
    : role.key === 'tenant-admin'
      ? 'members'
      : detailPick?.id === role.id
        ? detailPick.tab
        : 'actions';

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

  /** Tải lại vai trò sau khi gán/gỡ người dùng, không hiện thông báo làm mới. */
  async function refreshRoles() {
    const r = await authorizationRequest<{ roles: TenantRole[] }>('tenant-roles');
    setRoles(r.roles);
    router.refresh();
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


  // Danh sách theo nhóm: vai trò chia hệ thống / tùy chỉnh (hệ thống lên trước),
  // permission một nhóm. Phân trang trên danh sách đã xếp nhóm.
  const ordered =
    tab === 'roles'
      ? [
        ...items.filter((item) => (item as TenantRole).isSystem),
        ...items.filter((item) => !(item as TenantRole).isSystem),
      ]
      : items;
  const pageItems = ordered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const listGroups = (
    tab === 'roles'
      ? [
        {
          id: 'system',
          title: 'Vai trò hệ thống',
          tone: 'bg-slate-100 text-slate-700',
          total: items.filter((item) => (item as TenantRole).isSystem).length,
          rows: pageItems.filter((item) => (item as TenantRole).isSystem),
        },
        {
          id: 'custom',
          title: 'Vai trò tùy chỉnh',
          tone: 'bg-[#fff6d6] text-[#8a6400]',
          total: items.filter((item) => !(item as TenantRole).isSystem).length,
          rows: pageItems.filter((item) => !(item as TenantRole).isSystem),
        },
      ]
      : [
        {
          id: 'permissions',
          title: 'Permission',
          tone: 'bg-indigo-100 text-indigo-700',
          total: items.length,
          rows: pageItems,
        },
      ]
  ).filter((group) => group.rows.length > 0);

  // Hành động gom theo nhóm của danh mục hệ thống (Tổ chức, HRM · Cá nhân…).
  const actionGroups = useMemo(() => {
    const groups: { group: string; items: { key: string; label: string }[] }[] = [];
    for (const key of actions) {
      const def = TENANT_PERMISSION_ACTIONS.find((item) => item.key === key);
      const group = def?.group ?? 'Khác';
      let entry = groups.find((item) => item.group === group);
      if (!entry) {
        entry = { group, items: [] };
        groups.push(entry);
      }
      entry.items.push({ key, label: def?.label ?? key });
    }
    return groups;
  }, [actions]);

  // Form nằm thay chỗ phần chi tiết; màn hẹp nó ở dưới danh sách nên cuộn tới khi mở.
  const formRef = useRef<HTMLFormElement>(null);
  const editorKey = editor ? (editor.id ?? 'new') : undefined;
  useEffect(() => {
    if (editorKey) formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [editorKey]);

  const switchTab = (next: 'roles' | 'permissions') => {
    // Đổi tab thì bỏ form đang mở: lưu dựa vào tab hiện tại để chọn loại bản ghi.
    if (busy) return;
    setTab(next);
    setQuery('');
    setPage(1);
    setSelectedId(undefined);
    setEditor(undefined);
  };

  return (
    <div className="flex flex-col gap-4 text-[14px] text-[#18181b]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-[1_1_420px]">
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.3px]">Vai trò &amp; Phân quyền</h1>
          <p className="mt-1 text-[13.5px] text-slate-600">
            Cấu hình quyền thao tác Core và module cho người dùng tenant; quyền vào module được suy ra từ các thao tác được cấp.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => void reload()}
            className="flex h-[38px] cursor-pointer items-center gap-1.5 rounded-lg border border-[#eef0f3] bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-[#f4f6f9] disabled:opacity-60"
          >
            <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
            Làm mới
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditor({ ...emptyEditor })}
            className="flex h-[38px] cursor-pointer items-center gap-1.5 rounded-lg bg-[#ffc90a] px-3.5 text-[13px] font-bold text-[#18181b] hover:bg-[#ffd84d] disabled:opacity-60"
          >
            <Plus className="size-4" />
            Tạo {tab === 'roles' ? 'vai trò' : 'permission'}
          </button>
        </div>
      </div>

      <section
        aria-label="Tổng quan phân quyền"
        className="grid grid-cols-1 overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white sm:grid-cols-2 xl:grid-cols-4"
      >
        <Kpi
          icon={<Shield className="size-4" />}
          tone="bg-blue-100 text-blue-800"
          label="TỔNG VAI TRÒ"
          value={stats.totalRoles}
          note={`(${stats.systemRoles} hệ thống / ${stats.customRoles} tự tạo)`}
        />
        <Kpi
          icon={<KeyRound className="size-4" />}
          tone="bg-indigo-100 text-indigo-700"
          label="PERMISSION"
          value={stats.totalPermissions}
          note="quyền tiêu chuẩn"
        />
        <Kpi
          icon={<Layers className="size-4" />}
          tone="bg-emerald-100 text-emerald-800"
          label="MODULE GÓI CẤP"
          value={stats.activeModules}
          valueClass="text-emerald-700"
          note={`/ ${modules.length} kích hoạt`}
        />
        <Kpi
          icon={<Users className="size-4" />}
          tone="bg-violet-100 text-violet-700"
          label="NHÂN SỰ PHÂN QUYỀN"
          value={stats.totalAssignedUsers}
          note="người dùng"
          last
        />
      </section>

      <div className="flex flex-wrap items-start gap-4">
        <section
          aria-label="Danh sách phân quyền"
          className="flex max-w-full flex-[1_1_360px] flex-col gap-3"
        >
          <div className="flex items-center gap-2.5">
            <div
              className="flex gap-0.5 rounded-[9px] bg-[#f1f3f6] p-[3px]"
              role="tablist"
              aria-label="Loại phân quyền"
            >
              {(
                [
                  ['roles', 'Vai trò', roles.length],
                  ['permissions', 'Permission', permissions.length],
                ] as const
              ).map(([value, label, count]) => {
                const active = tab === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchTab(value)}
                    className={cn(
                      'flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] font-semibold',
                      active
                        ? 'bg-white text-[#18181b] shadow-[0_1px_2px_rgba(0,0,0,.08)]'
                        : 'text-slate-500 hover:text-[#18181b]',
                    )}
                  >
                    {label}
                    <span
                      className={cn(
                        'rounded-full px-[7px] text-[11px]',
                        active ? 'bg-[#ffc90a] text-[#18181b]' : 'bg-slate-200 text-slate-600',
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="flex-1" />
            <span className="text-[12.5px] text-slate-500">{items.length} kết quả</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <label className="flex h-9 min-w-0 flex-[1_1_170px] items-center gap-2 rounded-lg border border-[#eef0f3] bg-white px-2.5 text-slate-500 focus-within:border-[#ffc90a]">
              <Search className="size-3.5 shrink-0" aria-hidden />
              <input
                type="search"
                aria-label="Tìm kiếm vai trò hoặc permission"
                placeholder="Tìm theo tên, mã hoặc mô tả..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#18181b] outline-none placeholder:text-slate-400"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Xóa từ khóa tìm kiếm"
                  className="cursor-pointer text-slate-400 hover:text-slate-600"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </label>
            {tab === 'roles' && (
              <div className="min-w-[160px] flex-[1_1_160px]">
                <SearchableSelect
                  value={filter}
                  height={36}
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

          {listGroups.map((group) => (
            <div
              key={group.id}
              className="overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white"
            >
              <div className="flex items-center gap-2.5 bg-[#fafbfc] px-4 py-[11px]">
                <span
                  aria-hidden
                  className={`grid size-7 shrink-0 place-items-center rounded-[7px] ${group.tone}`}
                >
                  {tab === 'roles' ? <Shield className="size-3.5" /> : <KeyRound className="size-3.5" />}
                </span>
                <span className="flex-1 text-[13.5px] font-semibold">{group.title}</span>
                <span className="rounded-xl border border-[#eef0f3] bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">
                  {group.total}
                </span>
              </div>
              {group.rows.map((item) => {
                const isSelected = !editor && selected?.id === item.id;
                const isRole = 'userIds' in item;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => {
                      if (busy) return;
                      setSelectedId(item.id);
                      setEditor(undefined);
                    }}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex w-full cursor-pointer flex-col gap-1 border-t border-[#f1f3f6] px-4 py-[11px] text-left',
                      isSelected ? 'bg-[#fffbeb] shadow-[inset_3px_0_0_#ffc90a]' : 'bg-white hover:bg-[#f4f6f9]/60',
                    )}
                  >
                    <b className="text-[13px]">{item.name}</b>
                    <span className="line-clamp-2 text-xs text-slate-500">
                      {item.description || 'Không có mô tả chi tiết.'}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {isRole ? (
                        <>
                          <Chip>{(item as TenantRole).userIds.length} người dùng</Chip>
                          <Chip>
                            {(item as TenantRole).moduleKeys.includes('*')
                              ? 'Tất cả module'
                              : `${(item as TenantRole).moduleKeys.length} module`}
                          </Chip>
                        </>
                      ) : (
                        <>
                          <Chip>{(item as TenantPermission).roleIds.length} vai trò</Chip>
                          <Chip>{(item as TenantPermission).actionKeys.length} hành động</Chip>
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}

          {!items.length && (
            <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-slate-200 bg-white p-8 text-center text-slate-400">
              <Search className="mb-2 size-8 opacity-30" />
              <p className="m-0 text-sm font-medium text-slate-600">Không tìm thấy dữ liệu</p>
              <p className="m-0 mt-1 text-xs text-slate-400">
                Thử tìm kiếm với từ khóa khác hoặc điều chỉnh bộ lọc.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between text-[12.5px] text-slate-500">
            <span>
              Trang {currentPage} / {pages}
            </span>
            <span className="flex gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                className={PAGER}
              >
                <ChevronLeft className="size-3.5" />
                Trước
              </button>
              <button
                type="button"
                disabled={currentPage >= pages}
                onClick={() => setPage(currentPage + 1)}
                className={PAGER}
              >
                Sau
                <ChevronRight className="size-3.5" />
              </button>
            </span>
          </div>
        </section>

        {editor ? (
          <form
            ref={formRef}
            onSubmit={save}
            aria-label={`${editor.id ? 'Chỉnh sửa' : 'Tạo mới'} ${tab === 'roles' ? 'vai trò người dùng' : 'permission'}`}
            className="flex min-w-0 flex-[999_1_480px] scroll-mt-4 flex-col overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white"
          >
            <div className="flex items-start gap-3 border-b border-[#eef0f3] bg-[#fafbfc] px-5 py-4">
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[#fff6d6] text-[#8a6400]"
              >
                {tab === 'roles' ? <ShieldCheck className="size-4" /> : <KeyRound className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-base font-bold">
                  {editor.id ? 'Chỉnh sửa' : 'Tạo mới'}{' '}
                  {tab === 'roles' ? 'vai trò người dùng' : 'permission'}
                </h2>
                <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">
                  {tab === 'roles'
                    ? 'Khai báo thông tin định danh và chọn các quyền thao tác cho vai trò.'
                    : 'Chọn các hành động Core hoặc module. Có bất kỳ hành động nào của module là vào được module đó.'}
                </p>
              </div>
            </div>

            <fieldset disabled={busy} className="flex flex-col gap-[18px] px-5 py-[18px] text-[12.5px]">
              <div className="flex flex-col gap-2.5">
                <FormHeading
                  aside={
                    <>
                      Mục có dấu (<span className="text-red-600">*</span>) là bắt buộc
                    </>
                  }
                >
                  1. THÔNG TIN ĐỊNH DANH
                </FormHeading>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="font-semibold text-slate-700">
                      Tên {tab === 'roles' ? 'vai trò' : 'permission'}{' '}
                      <span className="text-red-600">*</span>
                    </span>
                    <input
                      required
                      maxLength={180}
                      placeholder={
                        tab === 'roles'
                          ? 'Ví dụ: Quản lý Bảo trì, Nhân viên Kho...'
                          : 'Ví dụ: Quản lý dữ liệu người dùng...'
                      }
                      value={editor.name}
                      onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                      className={FIELD}
                    />
                  </label>
                  {tab === 'roles' && (
                    <label className="flex flex-col gap-1">
                      <span className="font-semibold text-slate-700">Mô tả ngắn gọn</span>
                      <input
                        maxLength={2000}
                        placeholder="Mục đích sử dụng của vai trò này..."
                        value={editor.description}
                        onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                        className={FIELD}
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <FormHeading>{tab === 'roles' ? '2. QUYỀN THAO TÁC' : '2. DANH MỤC HÀNH ĐỘNG'}</FormHeading>
                {tab === 'permissions' ? (
                  <>
                    <p className="m-0 text-xs text-slate-500">
                      Inventory/Maintenance: cấp thêm quyền Xem khi chọn quyền giao dịch hoặc xử lý đợt. Quyền Quản lý bao gồm Xem và xử lý. Có bất kỳ hành động nào của module là vào được module đó; không cần chọn module riêng.
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
                      onChange={(actionKeys) => setEditor({ ...editor, actionKeys })}
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
                    onChange={(permissionIds) => setEditor({ ...editor, permissionIds })}
                  />
                )}
              </div>
            </fieldset>

            <div className="flex justify-end gap-2 border-t border-[#eef0f3] px-5 py-3">
              <button
                type="button"
                className={panelButton.secondary}
                onClick={() => setEditor(undefined)}
                disabled={busy}
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                className={panelButton.primary}
                disabled={
                  busy ||
                  !editor.name.trim() ||
                  (tab === 'permissions' && !editor.actionKeys.length)
                }
              >
                {busy ? 'Đang lưu…' : 'Lưu lại'}
              </button>
            </div>
          </form>
        ) : (
          <section
            aria-label="Chi tiết"
            className="flex min-w-0 flex-[999_1_480px] flex-col overflow-hidden rounded-[14px] border border-[#eef0f3] bg-white"
          >
            {selected ? (
              <>
                <div className="flex flex-wrap items-start gap-3 border-b border-[#eef0f3] px-5 py-[18px]">
                  <span
                    aria-hidden
                    className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[#fff6d6] text-[#8a6400]"
                  >
                    {role ? <ShieldCheck className="size-[18px]" /> : <KeyRound className="size-[18px]" />}
                  </span>
                  <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <h2 className="m-0 text-lg font-bold">{selected.name}</h2>
                      {role ? (
                        <span
                          className={cn(
                            'rounded-full border px-2 text-[11.5px] font-semibold',
                            role.isSystem
                              ? 'border-slate-200 bg-slate-100 text-slate-600'
                              : 'border-amber-200 bg-[#fff6d6] text-[#8a6400]',
                          )}
                        >
                          {role.isSystem ? 'Hệ thống' : 'Vai trò tùy chỉnh'}
                        </span>
                      ) : null}
                    </span>
                    {role && (
                      <span className="flex items-center gap-1.5 text-xs text-slate-500">
                        Key:
                        <code className="rounded-[5px] bg-[#f1f3f6] px-1.5 font-mono text-slate-700">
                          {role.key}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(role.key)}
                          className="grid size-6 cursor-pointer place-items-center rounded-[5px] text-slate-500 hover:bg-[#f4f6f9]"
                          aria-label="Sao chép key"
                        >
                          <Copy className="size-3.5" />
                        </button>
                      </span>
                    )}
                    <p className="m-0 text-[13px] text-slate-600">
                      {selected.description || 'Chưa thiết lập mô tả cho mục này.'}
                    </p>
                  </div>

                  {!role?.isSystem && (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={edit}
                        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] border border-[#eef0f3] bg-white px-2.5 text-[12.5px] font-semibold text-slate-700 hover:bg-[#f4f6f9] disabled:opacity-60"
                      >
                        <Pencil className="size-3.5" />
                        Chỉnh sửa
                      </button>
                      <Popconfirm
                        title="Xác nhận xóa phân quyền?"
                        description="Hành động này sẽ thu hồi quyền ngay lập tức và không thể khôi phục."
                        okText="Xóa mục này"
                        cancelText="Hủy"
                        okType="danger"
                        onConfirm={() => void remove()}
                      >
                        <button
                          type="button"
                          disabled={busy || used > 0}
                          title={
                            used > 0
                              ? role
                                ? 'Gỡ hoặc chuyển vai trò cho người dùng trước khi xóa'
                                : 'Gỡ permission khỏi các vai trò trước khi xóa'
                              : undefined
                          }
                          className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] border border-red-200 bg-white px-2.5 text-[12.5px] font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" />
                          Xóa
                        </button>
                      </Popconfirm>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-[18px] px-5 py-[18px]">
                  {role?.key === 'tenant-admin' && (
                    <p className="m-0 rounded-[10px] bg-blue-50 px-3 py-2.5 text-[13px] text-blue-900">
                      <b className="block">Vai trò Quản trị viên cấp cao (tenant-admin)</b>
                      Sở hữu toàn bộ quyền thao tác Core và module đang kích hoạt cho tenant. Đây là vai trò hệ thống, không thể thay đổi hoặc xóa bỏ.
                    </p>
                  )}

                  {showDetailTabs && role ? (
                    <div
                      role="tablist"
                      aria-label="Chi tiết vai trò"
                      className="flex w-fit gap-0.5 rounded-[9px] bg-[#f1f3f6] p-[3px]"
                    >
                      {(
                        [
                          ['actions', 'Quyền thao tác', actions.length],
                          ['members', 'Người dùng', role.userIds.length],
                        ] as const
                      ).map(([value, label, count]) => {
                        const active = detailTab === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setDetailPick({ id: role.id, tab: value })}
                            className={cn(
                              'flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] px-3 text-[12.5px] font-semibold',
                              active
                                ? 'bg-white text-[#18181b] shadow-[0_1px_2px_rgba(0,0,0,.08)]'
                                : 'text-slate-500 hover:text-[#18181b]',
                            )}
                          >
                            {label}
                            <span
                              className={cn(
                                'rounded-full px-[7px] text-[11px]',
                                active ? 'bg-[#ffc90a] text-[#18181b]' : 'bg-slate-200 text-slate-600',
                              )}
                            >
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {detailTab === 'actions' && (
                    <div className="flex flex-col gap-2.5">
                      <SectionHeading>HÀNH ĐỘNG &amp; QUYỀN THAO TÁC ({actions.length})</SectionHeading>
                      {actionGroups.length > 0 ? (
                        actionGroups.map((group) => (
                          <div
                            key={group.group}
                            className="flex flex-col gap-1.5 rounded-[10px] border border-[#f1f3f6] bg-[#fafbfc] px-3 py-2.5"
                          >
                            <span className="text-[11px] font-bold tracking-[0.4px] text-slate-500">
                              {group.group.toUpperCase()}
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {group.items.map((action) => (
                                <span
                                  key={action.key}
                                  className="flex items-center gap-1.5 rounded-[7px] border border-[#eef0f3] bg-white px-2 py-[3px] text-xs"
                                >
                                  <Check className="size-3 stroke-[3] text-emerald-600" />
                                  {action.label}
                                  <code className="font-mono text-[10.5px] text-slate-400">({action.key})</code>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="m-0 rounded-[10px] border border-dashed border-[#e5e7eb] p-3.5 text-center text-[13px] text-slate-500">
                          Không cấp quyền thao tác Core hoặc module.
                        </p>
                      )}
                    </div>
                  )}

                  {role && detailTab === 'members' ? (
                    <RoleMembers role={role} users={users} onChanged={refreshRoles} />
                  ) : null}
                  {!role ? (
                    <div className="flex flex-col gap-2.5 rounded-[10px] border border-[#f1f3f6] bg-[#fafbfc] px-3.5 py-3">
                      <span className="flex flex-wrap items-center gap-2 text-[13px] font-bold">
                        <Users className="size-3.5" />
                        <span className="flex-1">Vai trò đang dùng permission</span>
                        <span className="text-[12.5px] font-medium text-slate-600">
                          {used} vai trò sử dụng permission
                        </span>
                      </span>
                      {used > 0 && !role ? (
                        <p className="m-0 rounded-lg border border-amber-200 bg-[#fffbeb] px-2.5 py-2 text-[12.5px] text-amber-800">
                          Permission này hiện đang được dùng trong <b>{used} vai trò</b>. Vui lòng gỡ permission khỏi các vai trò trước khi thực hiện xóa.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <Shield className="mb-2 size-10 opacity-30" />
                <p className="m-0 text-sm font-medium text-slate-600">
                  Chọn một mục bên danh sách để xem chi tiết
                </p>
                <p className="m-0 mt-1 text-xs text-slate-400">
                  Bạn có thể xem các quyền, module được cấp và danh sách người dùng được phân bổ.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

const PAGER =
  'flex h-7 cursor-pointer items-center gap-0.5 rounded-[7px] border border-[#eef0f3] bg-white px-2.5 text-xs text-slate-700 hover:bg-[#f4f6f9] disabled:cursor-not-allowed disabled:text-slate-400';
const FIELD =
  'h-9 w-full rounded-[7px] border border-[#e5e7eb] bg-white px-2.5 text-[13px] text-[#18181b] outline-none focus:border-[#ffc90a]';

function Kpi({
  icon,
  tone,
  label,
  value,
  valueClass,
  note,
  last = false,
}: {
  icon: ReactNode;
  tone: string;
  label: string;
  value: number;
  valueClass?: string;
  note: string;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-[#f1f3f6] px-[18px] py-3.5',
        !last && 'border-b xl:border-b-0 xl:border-r',
      )}
    >
      <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-lg ${tone}`}>
        {icon}
      </span>
      <div className="flex flex-col">
        <span className="text-[11px] font-bold tracking-[0.5px] text-slate-500">{label}</span>
        <span>
          <b className={cn('text-xl tabular-nums', valueClass)}>{value}</b>{' '}
          <span className="text-xs text-slate-500">{note}</span>
        </span>
      </div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-[#f1f3f6] px-[7px] text-[11.5px] text-slate-600">{children}</span>
  );
}

function SectionHeading({ aside, children }: { aside?: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-[11.5px] font-bold tracking-[0.6px] text-slate-500">
      <span aria-hidden className="h-3.5 w-[3px] rounded-sm bg-[#ffc90a]" />
      <span className="flex-1">{children}</span>
      {aside}
    </span>
  );
}

function FormHeading({ aside, children }: { aside?: ReactNode; children: ReactNode }) {
  return (
    <span className="flex flex-wrap justify-between gap-2 border-b border-[#f1f3f6] pb-1.5 text-[11.5px] font-bold tracking-[0.5px] text-slate-700">
      {children}
      {aside ? <span className="font-medium tracking-normal text-slate-500">{aside}</span> : null}
    </span>
  );
}
