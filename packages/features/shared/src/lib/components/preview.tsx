'use client';

import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '../shared-api';
import styles from '../shared.module.scss';

export interface PreviewTarget {
  readonly documentId: string;
  /** Rỗng là phiên bản hiện hành. */
  readonly versionId?: string;
  readonly title: string;
}

type Loaded =
  | { readonly kind: 'pdf' | 'image'; readonly url: string }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Xem PDF và ảnh ngay trong trang qua URL ký sẵn chế độ `preview` — nhật ký
 * ghi là "xem", không phải "tải xuống".
 */
export function Preview({ target, onClose }: { readonly target?: PreviewTarget; readonly onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded>();

  useEffect(() => {
    if (!target) return;
    setLoaded(undefined);
    let alive = true;
    api
      .downloadTicket(target.documentId, target.versionId, 'preview')
      .then((ticket) => {
        if (!alive) return;
        setLoaded({
          kind: ticket.contentType.startsWith('image/') ? 'image' : 'pdf',
          url: ticket.downloadUrl,
        });
      })
      .catch((cause) => {
        if (alive) setLoaded({ kind: 'error', message: api.errorMessage(cause, 'Không mở được tệp.') });
      });
    return () => {
      alive = false;
    };
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  if (!target) return null;

  return createPortal(
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.preview}
        role="dialog"
        aria-modal="true"
        aria-label={target.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.previewHead}>
          <h3 title={target.title}>{target.title}</h3>
          <button
            type="button"
            className={styles.buttonGhost}
            onClick={() =>
              void api.openDocumentFile(target.documentId, target.versionId).catch(() => undefined)
            }
          >
            <Download size={15} /> Tải xuống
          </button>
          <button type="button" className={styles.iconButton} aria-label="Đóng" onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        <div className={styles.previewBody}>
          {!loaded ? (
            <p className={styles.muted}>Đang mở…</p>
          ) : loaded.kind === 'error' ? (
            <p role="alert" className={styles.alert}>
              {loaded.message}
            </p>
          ) : loaded.kind === 'image' ? (
            <img src={loaded.url} alt={target.title} />
          ) : (
            <iframe src={loaded.url} title={target.title} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
