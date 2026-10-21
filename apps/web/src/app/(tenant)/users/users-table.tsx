'use client';

import { Fragment, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { tenantApi } from '@/store/tenant-api';
import { useAppDispatch } from '@/store/organization-layout-store';
import type { UserGroup } from './users-list-model';
import {
  ExtraGrantsBadge,
  formatDate,
  RoleChips,
  StatusBadge,
  UserAvatar,
} from './user-ui';

const TH =
  'px-4 py-2 text-left text-[12px] font-semibold tracking-[0.4px] text-slate-500 uppercase';
const TD = 'px-4 py-2.5 align-middle';

/** Thanh cuộn ngang mảnh, chỉ hiện khi rê chuột (quy chuẩn ui-design mục 3.1). */
const SCROLL_X =
  'relative overflow-x-auto overflow-y-hidden [scrollbar-width:thin] [scrollbar-color:transparent_transparent] hover:[scrollbar-color:#cbd5e1_transparent] [&::-webkit-scrollbar]:h-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-[#cbd5e1]';

/** Bảng người dùng gọn: bấm cả dòng để mở trang chi tiết, không có cột thao tác. */
export function UsersTable({ groups }: { groups: readonly UserGroup[] }) {
  const router = useRouter();
  const dispatch = useAppDispatch();

  function open(event: MouseEvent, id: string) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // Bấm vào liên kết tên đã tự điều hướng.
    if ((event.target as HTMLElement).closest('a')) return;
    router.push(`/users/${id}`);
  }

  return (
    <div className={SCROLL_X}>
      <table className="w-full min-w-[720px] border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-[#eef0f3] bg-[#fafbfc]">
            <th scope="col" className={TH}>Nhân sự</th>
            <th scope="col" className={TH}>Vai trò</th>
            <th scope="col" className={TH}>Quyền bổ sung</th>
            <th scope="col" className={TH}>Trạng thái</th>
            <th scope="col" className={TH}>Ngày tạo</th>
            <th scope="col" className="w-10 px-2">
              <span className="sr-only">Mở</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.id}>
              <tr className="border-b border-[#eef0f3] bg-[#f6f7f9]">
                <th
                  colSpan={6}
                  scope="colgroup"
                  className="px-4 py-1.5 text-left text-[12px] font-semibold text-slate-600"
                >
                  {group.title}
                  <span className="ml-1.5 font-normal tabular-nums text-slate-500">
                    {group.total}
                  </span>
                </th>
              </tr>
              {group.rows.map((user) => (
                <tr
                  key={user.id}
                  data-testid={`user-row-${user.id}`}
                  className="group cursor-pointer border-b border-[#f1f3f6] last:border-b-0 hover:bg-[#f4f6f9]/70"
                  onClick={(e) => open(e, user.id)}
                  onMouseEnter={() => {
                    void dispatch(
                      tenantApi.util.prefetch('getUser', user.id, {}),
                    );
                  }}
                >
                  <td className={TD}>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <UserAvatar
                        name={user.fullName}
                        muted={user.status !== 'active'}
                      />
                      <div className="flex min-w-0 flex-col">
                        <Link
                          href={`/users/${user.id}`}
                          className="truncate font-semibold text-[#18181b] outline-none hover:underline focus-visible:underline"
                        >
                          {user.fullName}
                        </Link>
                        <span className="truncate text-xs text-slate-500">
                          {user.email}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className={TD}>
                    <RoleChips roles={user.roles} max={2} />
                  </td>
                  <td className={TD}>
                    {(user.directActionKeys?.length ?? 0) > 0 ? (
                      <ExtraGrantsBadge
                        count={user.directActionKeys?.length ?? 0}
                        testId={`user-extra-grants-${user.id}`}
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className={TD}>
                    <StatusBadge status={user.status} />
                  </td>
                  <td className={`${TD} whitespace-nowrap tabular-nums text-slate-600`}>
                    {formatDate(user.createdAt)}
                  </td>
                  <td className="w-10 px-2 text-slate-400 group-hover:text-slate-700">
                    <ChevronRight className="size-4" aria-hidden />
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
