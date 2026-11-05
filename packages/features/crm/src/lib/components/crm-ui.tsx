'use client';

import { ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { X } from 'lucide-react';
import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from '../sales.module.scss';
import { pageCountOf, pageItems } from './pagination.model';

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
  /** Nhãn nút đóng (mặc định "Huỷ"). */
  readonly cancelLabel?: string;
  readonly submitting?: boolean;
  readonly danger?: boolean;
  readonly wide?: boolean;
  /** Rộng hơn `wide` (tới 1080px) cho hộp có bảng nhiều cột. */
  readonly extraWide?: boolean;
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
  cancelLabel = 'Huỷ',
  submitting = false,
  danger = false,
  wide = false,
  extraWide = false,
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
        className={extraWide ? `${styles.dialog} ${styles.dialogExtraWide}` : wide ? `${styles.dialog} ${styles.dialogWide}` : styles.dialog}
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
              {cancelLabel}
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

/**
 * Chân bảng phân trang kiểu trang xem phim, đọc truyện: Trước, các số trang (trang đầu, cuối, quanh trang đang xem,
 * dải ẩn là `…`), Sau, và ô nhập để tới thẳng một trang.
 */
export function ListPager({
  page,
  total,
  pageSize,
  loading,
  noun,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  loading?: boolean;
  noun: string;
  onChange: (page: number) => void;
}) {
  const pageCount = pageCountOf(total, pageSize);
  const [jump, setJump] = useState('');
  const go = (next: number) => {
    if (next >= 1 && next <= pageCount && next !== page) onChange(next);
  };
  return (
    <nav className={styles.pager} aria-label="Phân trang">
      <span>
        {total} {noun} · {pageCount} trang
      </span>
      <span className={styles.pagerButtons}>
        <button type="button" className={styles.pagerButton} disabled={page <= 1 || loading} aria-label="Trang trước" onClick={() => go(page - 1)}>
          ‹ Trước
        </button>
        {pageItems(page, pageCount).map((item, index) =>
          item === 'gap' ? (
            <span key={`gap-${index}`} className={styles.pagerGap}>
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={item === page ? styles.pagerCurrent : styles.pagerButton}
              aria-current={item === page ? 'page' : undefined}
              disabled={loading && item !== page}
              onClick={() => go(item)}
            >
              {item}
            </button>
          ),
        )}
        <button type="button" className={styles.pagerButton} disabled={page >= pageCount || loading} aria-label="Trang sau" onClick={() => go(page + 1)}>
          Sau ›
        </button>
        {pageCount > 7 ? (
          <form
            className={styles.pagerJump}
            onSubmit={(event) => {
              event.preventDefault();
              go(Number(jump));
              setJump('');
            }}
          >
            <label>
              Đến trang
              <input
                className={styles.pagerInput}
                inputMode="numeric"
                value={jump}
                placeholder={String(page)}
                aria-label={`Đến trang (1 đến ${pageCount})`}
                onChange={(event) => setJump(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
              />
            </label>
          </form>
        ) : null}
      </span>
    </nav>
  );
}

const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [role="checkbox"]';

/**
 * Thuộc tính cho hàng bảng bấm vào là mở (thay cho nút Mở/Xem): bấm chuột hoặc Enter. Bấm vào nút, liên kết, ô nhập
 * nằm trong hàng thì để phần tử đó xử lý, không mở hàng.
 */
export function rowOpener(open: () => void): HTMLAttributes<HTMLElement> {
  const fromControl = (event: { target: EventTarget; currentTarget: EventTarget }) => {
    const control = (event.target as Element).closest?.(INTERACTIVE);
    return Boolean(control && control !== event.currentTarget && (event.currentTarget as Element).contains(control));
  };
  return {
    className: styles.clickableRow,
    tabIndex: 0,
    onClick: (event) => {
      if (!fromControl(event)) open();
    },
    onKeyDown: (event) => {
      if (event.key === 'Enter' && !fromControl(event)) {
        event.preventDefault();
        open();
      }
    },
  };
}

/** Nhãn trạng thái dạng chấm màu, không dùng emoji. */
export function StatusPill({ tone, children }: { tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return <span className={`${styles.pill} ${styles[`pill_${tone}`]}`}>{children}</span>;
}
