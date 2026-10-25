'use client';

import type { SocialAttachment } from '@enterprise-platform/contracts-social';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from '../composer-video.module.scss';

/** Trạng thái của ô video trong ô soạn, đủ để chọn nguồn phát và lời nhắn. */
export type PreviewTileState = 'uploading' | 'queued' | 'processing' | 'ready' | 'failed' | 'error';

export const PREVIEW_PENDING_NOTE =
  'Trình duyệt chưa phát được định dạng này (ví dụ video HEVC từ iPhone). Bạn vẫn có thể đăng: video sẽ xem được khi xử lý xong.';
export const PREVIEW_FAILED_NOTE = 'Không phát được video này trong trình duyệt.';

/**
 * Nguồn xem trước theo thứ tự ưu tiên: bản đã xử lý trên máy chủ (đúng thứ người xem sẽ thấy) khi video đã sẵn sàng,
 * rồi đến tệp vừa chọn (URL tạm của trình duyệt) để xem được ngay cả khi còn đang tải lên hoặc đang xử lý.
 * Video xử lý lỗi thì không có bản xem trước.
 */
export function previewSources(input: {
  readonly state: PreviewTileState;
  readonly attachment?: Pick<SocialAttachment, 'url'>;
  readonly previewUrl?: string;
}): readonly string[] {
  if (input.state === 'failed') return [];
  const sources: string[] = [];
  if (input.state === 'ready' && input.attachment?.url) sources.push(input.attachment.url);
  if (input.previewUrl && !sources.includes(input.previewUrl)) sources.push(input.previewUrl);
  return sources;
}

/** Lời nhắn khi không phát được: chưa xử lý xong thì có thể do trình duyệt không giải mã được tệp gốc. */
export function previewFailureNote(state: PreviewTileState): string {
  return state === 'uploading' || state === 'queued' || state === 'processing' ? PREVIEW_PENDING_NOTE : PREVIEW_FAILED_NOTE;
}

export interface VideoPreviewProps {
  readonly fileName: string;
  readonly sources: readonly string[];
  readonly failureNote: string;
  readonly onClose: () => void;
}

/**
 * Hộp xem trước video (dựng qua portal). Chỉ Esc và bấm ra ngoài đóng hộp này, không đóng ô soạn bên dưới.
 * Nguồn đầu lỗi (URL hết hạn, trình duyệt không giải mã được) thì thử nguồn kế tiếp, hết thì hiện lời nhắn.
 */
export function VideoPreview({ fileName, sources, failureNote, onClose }: VideoPreviewProps) {
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Pha bắt: chặn Esc trước khi tới ô soạn bên dưới.
      event.stopImmediatePropagation();
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previouslyFocused?.focus?.();
    };
  }, [mounted]);

  if (!mounted) return null;
  const source = sources[index];

  return createPortal(
    <div className={styles.previewOverlay} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.previewBox}
        role="dialog"
        aria-modal="true"
        aria-label={`Xem trước video ${fileName}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button ref={closeRef} type="button" className={styles.previewClose} aria-label="Đóng xem trước" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
        {source ? (
          <video
            key={source}
            className={styles.previewVideo}
            src={source}
            controls
            autoPlay
            playsInline
            onError={() => setIndex((current) => current + 1)}
          />
        ) : (
          <p className={styles.previewNote} role="status">
            {failureNote}
          </p>
        )}
        <p className={styles.previewTitle} title={fileName}>
          {fileName}
        </p>
      </div>
    </div>,
    document.body,
  );
}
