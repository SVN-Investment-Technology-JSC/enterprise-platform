import { MAX_RASTER_SIZE, svgToPng, withExplicitSize } from './rasterize';

describe('withExplicitSize', () => {
  it('thêm width và height vào thẻ gốc', () => {
    const out = withExplicitSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0" /></svg>', 48);
    expect(out).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48"><path d="M0 0" /></svg>');
  });

  it('thay width/height có sẵn nhưng không đụng stroke-width', () => {
    const out = withExplicitSize('<svg width="300" height=\'150\' viewBox="0 0 24 24" stroke-width="1.75">', 32);
    expect(out).toBe('<svg viewBox="0 0 24 24" stroke-width="1.75" width="32" height="32">');
  });

  it('chỉ sửa thẻ gốc, không đụng svg lồng bên trong', () => {
    const svg = '<svg viewBox="0 0 180 180"><svg x="18" width="144" height="144"></svg></svg>';
    expect(withExplicitSize(svg, 180)).toBe('<svg viewBox="0 0 180 180" width="180" height="180"><svg x="18" width="144" height="144"></svg></svg>');
  });

  it('thẻ gốc tự đóng vẫn đúng cú pháp', () => {
    expect(withExplicitSize('<svg viewBox="0 0 1 1" />', 16)).toBe('<svg viewBox="0 0 1 1" width="16" height="16"/>');
  });

  it('không có thẻ svg thì trả nguyên', () => {
    expect(withExplicitSize('không phải svg', 16)).toBe('không phải svg');
  });
});

type Handler = (() => void) | null;

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('không đọc được blob'));
    reader.readAsText(blob);
  });
}

describe('svgToPng', () => {
  const realImage = globalThis.Image;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const realRatio = window.devicePixelRatio;

  let loadFails = false;
  let createdBlobs: Blob[];
  let revoked: string[];
  let context: { clearRect: jest.Mock; drawImage: jest.Mock } | null;
  let canvases: HTMLCanvasElement[];
  let pngBytes: number[] | null;

  beforeEach(() => {
    loadFails = false;
    createdBlobs = [];
    revoked = [];
    canvases = [];
    context = { clearRect: jest.fn(), drawImage: jest.fn() };
    pngBytes = [0x89, 0x50, 0x4e, 0x47, 1, 2, 3];

    class FakeImage {
      onload: Handler = null;
      onerror: Handler = null;
      set src(_value: string) {
        queueMicrotask(() => (loadFails ? this.onerror?.() : this.onload?.()));
      }
    }
    (globalThis as unknown as { Image: unknown }).Image = FakeImage;
    URL.createObjectURL = jest.fn((blob: Blob | MediaSource) => {
      createdBlobs.push(blob as Blob);
      return `blob:fake-${createdBlobs.length}`;
    });
    URL.revokeObjectURL = jest.fn((url: string) => {
      revoked.push(url);
    });
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      canvases.push(this);
      return context as unknown as RenderingContext;
    });
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(pngBytes ? new Blob([new Uint8Array(pngBytes)], { type: 'image/png' }) : null);
    });
  });

  afterEach(() => {
    (globalThis as unknown as { Image: unknown }).Image = realImage;
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    Object.defineProperty(window, 'devicePixelRatio', { value: realRatio, configurable: true });
    jest.restoreAllMocks();
  });

  it('vẽ đúng cạnh yêu cầu và trả về byte PNG', async () => {
    const png = await svgToPng('<svg viewBox="0 0 24 24"></svg>', 48);
    expect([...png]).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(canvases).toHaveLength(1);
    expect(canvases[0].width).toBe(48);
    expect(canvases[0].height).toBe(48);
    expect(context?.clearRect).toHaveBeenCalledWith(0, 0, 48, 48);
    expect(context?.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 48, 48);
  });

  it('không nhân devicePixelRatio vào kích thước ảnh', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
    await svgToPng('<svg viewBox="0 0 24 24"></svg>', 32);
    expect(canvases[0].width).toBe(32);
    expect(canvases[0].height).toBe(32);
  });

  it('SVG đưa vào trình duyệt có kích thước tường minh và mã hoá UTF-8', async () => {
    await svgToPng('<svg viewBox="0 0 24 24"><!-- Đơn hàng --></svg>', 16);
    expect(createdBlobs).toHaveLength(1);
    expect(createdBlobs[0].type).toBe('image/svg+xml;charset=utf-8');
    expect(await readBlob(createdBlobs[0])).toBe('<svg viewBox="0 0 24 24" width="16" height="16"><!-- Đơn hàng --></svg>');
  });

  it('giải phóng URL tạm sau khi thành công', async () => {
    await svgToPng('<svg></svg>', 16);
    expect(revoked).toEqual(['blob:fake-1']);
  });

  it('SVG không đọc được: báo lỗi gọn và vẫn giải phóng URL', async () => {
    loadFails = true;
    await expect(svgToPng('<svg></svg>', 16)).rejects.toThrow('Không đọc được SVG');
    expect(revoked).toEqual(['blob:fake-1']);
  });

  it('không có canvas 2d: báo lỗi và giải phóng URL', async () => {
    context = null;
    await expect(svgToPng('<svg></svg>', 16)).rejects.toThrow('canvas');
    expect(revoked).toHaveLength(1);
  });

  it('trình duyệt không tạo được PNG: báo lỗi và giải phóng URL', async () => {
    pngBytes = null;
    await expect(svgToPng('<svg></svg>', 16)).rejects.toThrow('PNG');
    expect(revoked).toHaveLength(1);
  });

  it('từ chối cạnh không hợp lệ trước khi tạo URL', async () => {
    for (const size of [0, -1, 1.5, Number.NaN, MAX_RASTER_SIZE + 1]) {
      await expect(svgToPng('<svg></svg>', size)).rejects.toThrow('Cạnh ảnh');
    }
    expect(createdBlobs).toHaveLength(0);
  });
});
