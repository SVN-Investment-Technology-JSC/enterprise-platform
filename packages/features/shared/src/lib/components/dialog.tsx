'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from '../shared.module.scss';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly submitLabel?: string;
  /** Chữ trên nút khi đang gửi; mặc định "Đang lưu…". */
  readonly submittingLabel?: string;
  readonly submitting?: boolean;
  readonly submitDisabled?: boolean;
  /** Nút xác nhận mang kiểu nguy hiểm: xoá, xoá vĩnh viễn. */
  readonly danger?: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  readonly children: ReactNode;
}

/**
 * Hộp thoại form, dựng qua portal vào `document.body`.
 *
 * Đóng "ngầm" (bấm ra ngoài, Esc, nút X) khi form đã có nội dung thì hỏi lại
 * trước; nút Huỷ ở chân form vẫn đóng ngay.
 */
export function Dialog({
  open,
  title,
  submitLabel = 'Lưu',
  submittingLabel = 'Đang lưu…',
  submitting = false,
  submitDisabled = false,
  danger = false,
  error,
  onClose,
  onSubmit,
  children,
}: DialogProps) {
  const [mounted, setMounted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setDirty(false);
    setConfirmDiscard(false);
  }, [open]);

  const requestClose = useCallback(() => {
    if (submitting) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [dirty, onClose, submitting]);

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
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHead}>
          <h3>{title}</h3>
          <button type="button" className={styles.iconButton} aria-label="Đóng" onClick={requestClose}>
            <X size={15} />
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
              <span>Đóng lại sẽ mất những gì vừa nhập.</span>
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
            <button type="button" className={styles.buttonGhost} onClick={onClose} disabled={submitting}>
              Huỷ
            </button>
            <button
              type="submit"
              className={danger ? styles.buttonDanger : styles.buttonPrimary}
              disabled={submitting || submitDisabled}
            >
              {submitting ? submittingLabel : submitLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Nhãn cho ô chọn tự dựng (`SearchableSelect`). Không bọc bằng `<label>` như
 * `Field`: bấm một mục trong danh sách sẽ bị trình duyệt chuyển thành cú bấm
 * vào ô nhập bên trong label, làm danh sách vừa đóng đã mở lại.
 */
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
        {required ? <span className={styles.fieldRequired}> *</span> : null}
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
        {required ? <span className={styles.fieldRequired}> *</span> : null}
      </span>
      {children}
    </label>
  );
}
