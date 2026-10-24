'use client';

import type { ChatAttachmentView } from '@enterprise-platform/contracts-chat';
import { FileArchive, FileSpreadsheet, FileText, File as FileIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { chatApi } from './chat-api';
import { formatBytes } from './chat-model';
import styles from './chat.module.scss';

interface CachedUrl {
  readonly url: string;
  readonly expiresAt: number;
}

/** URL ký sẵn của tệp có hạn ngắn: nhớ trong trang tới gần lúc hết hạn để cuộn qua lại không xin lại mỗi lần. */
const urls = new Map<string, CachedUrl>();
const inFlight = new Map<string, Promise<string>>();

export function attachmentUrl(id: string): Promise<string> {
  const cached = urls.get(id);
  if (cached && cached.expiresAt - 30_000 > Date.now()) return Promise.resolve(cached.url);
  const pending = inFlight.get(id);
  if (pending) return pending;
  const request = chatApi
    .attachmentUrl(id)
    .then((result) => {
      urls.set(id, { url: result.url, expiresAt: Date.parse(result.expiresAt) });
      return result.url;
    })
    .finally(() => inFlight.delete(id));
  inFlight.set(id, request);
  return request;
}

function useAttachmentUrl(id: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => urls.get(id)?.url);
  useEffect(() => {
    let active = true;
    void attachmentUrl(id)
      .then((value) => active && setUrl(value))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [id]);
  return url;
}

function ImageThumb({ attachment, onOpen }: { attachment: ChatAttachmentView; onOpen: (url: string) => void }) {
  const url = useAttachmentUrl(attachment.id);
  return (
    <button type="button" className={styles.imageThumb} onClick={() => url && onOpen(url)} aria-label={`Xem ảnh ${attachment.fileName}`}>
      {url ? <img src={url} alt={attachment.fileName} loading="lazy" /> : null}
    </button>
  );
}

function fileIcon(contentType: string) {
  if (contentType.includes('sheet') || contentType.includes('excel') || contentType === 'text/csv') return FileSpreadsheet;
  if (contentType.includes('zip') || contentType.includes('rar') || contentType.includes('7z')) return FileArchive;
  if (contentType.includes('pdf') || contentType.includes('word') || contentType.startsWith('text/')) return FileText;
  return FileIcon;
}

async function openFile(attachment: ChatAttachmentView): Promise<void> {
  const url = await attachmentUrl(attachment.id);
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Ảnh hiện thành lưới xem nhanh (bấm để phóng to), tệp khác là thẻ có tên và dung lượng (bấm để mở/tải). */
export function MessageAttachments({ attachments }: { attachments: readonly ChatAttachmentView[] }) {
  const [preview, setPreview] = useState<string | null>(null);
  const images = attachments.filter((attachment) => attachment.isImage);
  const files = attachments.filter((attachment) => !attachment.isImage);
  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setPreview(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [preview]);
  if (attachments.length === 0) return null;
  return (
    <>
      {images.length > 0 ? (
        <div className={images.length === 1 ? `${styles.images} ${styles.imagesSingle}` : styles.images}>
          {images.map((attachment) => (
            <ImageThumb key={attachment.id} attachment={attachment} onOpen={setPreview} />
          ))}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className={styles.files}>
          {files.map((attachment) => {
            const Icon = fileIcon(attachment.contentType);
            return (
              <button key={attachment.id} type="button" className={styles.fileChip} onClick={() => void openFile(attachment)} title="Mở hoặc tải tệp">
                <Icon aria-hidden="true" />
                <span style={{ minWidth: 0 }}>
                  <span className={styles.fileName}>{attachment.fileName}</span>
                  <br />
                  <span className={styles.fileSize}>{formatBytes(attachment.sizeBytes)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {preview ? (
        <div className={styles.lightbox} role="dialog" aria-label="Xem ảnh" onClick={() => setPreview(null)}>
          <button type="button" className={`${styles.iconButton} ${styles.lightboxClose}`} aria-label="Đóng" onClick={() => setPreview(null)}>
            <X aria-hidden="true" />
          </button>
          <img src={preview} alt="" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </>
  );
}
