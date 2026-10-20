'use client';

import {
  TENANT_PERMISSION_ACTIONS,
  type TenantRole,
  type TenantPermission,
  type TenantUserPermissionGrant,
} from '@enterprise-platform/contracts-identity';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { useGetUserGrantsQuery, useGetUsersQuery, useSetUserGrantsMutation } from '@/store/tenant-api';
import { searchText } from './authorization-client';
import {
  actionLock,
  buildRoleSections,
  buildRoleSources,
  buildUnassignedGroups,
  describeLock,
  diffGrants,
  GRANTABLE_ACTIONS,
  toggleGrant,
  type ActionLock,
  type GrantableAction,
} from './permission-grants-model';

export function errorMessage(cause: unknown, fallback: string) {
  const message = (cause as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

export const actionLabelOf = (key: string) =>
  TENANT_PERMISSION_ACTIONS.find((a) => a.key === key)?.label ?? key;

const ROLE_BADGE = 'rounded-md bg-blue-50 px-1.5 py-px text-[11px] font-semibold text-blue-700';
const GRANT_BADGE = 'rounded-md bg-orange-100 px-1.5 py-px text-[11px] font-semibold text-orange-800';

interface UserPermissionGrantsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly userId: string;
  readonly userName: string;
  readonly roles: TenantRole[];
  readonly permissions: TenantPermission[];
  /** Vai trò đang chọn trong editor (có thể chưa lưu). */
  readonly selectedRoles: TenantRole[];
  /** Vai trò đang chọn khác bản đã lưu. */
  readonly rolesDirty: boolean;
}

const BTN =
  'h-9 cursor-pointer rounded-md px-3.5 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-60';
const BTN_SECONDARY = `${BTN} border border-[#e5e7eb] bg-white text-slate-700 hover:bg-[#f4f6f9]`;
const BTN_PRIMARY = `${BTN} bg-[#ffc90a] font-bold text-[#18181b] hover:bg-[#ffd84d]`;

export function UserPermissionGrantsDialog({ open, onOpenChange, ...rest }: UserPermissionGrantsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="permission-grants-dialog"
        className="flex max-h-[88vh] max-w-2xl flex-col gap-0 overflow-hidden rounded-[10px] p-0"
      >
        <GrantsBody {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function GrantsBody({
  userId,
  userName,
  roles,
  permissions,
  selectedRoles,
  rolesDirty,
  onClose,
}: Omit<UserPermissionGrantsDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  // Dữ liệu đã có trong bộ nhớ đệm thì hiện ngay; chỉ gọi API khi chưa có hoặc đã bị làm mới.
  const { data: loaded, error, refetch } = useGetUserGrantsQuery(userId);
  const [saveGrants, { isLoading: saving }] = useSetUserGrantsMutation();
  // Danh sách người dùng (đã có trong bộ nhớ đệm) để đổi mã người cấp thành tên.
  const { data: users } = useGetUsersQuery();
  const nameById = useMemo(() => new Map((users ?? []).map((u) => [u.id, u.fullName])), [users]);
  // Bản nháp chỉ tồn tại sau khi người dùng bấm chọn; trước đó lấy theo dữ liệu đã lưu.
  const [edited, setEdited] = useState<ReadonlySet<string>>();
  const draft: ReadonlySet<string> = edited ?? new Set(loaded?.actionKeys ?? []);
  const loadError = loaded ? '' : error?.message ?? '';
  const [query, setQuery] = useState('');
  const [openRoles, setOpenRoles] = useState<ReadonlySet<string>>(new Set());

  const sources = useMemo(() => buildRoleSources(selectedRoles, permissions), [selectedRoles, permissions]);
  const sections = useMemo(() => buildRoleSections(roles, permissions), [roles, permissions]);
  const unassigned = useMemo(() => buildUnassignedGroups(roles, permissions), [roles, permissions]);
  const grantInfo = useMemo(
    () => new Map<string, TenantUserPermissionGrant>((loaded?.grants ?? []).map((g) => [g.actionKey, g])),
    [loaded],
  );
  const savedKeys = loaded?.actionKeys ?? [];
  const diff = diffGrants(savedKeys, draft);
  const q = searchText(query.trim());
  const matches = (a: GrantableAction) =>
    !q || searchText(`${a.label} ${a.key} ${a.group}`).includes(q);

  async function save() {
    if (saving || !loaded || !diff.changed) return;
    try {
      await saveGrants({ id: userId, actionKeys: [...draft] }).unwrap();
      toast.success(`Đã cập nhật quyền bổ sung cho nhân sự "${userName}".`);
      onClose();
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thể lưu quyền bổ sung.'));
    }
  }

  const renderRow = (action: GrantableAction) => {
    const lock: ActionLock | undefined = actionLock(action.key, sources);
    const checked = draft.has(action.key);
    const info = grantInfo.get(action.key);
    // Action đã có từ vai trò thì khóa; riêng quyền bổ sung trùng vai trò vẫn bỏ chọn được để gỡ.
    const disabled = saving || !loaded || (lock !== undefined && !checked);
    return (
      <li key={action.key}>
        <label
          className={`flex items-start gap-2.5 rounded-[5px] px-2.5 py-1.5 ${
            disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-[#f4f6f9]'
          } ${checked && !lock ? 'bg-orange-50' : ''}`}
        >
          <input
            type="checkbox"
            data-testid={`grant-action-${action.key}`}
            className="mt-0.5 size-4 shrink-0 accent-[#ea580c]"
            checked={checked}
            disabled={disabled}
            onChange={() => setEdited(toggleGrant(draft, action.key))}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-[#18181b]">{action.label}</span>
              {checked && loaded?.actionKeys.includes(action.key) ? (
                <span className={GRANT_BADGE}>Bổ sung</span>
              ) : null}
              {checked && lock ? <span className={GRANT_BADGE}>Trùng với vai trò</span> : null}
            </span>
            {lock ? (
              <span className="text-[12px] text-slate-600">{describeLock(lock, actionLabelOf)}</span>
            ) : null}
            {info && checked ? (
              <span className="text-[12px] text-orange-800">
                Cấp
                {info.grantedBy && nameById.has(info.grantedBy) ? ` bởi ${nameById.get(info.grantedBy)}` : ''}
                {info.grantedAt ? ` ngày ${new Date(info.grantedAt).toLocaleDateString('vi-VN')}` : ''}
              </span>
            ) : null}
          </span>
        </label>
      </li>
    );
  };

  const visibleSections = sections
    .map((s) => ({ ...s, shown: GRANTABLE_ACTIONS.filter((a) => s.actionKeys.includes(a.key) && matches(a)) }))
    .filter((s) => !q || s.shown.length > 0);
  const visibleGroups = unassigned
    .map((g) => ({ ...g, shown: g.actions.filter(matches) }))
    .filter((g) => g.shown.length > 0);
  const assignedNames = new Set(selectedRoles.map((r) => r.id));

  return (
    <>
      <DialogHeader className="shrink-0 border-b border-[#eef0f3] px-6 pt-5 pb-3">
        <DialogTitle className="text-[20px] font-bold">Bổ sung quyền hạn ngoài vai trò</DialogTitle>
        <DialogDescription>
          Nhân sự: <b className="text-[#18181b]">{userName}</b>. Quyền bổ sung được cộng thêm vào quyền từ vai trò.
        </DialogDescription>
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <label className="flex h-9 min-w-0 flex-[1_1_240px] items-center gap-2 rounded-md border border-[#e5e7eb] bg-white px-2.5 text-slate-500 focus-within:border-[#2563eb]">
            <Search className="size-4 shrink-0" aria-hidden />
            <input
              type="search"
              aria-label="Tìm quyền hạn"
              placeholder="Tìm theo tên hoặc mã quyền…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-[#18181b] outline-none placeholder:text-slate-400"
            />
          </label>
          <span className="whitespace-nowrap text-[13px] text-slate-600" data-testid="grant-selected-count">
            Đã chọn: <b className="text-[#18181b]">{draft.size}</b> quyền
          </span>
        </div>
        {rolesDirty ? (
          <p className="m-0 mt-1 rounded-md bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900">
            Vai trò đang chọn chưa được lưu. Danh sách &quot;đã có từ vai trò&quot; tính theo vai trò đang chọn, khác với
            bản đã lưu; quyền bổ sung ở đây vẫn lưu độc lập.
          </p>
        ) : null}
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3 text-[13px]">
        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
            <span className="min-w-0 flex-1">{loadError}</span>
            <button type="button" className={BTN_SECONDARY} onClick={() => void refetch()}>
              Thử lại
            </button>
          </div>
        ) : !loaded ? (
          <p className="m-0 p-3 text-slate-500">Đang tải quyền bổ sung…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-[14px] font-bold text-[#18181b]">Theo vai trò</h3>
              {visibleSections.length === 0 ? (
                <p className="m-0 text-slate-500">Không có vai trò phù hợp.</p>
              ) : (
                visibleSections.map(({ role, actionKeys, shown }) => {
                  const expanded = q ? true : openRoles.has(role.id);
                  const picked = actionKeys.filter((k) => draft.has(k)).length;
                  return (
                    <div key={role.id} className="overflow-hidden rounded-md border border-[#eef0f3]">
                      <button
                        type="button"
                        data-testid={`grant-role-${role.id}`}
                        aria-expanded={expanded}
                        className="flex w-full cursor-pointer items-center gap-2 bg-[#fafbfc] px-3 py-2 text-left hover:bg-[#f4f6f9]"
                        onClick={() =>
                          setOpenRoles((cur) => {
                            const next = new Set(cur);
                            if (next.has(role.id)) next.delete(role.id);
                            else next.add(role.id);
                            return next;
                          })
                        }
                      >
                        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        <span className="font-semibold text-[#18181b]">{role.name}</span>
                        {assignedNames.has(role.id) ? <span className={ROLE_BADGE}>Đang gán</span> : null}
                        <span className="ml-auto text-[12px] text-slate-500">
                          {picked > 0 ? `${picked} đã chọn / ` : ''}
                          {actionKeys.length} quyền
                        </span>
                      </button>
                      {expanded ? <ul className="m-0 list-none p-1.5">{shown.map(renderRow)}</ul> : null}
                    </div>
                  );
                })
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-[14px] font-bold text-[#18181b]">Chưa gắn vào vai trò nào</h3>
              {visibleGroups.length === 0 ? (
                <p className="m-0 text-slate-500">Không có quyền phù hợp.</p>
              ) : (
                visibleGroups.map((g) => (
                  <div key={g.group} className="rounded-md border border-[#eef0f3]">
                    <div className="border-b border-[#eef0f3] bg-[#fafbfc] px-3 py-1.5 text-[12px] font-bold tracking-[0.3px] text-slate-600">
                      {g.group}
                    </div>
                    <ul className="m-0 list-none p-1.5">{g.shown.map(renderRow)}</ul>
                  </div>
                ))
              )}
            </section>
          </div>
        )}
      </div>

      <div className="flex shrink-0 justify-end gap-3 border-t border-[#e5e7eb] px-6 py-4">
        <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={saving}>
          Hủy
        </button>
        <button
          type="button"
          data-testid="save-permission-grants"
          className={BTN_PRIMARY}
          disabled={saving || !loaded || !diff.changed}
          onClick={() => void save()}
        >
          {saving ? 'Đang lưu…' : 'Lưu quyền bổ sung'}
        </button>
      </div>
    </>
  );
}
