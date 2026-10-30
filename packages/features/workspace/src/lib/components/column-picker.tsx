'use client';

import { Columns3 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { WORK_COLUMNS, type WorkColumnId } from '../work-table-store';
import styles from '../workspace.module.scss';

/**
 * Nút "Cột" mở bảng chọn cột hiển thị của bảng công việc. Cột Công việc luôn hiện. Mỗi người tự chọn, lưu theo
 * người dùng; "Đặt lại" quay về bố cục mặc định (tự bớt cột phụ khi khung hẹp).
 */
export function ColumnPicker({
  hidden,
  customized,
  onChange,
  onReset,
}: {
  hidden: ReadonlySet<string>;
  customized: boolean;
  onChange: (hidden: readonly WorkColumnId[]) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Bấm ra ngoài hoặc Esc thì đóng.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (id: WorkColumnId, show: boolean) => {
    const next = new Set(hidden);
    if (show) next.delete(id);
    else next.add(id);
    onChange(WORK_COLUMNS.map((column) => column.id).filter((columnId) => next.has(columnId)));
  };
  const visible = WORK_COLUMNS.length - WORK_COLUMNS.filter((column) => hidden.has(column.id)).length;

  return (
    <div ref={box} className={styles.columnPicker}>
      <button
        type="button"
        className={styles.columnPickerButton}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Chọn cột hiển thị"
        onClick={() => setOpen((current) => !current)}
      >
        <Columns3 size={14} aria-hidden /> Cột
        {customized ? <span className={styles.columnPickerCount}>{visible + 1}</span> : null}
      </button>
      {open ? (
        <div className={styles.columnPickerPanel} role="dialog" aria-label="Cột hiển thị">
          <p className={styles.columnPickerTitle}>Cột hiển thị</p>
          <label className={styles.columnPickerItem}>
            <input type="checkbox" checked disabled aria-label="Công việc" />
            <span>Công việc</span>
            <span className={styles.muted}>luôn hiện</span>
          </label>
          {WORK_COLUMNS.map((column) => (
            <label key={column.id} className={styles.columnPickerItem}>
              <input
                type="checkbox"
                checked={!hidden.has(column.id)}
                aria-label={column.label}
                onChange={(event) => toggle(column.id, event.target.checked)}
              />
              <span>{column.label}</span>
            </label>
          ))}
          <div className={styles.columnPickerFoot}>
            <button type="button" className={styles.columnPickerReset} disabled={!customized} onClick={onReset}>
              Đặt lại mặc định
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
