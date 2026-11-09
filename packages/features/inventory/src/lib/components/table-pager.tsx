'use client';

import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGE_SIZES, type Page } from '../trade-items.model';
import { Button } from '../ui/button';

/** Chân bảng: chọn số bản ghi mỗi trang (15, 30, 45), khoảng đang xem và nút chuyển trang. */
export function TablePager({
  view,
  pageSize,
  onPageSizeChange,
  onPageChange,
}: {
  view: Pick<Page<unknown>, 'page' | 'pageCount' | 'total' | 'from' | 'to'>;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onPageChange: (page: number) => void;
}) {
  const pageSizeOptions = PAGE_SIZES.map((value) => ({ value: String(value), label: `${value} / trang` }));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-slate-600">
      <div className="flex items-center gap-2">
        <span>Số bản ghi mỗi trang</span>
        <div className="w-[120px]">
          <SearchableSelect
            options={pageSizeOptions}
            value={String(pageSize)}
            onChange={(value) => onPageSizeChange(Number(value) || PAGE_SIZES[0])}
            clearable={false}
            height={32}
          />
        </div>
      </div>
      <span aria-live="polite">
        {view.from}–{view.to} / {view.total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Trang trước"
          disabled={view.page <= 1}
          onClick={() => onPageChange(view.page - 1)}
        >
          <ChevronLeft size={14} />
        </Button>
        <span>
          Trang {view.page} / {view.pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Trang sau"
          disabled={view.page >= view.pageCount}
          onClick={() => onPageChange(view.page + 1)}
        >
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}
