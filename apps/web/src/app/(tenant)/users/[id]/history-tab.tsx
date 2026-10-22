'use client';

import { useMemo } from 'react';
import { useGetRolesQuery, useGetUserHistoryQuery } from '@/store/tenant-api';
import { UserCard } from '../user-ui';
import {
  buildHistoryItems,
  formatDateTime,
  type HistoryChange,
} from './history-model';

const CHANGE_CLASS: Record<HistoryChange['kind'], string> = {
  added: 'bg-emerald-50 text-emerald-800',
  removed: 'bg-red-50 text-red-700',
};

const RETRY =
  'h-8 cursor-pointer rounded-md border border-[#e5e7eb] bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-[#f4f6f9]';

/** Tab "Lịch sử thay đổi quyền": ai đổi vai trò hoặc quyền bổ sung của người này, khi nào, đổi gì. */
export function HistoryTab({ userId }: { readonly userId: string }) {
  const history = useGetUserHistoryQuery(userId);
  const roles = useGetRolesQuery();
  const roleNames = useMemo(
    () => new Map((roles.data ?? []).map((r) => [r.id, r.name])),
    [roles.data],
  );
  const items = useMemo(
    () =>
      history.data && roles.data
        ? buildHistoryItems(history.data, roleNames)
        : [],
    [history.data, roles.data, roleNames],
  );

  const failed = history.error ?? roles.error;
  let body;
  if (failed && !(history.data && roles.data)) {
    body = (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-red-700"
      >
        <span className="min-w-0 flex-1">
          {failed.message ?? 'Không thể tải lịch sử thay đổi quyền.'}
        </span>
        <button
          type="button"
          aria-label="Thử tải lại lịch sử thay đổi quyền"
          className={RETRY}
          onClick={() => {
            if (history.error) void history.refetch();
            if (roles.error) void roles.refetch();
          }}
        >
          Thử lại
        </button>
      </div>
    );
  } else if (!history.data || !roles.data) {
    body = (
      <div
        className="flex flex-col gap-3"
        aria-busy="true"
        aria-label="Đang tải lịch sử"
      >
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <p className="m-0 rounded-md border border-dashed border-slate-200 p-8 text-center text-[14px] text-slate-500">
        Chưa có thay đổi vai trò hoặc quyền nào của người dùng này.
      </p>
    );
  } else {
    body = (
      <ol className="m-0 flex list-none flex-col p-0">
        {items.map((item, index) => (
          <li
            key={item.id}
            className="relative flex gap-3 pb-5 last:pb-0"
            data-testid="history-item"
          >
            {index < items.length - 1 ? (
              <span
                aria-hidden
                className="absolute top-3 bottom-0 left-[5px] w-px bg-[#e5e7eb]"
              />
            ) : null}
            <span
              aria-hidden
              className={`relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-white ring-1 ${
                item.operation === 'permissions'
                  ? 'bg-orange-400 ring-orange-300'
                  : 'bg-[#ffc90a] ring-[#e5b400]'
              }`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-slate-500">
                <b className="text-[14px] text-[#18181b]">{item.title}</b>
                <span>bởi {item.actorName}</span>
                <time dateTime={item.createdAt}>
                  {formatDateTime(item.createdAt)}
                </time>
              </div>
              {item.changes.length > 0 ? (
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {item.changes.map((change) => (
                    <li
                      key={`${change.kind}-${change.text}`}
                      className={`rounded-md px-2 py-0.5 text-[12px] font-medium ${CHANGE_CLASS[change.kind]}`}
                    >
                      <span aria-hidden>
                        {change.kind === 'added' ? '+ ' : '− '}
                      </span>
                      {change.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[13px] text-slate-400">
                  Không có thay đổi nào được ghi nhận.
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <UserCard aria-label="Lịch sử thay đổi quyền" className="p-4 sm:p-5">
      <h2 className="m-0 mb-4 text-[15px] font-bold text-[#18181b]">
        Lịch sử thay đổi quyền
      </h2>
      {body}
    </UserCard>
  );
}
