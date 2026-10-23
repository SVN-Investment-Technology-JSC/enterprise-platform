import { avatarProblem, detectAvatarImage } from './avatar-image.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0))));
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('ảnh đại diện', () => {
  it('nhận biết loại ảnh từ chữ ký đầu tệp', () => {
    expect(detectAvatarImage(PNG)).toBe('image/png');
    expect(detectAvatarImage(JPEG)).toBe('image/jpeg');
    expect(detectAvatarImage(new Uint8Array(WEBP))).toBe('image/webp');
    expect(detectAvatarImage(SVG)).toBeNull();
  });

  it('từ chối tệp rỗng, quá lớn hoặc không phải ảnh được hỗ trợ', () => {
    expect(avatarProblem(undefined)).toBe('missing');
    expect(avatarProblem(new Uint8Array())).toBe('missing');
    expect(avatarProblem(SVG)).toBe('unsupported');
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(PNG);
    expect(avatarProblem(big)).toBe('too-large');
    expect(avatarProblem(PNG)).toBeNull();
  });
});
