'use client';

import {
  TENANT_PERMISSION_ACTIONS,
  type TenantPermission,
  type TenantRole,
  type TenantUserPermissionGrants,
} from '@enterprise-platform/contracts-identity';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, UserCheck, Layers, KeyRound, Plus } from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { toast } from '@/components/ui/sonner';
import { panelButton, SidePanel } from '../side-panel';
import { PermissionPicker } from './permission-picker';
import { authorizationRequest } from './authorization-client';
import { overlappingGrants, buildRoleSources, sameIds } from './permission-grants-model';
import { actionLabelOf, UserPermissionGrantsDialog } from './user-permission-grants-dialog';

interface UserRoleEditorProps {
  readonly user: { id: string; fullName: string; roleIds?: string[]; directActionKeys?: string[] };
  readonly roles: TenantRole[];
  readonly permissions: TenantPermission[];
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}

export function UserRoleEditor({
  user,
  roles,
  permissions,
  onClose,
  onSaved,
}: UserRoleEditorProps) {
  const [ids, setIds] = useState(user.roleIds ?? []);
  const [busy, setBusy] = useState(false);
  const [grants, setGrants] = useState<TenantUserPermissionGrants>({
    actionKeys: user.directActionKeys ?? [],
    grants: [],
  });
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [grantBusy, setGrantBusy] = useState(false);
  const router = useRouter();

  // Nạp quyền bổ sung hiện có để khối "Bổ sung ngoài vai trò" hiện ngay khi mở editor.
  useEffect(() => {
    let cancelled = false;
    authorizationRequest<TenantUserPermissionGrants>(
      `tenant-users/${user.id}/permission-grants`,
    )
      .then((data) => {
        if (!cancelled) setGrants(data);
      })
      .catch(() => {
        // Giữ danh sách rút gọn từ danh sách người dùng; hộp thoại sẽ báo lỗi khi mở.
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const selected = roles.filter((r) => ids.includes(r.id));
  const admin = selected.some((r) => r.key === 'tenant-admin');
  const actions = [
    ...new Set(
      permissions
        .filter((p) => selected.some((r) => r.permissionIds.includes(p.id)))
        .flatMap((p) => p.actionKeys),
    ),
  ];
  const modules = [...new Set(selected.flatMap((r) => r.moduleKeys))];
  const sources = buildRoleSources(selected, permissions);
  const overlap = new Set(overlappingGrants(grants.actionKeys, sources));
  const rolesDirty = !sameIds(ids, user.roleIds ?? []);
  const onLoaded = useCallback((data: TenantUserPermissionGrants) => setGrants(data), []);

  async function applyGrants(data: TenantUserPermissionGrants) {
    setGrants(data);
    try {
      await onSaved();
    } catch {
      // Quyền đã lưu; chỉ làm mới danh sách người dùng bên ngoài thất bại.
    }
  }
  async function removeGrant(actionKey: string) {
    if (grantBusy) return;
    setGrantBusy(true);
    try {
      const data = await authorizationRequest<TenantUserPermissionGrants>(
        `tenant-users/${user.id}/permission-grants`,
        'PUT',
        { actionKeys: grants.actionKeys.filter((k) => k !== actionKey) },
      );
      await applyGrants(data);
      toast.success(`Đã gỡ quyền bổ sung "${actionLabelOf(actionKey)}".`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Không thể gỡ quyền bổ sung.');
    } finally {
      setGrantBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);

    try {
      await authorizationRequest(`tenant-users/${user.id}/roles`, 'PUT', {
        roleIds: ids,
      });
      await onSaved();
      toast.success(`Đã cập nhật vai trò cho nhân sự "${user.fullName}" thành công.`);
      router.refresh();
      onClose();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'Không thể gán vai trò.';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidePanel
      ariaLabel="Gán vai trò & phân quyền"
      icon={<UserCheck className="size-4" />}
      title="Gán vai trò & phân quyền"
      subtitle={
        <>
          Nhân sự: <b className="text-[#18181b]">{user.fullName}</b>
        </>
      }
      revealKey={user.id}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <button type="button" className={panelButton.secondary} onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button
            type="submit"
            form={`user-role-editor-${user.id}`}
            className={panelButton.primary}
            disabled={busy}
          >
            {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>
        </>
      }
    >
      <form id={`user-role-editor-${user.id}`} onSubmit={submit}>
        <fieldset disabled={busy} className="flex flex-col gap-3.5">
          <PermissionPicker
            label="Chọn vai trò áp dụng"
            values={ids}
            onChange={setIds}
            options={roles.map((r) => ({
              id: r.id,
              label: r.name,
              description: r.description,
              group: r.isSystem ? 'Hệ thống' : 'Tùy chỉnh',
            }))}
          />

          <div className="flex flex-col gap-2 rounded-[10px] border border-[#eef0f3] p-3">
            <span className="flex items-center gap-1.5 text-[14px] font-bold text-[#18181b]">
              <ShieldCheck className="size-3.5 text-emerald-700" />
              Quyền hạn tổng hợp dự kiến
            </span>

            {admin ? (
              <p className="m-0 rounded-lg bg-blue-50 px-2.5 py-2 text-blue-900">
                <b>Quản trị viên Tenant (tenant-admin):</b> Toàn quyền Core và các module đang kích hoạt cho tenant.
              </p>
            ) : (
              <>
                <span className="flex items-center gap-1.5 text-slate-600">
                  <Layers className="size-3.5" />
                  Phân hệ Module truy cập:
                </span>
                <div className="flex flex-wrap gap-1">
                  {modules.length > 0 ? (
                    modules.map((m) => (
                      <span
                        key={m}
                        className="rounded-md bg-[#f1f3f6] px-[7px] font-mono text-[12px] text-slate-700"
                      >
                        {m === '*' ? 'Tất cả module khả dụng' : m}
                      </span>
                    ))
                  ) : (
                    <i className="text-slate-400">Chưa cấp quyền module nào</i>
                  )}
                </div>
                <span className="flex items-center gap-1.5 text-slate-600">
                  <KeyRound className="size-3.5" />
                  Hành động Core và module khả dụng ({actions.length}):
                </span>
                {actions.length > 0 ? (
                  <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto pr-1">
                    {actions.map((a) => (
                      <span
                        key={a}
                        className="rounded-md border border-[#e5e7eb] px-[7px] text-[12px] text-slate-700"
                      >
                        {TENANT_PERMISSION_ACTIONS.find((item) => item.key === a)?.label ?? a}
                      </span>
                    ))}
                  </div>
                ) : (
                  <i className="text-slate-400">Không cấp quyền thao tác Core hoặc module</i>
                )}
              </>
            )}

            {grants.actionKeys.length > 0 ? (
              <div
                data-testid="granted-block"
                className="flex flex-col gap-1.5 rounded-lg border border-orange-300 bg-orange-50 p-2.5"
              >
                <span className="flex items-center gap-1.5 font-semibold text-orange-900">
                  <KeyRound className="size-3.5" />
                  Bổ sung ngoài vai trò ({grants.actionKeys.length})
                </span>
                <div className="flex flex-wrap gap-1">
                  {grants.actionKeys.map((key) => (
                    <span
                      key={key}
                      data-testid={`granted-chip-${key}`}
                      className="flex items-center gap-1 rounded-md border border-orange-300 bg-white py-px pr-0.5 pl-[7px] text-[12px] text-orange-900"
                    >
                      {actionLabelOf(key)}
                      {overlap.has(key) ? (
                        <span className="rounded bg-orange-100 px-1 text-[11px] font-semibold">
                          Trùng với vai trò
                        </span>
                      ) : null}
                      <Popconfirm
                        title="Gỡ quyền bổ sung?"
                        description={`Nhân sự "${user.fullName}" sẽ không còn quyền "${actionLabelOf(key)}" từ phần bổ sung này.`}
                        okText="Gỡ"
                        cancelText="Hủy"
                        okType="danger"
                        onConfirm={() => void removeGrant(key)}
                      >
                        <button
                          type="button"
                          data-testid={`remove-grant-${key}`}
                          aria-label={`Gỡ quyền bổ sung ${actionLabelOf(key)}`}
                          disabled={grantBusy}
                          className="grid size-5 cursor-pointer place-items-center rounded text-orange-800 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          ✕
                        </button>
                      </Popconfirm>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              data-testid="open-permission-grants"
              disabled={admin || busy}
              onClick={() => setGrantsOpen(true)}
              className="flex h-[34px] w-fit cursor-pointer items-center gap-1.5 rounded-[7px] border border-[#e5e7eb] bg-white px-2.5 text-[13px] font-semibold text-slate-700 hover:bg-[#f4f6f9] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="size-3.5" />
              Bổ sung quyền hạn ngoài vai trò
            </button>
            {admin ? (
              <span className="text-[12px] text-slate-500">
                Nhân sự này đã có toàn quyền (tenant-admin) nên không cần bổ sung quyền.
              </span>
            ) : null}
          </div>
        </fieldset>
      </form>

      <UserPermissionGrantsDialog
        open={grantsOpen}
        onOpenChange={setGrantsOpen}
        userId={user.id}
        userName={user.fullName}
        roles={roles}
        permissions={permissions}
        selectedRoles={selected}
        rolesDirty={rolesDirty}
        onLoaded={onLoaded}
        onSaved={(data) => void applyGrants(data)}
      />
    </SidePanel>
  );
}
