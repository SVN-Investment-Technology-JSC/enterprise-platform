'use client';

import type { ReactNode } from 'react';
import {
  ArrowLeftRight,
  Briefcase,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Wallet,
  UserCog,
  RotateCcw,
  Search,
  type LucideIcon,
} from 'lucide-react';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@enterprise-platform/shared-ui';
import {
  rowStatusMeta,
  STATUS_TONE_CLASS,
  type MyRequestRow,
  type RequestStatusFilter,
  type StatusMeta,
} from '../my-requests-model';
import { Button } from './button';
import { Input } from './input';

const KIND_ICON: Record<string, { icon: LucideIcon; box: string }> = {
  leave: { icon: CalendarDays, box: 'bg-emerald-50 text-emerald-600' },
  ot: { icon: Clock, box: 'bg-violet-50 text-violet-600' },
  business_trip: { icon: Briefcase, box: 'bg-orange-50 text-orange-600' },
  correction: { icon: FileText, box: 'bg-rose-50 text-rose-600' },
  shift_change: { icon: ArrowLeftRight, box: 'bg-teal-50 text-teal-600' },
  advance: { icon: Wallet, box: 'bg-indigo-50 text-indigo-600' },
  profile_correction: { icon: UserCog, box: 'bg-sky-50 text-sky-600' },
  custom: { icon: FileText, box: 'bg-slate-100 text-slate-600' },
};

export function KindIcon({
  kind,
  size = 'md',
}: {
  kind: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const meta = KIND_ICON[kind] ?? KIND_ICON.custom;
  const Icon = meta.icon;
  const box =
    size === 'lg'
      ? 'size-11 rounded-xl'
      : size === 'sm'
        ? 'size-7 rounded-md'
        : 'size-9 rounded-lg';
  const glyph =
    size === 'lg' ? 'size-5' : size === 'sm' ? 'size-3.5' : 'size-4';
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center ${box} ${meta.box}`}
    >
      <Icon className={glyph} />
    </span>
  );
}

export function StatusPill({
  meta,
  className = '',
}: {
  meta: StatusMeta;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE_CLASS[meta.tone]} ${className}`}
    >
      {meta.label}
    </span>
  );
}

export interface QuickCreateItem {
  key: string;
  kind: string;
  title: string;
  desc: string;
  onClick: () => void;
}

/** Hàng "Tạo đơn nhanh": mỗi loại đơn một thẻ; các loại còn lại mở bằng nút "Tất cả loại đơn". */
export function QuickCreateRow({
  items,
  extraCount,
  showAll,
  onToggleAll,
}: {
  items: readonly QuickCreateItem[];
  extraCount: number;
  showAll: boolean;
  onToggleAll: () => void;
}) {
  return (
    <section
      aria-label="Tạo đơn nhanh"
      className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-900">Tạo đơn nhanh</h2>
        {extraCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            aria-expanded={showAll}
            onClick={onToggleAll}
          >
            {showAll
              ? 'Thu gọn'
              : `Tất cả loại đơn (${items.length + extraCount})`}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-label={`Khởi tạo đơn này: ${item.title}`}
            onClick={item.onClick}
            className="group flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left transition hover:border-[#ffc90a] hover:bg-amber-50/40"
          >
            <KindIcon kind={item.kind} size="lg" />
            <span className="min-w-0 flex-1">
              <span
                role="heading"
                aria-level={3}
                className="block truncate text-[13px] font-bold text-slate-900"
              >
                {item.title}
              </span>
              <span className="block truncate text-[11px] text-slate-500">
                {item.desc}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-slate-400 transition group-hover:text-slate-700" />
          </button>
        ))}
      </div>
    </section>
  );
}

export interface RequestListTab {
  id: RequestStatusFilter;
  label: string;
  count: number;
}

export interface RequestListPage {
  from: number;
  to: number;
  total: number;
  page: number;
  pageCount: number;
}

const STATUS_OPTIONS: SearchableSelectOption[] = [
  { value: 'ALL', label: 'Tất cả trạng thái' },
  { value: 'PENDING', label: 'Đang chờ duyệt' },
  { value: 'APPROVED', label: 'Đã duyệt / Áp dụng' },
  { value: 'REJECTED', label: 'Đã từ chối' },
  { value: 'CANCELLED', label: 'Đã rút / hủy' },
];

/** Danh sách đơn trong tháng: tab trạng thái, tìm kiếm, lọc loại, bảng, phân trang. Bấm một dòng để xem chi tiết bên phải. */
export function RequestListPanel({
  title,
  rows,
  startIndex,
  selectedId,
  onSelect,
  loading,
  tabs,
  status,
  onStatusChange,
  search,
  onSearchChange,
  kind,
  onKindChange,
  kindOptions,
  advancedFilters,
  hasActiveFilters,
  onReset,
  toolbarExtra,
  page,
  onPage,
  reasonExtra,
}: {
  title: string;
  rows: readonly MyRequestRow[];
  startIndex: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  tabs: readonly RequestListTab[];
  status: RequestStatusFilter;
  onStatusChange: (status: RequestStatusFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  kind: string;
  onKindChange: (value: string) => void;
  kindOptions: SearchableSelectOption[];
  advancedFilters?: ReactNode;
  hasActiveFilters: boolean;
  onReset: () => void;
  toolbarExtra?: ReactNode;
  page: RequestListPage;
  onPage: (page: number) => void;
  reasonExtra?: (id: string) => ReactNode;
}) {
  return (
    <section
      aria-label="Danh sách đơn"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-52">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              aria-label="Tìm đơn"
              placeholder="Tìm mã đơn, lý do..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-8 bg-white pl-8 text-xs"
            />
          </div>
          <div className="w-48">
            <SearchableSelect
              height={32}
              options={kindOptions}
              value={kind}
              onChange={(val) => onKindChange(val || 'ALL')}
              placeholder="Tất cả loại đơn"
              clearable={false}
            />
          </div>
          <div className="w-48">
            <SearchableSelect
              height={32}
              options={STATUS_OPTIONS}
              value={status}
              onChange={(val) =>
                onStatusChange((val || 'ALL') as RequestStatusFilter)
              }
              placeholder="Tất cả trạng thái"
              clearable={false}
            />
          </div>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-slate-500"
              onClick={onReset}
            >
              <RotateCcw className="mr-1 size-3" />
              Đặt lại
            </Button>
          )}
          {toolbarExtra}
        </div>
      </div>

      {advancedFilters ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-2">
          {advancedFilters}
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="Lọc theo trạng thái"
        className="mt-2 flex gap-1 border-b border-slate-200 px-4"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={status === tab.id}
            onClick={() => onStatusChange(tab.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold transition ${
              status === tab.id
                ? 'border-[#ffc90a] text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-xs">
          <thead className="bg-slate-50 text-[11px] font-bold text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Mã đơn</th>
              <th className="px-3 py-2.5">Loại đơn</th>
              <th className="px-3 py-2.5">Thời gian</th>
              <th className="px-3 py-2.5">Số ngày/giờ</th>
              <th className="px-3 py-2.5">Lý do</th>
              <th className="px-3 py-2.5">Trạng thái</th>
              <th className="px-3 py-2.5">Ngày tạo</th>
              <th className="w-8 px-2 py-2.5">
                <span className="sr-only">Chi tiết</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-400">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Đang tải danh sách đơn từ...
                  </span>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-400">
                  Không tìm thấy đơn từ nào phù hợp với bộ lọc.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const selected = row.id === selectedId;
                return (
                  <tr
                    key={row.id}
                    data-testid={`request-row-${row.id}`}
                    aria-selected={selected}
                    onClick={() => onSelect(row.id)}
                    className={`cursor-pointer transition-colors ${
                      selected
                        ? 'bg-amber-100 shadow-[inset_3px_0_0_#f59e0b]'
                        : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <td className="px-3 py-2.5 text-slate-500">
                      {startIndex + index + 1}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <KindIcon kind={row.kind} size="sm" />
                        <span className="font-mono font-semibold text-slate-900">
                          {row.code}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-medium">{row.typeName}</td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {row.effectiveDate}
                    </td>
                    <td className="px-3 py-2.5 font-mono font-semibold">
                      {row.duration}
                    </td>
                    <td
                      className="max-w-[200px] px-3 py-2.5 text-slate-700"
                      title={row.reason}
                    >
                      <span className="block truncate">{row.reason}</span>
                      {reasonExtra?.(row.id)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill meta={rowStatusMeta(row)} />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600">
                      {row.createdAt}
                    </td>
                    <td className="px-2 py-2.5 text-slate-400">
                      <button
                        type="button"
                        aria-label={`Chi tiết đơn ${row.code}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(row.id);
                        }}
                        className="rounded p-0.5 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <ChevronRight className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
        <span>
          Hiển thị{' '}
          <strong>
            {page.from}-{page.to}
          </strong>{' '}
          trên <strong>{page.total}</strong> đơn
        </span>
        <span className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={page.page <= 1}
            onClick={() => onPage(page.page - 1)}
          >
            <ChevronLeft className="size-3.5" />
            Trước
          </Button>
          <span className="font-semibold text-slate-700">
            {page.page} / {page.pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={page.page >= page.pageCount}
            onClick={() => onPage(page.page + 1)}
          >
            Sau
            <ChevronRight className="size-3.5" />
          </Button>
        </span>
      </div>
    </section>
  );
}

export function DetailField({
  label,
  children,
  testId,
}: {
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-x-3 py-1.5 text-xs">
      <dt className="text-slate-500">{label}</dt>
      <dd
        data-testid={testId}
        className="min-w-0 whitespace-pre-wrap break-words font-medium text-slate-900"
      >
        {children}
      </dd>
    </div>
  );
}

/** Khung chi tiết đơn bên phải danh sách: thông tin chính, quy trình phê duyệt (do màn hình truyền vào) và các nút thao tác. */
export function RequestDetailCard({
  row,
  status,
  fields,
  workflow,
  actions,
}: {
  row: MyRequestRow | null;
  status: StatusMeta | null;
  fields: ReactNode;
  workflow: ReactNode;
  actions: ReactNode;
}) {
  return (
    <aside
      aria-label="Chi tiết đơn"
      data-testid="request-detail-card"
      className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-xs"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-base font-bold text-slate-900">Chi tiết đơn</h2>
        {status && <StatusPill meta={status} />}
      </div>
      {!row ? (
        <p className="p-4 text-xs text-slate-500">
          Chọn một đơn trong danh sách để xem chi tiết và tiến độ phê duyệt.
        </p>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <div className="flex items-center gap-3">
              <KindIcon kind={row.kind} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">
                  {row.typeName}
                </p>
                <p className="text-xs text-slate-500">
                  Mã đơn:{' '}
                  <span className="font-mono font-semibold text-slate-700">
                    {row.code}
                  </span>
                </p>
              </div>
            </div>
            <dl className="divide-y divide-slate-100">{fields}</dl>
            <div>
              <h3 className="mb-2 text-sm font-bold text-slate-900">
                Quy trình phê duyệt
              </h3>
              {workflow}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-3">
            {actions}
          </div>
        </>
      )}
    </aside>
  );
}
