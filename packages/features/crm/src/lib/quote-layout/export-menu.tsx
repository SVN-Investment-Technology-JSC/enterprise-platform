'use client';

/**
 * Nút "Xuất" và menu "PDF / In", "Word (.docx)" (plan mục 9.3, 9.4, 10). Dùng ở trình thiết kế (dữ liệu mẫu) và màn báo
 * giá (dữ liệu thật). Đang xuất thì nút khoá, bấm lặp không tạo thêm file; lỗi báo bằng toast.
 */
import type { QuoteLayout } from '@enterprise-platform/contracts-crm';
import { toast } from '@enterprise-platform/shared-ui';
import { ChevronDown, Download, FileText, Loader2, Printer } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { exportQuoteDocx, type DocxModule } from './export-docx';
import { QuoteExportError } from './export-error';
import { PDF_EXPORT_ERROR_MESSAGE, exportQuotePdf } from './export-pdf';
import type { QuoteLayoutData } from './quote-layout.data';
import styles from './quote-layout.module.scss';

export type QuoteExportFormat = 'pdf' | 'docx';

export interface ExportMenuProps {
  readonly layout: QuoteLayout;
  readonly data: QuoteLayoutData;
  /** Tên file không có đuôi; màn báo giá dùng `quoteExportFileName(code, versionNo)` (`<mã>_v<phiên bản>`). */
  readonly fileName: string;
  readonly disabled?: boolean;
  readonly className?: string;
  /** Thay bộ xuất khi kiểm thử. */
  readonly exporters?: {
    readonly pdf?: typeof exportQuotePdf;
    readonly docx?: typeof exportQuoteDocx;
    readonly loadDocx?: () => Promise<DocxModule>;
  };
}

const FALLBACK_MESSAGES: Readonly<Record<QuoteExportFormat, string>> = {
  pdf: PDF_EXPORT_ERROR_MESSAGE,
  docx: 'Không xuất được file Word. Thử lại.',
};

export function ExportMenu({ layout, data, fileName, disabled = false, className, exporters }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<QuoteExportFormat | null>(null);
  // Chặn bấm lặp ngay cả khi state chưa kịp cập nhật (bấm nhanh liên tiếp).
  const running = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    firstItemRef.current?.focus();
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (format: QuoteExportFormat) => {
    if (running.current) return;
    running.current = true;
    setOpen(false);
    setBusy(format);
    try {
      if (format === 'pdf') await (exporters?.pdf ?? exportQuotePdf)({ layout, data, fileName });
      else await (exporters?.docx ?? exportQuoteDocx)({ layout, data, fileName, load: exporters?.loadDocx });
    } catch (cause) {
      toast.error(cause instanceof QuoteExportError ? cause.message : FALLBACK_MESSAGES[format]);
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  const label = busy ? 'Đang xuất…' : 'Xuất';
  return (
    <div ref={rootRef} className={[styles.exportMenu, className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={styles.exportButton}
        disabled={disabled || busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={busy !== null}
        onClick={() => setOpen((value) => !value)}
      >
        {busy ? <Loader2 size={15} className={styles.spin} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
        {label}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <ul id={menuId} role="menu" className={styles.exportList}>
          <li role="none">
            <button ref={firstItemRef} type="button" role="menuitem" className={styles.exportItem} onClick={() => void run('pdf')}>
              <Printer size={15} aria-hidden="true" />
              PDF / In
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" className={styles.exportItem} onClick={() => void run('docx')}>
              <FileText size={15} aria-hidden="true" />
              Word (.docx)
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
