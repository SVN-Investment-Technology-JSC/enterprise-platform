'use client';

import type { WorkItem } from '@enterprise-platform/contracts-workspace';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  formatShortDate,
  workItemStatusLabel,
  workItemStatusTone,
} from '../workspace-labels';
import styles from '../workspace.module.scss';
import { useDirectory } from './use-directory';

export interface WorkItemDialogProps {
  readonly item: WorkItem;
  /** Chữ trên dải đầu, ví dụ "Chi tiết công việc · TA-3.1". */
  readonly heading: string;
  /** Đang có ngăn trao đổi, menu hay form mở đè lên: Esc dành cho chúng. */
  readonly escapeBlocked: boolean;
  readonly onClose: () => void;
  /** Đi từ một việc khác sang: nút quay lại việc đó (lùi lịch sử trình duyệt). */
  readonly back?: { readonly label: string; readonly onBack: () => void };
  /** Cột chính: khối đầu, mô tả, việc con, phụ thuộc, tài liệu. */
  readonly children: ReactNode;
  /** Cột phụ bên phải, ví dụ lịch sử hoạt động. */
  readonly aside: ReactNode;
}

/**
 * Hộp chi tiết của một công việc, mở đè lên trang dự án khi bấm một dòng
 * trong bảng WBS.
 *
 * Nằm dưới ngăn trao đổi, menu chuột phải và các form (z-index thấp hơn), vì
 * những thứ đó mở ra từ chính hộp này.
 */
export function WorkItemDialog({
  item,
  heading,
  escapeBlocked,
  onClose,
  back,
  children,
  aside,
}: WorkItemDialogProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || escapeBlocked) return;
      // Form sửa hay xác nhận đang mở đè lên thì Esc là của form đó.
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not([data-work-item])')) {
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [escapeBlocked, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className={styles.itemOverlay} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.itemDialog}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.code} · ${item.title}`}
        data-work-item
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.itemDialogHead}>
          {back ? (
            <button
              type="button"
              className={styles.itemDialogBack}
              title={`Quay lại ${back.label}`}
              onClick={back.onBack}
            >
              <ArrowLeft size={15} /> {back.label}
            </button>
          ) : null}
          <span className={styles.itemDialogHeading}>{heading}</span>
          <button type="button" aria-label="Đóng" title="Đóng (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className={styles.itemDialogBody}>
          <div className={styles.itemDialogMain}>{children}</div>
          <aside className={styles.itemDialogAside}>{aside}</aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Danh sách việc con trực tiếp, có lối thêm việc con ngay tại chỗ. */
export function ChildItems({
  items,
  parent,
  canAdd,
  onOpen,
  onAdd,
}: {
  items: readonly WorkItem[];
  parent: WorkItem;
  canAdd: boolean;
  onOpen: (item: WorkItem) => void;
  onAdd: () => void;
}) {
  const directory = useDirectory();
  const children = items
    .filter((item) => item.parentId === parent.id)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'vi'));
  const done = children.filter((item) => item.status === 'done').length;

  return (
    <section className={styles.panel}>
      <h3>
        Công việc con <span className={styles.muted}>· {`${done}/${children.length}`}</span>
      </h3>
      {children.length === 0 ? <p className={styles.muted}>Chưa có việc con.</p> : null}
      <ul className={styles.childList}>
        {children.map((child) => {
          const tone = workItemStatusTone(child);
          return (
            <li key={child.id}>
              <button type="button" className={styles.childRow} onClick={() => onOpen(child)}>
                <span className={styles.treeCode}>{child.code}</span>
                <span className={styles.treeTitle}>{child.title}</span>
                <span className={styles.muted}>
                  {child.assigneeUserId ? directory.nameOf(child.assigneeUserId) : 'Chưa giao'}
                </span>
                <span className={styles.muted}>{formatShortDate(child.plannedEnd)}</span>
                <span className={styles.pill} style={{ background: tone.bg, color: tone.fg }}>
                  {workItemStatusLabel(child)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {canAdd ? (
        <button type="button" className={styles.linkButton} onClick={onAdd}>
          <Plus size={13} /> Thêm việc con
        </button>
      ) : null}
    </section>
  );
}
