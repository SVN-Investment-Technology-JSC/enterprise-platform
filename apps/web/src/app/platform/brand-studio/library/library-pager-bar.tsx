'use client';

import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Hint } from '../components/hint';
import { PAGE_SIZE_OPTIONS, pageWindow, type PageSlice } from './library-pager';

/**
 * Chân khối icon: khoảng đang xem, chọn số icon mỗi trang, và nút chuyển trang. Chỉ hiện khi có nhiều hơn một trang cỡ
 * nhỏ nhất, vì ít icon hơn thế thì phân trang không giúp được gì.
 */
export function LibraryPagerBar({
  slice,
  onPage,
  onPageSize,
  unit = 'icon',
  sizes = PAGE_SIZE_OPTIONS,
  sizeControl = 'buttons',
}: {
  slice: Pick<PageSlice<unknown>, 'page' | 'pages' | 'pageSize' | 'total' | 'from' | 'to'>;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  /** Tên đối tượng đang phân trang, dùng trong nhãn (mặc định `icon`). */
  unit?: string;
  /** Các cỡ trang cho chọn (mặc định cỡ của lưới icon). */
  sizes?: readonly number[];
  /** `buttons`: dãy nút (lưới icon); `select`: ô chọn xổ xuống (danh sách dạng dòng). */
  sizeControl?: 'buttons' | 'select';
}) {
  if (slice.total <= (sizes[0] ?? 0)) return null;
  const { page, pages } = slice;

  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600"
      data-testid="pager-bar"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span aria-live="polite" className="tabular-nums">
          Hiển thị <strong className="font-semibold text-slate-900">{slice.from}–{slice.to}</strong> / {slice.total} {unit}
        </span>
        {sizeControl === 'select' ? (
          <div className="flex items-center gap-2">
            <span>Mỗi trang</span>
            <div className="w-[72px]">
              <SearchableSelect
                clearable={false}
                dropdownMinWidth={72}
                height={32}
                hideDropdownSearch
                name="page-size"
                onChange={(value) => onPageSize(Number(value))}
                options={sizes.map((size) => ({ value: String(size), label: String(size) }))}
                searchInDropdown
                value={String(slice.pageSize)}
              />
            </div>
          </div>
        ) : (
          <div aria-label={`Số ${unit} mỗi trang`} className="flex items-center gap-1" role="group">
            <span aria-hidden>Mỗi trang</span>
            {sizes.map((size) => (
              <Button
                aria-label={`${size} ${unit} mỗi trang`}
                aria-pressed={slice.pageSize === size}
                className={cn(
                  'min-w-8 tabular-nums',
                  slice.pageSize === size && 'border-blue-300 bg-blue-50 font-semibold text-blue-700 hover:bg-blue-50',
                )}
                key={size}
                onClick={() => onPageSize(size)}
                variant="outline"
              >
                {size}
              </Button>
            ))}
          </div>
        )}
      </div>

      <nav aria-label="Phân trang" className="flex items-center gap-0.5">
        <Hint label="Trang trước">
          <Button aria-label="Trang trước" disabled={page <= 1} onClick={() => onPage(page - 1)} size="icon" variant="ghost">
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
        </Hint>
        <span className="px-2 tabular-nums sm:hidden">
          Trang {page} / {pages}
        </span>
        <div className="hidden items-center gap-0.5 sm:flex">
          {pageWindow(page, pages).map((token) =>
            typeof token === 'number' ? (
              <Button
                aria-current={token === page ? 'page' : undefined}
                aria-label={`Trang ${token}`}
                className={cn(
                  'tabular-nums',
                  token === page && 'border-blue-300 bg-blue-50 font-semibold text-blue-700 hover:bg-blue-50 hover:text-blue-700',
                )}
                key={token}
                onClick={() => onPage(token)}
                size="icon"
                variant={token === page ? 'outline' : 'ghost'}
              >
                {token}
              </Button>
            ) : (
              <span aria-hidden className="grid size-8 place-items-center text-slate-400" key={token}>
                …
              </span>
            ),
          )}
        </div>
        <Hint label="Trang sau">
          <Button aria-label="Trang sau" disabled={page >= pages} onClick={() => onPage(page + 1)} size="icon" variant="ghost">
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </Hint>
      </nav>
    </div>
  );
}
