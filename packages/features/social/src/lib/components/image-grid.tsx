'use client';

import type { SocialAttachment } from '@enterprise-platform/contracts-social';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from '../social.module.scss';

/** Lưới ảnh (tối đa 4 ô, ô cuối hiện "+N") và hộp xem ảnh toàn màn hình, dùng cho bài viết và bình luận. */
function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
}: {
  readonly images: readonly SocialAttachment[];
  readonly index: number;
  readonly onIndex: (next: number) => void;
  readonly onClose: () => void;
}) {
  const current = images[index];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft')
        onIndex((index - 1 + images.length) % images.length);
      if (event.key === 'ArrowRight') onIndex((index + 1) % images.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onIndex, onClose]);

  if (!current) return null;
  return createPortal(
    <div
      className={styles.viewer}
      role="dialog"
      aria-modal="true"
      aria-label="Xem ảnh"
      onMouseDown={onClose}
    >
      <button
        type="button"
        className={styles.viewerClose}
        aria-label="Đóng"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      {images.length > 1 ? (
        <button
          type="button"
          className={`${styles.viewerNav} ${styles.viewerPrev}`}
          aria-label="Ảnh trước"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onIndex((index - 1 + images.length) % images.length)}
        >
          <ChevronLeft size={24} />
        </button>
      ) : null}
      {current.url ? (
        <img
          className={styles.viewerImage}
          src={current.url}
          alt={current.fileName}
          onMouseDown={(event) => event.stopPropagation()}
        />
      ) : null}
      {images.length > 1 ? (
        <button
          type="button"
          className={`${styles.viewerNav} ${styles.viewerNext}`}
          aria-label="Ảnh sau"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onIndex((index + 1) % images.length)}
        >
          <ChevronRight size={24} />
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

export function ImageGrid({
  images,
  preview = false,
}: {
  readonly images: readonly SocialAttachment[];
  /** Xem trước tĩnh trong ô soạn: ô không bấm được, không mở hộp xem ảnh. */
  readonly preview?: boolean;
}) {
  const [viewing, setViewing] = useState<number>();
  const shown = images.slice(0, 4);
  const hidden = images.length - shown.length;
  return (
    <>
      <div className={styles.imageGrid} data-count={shown.length}>
        {shown.map((image, index) =>
          preview ? (
            <div key={image.id} className={`${styles.imageCell} ${styles.imageCellStatic}`}>
              {image.url ? <img src={image.url} alt={image.fileName} loading="lazy" /> : null}
              {hidden > 0 && index === shown.length - 1 ? (
                <span className={styles.imageMore}>+{hidden}</span>
              ) : null}
            </div>
          ) : (
            <button
              key={image.id}
              type="button"
              className={styles.imageCell}
              aria-label={`Xem ảnh ${image.fileName}`}
              onClick={() => setViewing(index)}
            >
              {image.url ? (
                <img src={image.url} alt={image.fileName} loading="lazy" />
              ) : null}
              {hidden > 0 && index === shown.length - 1 ? (
                <span className={styles.imageMore}>+{hidden}</span>
              ) : null}
            </button>
          ),
        )}
      </div>
      {viewing !== undefined ? (
        <ImageViewer
          images={images}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(undefined)}
        />
      ) : null}
    </>
  );
}
