'use client';

import type { SocialAttachment } from '@enterprise-platform/contracts-social';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import styles from '../social.module.scss';
import { useExclusiveVideoPlayback } from '../use-exclusive-video-playback';
import { useNearViewport, usePauseWhenOutOfView } from '../use-viewport-visibility';
import { useVideoRefreshPoll, type VideoRefresh } from '../use-video-refresh-poll';

export interface VideoAttachmentProps {
  readonly attachment: SocialAttachment;
  /** Chỉ ô soạn thảo của tác giả: gỡ video (kể cả video đang xử lý hoặc lỗi). */
  readonly onRemove?: () => void;
  /** URL xem video sống 1 giờ: cha tải lại dữ liệu để lấy URL mới khi liên kết hết hạn. */
  readonly onRequestRefresh?: VideoRefresh;
  readonly className?: string;
}

export const VIDEO_EXPIRED_MESSAGE = 'Liên kết video đã hết hạn, hãy tải lại trang.';
export const VIDEO_PROCESSING_MESSAGE = 'Video đang được xử lý, sẽ xem được sau ít phút.';
export const VIDEO_FAILED_MESSAGE = 'Không xử lý được video này.';
export const VIDEO_NOT_READY_MESSAGE = 'Video chưa sẵn sàng';

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
  const rootRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const retried = useRef(false);
  const resumeAt = useRef<number | null>(null);
  const [expired, setExpired] = useState(false);

  const { url, posterUrl } = attachment;
  // Video đang phát mà cuộn ra khỏi màn hình thì tự dừng (cuộn lại không tự phát tiếp).
  usePauseWhenOutOfView(videoRef, url);
  // Ảnh bìa (thuộc tính `poster`) và khung đầu của video không bìa đều được tải ngay khi thẻ video xuất hiện, không có lazy
  // như thẻ `<img>`; hoãn tới khi gần vùng nhìn thấy để mở bảng tin không phải tải bìa của mọi bài.
  const near = useNearViewport(rootRef, Boolean(url));
  const source = url && (posterUrl || near) ? url : undefined;
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
    void Promise.resolve(onRequestRefresh()).catch(() => undefined);
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

  const status = attachment.processingStatus;
  const waitingForServer = !url && (status === 'queued' || status === 'processing');
  // Người xem video chưa xong: cha tải lại định kỳ để lấy URL khi video xử lý xong.
  useVideoRefreshPoll(waitingForServer, onRequestRefresh);

  const removeButton = onRemove ? (
    <button type="button" className={styles.videoRemove} onClick={onRemove}>
      Gỡ
    </button>
  ) : null;

  if (!url) {
    const failed = status === 'failed';
    const label = waitingForServer ? VIDEO_PROCESSING_MESSAGE : failed ? VIDEO_FAILED_MESSAGE : VIDEO_NOT_READY_MESSAGE;
    return (
      <div className={rootClass}>
        <div
          className={styles.videoPlaceholder}
          role={waitingForServer ? 'status' : failed ? 'alert' : 'img'}
          aria-label={label}
          data-state={waitingForServer ? 'processing' : failed ? 'failed' : undefined}
          style={{ aspectRatio: ratio ?? '16 / 9' }}
        >
          {waitingForServer ? (
            <LoaderCircle size={22} className={styles.videoPlaceholderSpin} aria-hidden="true" />
          ) : failed ? (
            <TriangleAlert size={22} aria-hidden="true" />
          ) : null}
          <span>{label}</span>
          {failed && attachment.processingError ? (
            <span className={styles.videoPlaceholderDetail}>{attachment.processingError}</span>
          ) : null}
        </div>
        {removeButton}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={rootClass}>
      <video
        ref={videoRef}
        key={url}
        className={styles.videoPlayer}
        style={{ aspectRatio: ratio }}
        src={source}
        poster={near ? posterUrl : undefined}
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
