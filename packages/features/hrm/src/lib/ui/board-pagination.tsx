'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { pageWindow } from '../hrm-employee-view';

export const BOARD_PAGE_SIZES = [10, 20, 50] as const;

/**
 * Thanh dưới bảng công: "Đang hiển thị 1 - 10 trong 56 nhân viên", chọn số dòng mỗi trang và dải số trang.
 * Số trang và số dòng do máy chủ phân trang.
 */
export function BoardPagination({
  page,
  pageSize,
  total,
  loading,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const nav = 'inline-flex size-8 items-center justify-center rounded-md border text-xs font-semibold transition';
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-500">
      <span>
        Đang hiển thị{' '}
        <strong className="text-slate-700">
          {from} - {to}
        </strong>{' '}
        trong {total} nhân viên
      </span>
      <div className="flex items-center gap-3">
        <div className="w-40" title="Số nhân viên mỗi trang">
          <SearchableSelect
            options={BOARD_PAGE_SIZES.map((n) => ({ value: String(n), label: `Hiển thị ${n}` }))}
            value={String(pageSize)}
            onChange={(v) => v && onPageSize(Number(v))}
            clearable={false}
          />
        </div>
        <nav aria-label="Phân trang" className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Trang trước"
            disabled={page <= 1 || loading}
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
                disabled={loading}
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
            disabled={page >= pageCount || loading}
            onClick={() => onPage(page + 1)}
            className={`${nav} border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40`}
          >
            <ChevronRight className="size-4" />
          </button>
        </nav>
      </div>
    </div>
  );
}
