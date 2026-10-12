'use client';

import {
  TENANT_PERMISSION_ACTIONS,
  type TenantPermission,
  type TenantRole,
} from '@enterprise-platform/contracts-identity';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, UserCheck, Layers, KeyRound } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { panelButton, SidePanel } from '../side-panel';
import { PermissionPicker } from './permission-picker';
import { authorizationRequest } from './authorization-client';

interface UserRoleEditorProps {
  readonly user: { id: string; fullName: string; roleIds?: string[] };
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
  const router = useRouter();

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
            <span className="flex items-center gap-1.5 text-[13px] font-bold text-[#18181b]">
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
                        className="rounded-md bg-[#f1f3f6] px-[7px] font-mono text-[11.5px] text-slate-700"
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
                        className="rounded-md border border-[#e5e7eb] px-[7px] text-[11.5px] text-slate-700"
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
          </div>
        </fieldset>
      </form>
    </SidePanel>
  );
}
