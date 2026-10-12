'use client';
/**
 * Danh sách co giãn theo KHUNG chứa (container query): từ `bp` trở lên là bảng nhiều cột, hẹp hơn mỗi dòng là một thẻ
 * (cột đầu là tiêu đề, các cột còn lại hiện kèm nhãn). Chỉ có MỘT bộ DOM nên không bị lặp nội dung giữa hai kiểu hiển thị.
 * Kèm bộ phân trang gọn (`usePaged` + `Pager`).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { Button } from '../button';

export interface ListColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Cột đầu của thẻ: không kèm nhãn khi hẹp. */
  primary?: boolean;
  /**
   * Cột thao tác. `corner`: góc phải trên của thẻ khi hẹp (một nút "..."); `inline`: hàng riêng cuối thẻ (nhiều nút).
   */
  actions?: 'corner' | 'inline';
}

const BP = {
  '2xl': {
    head: 'hidden @2xl:grid',
    wideRow: '@2xl:grid @2xl:items-center @2xl:gap-3 @2xl:rounded-none @2xl:border-0 @2xl:px-3 @2xl:py-2.5 @2xl:pr-3',
    label: '@2xl:hidden',
    cell: '@2xl:block',
    corner: '@2xl:static @2xl:justify-end',
    inline: '@2xl:mt-0 @2xl:border-0 @2xl:pt-0',
    frame: '@2xl:overflow-hidden @2xl:rounded-lg @2xl:border @2xl:border-slate-200',
    stack: '@2xl:space-y-0 @2xl:divide-y @2xl:divide-slate-100',
    primary: '@2xl:pr-0',
  },
  '3xl': {
    head: 'hidden @3xl:grid',
    wideRow: '@3xl:grid @3xl:items-center @3xl:gap-3 @3xl:rounded-none @3xl:border-0 @3xl:px-3 @3xl:py-2.5 @3xl:pr-3',
    label: '@3xl:hidden',
    cell: '@3xl:block',
    corner: '@3xl:static @3xl:justify-end',
    inline: '@3xl:mt-0 @3xl:border-0 @3xl:pt-0',
    frame: '@3xl:overflow-hidden @3xl:rounded-lg @3xl:border @3xl:border-slate-200',
    stack: '@3xl:space-y-0 @3xl:divide-y @3xl:divide-slate-100',
    primary: '@3xl:pr-0',
  },
} as const;

export function ResponsiveList<T>({
  label,
  rows,
  columns,
  rowKey,
  gridClass,
  bp = '2xl',
}: {
  label: string;
  rows: readonly T[];
  columns: readonly ListColumn<T>[];
  rowKey: (row: T) => string;
  /** Lớp lưới cho chế độ bảng, ví dụ `@2xl:grid-cols-[8rem_minmax(0,1fr)_6rem]` (phải cùng điểm gãy `bp`). */
  gridClass: string;
  bp?: keyof typeof BP;
}) {
  const s = BP[bp];
  const hasCorner = columns.some((c) => c.actions === 'corner');
  return (
    <div role="table" aria-label={label} className="@container min-w-0">
      <div role="rowgroup" className={s.frame}>
        <div
          role="row"
          className={`${s.head} ${gridClass} gap-3 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600`}
        >
          {columns.map((c) => (
            <div
              key={c.id}
              role="columnheader"
              className={c.actions ? 'text-right' : 'min-w-0'}
            >
              {c.header}
            </div>
          ))}
        </div>
        <div className={`space-y-2 ${s.stack}`}>
          {rows.map((row) => (
            <div
              key={rowKey(row)}
              role="row"
              className={`relative flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-3 ${
                hasCorner ? 'pr-11' : ''
              } ${s.wideRow} ${gridClass}`}
            >
              {columns.map((c) =>
                c.actions ? (
                  <div
                    key={c.id}
                    role="cell"
                    className={
                      c.actions === 'corner'
                        ? `absolute right-2 top-2 flex items-center ${s.corner}`
                        : `mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-2 ${s.inline} @2xl:justify-end`
                    }
                  >
                    {c.cell(row)}
                  </div>
                ) : (
                  <div
                    key={c.id}
                    role="cell"
                    className={`flex min-w-0 items-start gap-2 text-xs text-slate-700 ${s.cell} ${
                      c.primary ? s.primary : ''
                    }`}
                  >
                    {c.primary ? null : (
                      <span className={`w-[5.5rem] shrink-0 pt-px text-[11px] text-slate-500 ${s.label}`}>
                        {c.header}
                      </span>
                    )}
                    <div className="min-w-0 flex-1 break-words">{c.cell(row)}</div>
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Phân trang phía trình duyệt: tự kẹp số trang khi danh sách ngắn lại (lọc, tìm kiếm). */
export function usePaged<T>(rows: readonly T[], initialSize = 10) {
  const [size, setSize] = useState(initialSize);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  const pageRows = useMemo(
    () => rows.slice((current - 1) * size, current * size),
    [rows, current, size],
  );
  return { pageRows, page: current, pages, total: rows.length, size, setPage, setSize };
}

const SIZE_OPTIONS = [10, 20, 50, 100].map((n) => ({
  value: String(n),
  label: `${n} dòng / trang`,
}));

export function Pager({
  paged,
  sizeChanger = false,
}: {
  paged: Pick<ReturnType<typeof usePaged>, 'page' | 'pages' | 'total' | 'size' | 'setPage' | 'setSize'>;
  sizeChanger?: boolean;
}) {
  const { page, pages, total, size, setPage, setSize } = paged;
  if (total === 0) return null;
  const showSize = sizeChanger && total > 10;
  if (pages <= 1 && !showSize)
    return <p className="pt-3 text-xs text-slate-500">Tổng {total} dòng</p>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-slate-500">
      <span>Tổng {total} dòng</span>
      <div className="flex flex-wrap items-center gap-2">
        {showSize ? (
          <div className="w-36">
            <SearchableSelect
              value={String(size)}
              options={SIZE_OPTIONS}
              clearable={false}
              onChange={(v) => {
                setSize(Number(v) || 10);
                setPage(1);
              }}
            />
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Trang trước"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span aria-live="polite">
          Trang {page} / {pages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Trang sau"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
