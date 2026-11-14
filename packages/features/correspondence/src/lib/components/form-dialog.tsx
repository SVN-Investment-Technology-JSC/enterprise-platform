'use client';

import { CloseGuard } from '@enterprise-platform/shared-ui';
import { FileText, Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatBytes } from '../correspondence.model';
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
  /** Hộp thoại rộng cho form nhiều cột (tạo công văn, quy trình duyệt). */
  readonly wide?: boolean;
  /** Màu nút xác nhận: huỷ là đỏ, trả lại là vàng. */
  readonly tone?: 'primary' | 'danger' | 'warning';
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
  tone = 'primary',
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
            <button
              type="submit"
              className={tone === 'danger' ? styles.buttonDangerSolid : tone === 'warning' ? styles.buttonWarning : styles.buttonPrimary}
              disabled={submitting || submitDisabled}
            >
              {submitting ? 'Đang xử lý…' : submitLabel}
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

/**
 * Nhóm ô đánh dấu có nhãn như một trường của form, đặt cạnh ô nhập khác trong cùng hàng thì
 * nhãn và khung thẳng hàng với ô bên cạnh.
 */
export function CheckGroup({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className={styles.field} role="group" aria-label={label}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.checkGroup}>{children}</div>
    </div>
  );
}

/** Chọn nhiều tệp: nút chọn tệp và danh sách tệp đã chọn (bỏ được từng tệp). */
export function FilePickField({
  label,
  files,
  hint,
  onChange,
}: {
  readonly label: string;
  readonly files: readonly File[];
  readonly hint?: string;
  readonly onChange: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={styles.field} role="group" aria-label={label}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        ref={input}
        type="file"
        multiple
        className={styles.fileInput}
        onChange={(event) => {
          onChange([...files, ...Array.from(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
      <div className={styles.filePick}>
        <button type="button" className={styles.buttonGhost} onClick={() => input.current?.click()}>
          <Paperclip size={14} /> Chọn tệp
        </button>
        <span className={styles.hint}>{files.length > 0 ? `Đã chọn ${files.length} tệp` : (hint ?? 'Chưa chọn tệp nào')}</span>
      </div>
      {files.length > 0 ? (
        <ul className={styles.pickedFiles}>
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <FileText size={14} />
              <span title={file.name}>{file.name}</span>
              <small>{formatBytes(file.size)}</small>
              <button type="button" aria-label={`Bỏ ${file.name}`} onClick={() => onChange(files.filter((_, at) => at !== index))}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
