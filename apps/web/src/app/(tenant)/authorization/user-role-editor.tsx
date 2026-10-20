'use client';

import { TENANT_PERMISSION_ACTIONS } from '@enterprise-platform/contracts-identity';
import { useState } from 'react';
import { ShieldCheck, Layers, KeyRound, Plus } from 'lucide-react';
import { Popconfirm } from '@enterprise-platform/shared-ui';
import { toast } from '@/components/ui/sonner';
import {
  useGetPermissionsQuery,
  useGetRolesQuery,
  useGetUserGrantsQuery,
  useSetUserGrantsMutation,
  useSetUserRolesMutation,
} from '@/store/tenant-api';
import { UserCard } from '../users/user-ui';
import type { TenantCoreUser } from '../users/user-types';
import { PermissionPicker } from './permission-picker';
import {
  overlappingGrants,
  buildRoleSources,
  sameIds,
  summarizeRoles,
} from './permission-grants-model';
import {
  actionLabelOf,
  errorMessage,
  UserPermissionGrantsDialog,
} from './user-permission-grants-dialog';

const BTN =
  'inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-60';
const BTN_PRIMARY = `${BTN} bg-[#ffc90a] font-bold text-[#18181b] hover:bg-[#ffd84d]`;
const BTN_SECONDARY = `${BTN} border border-[#e5e7eb] bg-white text-slate-700 hover:bg-[#f4f6f9]`;
const TITLE =
  'm-0 flex items-center gap-1.5 text-[15px] font-bold text-[#18181b]';

type AccessUser = Pick<
  TenantCoreUser,
  'id' | 'fullName' | 'roleIds' | 'directActionKeys'
>;

/**
 * Tab "Vai trò và quyền" của trang chi tiết người dùng: chọn vai trò, xem quyền hạn tổng hợp và quản lý quyền bổ
 * sung ngoài vai trò. Dữ liệu vai trò, quyền, quyền bổ sung đọc từ bộ nhớ đệm RTK Query; sau khi ghi, tag invalidation
 * tự làm mới đúng phần liên quan.
 */
export function UserAccessEditor({ user }: { readonly user: AccessUser }) {
  const roles = useGetRolesQuery();
  const permissions = useGetPermissionsQuery();
  const grantsQuery = useGetUserGrantsQuery(user.id);
  const [saveRoles, { isLoading: savingRoles }] = useSetUserRolesMutation();
  const [saveGrants, { isLoading: savingGrant }] = useSetUserGrantsMutation();
  // Bản nháp chỉ có sau khi người dùng chọn; trước đó lấy theo vai trò đã lưu.
  const [draft, setDraft] = useState<string[]>();
  const [grantsOpen, setGrantsOpen] = useState(false);

  if (!roles.data || !permissions.data) {
    const failed = roles.error ?? permissions.error;
    if (failed) {
      return (
        <UserCard className="p-5">
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-red-700"
          >
            <span className="min-w-0 flex-1">
              {failed.message ?? 'Không thể tải vai trò và quyền.'}
            </span>
            <button
              type="button"
              aria-label="Thử tải lại vai trò và quyền"
              className={BTN_SECONDARY}
              onClick={() => {
                void roles.refetch();
                void permissions.refetch();
              }}
            >
              Thử lại
            </button>
          </div>
        </UserCard>
      );
    }
    return (
      <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
        <div className="h-72 animate-pulse rounded-[10px] bg-slate-100" />
        <div className="h-72 animate-pulse rounded-[10px] bg-slate-100" />
      </div>
    );
  }

  const allRoles = roles.data;
  const allPermissions = permissions.data;
  const savedIds = user.roleIds ?? [];
  const ids = draft ?? savedIds;
  const dirty = !sameIds(ids, savedIds);
  const selected = allRoles.filter((r) => ids.includes(r.id));
  const summary = summarizeRoles(selected, allPermissions);
  const grantKeys = grantsQuery.data?.actionKeys ?? user.directActionKeys ?? [];
  const overlap = new Set(
    overlappingGrants(grantKeys, buildRoleSources(selected, allPermissions)),
  );

  async function submit() {
    if (savingRoles || !dirty) return;
    try {
      await saveRoles({ id: user.id, roleIds: ids }).unwrap();
      setDraft(undefined);
      toast.success(`Đã cập nhật vai trò cho nhân sự "${user.fullName}".`);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thể gán vai trò.'));
    }
  }

  async function removeGrant(actionKey: string) {
    if (savingGrant) return;
    try {
      await saveGrants({
        id: user.id,
        actionKeys: grantKeys.filter((k) => k !== actionKey),
      }).unwrap();
      toast.success(`Đã gỡ quyền bổ sung "${actionLabelOf(actionKey)}".`);
    } catch (cause) {
      toast.error(errorMessage(cause, 'Không thể gỡ quyền bổ sung.'));
    }
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <UserCard
        aria-label="Gán vai trò"
        className="flex flex-col gap-3.5 p-4 sm:p-5"
      >
        <h2 className={TITLE}>Vai trò áp dụng</h2>
        <fieldset disabled={savingRoles} className="m-0 min-w-0 border-0 p-0">
          <PermissionPicker
            label="Chọn vai trò áp dụng"
            values={ids}
            onChange={setDraft}
            options={allRoles.map((r) => ({
              id: r.id,
              label: r.name,
              description: r.description,
              group: r.isSystem ? 'Hệ thống' : 'Tùy chỉnh',
            }))}
          />
        </fieldset>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#eef0f3] pt-3.5">
          {dirty ? (
            <span className="mr-auto text-[13px] text-amber-800">
              Có thay đổi chưa lưu
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Hủy thay đổi vai trò"
            className={BTN_SECONDARY}
            disabled={!dirty || savingRoles}
            onClick={() => setDraft(undefined)}
          >
            Hủy
          </button>
          <button
            type="button"
            aria-label="Lưu vai trò"
            className={BTN_PRIMARY}
            disabled={!dirty || savingRoles}
            onClick={() => void submit()}
          >
            {savingRoles ? 'Đang lưu…' : 'Lưu vai trò'}
          </button>
        </div>
      </UserCard>

      <UserCard
        aria-label="Quyền hạn tổng hợp"
        className="flex flex-col gap-3 p-4 sm:p-5"
      >
        <h2 className={TITLE}>
          <ShieldCheck className="size-4 text-emerald-700" aria-hidden />
          Quyền hạn tổng hợp{dirty ? ' (dự kiến)' : ''}
        </h2>

        {summary.admin ? (
          <p className="m-0 rounded-md bg-blue-50 px-3 py-2 text-[13px] text-blue-900">
            <b>Quản trị viên Tenant (tenant-admin):</b> toàn quyền Core và các
            module đang kích hoạt cho tenant.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-600">
                <Layers className="size-3.5" aria-hidden />
                Phân hệ truy cập
              </span>
              <div className="flex flex-wrap gap-1">
                {summary.moduleKeys.length > 0 ? (
                  summary.moduleKeys.map((m) => (
                    <span
                      key={m}
                      className="rounded-md bg-[#f1f3f6] px-2 py-0.5 font-mono text-[12px] text-slate-700"
                    >
                      {m === '*' ? 'Tất cả module khả dụng' : m}
                    </span>
                  ))
                ) : (
                  <i className="text-[13px] text-slate-400">
                    Chưa cấp quyền module nào
                  </i>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-600">
                <KeyRound className="size-3.5" aria-hidden />
                Hành động từ vai trò ({summary.actionKeys.length})
              </span>
              {summary.actionKeys.length > 0 ? (
                <div className="flex max-h-44 flex-wrap gap-1 overflow-y-auto pr-1">
                  {summary.actionKeys.map((a) => (
                    <span
                      key={a}
                      className="rounded-md border border-[#e5e7eb] px-2 py-0.5 text-[12px] text-slate-700"
                    >
                      {TENANT_PERMISSION_ACTIONS.find((item) => item.key === a)
                        ?.label ?? a}
                    </span>
                  ))}
                </div>
              ) : (
                <i className="text-[13px] text-slate-400">
                  Không cấp quyền thao tác Core hoặc module
                </i>
              )}
            </div>
          </>
        )}

        {grantKeys.length > 0 ? (
          <div
            data-testid="granted-block"
            className="flex flex-col gap-1.5 rounded-md border border-orange-300 bg-orange-50 p-2.5"
          >
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-orange-900">
              <KeyRound className="size-3.5" aria-hidden />
              Bổ sung ngoài vai trò ({grantKeys.length})
            </span>
            <div className="flex flex-wrap gap-1">
              {grantKeys.map((key) => (
                <span
                  key={key}
                  data-testid={`granted-chip-${key}`}
                  className="flex items-center gap-1 rounded-md border border-orange-300 bg-white py-px pr-0.5 pl-2 text-[12px] text-orange-900"
                >
                  {actionLabelOf(key)}
                  {overlap.has(key) ? (
                    <span className="rounded-md bg-orange-100 px-1 text-[11px] font-semibold">
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
                      disabled={savingGrant}
                      className="grid size-5 cursor-pointer place-items-center rounded-md text-orange-800 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
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
          aria-label="Bổ sung quyền hạn ngoài vai trò"
          disabled={summary.admin || savingRoles}
          onClick={() => setGrantsOpen(true)}
          className={`${BTN_SECONDARY} w-fit`}
        >
          <Plus className="size-3.5" aria-hidden />
          Bổ sung quyền hạn ngoài vai trò
        </button>
        {summary.admin ? (
          <span className="text-[12px] text-slate-500">
            Nhân sự này đã có toàn quyền (tenant-admin) nên không cần bổ sung
            quyền.
          </span>
        ) : null}
      </UserCard>

      <UserPermissionGrantsDialog
        open={grantsOpen}
        onOpenChange={setGrantsOpen}
        userId={user.id}
        userName={user.fullName}
        roles={allRoles}
        permissions={allPermissions}
        selectedRoles={selected}
        rolesDirty={dirty}
      />
    </div>
  );
}
