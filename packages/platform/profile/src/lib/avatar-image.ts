import { AVATAR_MAX_UPLOAD_BYTES } from '@enterprise-platform/contracts-chat';

export type AvatarImageType = 'image/png' | 'image/jpeg' | 'image/webp';

const EXTENSIONS: Readonly<Record<AvatarImageType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function avatarExtension(type: AvatarImageType): string {
  return EXTENSIONS[type];
}

/**
 * Loại ảnh đọc từ chữ ký đầu tệp, không tin `Content-Type` hay đuôi tên tệp do trình duyệt gửi: tệp khác (HTML,
 * SVG có script...) đổi tên thành .png vẫn bị từ chối, nên ảnh trả lại cho người khác không chạy được gì.
 */
export function detectAvatarImage(bytes: Uint8Array): AvatarImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export type AvatarProblem = 'missing' | 'too-large' | 'unsupported';

export function avatarProblem(bytes: Uint8Array | undefined): AvatarProblem | null {
  if (!bytes || bytes.length === 0) return 'missing';
  if (bytes.length > AVATAR_MAX_UPLOAD_BYTES) return 'too-large';
  return detectAvatarImage(bytes) ? null : 'unsupported';
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
