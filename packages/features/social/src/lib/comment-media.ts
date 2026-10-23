import {
  SOCIAL_COMMENT_IMAGE_MAX_BYTES,
  SOCIAL_COMMENT_MAX_ATTACHMENTS,
  SOCIAL_COMMENT_MAX_VIDEOS,
  SOCIAL_COMMENT_VIDEO_MAX_BYTES,
  SOCIAL_IMAGE_CONTENT_TYPES,
  SOCIAL_VIDEO_CONTENT_TYPES,
} from '@enterprise-platform/contracts-social';

/** Ảnh gốc lớn hơn mức này bị từ chối ngay, không cố nén (tránh giải mã ảnh quá nặng trên trình duyệt). */
export const COMMENT_IMAGE_INPUT_MAX_BYTES = 25 * 1024 * 1024;
/** Cạnh dài tối đa sau khi thu nhỏ. */
const MAX_EDGE = 1600;
/** Ảnh nhỏ hơn mức này giữ nguyên, nén cũng không đáng kể. */
const SKIP_BELOW_BYTES = 300 * 1024;
const WEBP_QUALITY = 0.82;

/** Tệp có phải video được phép đính kèm (MP4, WebM) hay không. */
export function isCommentVideo(file: { readonly type: string }): boolean {
  return SOCIAL_VIDEO_CONTENT_TYPES.includes(file.type);
}

/**
 * Kiểm một ảnh hoặc video định đính kèm; trả thông báo lỗi tiếng Việt hoặc `undefined` khi hợp lệ.
 * `current` là số tệp và số video đã có trong bình luận. Video không nén nên chỉ kiểm loại và dung lượng.
 */
export function validateCommentMedia(
  file: { readonly name: string; readonly type: string; readonly size: number },
  current: { readonly count: number; readonly videos: number },
): string | undefined {
  if (current.count >= SOCIAL_COMMENT_MAX_ATTACHMENTS) {
    return `Mỗi bình luận đính kèm tối đa ${SOCIAL_COMMENT_MAX_ATTACHMENTS} tệp.`;
  }
  if (isCommentVideo(file)) {
    if (current.videos >= SOCIAL_COMMENT_MAX_VIDEOS) {
      return `Mỗi bình luận chỉ đính kèm tối đa ${SOCIAL_COMMENT_MAX_VIDEOS} video.`;
    }
    if (file.size > SOCIAL_COMMENT_VIDEO_MAX_BYTES) {
      return `Video "${file.name}" quá lớn (tối đa ${Math.floor(SOCIAL_COMMENT_VIDEO_MAX_BYTES / (1024 * 1024))} MB).`;
    }
    return undefined;
  }
  if (file.type === 'video/quicktime') {
    return 'Định dạng MOV chưa được hỗ trợ. Hãy xuất sang MP4 (H.264) hoặc WebM.';
  }
  if (!SOCIAL_IMAGE_CONTENT_TYPES.includes(file.type)) {
    return `"${file.name}" không phải ảnh JPEG, PNG, GIF, WebP hoặc video MP4, WebM.`;
  }
  if (file.size > COMMENT_IMAGE_INPUT_MAX_BYTES) {
    return `Ảnh "${file.name}" quá lớn (tối đa ${Math.floor(COMMENT_IMAGE_INPUT_MAX_BYTES / (1024 * 1024))} MB).`;
  }
  return undefined;
}

/** Sau khi nén, ảnh còn vượt mức của bình luận thì không tải được. */
export function exceedsCommentImageLimit(sizeBytes: number): boolean {
  return sizeBytes > SOCIAL_COMMENT_IMAGE_MAX_BYTES;
}

/**
 * Thu nhỏ (cạnh dài ≤ 1600px) và đổi sang WebP trước khi tải lên: thường giảm 5–10 lần dung lượng lưu trữ.
 * GIF giữ nguyên để không mất ảnh động; ảnh nhỏ hoặc không nén được nhỏ hơn thì giữ bản gốc; lỗi giải mã
 * (trình duyệt cũ) cũng giữ bản gốc.
 */
export async function prepareCommentImage(file: File): Promise<File> {
  if (file.type === 'image/gif' || file.size <= SKIP_BELOW_BYTES) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, {
      type: 'image/webp',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

export type VideoProbeResult =
  | { readonly ok: true; readonly durationSeconds: number; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: string };

export const VIDEO_UNREADABLE_REASON =
  'Trình duyệt không đọc được video này. Video quay bằng điện thoại thường là H.265/HEVC; hãy xuất lại sang MP4 (H.264) hoặc WebM rồi thử lại.';
const VIDEO_PROBE_TIMEOUT_MS = 8000;

/**
 * Kiểm trình duyệt có đọc được video không (codec, vùng chứa) trước khi tải lên: nạp metadata bằng thẻ
 * `<video>` ẩn, tối đa 8 giây. `createVideo` tiêm được để test.
 */
export function probeVideo(
  file: Blob,
  createVideo: () => HTMLVideoElement = () => document.createElement('video'),
  timeoutMs = VIDEO_PROBE_TIMEOUT_MS,
): Promise<VideoProbeResult> {
  return new Promise<VideoProbeResult>((resolve) => {
    let video: HTMLVideoElement;
    let url: string;
    try {
      video = createVideo();
      url = URL.createObjectURL(file);
    } catch {
      resolve({ ok: false, reason: VIDEO_UNREADABLE_REASON });
      return;
    }
    const finish = (result: VideoProbeResult) => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load?.();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () =>
      finish(
        video.videoWidth > 0 && video.videoHeight > 0
          ? { ok: true, durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight }
          : { ok: false, reason: VIDEO_UNREADABLE_REASON },
      );
    video.onerror = () => finish({ ok: false, reason: VIDEO_UNREADABLE_REASON });
    const timer = setTimeout(() => finish({ ok: false, reason: VIDEO_UNREADABLE_REASON }), timeoutMs);
    video.src = url;
  });
}
