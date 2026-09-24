'use client';

import {
  TENANT_PERMISSION_ACTIONS,
  type TenantPermission,
  type TenantRole,
} from '@enterprise-platform/contracts-identity';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, UserCheck, Layers, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-6">
        <DialogHeader className="border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
              <UserCheck className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-slate-900">
                Gán vai trò & phân quyền
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Nhân sự: <span className="font-semibold text-slate-700">{user.fullName}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="mt-4 space-y-5">
          <fieldset disabled={busy} className="space-y-5">
            <PermissionPicker
              label="Chọn vai trò áp dụng"
              values={ids}
              onChange={setIds}
              options={roles
                .filter(
                  (r) =>
                    r.key !== 'legacy-tenant-user' ||
                    user.roleIds?.includes(r.id),
                )
                .map((r) => ({
                  id: r.id,
                  label: r.name,
                  description: r.description,
                  group: r.isSystem ? 'Hệ thống' : 'Tùy chỉnh',
                }))}
            />

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <ShieldCheck className="size-4 text-blue-600" />
                <span>Quyền hạn tổng hợp dự kiến</span>
              </div>

              {admin ? (
                <div className="mt-2.5 rounded-lg border border-blue-200 bg-blue-50/80 p-3 text-xs text-blue-900 leading-relaxed">
                  <span className="font-semibold">Quản trị viên Tenant (tenant-admin):</span> Toàn quyền Core và các module đang kích hoạt cho tenant.
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <div>
                    <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5 mb-1.5">
                      <Layers className="size-3.5" />
                      Phân hệ Module truy cập:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {modules.length > 0 ? (
                        modules.map((m) => (
                          <Badge key={m} variant="secondary" className="text-xs font-normal">
                            {m === '*' ? 'Tất cả module khả dụng' : m}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400 italic">Chưa cấp quyền module nào</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5 mb-1.5">
                      <KeyRound className="size-3.5" />
                      Hành động Core và module khả dụng ({actions.length}):
                    </span>
                    {actions.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                        {actions.map((a) => (
                          <Badge key={a} variant="outline" className="text-xs font-normal bg-white">
                            {TENANT_PERMISSION_ACTIONS.find((item) => item.key === a)?.label ?? a}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Không cấp quyền thao tác Core hoặc module</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Hủy
              </Button>
              <Button
                type="submit"
                disabled={busy}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
              </Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
