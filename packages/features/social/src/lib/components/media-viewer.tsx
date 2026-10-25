'use client';

import { ChevronLeft, ChevronRight, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from '../media-gallery.module.scss';
import socialStyles from '../social.module.scss';
import { pauseOtherVideos, useExclusiveVideoPlayback } from '../use-exclusive-video-playback';
import { VIDEO_FAILED_MESSAGE, VIDEO_PROCESSING_MESSAGE } from './video-attachment';
import type { GalleryItem } from './media-gallery';

export interface MediaViewerProps {
  readonly items: readonly GalleryItem[];
  readonly index: number;
  readonly onIndex: (next: number) => void;
  readonly onClose: () => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * Xem toàn màn hình mọi ảnh và video của bài theo thứ tự. Phím ←/→ chuyển mục, Esc đóng, bấm nền đóng.
 * Video có controls, tự phát khi tới mục (trừ khi người dùng giảm chuyển động) và dừng khi rời mục
 * (mỗi mục là một phần tử riêng nên rời mục là huỷ phần tử).
 */
export function MediaViewer({ items, index, onIndex, onClose }: MediaViewerProps) {
  useExclusiveVideoPlayback();
  const closeRef = useRef<HTMLButtonElement>(null);
  const current = items[index];
  const count = items.length;

  // Mở hộp xem thì dừng video đang phát bên ngoài.
  useEffect(() => {
    pauseOtherVideos(null);
  }, []);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      // Phím mũi tên trên thanh điều khiển video dùng để tua, không chuyển mục.
      if (event.target instanceof HTMLElement && event.target.closest('video')) return;
      if (event.key === 'ArrowLeft') onIndex((index - 1 + count) % count);
      if (event.key === 'ArrowRight') onIndex((index + 1) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, count, onIndex, onClose]);

  if (!current) return null;

  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const status = current.processingStatus;
  const waiting = current.kind === 'video' && !current.url && (status === 'queued' || status === 'processing');
  const failed = current.kind === 'video' && status === 'failed';

  let media: React.ReactNode;
  if (current.kind === 'image') {
    media = current.url ? (
      <img key={current.key} className={socialStyles.viewerImage} src={current.url} alt={current.alt} onMouseDown={stop} />
    ) : null;
  } else if (current.url && !failed) {
    media = (
      <video
        key={current.key}
        className={styles.viewerMedia}
        src={current.url}
        poster={current.posterUrl}
        controls
        autoPlay={!prefersReducedMotion()}
        playsInline
        aria-label={`Video ${current.alt}`}
        onMouseDown={stop}
      />
    );
  } else {
    media = (
      <div className={styles.viewerNote} role={failed ? 'alert' : 'status'} onMouseDown={stop}>
        {failed ? (
          <TriangleAlert size={22} aria-hidden="true" />
        ) : (
          <LoaderCircle size={22} className={styles.spin} aria-hidden="true" />
        )}
        <span>{waiting ? VIDEO_PROCESSING_MESSAGE : failed ? VIDEO_FAILED_MESSAGE : 'Video chưa sẵn sàng'}</span>
      </div>
    );
  }

  return createPortal(
    <div className={socialStyles.viewer} role="dialog" aria-modal="true" aria-label="Xem ảnh và video" onMouseDown={onClose}>
      <button ref={closeRef} type="button" className={socialStyles.viewerClose} aria-label="Đóng" onClick={onClose}>
        <X size={20} />
      </button>
      {count > 1 ? (
        <button
          type="button"
          className={`${socialStyles.viewerNav} ${socialStyles.viewerPrev}`}
          aria-label="Mục trước"
          onMouseDown={stop}
          onClick={() => onIndex((index - 1 + count) % count)}
        >
          <ChevronLeft size={24} />
        </button>
      ) : null}
      {media}
      {count > 1 ? (
        <button
          type="button"
          className={`${socialStyles.viewerNav} ${socialStyles.viewerNext}`}
          aria-label="Mục sau"
          onMouseDown={stop}
          onClick={() => onIndex((index + 1) % count)}
        >
          <ChevronRight size={24} />
        </button>
      ) : null}
      {count > 1 ? (
        <span className={styles.viewerCount} aria-live="polite" onMouseDown={stop}>
          {index + 1}/{count}
        </span>
      ) : null}
    </div>,
    document.body,
  );
}
