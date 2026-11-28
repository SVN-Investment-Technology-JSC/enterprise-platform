import { useCallback, useEffect, useState } from 'react';

/**
 * Cách hiện chữ dài trong bảng danh sách dự án: `wrap` (mặc định) cho chữ xuống dòng để đọc đủ tên dự án, khách hàng,
 * nhóm; `compact` giữ mỗi dòng một hàng, chữ dài bị cắt "…" và rê chuột xem đủ. Lựa chọn lưu trong localStorage của
 * trình duyệt (trang này chưa có sẵn id người dùng, nên lưu chung như thứ tự cột).
 */
export type ProjectCellWrap = 'wrap' | 'compact';

export const DEFAULT_PROJECT_CELL_WRAP: ProjectCellWrap = 'wrap';

export const PROJECT_CELL_WRAP_STORAGE_KEY = 'workspace:projects-list:cell-wrap';

/** Đọc lựa chọn đã lưu; không có, giá trị lạ hay trình duyệt chặn lưu trữ thì về mặc định (xuống dòng). */
export function readProjectCellWrap(): ProjectCellWrap {
  try {
    const raw = window.localStorage.getItem(PROJECT_CELL_WRAP_STORAGE_KEY);
    return raw === 'compact' || raw === 'wrap' ? raw : DEFAULT_PROJECT_CELL_WRAP;
  } catch {
    return DEFAULT_PROJECT_CELL_WRAP;
  }
}

/** Lưu lựa chọn; mặc định thì xoá khoá cho gọn. Trình duyệt chặn lưu trữ thì chỉ có hiệu lực trong phiên này. */
export function writeProjectCellWrap(mode: ProjectCellWrap): void {
  try {
    if (mode === DEFAULT_PROJECT_CELL_WRAP) window.localStorage.removeItem(PROJECT_CELL_WRAP_STORAGE_KEY);
    else window.localStorage.setItem(PROJECT_CELL_WRAP_STORAGE_KEY, mode);
  } catch {
    // Không lưu được: bỏ qua.
  }
}

/** Lựa chọn hiện chữ của bảng dự án; đọc sau khi gắn vào trang (như độ rộng cột) để khớp bản dựng trên server. */
export function useProjectCellWrap(): [ProjectCellWrap, (mode: ProjectCellWrap) => void] {
  const [mode, setMode] = useState<ProjectCellWrap>(DEFAULT_PROJECT_CELL_WRAP);
  useEffect(() => setMode(readProjectCellWrap()), []);
  const change = useCallback((next: ProjectCellWrap) => {
    setMode(next);
    writeProjectCellWrap(next);
  }, []);
  return [mode, change];
}
