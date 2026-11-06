import {
  LAYOUT_IMAGE_READ_MESSAGE,
  LAYOUT_IMAGE_TOO_LARGE_MESSAGE,
  LAYOUT_IMAGE_TYPE_MESSAGE,
  dataUrlByteLength,
  detectImageType,
  readLayoutImage,
  scaledImageSize,
  type LayoutImageDeps,
} from './layout-image';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0];
const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
const SVG_HEAD = Array.from('<svg xml', (char) => char.charCodeAt(0));

/** Data URL có đúng `bytes` byte sau giải mã. */
const dataUrlOf = (mime: string, bytes: number) => `data:${mime};base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`;

function deps(head: number[], options: { width: number; bytes: number; resizedBytes?: number; mime?: string }) {
  const resize = jest.fn((_width: number, _height: number, mime: string) => dataUrlOf(mime, options.resizedBytes ?? options.bytes));
  const value: LayoutImageDeps = {
    readBytes: async () => new Uint8Array(head),
    readDataUrl: async () => dataUrlOf(options.mime ?? 'image/png', options.bytes),
    decode: async () => ({ width: options.width, height: options.width / 2, resize }),
  };
  return { value, resize };
}

const file = (size: number, type = 'image/png') => {
  const blob = new File(['x'], 'anh.png', { type });
  Object.defineProperty(blob, 'size', { value: size });
  return blob;
};

describe('layout-image', () => {
  it('nhận diện PNG, JPEG theo chữ ký đầu file', () => {
    expect(detectImageType(new Uint8Array(PNG_HEAD))).toBe('image/png');
    expect(detectImageType(new Uint8Array(JPEG_HEAD))).toBe('image/jpeg');
    expect(detectImageType(new Uint8Array(PDF_HEAD))).toBeNull();
    expect(detectImageType(new Uint8Array(SVG_HEAD))).toBeNull();
  });

  it('kích thước sau giải mã và thu nhỏ giữ tỉ lệ', () => {
    expect(dataUrlByteLength('data:image/png;base64,QUJD')).toBe(3);
    expect(dataUrlByteLength('data:image/png;base64,QUI=')).toBe(2);
    expect(dataUrlByteLength('data:image/png;base64,QQ==')).toBe(1);
    expect(scaledImageSize(2000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(scaledImageSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('TC-DS-11: PNG 200 KB nhận nguyên, không thu nhỏ', async () => {
    const { value, resize } = deps(PNG_HEAD, { width: 600, bytes: 200 * 1024 });
    const result = await readLayoutImage(file(200 * 1024), value);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(resize).not.toHaveBeenCalled();
  });

  it('TC-DS-11: ảnh rộng hơn 1.000 px tự thu nhỏ; sau đó ≤ 300 KB thì nhận, vẫn quá thì báo lỗi', async () => {
    const small = deps(JPEG_HEAD, { width: 4000, bytes: 5 * 1024 * 1024, resizedBytes: 180 * 1024, mime: 'image/jpeg' });
    const accepted = await readLayoutImage(file(5 * 1024 * 1024, 'image/jpeg'), small.value);
    expect(small.resize).toHaveBeenCalledWith(1000, 500, 'image/jpeg');
    expect(accepted.ok).toBe(true);
    const big = deps(PNG_HEAD, { width: 2000, bytes: 500 * 1024, resizedBytes: 400 * 1024 });
    expect(await readLayoutImage(file(500 * 1024), big.value)).toEqual({ ok: false, message: LAYOUT_IMAGE_TOO_LARGE_MESSAGE });
    expect(LAYOUT_IMAGE_TOO_LARGE_MESSAGE.startsWith('Ảnh vượt 300 KB')).toBe(true);
  });

  it('TC-DS-11: ảnh nhỏ px nhưng quá 300 KB thì báo lỗi', async () => {
    const { value } = deps(PNG_HEAD, { width: 900, bytes: 310 * 1024 });
    expect(await readLayoutImage(file(310 * 1024), value)).toEqual({ ok: false, message: LAYOUT_IMAGE_TOO_LARGE_MESSAGE });
  });

  it('TC-DS-11: SVG, PDF đổi đuôi .png bị từ chối dù trình duyệt báo image/png', async () => {
    const pdf = deps(PDF_HEAD, { width: 100, bytes: 1000 });
    expect(await readLayoutImage(file(1000), pdf.value)).toEqual({ ok: false, message: LAYOUT_IMAGE_TYPE_MESSAGE });
    const svg = deps(SVG_HEAD, { width: 100, bytes: 1000 });
    expect(await readLayoutImage(file(1000, 'image/svg+xml'), svg.value)).toEqual({ ok: false, message: LAYOUT_IMAGE_TYPE_MESSAGE });
  });

  it('giải mã lỗi thì báo không đọc được ảnh', async () => {
    const { value } = deps(PNG_HEAD, { width: 100, bytes: 100 });
    const broken: LayoutImageDeps = { ...value, decode: () => Promise.reject(new Error('x')) };
    expect(await readLayoutImage(file(100), broken)).toEqual({ ok: false, message: LAYOUT_IMAGE_READ_MESSAGE });
  });
});
