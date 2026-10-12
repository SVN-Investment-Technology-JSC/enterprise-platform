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
  noteTone,
}: {
  testId: string;
  icon: ReactNode;
  tone: string;
  label: string;
  value: number;
  note: string;
  noteTone: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3"
    >
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-slate-600">{label}</p>
        <p className="font-mono text-2xl font-bold leading-tight text-slate-900">{value}</p>
        <p className={`truncate text-[11px] font-semibold ${noteTone}`}>{note}</p>
      </div>
    </div>
  );
}

const percent = (n: number) => `${String(n).replace('.', ',')}%`;

/** Bốn thẻ tổng quan: tổng nhân viên, đang làm việc, nghỉ việc, chờ hoàn thiện hồ sơ. */
export function EmployeeStatCards({ stats }: { stats: EmployeeStats }) {
  return (
    <div aria-label="Tổng quan nhân sự" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      <StatCard
        testId="employee-stat-total"
        icon={<Users className="size-5" />}
        tone="bg-blue-50 text-blue-600"
        label="Tổng nhân sự"
        value={stats.total}
        note={stats.joinedThisMonth > 0 ? `+${stats.joinedThisMonth} vào làm trong tháng` : 'Không có người vào mới trong tháng'}
        noteTone={stats.joinedThisMonth > 0 ? 'text-emerald-600' : 'text-slate-400'}
      />
      <StatCard
        testId="employee-stat-active"
        icon={<UserCheck className="size-5" />}
        tone="bg-emerald-50 text-emerald-600"
        label="Đang làm việc"
        value={stats.active}
        note={percent(stats.activePercent)}
        noteTone="text-emerald-600"
      />
      <StatCard
        testId="employee-stat-inactive"
        icon={<UserX className="size-5" />}
        tone="bg-rose-50 text-rose-500"
        label="Nghỉ việc"
        value={stats.inactive}
        note={percent(stats.inactivePercent)}
        noteTone="text-rose-500"
      />
      <StatCard
        testId="employee-stat-incomplete"
        icon={<Home className="size-5" />}
        tone="bg-amber-50 text-amber-600"
        label="Chờ hoàn thiện hồ sơ"
        value={stats.incomplete}
        note={percent(stats.incompletePercent)}
        noteTone="text-amber-600"
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
