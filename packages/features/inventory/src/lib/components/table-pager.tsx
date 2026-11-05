'use client';

import { SearchableSelect } from '@enterprise-platform/shared-ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from '../inventory.module.scss';
import { PAGE_SIZES, type Page } from '../trade-items.model';

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
    <div
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', fontSize: '13px', color: '#475569' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>Số bản ghi mỗi trang</span>
        <div style={{ width: '120px' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          className={styles.btnSecondary}
          aria-label="Trang trước"
          disabled={view.page <= 1}
          onClick={() => onPageChange(view.page - 1)}
        >
          <ChevronLeft size={14} />
        </button>
        <span>
          Trang {view.page} / {view.pageCount}
        </span>
        <button
          type="button"
          className={styles.btnSecondary}
          aria-label="Trang sau"
          disabled={view.page >= view.pageCount}
          onClick={() => onPageChange(view.page + 1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
