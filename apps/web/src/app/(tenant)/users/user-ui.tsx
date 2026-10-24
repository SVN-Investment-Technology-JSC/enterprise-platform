'use client';

import type { ReactNode } from 'react';
import { userAvatarUrl } from '@enterprise-platform/contracts-chat';
import { usePerson } from '@enterprise-platform/feature-chat';
import { useState } from 'react';
import type { TenantCoreUser } from './user-types';

/**
 * Thành phần giao diện dùng chung cho danh sách và chi tiết người dùng.
 * Chỉ hai cỡ bo góc: thẻ `rounded-[10px]` và control (nút, ô nhập, chip, badge) `rounded-md` (6px).
 */
export const CARD_CLASS = 'rounded-[10px] border border-[#eef0f3] bg-white';

export function UserCard({
  children,
  className = '',
  as: Tag = 'section',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
  'aria-label'?: string;
}) {
  return (
    <Tag className={`${CARD_CLASS} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const last = parts[parts.length - 1];
  const first = parts.length > 1 ? parts[0] : '';
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

export function UserAvatar({
  name,
  userId,
  size = 36,
  muted = false,
}: {
  name: string;
  /** Có id thì hiện ảnh đại diện người đó tự tải lên (lấy từ danh bạ chung); chưa có ảnh thì hiện chữ viết tắt. */
  userId?: string;
  size?: number;
  muted?: boolean;
}) {
  const person = usePerson(userId);
  const [failed, setFailed] = useState(false);
  if (userId && person?.avatarVersion != null && !failed) {
    return (
      <img
        alt=""
        aria-hidden
        src={userAvatarUrl(userId, person.avatarVersion)}
        style={{ width: size, height: size }}
        className={`shrink-0 rounded-md object-cover ${muted ? 'opacity-60 grayscale' : ''}`}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      className={`grid shrink-0 place-items-center rounded-md font-bold ${
        muted ? 'bg-slate-100 text-slate-500' : 'bg-[#ffc90a] text-[#18181b]'
      }`}
    >
      {initials(name)}
    </span>
  );
}

export function StatusBadge({ status }: { status: TenantCoreUser['status'] }) {
  const active = status === 'active';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-semibold ${
        active ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-red-500'}`}
      />
      {active ? 'Hoạt động' : 'Vô hiệu hóa'}
    </span>
  );
}

export const chipClass =
  'inline-flex items-center rounded-md bg-[#f1f3f6] px-2 py-0.5 text-[12px] font-medium text-slate-700';

/** Vai trò dạng chip, tối đa `max` chip rồi gộp phần còn lại thành "+N". */
export function RoleChips({
  roles,
  max = 2,
}: {
  roles: readonly { id: string; name: string }[] | undefined;
  max?: number;
}) {
  const list = roles ?? [];
  if (list.length === 0)
    return <span className="text-[12px] text-slate-400">Chưa có vai trò</span>;
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((r) => (
        <span key={r.id} className={chipClass}>
          {r.name}
        </span>
      ))}
      {rest > 0 ? (
        <span
          className={chipClass}
          title={list
            .slice(max)
            .map((r) => r.name)
            .join(', ')}
        >
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

export function ExtraGrantsBadge({ count, testId }: { count: number; testId?: string }) {
  if (count <= 0) return null;
  return (
    <span
      data-testid={testId}
      title="Quyền được cấp thêm ngoài vai trò"
      className="inline-flex items-center rounded-md bg-orange-50 px-2 py-0.5 text-[12px] font-semibold text-orange-800"
    >
      +{count} quyền bổ sung
    </span>
  );
}

export function formatDate(value: string | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
}
