'use client';

import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from '../workspace.module.scss';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly submitLabel?: string;
  readonly submitting?: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  readonly children: ReactNode;
}

/**
 * Hộp thoại dùng chung cho các form của Workspace.
 *
 * Dựng qua portal vào `document.body`: form nằm trong cột cây có `overflow`
 * riêng, nếu render tại chỗ thì lớp phủ bị cắt theo cột đó.
 */
export function Dialog({
  open,
  title,
  subtitle,
  submitLabel = 'Lưu',
  submitting = false,
  error,
  onClose,
  onSubmit,
  children,
}: DialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Chặn nổi bọt để cú bấm bên trong hộp thoại không đóng nó lại.
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHead}>
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" aria-label="Đóng" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <form
          className={styles.dialogBody}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {children}
          {error ? (
            <p role="alert" className={styles.alert}>
              {error}
            </p>
          ) : null}
          <footer className={styles.dialogFoot}>
            <button type="button" className={styles.buttonGhost} onClick={onClose}>
              Huỷ
            </button>
            <button type="submit" className={styles.buttonPrimary} disabled={submitting}>
              {submitting ? 'Đang lưu…' : submitLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/** Một dòng nhãn + ô nhập, dùng chung cho mọi form trong module. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </label>
  );
}
