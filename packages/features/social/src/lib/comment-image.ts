import {
  SOCIAL_COMMENT_IMAGE_MAX_BYTES,
  SOCIAL_COMMENT_MAX_ATTACHMENTS,
  SOCIAL_IMAGE_CONTENT_TYPES,
} from '@enterprise-platform/contracts-social';

/** Ảnh gốc lớn hơn mức này bị từ chối ngay, không cố nén (tránh giải mã ảnh quá nặng trên trình duyệt). */
export const COMMENT_IMAGE_INPUT_MAX_BYTES = 25 * 1024 * 1024;
/** Cạnh dài tối đa sau khi thu nhỏ. */
const MAX_EDGE = 1600;
/** Ảnh nhỏ hơn mức này giữ nguyên, nén cũng không đáng kể. */
const SKIP_BELOW_BYTES = 300 * 1024;
const WEBP_QUALITY = 0.82;

/** Kiểm một ảnh định đính kèm; trả thông báo lỗi tiếng Việt hoặc `undefined` khi hợp lệ. */
export function validateCommentImage(
  file: { readonly name: string; readonly type: string; readonly size: number },
  currentCount: number,
): string | undefined {
  if (currentCount >= SOCIAL_COMMENT_MAX_ATTACHMENTS) {
    return `Mỗi bình luận đính kèm tối đa ${SOCIAL_COMMENT_MAX_ATTACHMENTS} ảnh.`;
  }
  if (!SOCIAL_IMAGE_CONTENT_TYPES.includes(file.type)) {
    return `"${file.name}" không phải ảnh JPEG, PNG, GIF hoặc WebP.`;
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
