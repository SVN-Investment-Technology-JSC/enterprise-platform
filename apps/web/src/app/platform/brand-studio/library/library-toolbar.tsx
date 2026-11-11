'use client';

import { CATEGORY_LABELS } from '@enterprise-platform/shared-brand-icon';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { ChevronDown, LayoutGrid, List, ListFilter, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { IconButton } from './library-ui';
import { RAISED } from '../components/panel';
import {
  CATEGORY_FILTERS,
  SORT_LABELS,
  STATUSES,
  STATUS_LABELS,
  type CategoryFilter,
  type FacetCounts,
  type LibraryView,
  type SortKey,
  type StatusFilter,
  type ViewMode,
} from './library-filters';
import { Hint } from '../components/hint';

const SORT_OPTIONS = (Object.keys(SORT_LABELS) as SortKey[]).map((value) => ({ value, label: SORT_LABELS[value] }));
const STATUS_FILTERS: readonly StatusFilter[] = ['all', ...STATUSES];

const categoryName = (category: CategoryFilter) => (category === 'all' ? 'Tất cả danh mục' : CATEGORY_LABELS[category]);
const statusName = (status: StatusFilter) => (status === 'all' ? 'Mọi trạng thái' : STATUS_LABELS[status]);

/** Chip một bộ lọc đang bật, bấm để bỏ riêng bộ lọc đó. */
function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-blue-50 pl-2.5 pr-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
      {label}
      <button
        aria-label={`Bỏ lọc ${label}`}
        className="grid size-5 place-items-center rounded-full text-blue-500 hover:bg-blue-100 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        onClick={onRemove}
        type="button"
      >
        <X aria-hidden className="size-3" />
      </button>
    </span>
  );
}

function CountedItem({ value, label, count }: { value: string; label: string; count: number }) {
  return (
    <DropdownMenuRadioItem closeOnClick={false} value={value}>
      <span className="flex-1">{label}</span>
      <span className={cn('tabular-nums text-xs', count === 0 ? 'text-muted-foreground/60' : 'text-muted-foreground')}>{count}</span>
    </DropdownMenuRadioItem>
  );
}

/**
 * Hàng công cụ của thư viện: ô tìm, nút Bộ lọc (menu danh mục và trạng thái, mỗi mục kèm số icon sẽ hiện ra), chip các
 * bộ lọc đang bật, sắp xếp và kiểu hiển thị. Một hàng thay cho hai dãy chip, nhưng vẫn đủ mọi bộ lọc.
 */
export function LibraryToolbar({
  view,
  counts,
  mode,
  onChange,
  onMode,
  onSort,
}: {
  view: LibraryView;
  counts: FacetCounts;
  mode: ViewMode;
  onChange: (patch: Partial<LibraryView>) => void;
  onMode: (mode: ViewMode) => void;
  onSort: (sort: SortKey) => void;
}) {
  const activeCount = (view.category !== 'all' ? 1 : 0) + (view.status !== 'all' ? 1 : 0);

  return (
    <div aria-label="Bộ lọc" className="flex flex-wrap items-center gap-2" role="search">
      <div className="relative w-full min-w-48 sm:w-64">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          aria-label="Tìm icon"
          className="h-8 rounded-md border-slate-300 bg-white pl-8 pr-8 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.06)] [&::-webkit-search-cancel-button]:hidden"
          onChange={(event) => onChange({ query: event.target.value })}
          placeholder="Tìm theo tên, mô tả, nhãn"
          type="search"
          value={view.query}
        />
        {view.query ? (
          <Hint label="Xoá từ khoá">
            <button
              aria-label="Xoá từ khoá"
              className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-slate-400 hover:text-slate-700"
              onClick={() => onChange({ query: '' })}
              type="button"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </Hint>
        ) : null}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button aria-label={activeCount > 0 ? `Bộ lọc, đang bật ${activeCount}` : 'Bộ lọc'} className={cn(RAISED, 'gap-1.5 px-2.5')} variant="outline" />
          }
        >
          <ListFilter aria-hidden className="size-4 text-blue-600" />
          Bộ lọc
          {activeCount > 0 ? (
            <span aria-hidden className="grid min-w-4 place-items-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold leading-4 text-white">
              {activeCount}
            </span>
          ) : null}
          <ChevronDown aria-hidden className="size-3.5 text-slate-400" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60" sideOffset={6}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Danh mục</DropdownMenuLabel>
            <DropdownMenuRadioGroup onValueChange={(value) => onChange({ category: value as CategoryFilter })} value={view.category}>
              {CATEGORY_FILTERS.map((category) => (
                <CountedItem count={counts.category[category]} key={category} label={categoryName(category)} value={category} />
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Trạng thái</DropdownMenuLabel>
            <DropdownMenuRadioGroup onValueChange={(value) => onChange({ status: value as StatusFilter })} value={view.status}>
              {STATUS_FILTERS.map((status) => (
                <CountedItem count={counts.status[status]} key={status} label={statusName(status)} value={status} />
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {view.category !== 'all' ? <ActiveChip label={categoryName(view.category)} onRemove={() => onChange({ category: 'all' })} /> : null}
      {view.status !== 'all' ? <ActiveChip label={statusName(view.status)} onRemove={() => onChange({ status: 'all' })} /> : null}

      <div className="ml-auto flex items-center gap-2">
        <Hint label="Sắp xếp">
          <div className="w-36">
            <SearchableSelect
              clearable={false}
              height={32}
              onChange={(value) => onSort(value === 'name' ? 'name' : 'updated')}
              options={SORT_OPTIONS}
              placeholder="Sắp xếp"
              searchInDropdown
              value={view.sort}
            />
          </div>
        </Hint>
        <div aria-label="Kiểu hiển thị" className="flex rounded-md border border-slate-300 bg-white p-0.5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]" role="group">
          <IconButton
            aria-pressed={mode === 'grid'}
            className={cn('size-7', mode === 'grid' && 'bg-blue-50 text-blue-700')}
            label="Dạng lưới"
            onClick={() => onMode('grid')}
          >
            <LayoutGrid aria-hidden className="size-4" />
          </IconButton>
          <IconButton
            aria-pressed={mode === 'list'}
            className={cn('size-7', mode === 'list' && 'bg-blue-50 text-blue-700')}
            label="Dạng danh sách"
            onClick={() => onMode('list')}
          >
            <List aria-hidden className="size-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
