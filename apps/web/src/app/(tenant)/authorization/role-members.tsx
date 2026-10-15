'use client';

import type { TenantRole } from '@enterprise-platform/contracts-identity';
import { Popconfirm, SearchableSelect } from '@enterprise-platform/shared-ui';
import { useMemo, useState } from 'react';
import { UserMinus, UserPlus, Users } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { panelButton } from '../side-panel';
import { authorizationRequest, searchText } from './authorization-client';

export interface RoleMemberUser {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: 'active' | 'disabled';
}

interface RoleMembersProps {
  readonly role: TenantRole;
  readonly users: readonly RoleMemberUser[];
  readonly onChanged: () => Promise<void>;
}

/**
 * Người đang giữ một vai trò và gán/gỡ nhanh. Dùng đúng API như trang Người dùng
 * (`PUT tenant-users/:id/roles` thay toàn bộ danh sách role), nên mọi luật phía máy chủ
 * (admin cuối cùng, tài khoản admin, audit, tăng revision) giữ nguyên.
 */
export function RoleMembers({ role, users, onChanged }: RoleMembersProps) {
  const [pick, setPick] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [filter, setFilter] = useState('');

  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const members = useMemo(
    () =>
      role.userIds
        .map((id) => ({ id, user: byId.get(id) }))
        .sort((a, b) =>
          (a.user?.fullName ?? a.id).localeCompare(b.user?.fullName ?? b.id, 'vi'),
        ),
    [role.userIds, byId],
  );
  const shown = useMemo(() => {
    const q = searchText(filter.trim());
    if (!q) return members;
    return members.filter(({ user }) =>
      searchText(`${user?.fullName ?? ''} ${user?.email ?? ''}`).includes(q),
    );
  }, [members, filter]);
  const candidates = useMemo(
    () =>
      users
        .filter((u) => !role.userIds.includes(u.id))
        .map((u) => ({
          value: u.id,
          label: u.fullName,
          description: u.email,
          badge: u.status === 'disabled' ? 'Vô hiệu' : undefined,
        })),
    [users, role.userIds],
  );

  async function change(userId: string, action: 'add' | 'remove') {
    if (busyId) return;
    setBusyId(userId);
    const name = byId.get(userId)?.fullName ?? 'người dùng';
    try {
      // Đọc lại danh sách role hiện tại của người này ngay trước khi ghi, vì PUT thay toàn bộ.
      const current = await authorizationRequest<{ roleIds: string[] }>(
        `tenant-users/${userId}/roles`,
      );
      const roleIds =
        action === 'add'
          ? [...new Set([...current.roleIds, role.id])]
          : current.roleIds.filter((id) => id !== role.id);
      await authorizationRequest(`tenant-users/${userId}/roles`, 'PUT', {
        roleIds,
      });
      await onChanged();
      if (action === 'add') setPick('');
      toast.success(
        action === 'add'
          ? `Đã gán vai trò "${role.name}" cho "${name}".`
          : `Đã gỡ vai trò "${role.name}" khỏi "${name}".`,
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Không thể cập nhật vai trò.',
      );
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border border-[#f1f3f6] bg-[#fafbfc] px-3.5 py-3">
      <span className="flex flex-wrap items-center gap-2 text-[14px] font-bold">
        <Users className="size-3.5" />
        <span className="flex-1">Người đang giữ vai trò ({members.length})</span>
      </span>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <SearchableSelect
            value={pick}
            options={candidates}
            placeholder="Chọn người dùng để gán vai trò này"
            searchPlaceholder="Tìm theo tên hoặc email"
            emptyText="Không còn người dùng để gán"
            height={36}
            disabled={!!busyId || candidates.length === 0}
            onChange={setPick}
          />
        </div>
        <button
          type="button"
          className={`${panelButton.primary} inline-flex items-center gap-1.5 whitespace-nowrap`}
          disabled={!pick || !!busyId}
          onClick={() => void change(pick, 'add')}
        >
          <UserPlus className="size-3.5" />
          Gán vai trò
        </button>
      </div>

      {members.length > 8 ? (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Lọc trong danh sách đang giữ vai trò"
          aria-label="Lọc người đang giữ vai trò"
          className="h-8 w-full rounded-[7px] border border-[#e5e7eb] bg-white px-2.5 text-[13px] outline-none focus:border-[#ffc90a]"
        />
      ) : null}

      {members.length === 0 ? (
        <p className="m-0 rounded-[10px] border border-dashed border-[#e5e7eb] bg-white p-3.5 text-center text-[14px] text-slate-500">
          Chưa có người dùng nào giữ vai trò này.
        </p>
      ) : (
        <ul className="m-0 flex max-h-64 list-none flex-col gap-1.5 overflow-y-auto p-0 pr-1">
          {shown.map(({ id, user }) => (
            <li
              key={id}
              className="flex items-center gap-2.5 rounded-[9px] border border-[#eef0f3] bg-white px-2.5 py-[7px]"
            >
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-full bg-[#fff6d6] text-[12px] font-bold text-[#8a6400]"
              >
                {(user?.fullName ?? '?').trim().charAt(0).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <b className="truncate text-[13px]">
                  {user?.fullName ?? 'Người dùng không xác định'}
                </b>
                <span className="truncate text-[12px] text-slate-500">
                  {user?.email ?? id}
                </span>
              </span>
              {user?.status === 'disabled' ? (
                <span className="rounded-full bg-slate-100 px-1.5 text-[12px] font-semibold text-slate-600">
                  Vô hiệu
                </span>
              ) : null}
              <Popconfirm placement='left'
                title="Gỡ vai trò khỏi người dùng này?"
                description="Quyền của vai trò sẽ bị thu hồi ngay; quyền từ các vai trò khác vẫn giữ nguyên."
                okText="Gỡ vai trò"
                cancelText="Hủy"
                okType="danger"
                onConfirm={() => void change(id, 'remove')}
              >
                <button
                  type="button"
                  disabled={!!busyId}
                  aria-label={`Gỡ vai trò khỏi ${user?.fullName ?? id}`}
                  className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <UserMinus className="size-3.5" />
                </button>
              </Popconfirm>
            </li>
          ))}
          {shown.length === 0 ? (
            <li className="p-2 text-center text-[13px] text-slate-500">
              Không có kết quả phù hợp.
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
