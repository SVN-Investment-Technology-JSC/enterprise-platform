'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { HrmBoardDay, HrmDayRequest } from '@enterprise-platform/contracts-hrm';
import { REQUEST_LETTERS, requestDetailRows } from './my-timesheet-format';
import {
  dayRequestHref,
  dayRequestSummary,
  requestStatusLabel,
  sourceHref,
  sourceSummary,
} from './timesheet-board-format';

const STATUS_CLASS: Record<HrmDayRequest['status'], string> = {
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-800',
  REJECTED: 'border-slate-200 bg-white text-slate-500',
};

interface Item {
  key: string;
  kind: HrmDayRequest['kind'];
  text: string;
  href: string;
  status: HrmDayRequest['status'];
  rows: [string, string][];
}

function itemsOf(day: HrmBoardDay, canViewAll: boolean): Item[] {
  if (day.requests?.length) {
    return day.requests.map((r) => ({
      key: `${r.kind}-${r.id}`,
      kind: r.kind,
      text: dayRequestSummary(r),
      href: dayRequestHref(r, canViewAll),
      status: r.status,
      rows: requestDetailRows(r),
    }));
  }
  return (day.sources ?? []).map((src) => ({
    key: `${src.kind}-${src.id}`,
    kind: src.kind,
    text: sourceSummary(src),
    href: sourceHref(src, canViewAll),
    status: 'APPROVED' as const,
    rows: [],
  }));
}

/**
 * Danh sách đơn từ áp dụng cho một ngày công: loại đơn, thời gian (ngày giờ), lý do, trạng thái và liên kết mở đơn gốc.
 * Dùng chung cho bảng công của quản lý và Công của tôi.
 */
export function DayRequestList({ day, canViewAll }: { day: HrmBoardDay; canViewAll: boolean }) {
  const items = itemsOf(day, canViewAll);
  if (!items.length) return null;
  return (
    <div data-testid="day-sources" className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 font-semibold text-slate-800">Đơn từ áp dụng cho ngày này</p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key} className="rounded-md border border-slate-200 bg-white p-2.5">
            <div className="flex items-start justify-between gap-2">
              <span className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  title={REQUEST_LETTERS[item.kind].label}
                  className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-slate-800 px-1 text-[10px] font-bold text-white"
                >
                  {REQUEST_LETTERS[item.kind].letter}
                </span>
                <span className="font-semibold text-slate-900">
                  {item.text}
                  <span
                    className={`ml-2 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[item.status]}`}
                  >
                    {requestStatusLabel(item.status)}
                  </span>
                </span>
              </span>
              <Link
                href={item.href}
                aria-label={`Mở ${item.text}`}
                className="inline-flex shrink-0 items-center gap-1 font-semibold text-blue-700 hover:underline"
              >
                Mở đơn
                <ExternalLink className="size-3" />
              </Link>
            </div>
            {item.rows.length > 0 && (
              <dl className="mt-1.5 grid grid-cols-[120px_1fr] gap-x-3 gap-y-0.5 pl-7 text-[11px]">
                {item.rows.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-slate-500">
        Chỉ đơn đã duyệt được tính vào công; đơn chờ duyệt hoặc bị từ chối chỉ để tham khảo.
      </p>
    </div>
  );
}
