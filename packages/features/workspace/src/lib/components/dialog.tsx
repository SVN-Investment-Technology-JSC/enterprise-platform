'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from '../workspace.module.scss';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly submitLabel?: string;
  /** Nhãn nút đóng ở chân hộp thoại; `null` thì ẩn hẳn nút này. */
  readonly cancelLabel?: string | null;
  readonly submitting?: boolean;
  /** Khoá nút gửi khi form chưa đủ dữ liệu bắt buộc (vd lý do còn trống). */
  readonly submitDisabled?: boolean;
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
  cancelLabel = 'Huỷ',
  submitting = false,
  submitDisabled = false,
  error,
  onClose,
  onSubmit,
  children,
}: DialogProps) {
  const [mounted, setMounted] = useState(false);
  /** Người dùng đã gõ hoặc chọn gì đó trong form kể từ lúc mở. */
  const [dirty, setDirty] = useState(false);
  /** Đang hỏi "bỏ thay đổi?" sau một cú bấm ra ngoài hoặc phím Esc. */
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setDirty(false);
    setConfirmDiscard(false);
  }, [open]);

  /**
   * Đóng theo lối "ngầm" — bấm ra ngoài, phím Esc, nút X. Form đã có nội dung
   * thì hỏi lại trước, vì những lối này rất dễ chạm nhầm và trước đây làm mất
   * sạch những gì vừa gõ. Nút Huỷ ở chân form vẫn đóng ngay: đó là ý định rõ.
   */
  const requestClose = useCallback(() => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmDiscard) setConfirmDiscard(false);
      else requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, confirmDiscard, requestClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className={styles.overlay} role="presentation" onMouseDown={requestClose}>
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
          <button type="button" aria-label="Đóng" onClick={requestClose}>
            <X size={16} />
          </button>
        </header>

        <form
          className={styles.dialogBody}
          onChangeCapture={() => setDirty(true)}
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
          {confirmDiscard ? (
            <div className={styles.discardBar} role="alert">
              <span>Bạn có thay đổi chưa lưu. Đóng lại sẽ mất những gì vừa nhập.</span>
              <button
                type="button"
                className={styles.buttonGhost}
                autoFocus
                onClick={() => setConfirmDiscard(false)}
              >
                Tiếp tục sửa
              </button>
              <button type="button" className={styles.buttonDanger} onClick={onClose}>
                Bỏ thay đổi
              </button>
            </div>
          ) : null}
          <footer className={styles.dialogFoot}>
            {cancelLabel === null ? null : (
              <button type="button" className={styles.buttonGhost} onClick={onClose}>
                {cancelLabel}
              </button>
            )}
            <button
              type="submit"
              className={styles.buttonPrimary}
              disabled={submitting || submitDisabled}
            >
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
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  /** Hiện dấu * cho trường bắt buộc. */
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        {required ? <span className={styles.fieldRequired}> *</span> : null}
      </span>
      {children}
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </label>
  );
}
