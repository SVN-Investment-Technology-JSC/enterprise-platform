'use client';

import { useAssistantEmbed } from '@enterprise-platform/feature-module-shell';
import { X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from '../workspace.module.scss';
import { ConfirmBox } from './confirm-box';

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
  /**
   * `wide` cho hộp thoại có hai cột hoặc cây chọn (khoảng 52rem); `extraWide` cho bảng nhập nhiều dòng
   * (khoảng 68rem).
   */
  readonly size?: 'default' | 'wide' | 'extraWide';
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  readonly children: ReactNode;
}

/**
 * Hộp thoại dùng chung cho các form của Workspace.
 *
 * Dựng qua portal vào `document.body`: form nằm trong cột cây có `overflow`
 * riêng, nếu render tại chỗ thì lớp phủ bị cắt theo cột đó.
 *
 * Trong trang form nhúng của card Trợ lý (`useAssistantEmbed`), form nằm ngay
 * tại chỗ, rộng hết card và cao theo nội dung: không portal, không lớp phủ,
 * không đóng ngầm bằng Esc hay nút X. Nút Huỷ ở chân form vẫn đóng như cũ.
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
  size = 'default',
  onClose,
  onSubmit,
  children,
}: DialogProps) {
  const embedded = useAssistantEmbed();
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
    // Form trong card không phải hộp thoại nổi: Esc không đóng nó.
    if (!open || embedded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmDiscard) setConfirmDiscard(false);
      else requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, embedded, confirmDiscard, requestClose]);

  if (!open || !mounted) return null;

  const head = (
    <header className={styles.dialogHead}>
      <div>
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {embedded ? null : (
        <button type="button" aria-label="Đóng" onClick={requestClose}>
          <X size={16} />
        </button>
      )}
    </header>
  );

  const form = (
    <form
      className={styles.dialogBody}
      onChangeCapture={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className={styles.dialogScroll}>
        {children}
        {error ? (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        ) : null}
      </div>
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
      <ConfirmBox
        open={confirmDiscard}
        title="Bạn có chắc chắn muốn đóng?"
        message="Những gì vừa nhập chưa được lưu sẽ mất."
        confirmLabel="Bỏ thay đổi"
        onConfirm={onClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </form>
  );

  // Card của Trợ lý: form nằm ngay trong trang form nhúng, card co giãn theo chiều cao của nó.
  if (embedded) {
    return (
      <section className={styles.dialogInline} aria-label={title}>
        {head}
        {form}
      </section>
    );
  }

  return createPortal(
    <div className={styles.overlay} role="presentation" onMouseDown={requestClose}>
      <div
        className={
          size === 'wide'
            ? `${styles.dialog} ${styles.dialogWide}`
            : size === 'extraWide'
              ? `${styles.dialog} ${styles.dialogExtraWide}`
              : styles.dialog
        }
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Chặn nổi bọt để cú bấm bên trong hộp thoại không đóng nó lại.
        onMouseDown={(event) => event.stopPropagation()}
      >
        {head}
        {form}
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
    <div className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        {required ? <span className={styles.fieldRequired}> *</span> : null}
      </span>
      {children}
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </div>
  );
}
