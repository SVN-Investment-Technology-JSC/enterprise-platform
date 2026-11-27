'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './case-layout-a.module.scss';

/**
 * Giao diện của màn "Hồ sơ xử lý": `a` là giao diện mới (bảng hồ sơ dùng chung với Tổng quan, bấm hồ sơ mở cửa sổ chi
 * tiết, nút thao tác ghim đáy cửa sổ), `legacy` là giao diện cũ. Người dùng đổi qua lại bằng nút ở thanh công cụ; lựa chọn nhớ theo trình duyệt.
 * Khi bỏ giao diện cũ: xoá `legacy`, nút đổi và nhánh cũ trong `workspace-board.tsx`.
 */
export type CaseLayout = 'a' | 'legacy';

export const CASE_LAYOUT_STORAGE_KEY = 'procedure-case-layout';

/** Mặc định là giao diện mới. */
export const DEFAULT_CASE_LAYOUT: CaseLayout = 'a';

function readStoredLayout(): CaseLayout {
  try {
    const stored = window.localStorage.getItem(CASE_LAYOUT_STORAGE_KEY);
    return stored === 'legacy' || stored === 'a' ? stored : DEFAULT_CASE_LAYOUT;
  } catch {
    return DEFAULT_CASE_LAYOUT;
  }
}

/** Giao diện đang dùng và hàm đổi (ghi nhớ vào localStorage; trình duyệt chặn lưu thì chỉ đổi trong phiên). */
export function useCaseLayout(): readonly [CaseLayout, (next: CaseLayout) => void] {
  const [layout, setLayout] = useState<CaseLayout>(DEFAULT_CASE_LAYOUT);
  // Trang dựng sẵn phía server luôn ra giá trị mặc định (tránh lệch khi hydrate): đọc lựa chọn đã lưu khi vào trình duyệt.
  useEffect(() => {
    setLayout(readStoredLayout());
  }, []);
  const change = useCallback((next: CaseLayout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(CASE_LAYOUT_STORAGE_KEY, next);
    } catch {
      // Không lưu được (chế độ riêng tư, bị chặn): giữ lựa chọn trong phiên.
    }
  }, []);
  return [layout, change] as const;
}

/** Nút đổi giao diện "Giao diện: Mới | Cũ", hiện ở thanh công cụ của cả hai giao diện. */
export function CaseLayoutToggle({
  value,
  onChange,
}: {
  value: CaseLayout;
  onChange: (next: CaseLayout) => void;
}) {
  return (
    <div className={styles.layoutToggle} role="group" aria-label="Giao diện">
      <span className={styles.layoutToggleLabel}>Giao diện</span>
      <button
        type="button"
        aria-pressed={value === 'a'}
        className={value === 'a' ? styles.layoutToggleOn : undefined}
        onClick={() => onChange('a')}
      >
        Mới
      </button>
      <button
        type="button"
        aria-pressed={value === 'legacy'}
        className={value === 'legacy' ? styles.layoutToggleOn : undefined}
        onClick={() => onChange('legacy')}
      >
        Cũ
      </button>
    </div>
  );
}
