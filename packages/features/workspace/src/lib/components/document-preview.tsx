'use client';

import { PREVIEWABLE_DOCUMENT_CONTENT_TYPES } from '@enterprise-platform/contracts-workspace';
import { Download, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '../workspace-api';
import styles from '../workspace.module.scss';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Loại tệp mở được trong khung xem trước. */
export function isPreviewable(contentType: string | undefined): boolean {
  return Boolean(contentType && PREVIEWABLE_DOCUMENT_CONTENT_TYPES.includes(contentType));
}

/** Tài liệu và phiên bản đang xem trước. */
export interface PreviewTarget {
  readonly documentId: string;
  /** Rỗng nghĩa là phiên bản hiện hành. */
  readonly versionId?: string;
  readonly title: string;
  /** Ví dụ "Bản 3". */
  readonly subtitle?: string;
}

export interface DocumentPreviewProps {
  readonly target?: PreviewTarget;
  readonly onClose: () => void;
  readonly onDownload: (documentId: string, versionId?: string) => void;
}

type Loaded =
  | { readonly kind: 'pdf' | 'image'; readonly url: string }
  | { readonly kind: 'docx'; readonly blob: Blob }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Khung xem trước tài liệu, phủ gần kín màn hình.
 *
 * - PDF: trình xem PDF có sẵn của trình duyệt, qua URL ký sẵn mở tại chỗ.
 * - Ảnh: hiện thẳng.
 * - Word (.docx): tải tệp về trình duyệt rồi dựng thành trang bằng
 *   `docx-preview`. Tệp không đi qua dịch vụ xem trước bên ngoài nào.
 *
 * URL lấy theo chế độ `preview`, nên nhật ký truy cập ghi là "xem" chứ không
 * phải "tải xuống".
 */
export function DocumentPreview({ target, onClose, onDownload }: DocumentPreviewProps) {
  const [loaded, setLoaded] = useState<Loaded>();
  const docxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;
    setLoaded(undefined);
    let alive = true;

    void (async () => {
      try {
        const ticket = await api.getDownloadTicket(target.documentId, target.versionId, 'preview');
        if (!alive) return;
        if (ticket.contentType === 'application/pdf') {
          setLoaded({ kind: 'pdf', url: ticket.downloadUrl });
        } else if (ticket.contentType.startsWith('image/')) {
          setLoaded({ kind: 'image', url: ticket.downloadUrl });
        } else if (ticket.contentType === DOCX) {
          const response = await fetch(ticket.downloadUrl);
          if (!response.ok) throw new Error(`Không tải được tệp (HTTP ${response.status}).`);
          const blob = await response.blob();
          if (alive) setLoaded({ kind: 'docx', blob });
        } else {
          setLoaded({
            kind: 'error',
            message: 'Định dạng này chưa xem trước được, hãy tải xuống để mở.',
          });
        }
      } catch (cause) {
        if (alive) {
          setLoaded({
            kind: 'error',
            message: (cause as { message?: string })?.message ?? 'Không mở được bản xem trước.',
          });
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [target]);

  // Dựng tệp Word sau khi khung của nó đã gắn vào trang.
  useEffect(() => {
    if (loaded?.kind !== 'docx') return;
    const container = docxRef.current;
    if (!container) return;
    let alive = true;
    void (async () => {
      try {
        // Nạp thư viện khi cần: chỉ người mở tệp Word mới phải tải nó về.
        const { renderAsync } = await import('docx-preview');
        if (!alive) return;
        container.replaceChildren();
        await renderAsync(loaded.blob, container, undefined, {
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
          breakPages: true,
        });
      } catch {
        if (alive) {
          setLoaded({
            kind: 'error',
            message: 'Không dựng được tệp Word này. Hãy tải xuống để mở bằng Word.',
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [loaded]);

  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  if (!target || typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.previewPanel}
        role="dialog"
        aria-modal="true"
        aria-label={`Xem trước ${target.title}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.previewHead}>
          <div className={styles.previewTitle}>
            <b>{target.title}</b>
            {target.subtitle ? <span className={styles.muted}>{target.subtitle}</span> : null}
          </div>
          <button
            type="button"
            className={styles.buttonGhost}
            onClick={() => onDownload(target.documentId, target.versionId)}
          >
            <Download size={14} /> Tải xuống
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Đóng xem trước"
            title="Đóng (Esc)"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.previewBody}>
          {!loaded ? <p className={styles.previewNote}>Đang mở…</p> : null}
          {loaded?.kind === 'error' ? (
            <p role="alert" className={styles.previewNote}>
              {loaded.message}
            </p>
          ) : null}
          {loaded?.kind === 'pdf' ? (
            <iframe className={styles.previewFrame} src={loaded.url} title={target.title} />
          ) : null}
          {loaded?.kind === 'image' ? (
            <img className={styles.previewImage} src={loaded.url} alt={target.title} />
          ) : null}
          {loaded?.kind === 'docx' ? <div ref={docxRef} className={styles.previewDocx} /> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
