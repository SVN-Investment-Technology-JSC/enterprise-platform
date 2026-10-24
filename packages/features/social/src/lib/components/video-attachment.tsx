'use client';

import type { SocialAttachment } from '@enterprise-platform/contracts-social';
import { useCallback, useRef, useState } from 'react';
import styles from '../social.module.scss';
import { useExclusiveVideoPlayback } from '../use-exclusive-video-playback';

export interface VideoAttachmentProps {
  readonly attachment: SocialAttachment;
  /** Chỉ ô soạn thảo của tác giả: gỡ video (kể cả video đang xử lý hoặc lỗi). */
  readonly onRemove?: () => void;
  /** URL xem video sống 1 giờ: cha tải lại dữ liệu để lấy URL mới khi liên kết hết hạn. */
  readonly onRequestRefresh?: () => void;
  readonly className?: string;
}

export const VIDEO_EXPIRED_MESSAGE = 'Liên kết video đã hết hạn, hãy tải lại trang.';

/** Tỉ lệ khung hình CSS từ chiều rộng và cao; thiếu hoặc không hợp lệ thì để trình duyệt tự suy ra. */
export function videoAspectRatio(width?: number, height?: number): string | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  return `${width} / ${height}`;
}

/** `preload="none"` khi có poster (chưa tải video đến khi bấm phát); không có poster thì tải siêu dữ liệu để hiện khung đầu. */
export function videoPreload(posterUrl?: string): 'none' | 'metadata' {
  return posterUrl ? 'none' : 'metadata';
}

/** Định dạng thời lượng `m:ss` hoặc `h:mm:ss`; không hợp lệ trả về undefined. */
export function formatVideoDuration(durationMs?: number): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) return undefined;
  const total = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** Chỉ làm mới URL một lần, và chỉ khi người xem đã bấm phát (lỗi trước đó là lỗi khác, không phải hết hạn). */
export function shouldRefreshOnError(state: { readonly started: boolean; readonly retried: boolean }): boolean {
  return state.started && !state.retried;
}

export function VideoAttachment({ attachment, onRemove, onRequestRefresh, className }: VideoAttachmentProps) {
  useExclusiveVideoPlayback();
  const videoRef = useRef<HTMLVideoElement>(null);
  const started = useRef(false);
  const retried = useRef(false);
  const resumeAt = useRef<number | null>(null);
  const [expired, setExpired] = useState(false);

  const { url, posterUrl } = attachment;
  const duration = formatVideoDuration(attachment.durationMs);
  const rootClass = [styles.videoAttachment, className].filter(Boolean).join(' ');
  const ratio = videoAspectRatio(attachment.width, attachment.height);

  const handleError = useCallback(() => {
    const element = videoRef.current;
    const wasPlaying = started.current || (element?.currentTime ?? 0) > 0;
    if (!wasPlaying) return;
    if (!shouldRefreshOnError({ started: wasPlaying, retried: retried.current }) || !onRequestRefresh) {
      setExpired(true);
      return;
    }
    retried.current = true;
    resumeAt.current = element?.currentTime ?? 0;
    onRequestRefresh();
  }, [onRequestRefresh]);

  const handleLoadedMetadata = useCallback(() => {
    const element = videoRef.current;
    const position = resumeAt.current;
    if (!element || position === null) return;
    resumeAt.current = null;
    element.currentTime = position;
    const playing = element.play() as Promise<void> | undefined;
    void playing?.catch(() => undefined);
  }, []);

  const removeButton = onRemove ? (
    <button type="button" className={styles.videoRemove} onClick={onRemove}>
      Gỡ
    </button>
  ) : null;

  if (!url) {
    return (
      <div className={rootClass}>
        <div
          className={styles.videoPlaceholder}
          role="img"
          aria-label="Video chưa sẵn sàng"
          style={{ aspectRatio: ratio ?? '16 / 9' }}
        >
          Video chưa sẵn sàng
        </div>
        {removeButton}
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <video
        ref={videoRef}
        key={url}
        className={styles.videoPlayer}
        style={{ aspectRatio: ratio }}
        src={url}
        poster={posterUrl}
        controls
        playsInline
        preload={videoPreload(posterUrl)}
        aria-label={`Video ${attachment.fileName}`}
        onPlay={() => {
          started.current = true;
        }}
        onPlaying={() => {
          retried.current = false;
          setExpired(false);
        }}
        onLoadedMetadata={handleLoadedMetadata}
        onError={handleError}
      />
      {duration ? (
        <span className={styles.videoDuration} aria-label={`Thời lượng ${duration}`}>
          {duration}
        </span>
      ) : null}
      {expired ? (
        <p className={styles.videoExpired} role="status">
          {VIDEO_EXPIRED_MESSAGE}
        </p>
      ) : null}
      {removeButton}
    </div>
  );
}
