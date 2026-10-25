'use client';

import type { SocialAttachment } from '@enterprise-platform/contracts-social';
import { LoaderCircle, Play, RotateCw, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import styles from '../composer-video.module.scss';
import layoutStyles from './media-layout.module.scss';
import { MediaMoveButtons } from './media-layout-picker';
import { previewFailureNote, previewSources, VideoPreview } from './video-preview';

export interface ComposerVideoTileProps {
  readonly fileName: string;
  /** URL tạm của tệp vừa chọn, để xem trước khi chưa có poster. */
  readonly previewUrl?: string;
  /** `uploading`: đang tải; `done`: đã tải, trạng thái xử lý nằm ở `attachment`; `error`: lỗi tải. */
  readonly status: 'uploading' | 'done' | 'error';
  /** Tiến trình tải lên, 0 đến 1. */
  readonly progress?: number;
  /** Bản mới nhất của tệp (từ phản hồi `complete` hoặc lần hỏi trạng thái gần nhất). */
  readonly attachment?: SocialAttachment;
  /** Lỗi tải lên (khi `status` là `error`). */
  readonly error?: string;
  /** Có hiện nút "Thử lại tải lên" không. */
  readonly retryable?: boolean;
  /** Khoá thao tác khi ô soạn đang gửi. */
  readonly disabled?: boolean;
  readonly onRemove: () => void;
  readonly onRetry?: () => void;
  /** Nút đổi vị trí trong bố cục bài viết; không truyền thì không hiện (ví dụ ô soạn bình luận). */
  readonly move?: {
    readonly canEarlier: boolean;
    readonly canLater: boolean;
    readonly onMove: (direction: 'earlier' | 'later') => void;
  };
}

/** Thời lượng dạng m:ss hoặc h:mm:ss. */
export function formatVideoDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return undefined;
  const total = Math.round(durationMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

type TileState = 'uploading' | 'queued' | 'processing' | 'ready' | 'failed' | 'error';

function tileState(props: Pick<ComposerVideoTileProps, 'status' | 'attachment'>): TileState {
  if (props.status === 'uploading') return 'uploading';
  if (props.status === 'error') return 'error';
  return props.attachment?.processingStatus ?? 'ready';
}

/** Một video trong ô soạn: tải lên, chờ hoặc đang xử lý, sẵn sàng hoặc lỗi; gỡ được ở mọi trạng thái. */
export function ComposerVideoTile(props: ComposerVideoTileProps) {
  const { fileName, previewUrl, progress = 0, attachment, error, retryable, disabled, onRemove, onRetry, move } = props;
  const state = tileState(props);
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const duration = formatVideoDuration(attachment?.durationMs);
  const removeLabel = state === 'uploading' ? `Huỷ tải video ${fileName}` : `Gỡ video ${fileName}`;
  const busyProcessing = state === 'queued' || state === 'processing';
  // Xem trước được ngay khi đã có tệp trong máy (kể cả đang tải hoặc đang xử lý) hoặc bản đã xử lý trên máy chủ.
  const [previewing, setPreviewing] = useState(false);
  const sources = previewSources({ state, attachment, previewUrl });

  return (
    <div className={styles.tile} data-state={state} role="group" aria-label={`Video ${fileName}`}>
      <div className={styles.thumb}>
        {sources.length > 0 ? (
          <button
            type="button"
            className={styles.thumbButton}
            aria-label={`Xem trước video ${fileName}`}
            title="Xem trước"
            onClick={() => setPreviewing(true)}
          />
        ) : null}
        {state === 'ready' && attachment?.posterUrl ? (
          <img src={attachment.posterUrl} alt="" />
        ) : previewUrl && state !== 'failed' ? (
          <video src={previewUrl} muted preload="metadata" playsInline aria-hidden="true" tabIndex={-1} />
        ) : null}
        {state === 'ready' ? (
          <>
            <Play size={18} fill="currentColor" className={styles.icon} aria-hidden="true" />
            {duration ? <span className={styles.duration}>{duration}</span> : null}
          </>
        ) : state === 'failed' || state === 'error' ? (
          <TriangleAlert size={18} className={styles.icon} aria-hidden="true" />
        ) : (
          <LoaderCircle size={18} className={`${styles.icon} ${busyProcessing ? styles.spin : ''}`} aria-hidden="true" />
        )}
      </div>
      <div className={styles.body}>
        <span className={styles.name} title={fileName}>
          {fileName}
        </span>
        {state === 'uploading' ? (
          <>
            <span className={styles.status}>Đang tải lên… {percent}%</span>
            <div
              className={styles.bar}
              role="progressbar"
              aria-label="Đang tải video lên"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className={styles.barValue} style={{ width: `${percent}%` }} />
            </div>
          </>
        ) : null}
        {busyProcessing ? (
          <>
            <span className={styles.status} role="status">
              {state === 'queued' ? 'Đang chờ xử lý video…' : 'Đang xử lý video…'}
            </span>
            <span className={styles.hint}>Bạn có thể đăng ngay hoặc chờ vài phút.</span>
          </>
        ) : null}
        {state === 'ready' ? (
          <>
            <span className={styles.status}>Video đã sẵn sàng</span>
            {sources.length > 0 ? <span className={styles.hint}>Bấm vào hình để xem trước.</span> : null}
          </>
        ) : null}
        {state === 'failed' ? (
          <>
            <span className={styles.errorText} role="alert">
              {attachment?.processingError || 'Không xử lý được video này.'}
            </span>
            <div className={styles.actions}>
              <button type="button" className={styles.textButton} disabled={disabled} onClick={onRemove}>
                Gỡ video
              </button>
            </div>
          </>
        ) : null}
        {state === 'error' ? (
          <>
            <span className={styles.errorText} role="alert">
              {error || `Không tải được video "${fileName}".`}
            </span>
            {retryable !== false && onRetry ? (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.textButton}
                  aria-label={`Thử lại tải lên video ${fileName}`}
                  disabled={disabled}
                  onClick={onRetry}
                >
                  <RotateCw size={11} aria-hidden="true" /> Thử lại tải lên
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      <button
        type="button"
        className={styles.remove}
        aria-label={removeLabel}
        title={removeLabel}
        disabled={disabled}
        onClick={onRemove}
      >
        <X size={12} aria-hidden="true" />
      </button>
      {move ? (
        <MediaMoveButtons
          className={layoutStyles.tileMove}
          fileName={fileName}
          canEarlier={move.canEarlier}
          canLater={move.canLater}
          disabled={disabled}
          onMove={move.onMove}
        />
      ) : null}
      {previewing ? (
        <VideoPreview
          fileName={fileName}
          sources={sources}
          failureNote={previewFailureNote(state)}
          onClose={() => setPreviewing(false)}
        />
      ) : null}
    </div>
  );
}
