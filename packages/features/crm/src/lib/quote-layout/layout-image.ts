/**
 * Tải ảnh cho khối `image`, logo của `companyHeader` và logo tổ chức báo giá (plan mục 9.3): chỉ nhận PNG, JPEG (kiểm chữ
 * ký đầu file, không tin đuôi). Tự nén ở trình duyệt: ảnh đã gọn (rộng ≤ 1.600 px, ≤ 300 KB) giữ nguyên (PNG giữ nền
 * trong suốt); còn lại vẽ lại bằng canvas với chiều rộng tối đa 1.600 px rồi nén JPEG, hạ dần chất lượng rồi chiều rộng tới
 * khi ≤ 300 KB. Không nén được xuống mới báo lỗi.
 */
import { QUOTE_LAYOUT_LIMITS } from '@enterprise-platform/contracts-crm';

export const LAYOUT_IMAGE_MAX_WIDTH_PX = 1600;
/** Chất lượng JPEG thử lần lượt; hết mà vẫn lớn thì thu nhỏ chiều rộng. */
export const LAYOUT_IMAGE_JPEG_QUALITIES: readonly number[] = [0.85, 0.75, 0.65, 0.55];
/** Mỗi lần thu nhỏ còn chừng này phần chiều rộng; không thu dưới `LAYOUT_IMAGE_MIN_WIDTH_PX`. */
const SHRINK_FACTOR = 0.8;
export const LAYOUT_IMAGE_MIN_WIDTH_PX = 320;
/** Gợi ý ở ô tải ảnh. */
export const LAYOUT_IMAGE_HINT = 'PNG hoặc JPEG; ảnh lớn được tự thu về rộng tối đa 1.600 px và nén JPEG dưới 300 KB.';
/** File gốc quá lớn thì từ chối ngay, không giải mã (tránh treo trang). */
export const LAYOUT_IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const LAYOUT_IMAGE_TYPE_MESSAGE = 'Chỉ nhận ảnh PNG hoặc JPEG.';
export const LAYOUT_IMAGE_TOO_LARGE_MESSAGE = 'Ảnh quá lớn, không nén được xuống dưới 300 KB. Hãy chọn ảnh nhỏ hơn.';
export const LAYOUT_IMAGE_READ_MESSAGE = 'Không đọc được ảnh. Thử ảnh khác.';

export type LayoutImageMime = 'image/png' | 'image/jpeg';

/** Loại ảnh theo chữ ký đầu file; không phải PNG, JPEG thì `null`. */
export function detectImageType(bytes: Uint8Array): LayoutImageMime | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

/** Số byte sau giải mã của data URL base64. */
export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const payload = comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/** Kích thước sau khi thu nhỏ cho chiều ngang không quá `maxWidth`, giữ tỉ lệ. */
export function scaledImageSize(width: number, height: number, maxWidth = LAYOUT_IMAGE_MAX_WIDTH_PX): { width: number; height: number } {
  if (width <= maxWidth || width <= 0) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

export type LayoutImageResult = { readonly ok: true; readonly dataUrl: string } | { readonly ok: false; readonly message: string };

/** Phần phụ thuộc trình duyệt; kiểm thử thay được. */
export interface LayoutImageDeps {
  readonly readBytes: (file: Blob, length: number) => Promise<Uint8Array>;
  readonly readDataUrl: (file: Blob) => Promise<string>;
  /** Giải mã ảnh, trả kích thước và hàm vẽ lại ở kích thước mới thành data URL. */
  readonly decode: (
    dataUrl: string,
  ) => Promise<{ width: number; height: number; resize: (width: number, height: number, mime: LayoutImageMime, quality?: number) => string }>;
}

function readWith<T>(start: (reader: FileReader) => void, pick: (reader: FileReader) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(pick(reader));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    start(reader);
  });
}

export const browserImageDeps: LayoutImageDeps = {
  readBytes: (file, length) =>
    readWith(
      (reader) => reader.readAsArrayBuffer(file.slice(0, length)),
      (reader) => new Uint8Array(reader.result as ArrayBuffer),
    ),
  readDataUrl: (file) =>
    readWith(
      (reader) => reader.readAsDataURL(file),
      (reader) => String(reader.result ?? ''),
    ),
  decode: (dataUrl) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () =>
        resolve({
          width: image.naturalWidth,
          height: image.naturalHeight,
          resize: (width, height, mime, quality = 0.88) => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('canvas unavailable');
            if (mime === 'image/jpeg') {
              // JPEG không có nền trong suốt: tô trắng như giấy in.
              context.fillStyle = '#ffffff';
              context.fillRect(0, 0, width, height);
            }
            context.drawImage(image, 0, 0, width, height);
            return canvas.toDataURL(mime, quality);
          },
        });
      image.onerror = () => reject(new Error('decode failed'));
      image.src = dataUrl;
    }),
};

/** Đổi file người dùng chọn thành data URL hợp lệ cho bố cục (tự nén nếu cần), hoặc câu báo lỗi tiếng Việt. */
export async function readLayoutImage(file: File, deps: LayoutImageDeps = browserImageDeps): Promise<LayoutImageResult> {
  if (file.size > LAYOUT_IMAGE_MAX_SOURCE_BYTES) return { ok: false, message: LAYOUT_IMAGE_TOO_LARGE_MESSAGE };
  try {
    const mime = detectImageType(await deps.readBytes(file, 8));
    if (!mime) return { ok: false, message: LAYOUT_IMAGE_TYPE_MESSAGE };
    const original = (await deps.readDataUrl(file)).replace(/^data:[^;,]*;base64,/, `data:${mime};base64,`);
    const decoded = await deps.decode(original);
    const limit = QUOTE_LAYOUT_LIMITS.maxImageBytes;
    // Ảnh đã gọn thì giữ nguyên: không mất chất lượng, PNG giữ nền trong suốt.
    if (decoded.width <= LAYOUT_IMAGE_MAX_WIDTH_PX && dataUrlByteLength(original) <= limit) return { ok: true, dataUrl: original };
    let size = scaledImageSize(decoded.width, decoded.height);
    for (;;) {
      for (const quality of LAYOUT_IMAGE_JPEG_QUALITIES) {
        const dataUrl = decoded.resize(size.width, size.height, 'image/jpeg', quality);
        if (dataUrlByteLength(dataUrl) <= limit) return { ok: true, dataUrl };
      }
      if (size.width <= LAYOUT_IMAGE_MIN_WIDTH_PX) return { ok: false, message: LAYOUT_IMAGE_TOO_LARGE_MESSAGE };
      size = scaledImageSize(size.width, size.height, Math.max(LAYOUT_IMAGE_MIN_WIDTH_PX, Math.round(size.width * SHRINK_FACTOR)));
    }
  } catch {
    return { ok: false, message: LAYOUT_IMAGE_READ_MESSAGE };
  }
}
