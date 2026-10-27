'use client';

import { ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from '../sales.module.scss';

/** Bảng antd theo token của khung sáng (cùng cấu hình với Tài chính). */
export function CrmAntdProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={viVN}
      componentSize="small"
      theme={{
        token: { colorPrimary: '#2563eb', colorLink: '#1d4ed8', fontSize: 14, borderRadius: 8 },
        components: { Table: { cellPaddingBlockSM: 8, cellPaddingInlineSM: 10 } },
      }}
    >
      {children}
    </ConfigProvider>
  );
}

export interface CrmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly submitLabel?: string;
  readonly submitting?: boolean;
  readonly danger?: boolean;
  readonly wide?: boolean;
  readonly error?: string;
  /** Nội dung chèn trên hàng nút (cảnh báo cần xác nhận...). */
  readonly notice?: ReactNode;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
  readonly children: ReactNode;
}

/**
 * Hộp thoại form (Minimal Popup Form của ui-design): portal vào `body`, đóng
 * bằng Esc, nút X, bấm nền; nút chính xanh, nút Huỷ viền.
 */
export function CrmDialog({
  open,
  title,
  subtitle,
  submitLabel = 'Lưu',
  submitting = false,
  danger = false,
  wide = false,
  error,
  notice,
  onClose,
  onSubmit,
  children,
}: CrmDialogProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className={styles.overlay} role="presentation" onMouseDown={() => !submitting && onClose()}>
      <div
        className={wide ? `${styles.dialog} ${styles.dialogWide}` : styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHead}>
          <div>
            <h3>{title}</h3>
            {subtitle ? <p className={styles.muted}>{subtitle}</p> : null}
          </div>
          <button type="button" className={styles.iconButton} aria-label="Đóng" onClick={onClose} disabled={submitting}>
            <X size={16} />
          </button>
        </header>
        <form
          className={styles.dialogBody}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!submitting) onSubmit();
          }}
        >
          {children}
          {notice}
          {error ? (
            <p role="alert" className={styles.alert}>
              {error}
            </p>
          ) : null}
          <div className={styles.dialogFoot}>
            <button type="button" className={styles.buttonGhost} onClick={onClose} disabled={submitting}>
              Huỷ
            </button>
            <button type="submit" className={danger ? styles.buttonDanger : styles.buttonPrimary} disabled={submitting}>
              {submitting ? 'Đang lưu…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

export function Field({
  label,
  required,
  hint,
  error,
  wide,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={wide ? `${styles.field} ${styles.fieldWide}` : styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        {required ? <span className={styles.required}> *</span> : null}
      </span>
      {children}
      {error ? <span className={styles.fieldError}>{error}</span> : hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </label>
  );
}

/** Chân bảng phân trang keyset: Trước / Sau, không có tổng số trang. */
export function KeysetPager({
  page,
  count,
  hasNext,
  loading,
  noun,
  onPrevious,
  onNext,
}: {
  page: number;
  count: number;
  hasNext: boolean;
  loading?: boolean;
  noun: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className={styles.pager}>
      <span>
        Trang {page} · {count} {noun}
      </span>
      <span className={styles.pagerButtons}>
        <button type="button" className={styles.pagerButton} disabled={page <= 1 || loading} onClick={onPrevious}>
          ← Trước
        </button>
        <strong>{page}</strong>
        <button type="button" className={styles.pagerButton} disabled={!hasNext || loading} onClick={onNext}>
          Sau →
        </button>
      </span>
    </div>
  );
}

/** Nhãn trạng thái dạng chấm màu, không dùng emoji. */
export function StatusPill({ tone, children }: { tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return <span className={`${styles.pill} ${styles[`pill_${tone}`]}`}>{children}</span>;
}
