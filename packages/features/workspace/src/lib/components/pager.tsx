'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import styles from '../workspace.module.scss';

/** Số dòng mỗi trang của các bảng báo cáo. */
export const REPORT_PAGE_SIZE = 10;

/**
 * Chia một danh sách đã tải sẵn thành từng trang ở client. Danh sách đổi (đổi
 * bộ lọc, tải lại) thì về trang 1.
 */
export function usePaged<T>(rows: readonly T[] | undefined, pageSize = REPORT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const total = rows?.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage(1);
  }, [rows]);

  const current = Math.min(page, pages);
  return {
    rows: (rows ?? []).slice((current - 1) * pageSize, current * pageSize),
    page: current,
    pages,
    total,
    pageSize,
    setPage,
  };
}

export interface PagerProps {
  readonly page: number;
  readonly pages: number;
  readonly total: number;
  readonly pageSize: number;
  readonly onPage: (page: number) => void;
}

/** "11–20 / 57" và hai nút trước/sau; chỉ hiện khi có hơn một trang. */
export function Pager({ page, pages, total, pageSize, onPage }: PagerProps) {
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav className={styles.pager} aria-label="Phân trang">
      <span className={styles.muted}>
        {from}–{to} / {total}
      </span>
      <button
        type="button"
        className={styles.pagerButton}
        aria-label="Trang trước"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={15} />
      </button>
      <span className={styles.pagerPage}>
        {page}/{pages}
      </span>
      <button
        type="button"
        className={styles.pagerButton}
        aria-label="Trang sau"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={15} />
      </button>
    </nav>
  );
}
