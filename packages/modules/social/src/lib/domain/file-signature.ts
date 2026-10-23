/** Số byte đầu tệp cần đọc để đối chiếu chữ ký. */
export const FILE_SIGNATURE_HEAD_BYTES = 64;

function startsWith(head: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => head[offset + index] === byte);
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

/**
 * So khớp vài byte đầu tệp với kiểu đã khai báo, để chặn tệp giả kiểu (ví dụ
 * văn bản đặt tên `.png`). Trả `undefined` khi kiểu này không được kiểm.
 */
export function matchesFileSignature(contentType: string, head: Uint8Array): boolean | undefined {
  switch (contentType.toLowerCase()) {
    case 'image/jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif':
      return startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'));
    case 'image/webp':
      return startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8);
    case 'video/mp4':
      return startsWith(head, ascii('ftyp'), 4);
    case 'video/webm':
      return startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]);
    default:
      return undefined;
  }
}
