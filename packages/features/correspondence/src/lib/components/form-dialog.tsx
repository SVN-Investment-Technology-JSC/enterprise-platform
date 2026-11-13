'use client';

import { CloseGuard } from '@enterprise-platform/shared-ui';
import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from '../correspondence.module.scss';

export interface FormDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly submitLabel: string;
  readonly submitting?: boolean;
  readonly submitDisabled?: boolean;
  /** Form đã có thay đổi: đóng phải hỏi lại, Esc không đóng. */
  readonly dirty: boolean;
  readonly error?: string;
  /** Hộp thoại rộng cho form nhiều cột (quy trình duyệt). */
  readonly wide?: boolean;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  readonly children: ReactNode;
}

/**
 * Hộp thoại nhập liệu dựng qua portal. Bấm ra ngoài không bao giờ đóng; nút X và Huỷ
 * đi qua `CloseGuard` (hỏi lại khi đã nhập); Esc chỉ đóng khi form chưa thay đổi.
 */
export function FormDialog({
  open,
  title,
  subtitle,
  submitLabel,
  submitting = false,
  submitDisabled = false,
  dirty,
  error,
  wide = false,
  onClose,
  onSubmit,
  children,
}: FormDialogProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !dirty && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dirty, submitting, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className={styles.modal} role="presentation">
      <div className={wide ? `${styles.dialog} ${styles.dialogWide}` : styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.dialogHead}>
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <CloseGuard dirty={dirty} busy={submitting} onClose={onClose}>
            <button type="button" className={styles.iconButton} aria-label="Đóng">
              <X size={16} />
            </button>
          </CloseGuard>
        </header>
        {/* Thân cuộn riêng, chân hộp thoại (Huỷ, Lưu) luôn hiện dù form dài. */}
        <form
          className={styles.dialogForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (!submitting && !submitDisabled) onSubmit();
          }}
        >
          <div className={styles.dialogBody}>
            {children}
            {error ? (
              <p role="alert" className={styles.alert}>
                {error}
              </p>
            ) : null}
          </div>
          <footer className={styles.dialogFooter}>
            <CloseGuard dirty={dirty} busy={submitting} onClose={onClose}>
              <button type="button" className={styles.buttonGhost}>
                Huỷ
              </button>
            </CloseGuard>
            <button type="submit" className={styles.buttonPrimary} disabled={submitting || submitDisabled}>
              {submitting ? 'Đang lưu…' : submitLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/** Nhãn cho ô chọn tự dựng: không bọc `<label>` để cú bấm vào danh sách không mở lại ô chọn. */
export function SelectField({
  label,
  required = false,
  children,
}: {
  readonly label: string;
  readonly required?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.field} role="group" aria-label={label}>
      <span className={styles.fieldLabel}>
        {label}
        {required ? <span className={styles.required}> *</span> : null}
      </span>
      {children}
    </div>
  );
}

export function Field({
  label,
  required = false,
  children,
}: {
  readonly label: string;
  readonly required?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        {required ? <span className={styles.required}> *</span> : null}
      </span>
      {children}
    </label>
  );
}
