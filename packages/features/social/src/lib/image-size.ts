import { SOCIAL_IMAGE_MAX_DIMENSION } from '@enterprise-platform/contracts-social';

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** Thời hạn đọc kích thước; quá thì bỏ qua (ảnh vẫn tải bình thường, chỉ thiếu kích thước). */
export const READ_IMAGE_SIZE_TIMEOUT_MS = 5000;

/** Kích thước hợp lệ: số nguyên dương, không quá `SOCIAL_IMAGE_MAX_DIMENSION`. */
export function validImageSize(width: unknown, height: unknown): ImageSize | undefined {
  const ok = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= SOCIAL_IMAGE_MAX_DIMENSION;
  return ok(width) && ok(height) ? { width, height } : undefined;
}

/** Phần của thẻ ảnh mà việc đọc kích thước dùng. */
export interface ImageLike {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

/** Phần phụ thuộc trình duyệt, tiêm được để test. */
export interface ImageSizeDeps {
  readonly createImageBitmap?: (file: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
  readonly createImage?: () => ImageLike;
  readonly createObjectURL?: (file: Blob) => string;
  readonly revokeObjectURL?: (url: string) => void;
  readonly timeoutMs?: number;
}

function browserDeps(): ImageSizeDeps {
  const g = globalThis as {
    createImageBitmap?: ImageSizeDeps['createImageBitmap'];
    document?: unknown;
    URL?: typeof URL;
  };
  return {
    createImageBitmap: typeof g.createImageBitmap === 'function' ? g.createImageBitmap.bind(globalThis) : undefined,
    createImage: g.document ? () => new Image() as ImageLike : undefined,
    createObjectURL: g.URL?.createObjectURL ? (file) => URL.createObjectURL(file) : undefined,
    revokeObjectURL: g.URL?.revokeObjectURL ? (url) => URL.revokeObjectURL(url) : undefined,
  };
}

async function viaBitmap(
  file: Blob,
  createBitmap: NonNullable<ImageSizeDeps['createImageBitmap']>,
): Promise<ImageSize | undefined> {
  // `createImageBitmap` mặc định theo `imageOrientation: 'from-image'` (trình duyệt hiện đại), nên width/height
  // đã tính phép xoay EXIF: đúng với cách ảnh hiển thị.
  const bitmap = await createBitmap(file);
  try {
    return validImageSize(bitmap.width, bitmap.height);
  } finally {
    bitmap.close?.();
  }
}

function viaImage(
  file: Blob,
  createImage: () => ImageLike,
  createObjectURL: (file: Blob) => string,
  revokeObjectURL?: (url: string) => void,
): Promise<ImageSize | undefined> {
  return new Promise((resolve) => {
    const url = createObjectURL(file);
    const img = createImage();
    const done = (size: ImageSize | undefined) => {
      img.onload = null;
      img.onerror = null;
      revokeObjectURL?.(url);
      resolve(size);
    };
    // `naturalWidth/Height` của thẻ ảnh cũng đã áp phép xoay EXIF (image-orientation mặc định là from-image).
    img.onload = () => done(validImageSize(img.naturalWidth, img.naturalHeight));
    img.onerror = () => done(undefined);
    img.src = url;
  });
}

/**
 * Đọc kích thước điểm ảnh (đã tính phép xoay EXIF) của ảnh ở trình duyệt. Ưu tiên `createImageBitmap`, không có
 * thì dùng thẻ ảnh với URL tạm (thu hồi sau khi đọc). Không bao giờ ném: ảnh hỏng, định dạng không đọc được,
 * quá 5 giây hoặc kích thước không hợp lệ đều trả `undefined`.
 */
export async function readImageSize(file: Blob, deps: ImageSizeDeps = browserDeps()): Promise<ImageSize | undefined> {
  const timeoutMs = deps.timeoutMs ?? READ_IMAGE_SIZE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  const read = async (): Promise<ImageSize | undefined> => {
    try {
      if (deps.createImageBitmap) return await viaBitmap(file, deps.createImageBitmap);
      if (deps.createImage && deps.createObjectURL) {
        return await viaImage(file, deps.createImage, deps.createObjectURL, deps.revokeObjectURL);
      }
      return undefined;
    } catch {
      return undefined;
    }
  };
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
