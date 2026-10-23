import { matchesFileSignature } from './file-signature.js';

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => Uint8Array.from([...value].map((char) => char.charCodeAt(0)));

describe('matchesFileSignature', () => {
  it('nhận đúng chữ ký của từng kiểu', () => {
    expect(matchesFileSignature('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(matchesFileSignature('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
    expect(matchesFileSignature('image/gif', text('GIF89a....'))).toBe(true);
    expect(matchesFileSignature('image/gif', text('GIF87a....'))).toBe(true);
    expect(matchesFileSignature('image/webp', text('RIFF\0\0\0\0WEBPVP8 '))).toBe(true);
    expect(matchesFileSignature('video/mp4', text('\0\0\0\x18ftypisom'))).toBe(true);
    expect(matchesFileSignature('video/webm', bytes(0x1a, 0x45, 0xdf, 0xa3, 1))).toBe(true);
  });

  it('từ chối nội dung không khớp hoặc quá ngắn', () => {
    expect(matchesFileSignature('image/png', text('đây là chữ, không phải ảnh'))).toBe(false);
    expect(matchesFileSignature('image/jpeg', bytes(0xff, 0xd8))).toBe(false);
    expect(matchesFileSignature('image/webp', text('RIFF\0\0\0\0WAVE'))).toBe(false);
    expect(matchesFileSignature('video/mp4', text('hello world'))).toBe(false);
    expect(matchesFileSignature('video/webm', new Uint8Array())).toBe(false);
  });

  it('kiểu khác không kiểm', () => {
    expect(matchesFileSignature('application/pdf', text('bất kỳ'))).toBeUndefined();
  });
});
