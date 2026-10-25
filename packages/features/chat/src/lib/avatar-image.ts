import { AVATAR_CONTENT_TYPES, AVATAR_MAX_SOURCE_BYTES, AVATAR_MAX_UPLOAD_BYTES, AVATAR_SIZE_PX } from '@enterprise-platform/contracts-chat';

/** Lỗi ảnh người dùng chọn; null khi ảnh dùng được. */
export function avatarSourceProblem(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(AVATAR_CONTENT_TYPES as readonly string[]).includes(file.type)) return 'Chỉ nhận ảnh PNG, JPG hoặc WebP.';
  if (file.size > AVATAR_MAX_SOURCE_BYTES) return `Ảnh tối đa ${Math.round(AVATAR_MAX_SOURCE_BYTES / 1024 / 1024)} MB.`;
  if (file.size === 0) return 'Ảnh rỗng.';
  return null;
}

/** Vùng cắt vuông ở giữa ảnh. */
export function centerSquare(width: number, height: number): { sx: number; sy: number; side: number } {
  const side = Math.min(width, height);
  return { sx: Math.round((width - side) / 2), sy: Math.round((height - side) / 2), side };
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không đọc được ảnh. Hãy chọn ảnh khác.'));
    };
    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Cắt vuông ở giữa và thu về `AVATAR_SIZE_PX` ngay trên trình duyệt, xuất WebP (không hỗ trợ thì JPEG). Ảnh gửi lên máy
 * chủ vì thế luôn nhỏ (thường dưới 100 KB) và đúng định dạng; ảnh gốc tối đa 5 MB không phải đi qua mạng.
 */
export async function prepareAvatarImage(file: File): Promise<Blob> {
  const problem = avatarSourceProblem(file);
  if (problem) throw new Error(problem);
  const image = await loadImage(file);
  const { sx, sy, side } = centerSquare(image.naturalWidth, image.naturalHeight);
  if (side < 32) throw new Error('Ảnh quá nhỏ. Chọn ảnh từ 32x32 điểm ảnh trở lên.');
  const size = Math.min(AVATAR_SIZE_PX, side);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Trình duyệt không xử lý được ảnh.');
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  for (const [type, quality] of [
    ['image/webp', 0.9],
    ['image/jpeg', 0.9],
    ['image/jpeg', 0.75],
  ] as const) {
    const blob = await toBlob(canvas, type, quality);
    if (blob && blob.type === type && blob.size <= AVATAR_MAX_UPLOAD_BYTES) return blob;
  }
  throw new Error('Không nén được ảnh. Hãy chọn ảnh khác.');
}
