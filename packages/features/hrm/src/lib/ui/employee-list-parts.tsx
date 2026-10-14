'use client';

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Home, UserCheck, UserX, Users } from 'lucide-react';
import type { EmployeeStats } from '../hrm-employee-view';
import { pageWindow } from '../hrm-employee-view';

function StatCard({
  testId,
  icon,
  tone,
  label,
  value,
  note,
  noteTone = '',
  selected = false,
  onSelect,
}: {
  selected?: boolean;
  onSelect?: () => void;
  testId: string;
  icon: ReactNode;
  tone: string;
  label: string;
  value: number;
  note?: string;
  noteTone?: string;
}) {
  const body = (
    <div
      data-testid={testId}
      className={`flex min-w-0 items-center gap-3 rounded-xl border bg-white px-3.5 py-3 ${
        selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'
      }`}
    >
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-slate-600">{label}</p>
        <p className="font-mono text-2xl font-bold leading-tight text-slate-900">{value}</p>
        {note ? <p className={`truncate text-[11px] font-semibold ${noteTone}`}>{note}</p> : null}
      </div>
    </div>
  );
  if (!onSelect) return body;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Lọc danh sách: ${label}`}
      className="block min-w-0 cursor-pointer rounded-xl text-left transition hover:ring-2 hover:ring-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {body}
    </button>
  );
}

/** Bốn thẻ tổng quan: tổng nhân viên, đang làm việc, nghỉ việc, chờ hoàn thiện hồ sơ. */
export type EmployeeCardFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'INCOMPLETE';

export function EmployeeStatCards({
  stats,
  active = 'ALL',
  onSelect,
}: {
  stats: EmployeeStats;
  /** Thẻ đang lọc danh sách (nếu có). */
  active?: EmployeeCardFilter;
  /** Bấm thẻ: lọc danh sách nhân sự theo nhóm của thẻ. Không truyền thì thẻ chỉ để xem. */
  onSelect?: (filter: EmployeeCardFilter) => void;
}) {
  return (
    <div aria-label="Tổng quan nhân sự" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      <StatCard
        testId="employee-stat-total"
        selected={false}
        onSelect={onSelect ? () => onSelect('ALL') : undefined}
        icon={<Users className="size-5" />}
        tone="bg-blue-50 text-blue-600"
        label="Tổng nhân sự"
        value={stats.total}
        note={stats.joinedThisMonth > 0 ? `+${stats.joinedThisMonth} vào làm trong tháng` : undefined}
        noteTone="text-emerald-600"
      />
      <StatCard
        testId="employee-stat-active"
        selected={active === 'ACTIVE'}
        onSelect={onSelect ? () => onSelect('ACTIVE') : undefined}
        icon={<UserCheck className="size-5" />}
        tone="bg-emerald-50 text-emerald-600"
        label="Đang làm việc"
        value={stats.active}
      />
      <StatCard
        testId="employee-stat-inactive"
        selected={active === 'INACTIVE'}
        onSelect={onSelect ? () => onSelect('INACTIVE') : undefined}
        icon={<UserX className="size-5" />}
        tone="bg-rose-50 text-rose-500"
        label="Nghỉ việc"
        value={stats.inactive}
      />
      <StatCard
        testId="employee-stat-incomplete"
        selected={active === 'INCOMPLETE'}
        onSelect={onSelect ? () => onSelect('INCOMPLETE') : undefined}
        icon={<Home className="size-5" />}
        tone="bg-amber-50 text-amber-600"
        label="Chờ hoàn thiện hồ sơ"
        value={stats.incomplete}
      />
    </div>
  );
}

/** Phân trang: "Hiển thị 1 - 12 trong 56 nhân viên" và dải số trang. */
export function EmployeePagination({
  page,
  pageCount,
  from,
  to,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const nav = 'inline-flex size-8 items-center justify-center rounded-md border text-xs font-semibold transition';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
      <span>
        Hiển thị{' '}
        <strong className="text-slate-700">
          {from} - {to}
        </strong>{' '}
        trong {total} nhân sự
      </span>
      <nav aria-label="Phân trang" className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Trang trước"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className={`${nav} border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40`}
        >
          <ChevronLeft className="size-4" />
        </button>
        {pageWindow(page, pageCount).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className="px-1 text-slate-400" aria-hidden="true">
              ...
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-label={`Trang ${p}`}
              aria-current={p === page ? 'page' : undefined}
              onClick={() => onPage(p)}
              className={`${nav} ${
                p === page ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          aria-label="Trang sau"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          className={`${nav} border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40`}
        >
          <ChevronRight className="size-4" />
        </button>
      </nav>
    </div>
  );
}

const AVATAR_TONES = [
  'bg-rose-100 text-rose-700',
  'bg-sky-100 text-sky-700',
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-indigo-100 text-indigo-700',
];

/** Ảnh đại diện chữ cái; màu theo mã nhân viên để cùng một người luôn cùng màu. */
export function EmployeeAvatar({ initials, seed }: { initials: string; seed: string }) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${AVATAR_TONES[hash % AVATAR_TONES.length]}`}
    >
      {initials}
    </span>
  );
}
