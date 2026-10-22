'use client';

import {
  cloneElement,
  isValidElement,
  useEffect,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from '../workspace.module.scss';

export interface ConfirmBoxProps {
  readonly open: boolean;
  /** Câu hỏi, dạng "Bạn có chắc chắn muốn …?". */
  readonly title: string;
  /** Hậu quả của thao tác, một hai câu ngắn. */
  readonly message?: ReactNode;
  /** Nút hành động: động từ của thao tác, vd "Xoá", "Bỏ thay đổi". */
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly tone?: 'danger' | 'warning' | 'primary';
  readonly busy?: boolean;
  readonly confirmDisabled?: boolean;
  readonly error?: string;
  /** Ô nhập kèm theo khi thao tác cần ghi lại dữ liệu (vd lý do huỷ). */
  readonly children?: ReactNode;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Hộp xác nhận chung của Workspace: câu hỏi "Bạn có chắc chắn…?", một dòng hậu quả, nút hành động và nút "Không".
 * Nằm giữa màn hình, trên cả hộp thoại đang mở; Esc hoặc bấm ra ngoài là "Không". Không bắt gõ lại mã hay tên —
 * câu hỏi và nút hành động ghi rõ việc sẽ làm là đủ.
 */
export function ConfirmBox({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Không',
  tone = 'danger',
  busy = false,
  confirmDisabled = false,
  error,
  children,
  onConfirm,
  onCancel,
}: ConfirmBoxProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    // Bắt ở pha capture và chặn lan: Esc chỉ đóng hộp xác nhận, không đóng luôn hộp thoại bên dưới.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      event.preventDefault();
      if (!busy) onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, busy, onCancel]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={styles.confirmOverlay}
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (!busy) onCancel();
      }}
    >
      <div
        className={styles.confirmBox}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3>{title}</h3>
        {message ? <div className={styles.confirmMessage}>{message}</div> : null}
        {children}
        {error ? (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        ) : null}
        <div className={styles.confirmActions}>
          <button type="button" className={styles.buttonGhost} autoFocus disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              tone === 'danger'
                ? styles.buttonDanger
                : tone === 'warning'
                  ? `${styles.buttonPrimary} ${styles.confirmWarning}`
                  : styles.buttonPrimary
            }
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
          >
            {busy ? 'Đang xử lý…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly okText: string;
  readonly cancelText?: string;
  readonly okType?: 'danger' | 'warning' | 'primary';
  /** Tắt hẳn: bấm nút kích hoạt không mở hộp xác nhận. */
  readonly disabled?: boolean;
  /** Có ô lý do; `reasonRequired` thì phải nhập mới bấm được nút hành động. */
  readonly reasonLabel?: string;
  readonly reasonPlaceholder?: string;
  readonly reasonRequired?: boolean;
  readonly onConfirm: (reason?: string) => unknown;
  /** Nút kích hoạt; bấm nó thì mở hộp xác nhận. */
  readonly children: ReactElement<{ onClick?: (event: MouseEvent) => void }>;
}

/**
 * Bọc một nút: bấm nút thì hỏi lại bằng `ConfirmBox`, đồng ý mới chạy `onConfirm`. Thao tác lỗi thì báo ngay trong
 * hộp, giữ hộp mở để thử lại.
 */
export function Confirm({
  title,
  description,
  okText,
  cancelText,
  okType = 'danger',
  disabled = false,
  reasonLabel,
  reasonPlaceholder,
  reasonRequired = false,
  onConfirm,
  children,
}: ConfirmProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reason, setReason] = useState('');
  const hasReason = reasonLabel !== undefined || reasonRequired;

  const trigger = isValidElement(children)
    ? cloneElement(children, {
        onClick: (event: MouseEvent) => {
          children.props.onClick?.(event);
          if (disabled || event.defaultPrevented) return;
          setError(undefined);
          setReason('');
          setOpen(true);
        },
      })
    : children;

  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm(hasReason ? reason.trim() : undefined);
      setOpen(false);
    } catch (cause) {
      setError((cause as { message?: string })?.message ?? 'Thao tác không thành công.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {trigger}
      <ConfirmBox
        open={open}
        title={title}
        message={description}
        confirmLabel={okText}
        cancelLabel={cancelText}
        tone={okType}
        busy={busy}
        confirmDisabled={reasonRequired && !reason.trim()}
        error={error}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      >
        {hasReason ? (
          <label className={styles.confirmField}>
            <span>{reasonLabel ?? 'Lý do'}</span>
            <textarea
              rows={3}
              value={reason}
              placeholder={reasonPlaceholder}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        ) : null}
      </ConfirmBox>
    </>
  );
}
