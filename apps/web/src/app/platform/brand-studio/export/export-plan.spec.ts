import { createDocument, createShape, DEFAULT_PALETTE, type IconDocument } from '@enterprise-platform/shared-brand-icon';
import { TextEncoder as NodeTextEncoder } from 'node:util';
import {
  archiveBaseName,
  baseName,
  DEFAULT_CHOICE,
  estimatePngBytes,
  estimateRasterize,
  formatBytes,
  limitList,
  mimeOf,
  planExport,
  resolveFaviconDocId,
  runExport,
  toggleFormat,
  usesColorMode,
  utf8Length,
} from './export-plan';

// jsdom không có TextEncoder (trình duyệt thật thì có); createZip cần nó khi chạy trong test.
if (typeof globalThis.TextEncoder === 'undefined') Object.assign(globalThis, { TextEncoder: NodeTextEncoder });

function makeDoc(id: string, name: string): IconDocument {
  return createDocument({
    id,
    name,
    shapes: [createShape({ type: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 3 }, { stroke: 'brand:sapphire' })],
  });
}

const docs = [makeDoc('a', 'Nhà kho'), makeDoc('b', 'Hóa đơn')];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('lựa chọn định dạng', () => {
  it('toggleFormat bật tắt và giữ thứ tự chuẩn', () => {
    expect(toggleFormat(['svg'], 'favicon')).toEqual(['svg', 'favicon']);
    expect(toggleFormat(['favicon'], 'svg')).toEqual(['svg', 'favicon']);
    expect(toggleFormat(['svg', 'json', 'tsx'], 'tsx')).toEqual(['svg', 'json']);
    expect(toggleFormat(['svg'], 'svg')).toEqual([]);
  });

  it('chế độ màu chỉ áp dụng cho svg, tsx, sprite', () => {
    expect(usesColorMode(['svg'])).toBe(true);
    expect(usesColorMode(['json', 'sprite'])).toBe(true);
    expect(usesColorMode(['json', 'favicon'])).toBe(false);
    expect(usesColorMode([])).toBe(false);
  });

  it('resolveFaviconDocId lấy icon đã chọn, không có thì icon đầu', () => {
    expect(resolveFaviconDocId(docs, 'b')).toBe('b');
    expect(resolveFaviconDocId(docs, 'zzz')).toBe('a');
    expect(resolveFaviconDocId(docs, undefined)).toBe('a');
    expect(resolveFaviconDocId([], 'a')).toBe('');
  });

  it('mặc định chỉ xuất SVG theo ngữ cảnh', () => {
    expect(DEFAULT_CHOICE).toEqual({ formats: ['svg'], colorMode: 'currentColor' });
  });
});

describe('ước tính dung lượng', () => {
  it('estimatePngBytes tăng theo cạnh và có mức tối thiểu', () => {
    expect(estimatePngBytes(1)).toBeGreaterThanOrEqual(64);
    expect(estimatePngBytes(512)).toBeGreaterThan(estimatePngBytes(192));
    expect(estimatePngBytes(192)).toBeGreaterThan(estimatePngBytes(16));
  });

  it('estimateRasterize trả PNG có chữ ký và độ dài ước tính', async () => {
    const png = await estimateRasterize('<svg />', 192);
    expect([...png.subarray(0, 8)]).toEqual(PNG);
    expect(png.length).toBe(estimatePngBytes(192));
  });

  it('utf8Length khớp số byte thật, kể cả dấu tiếng Việt và ký tự ngoài BMP', () => {
    for (const text of ['', 'abc', 'Đơn hàng ắ ề ỗ', '<!-- ❤ -->', 'a\u{1F600}b']) {
      expect(utf8Length(text)).toBe(Buffer.byteLength(text, 'utf8'));
    }
  });

  it('formatBytes dùng dấu phẩy thập phân kiểu Việt', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3,5 MB');
  });
});

describe('tên tệp', () => {
  it('baseName và mimeOf theo đuôi', () => {
    expect(baseName('svg/nha-kho.svg')).toBe('nha-kho.svg');
    expect(baseName('icons.json')).toBe('icons.json');
    expect(mimeOf('svg/a.svg')).toBe('image/svg+xml');
    expect(mimeOf('icons.json')).toBe('application/json');
    expect(mimeOf('favicon/favicon.ico')).toBe('image/x-icon');
    expect(mimeOf('favicon/site.webmanifest')).toBe('application/manifest+json');
    expect(mimeOf('x.zip')).toBe('application/zip');
    expect(mimeOf('khong-co-duoi')).toBe('application/octet-stream');
  });

  it('archiveBaseName theo nội dung xuất', () => {
    expect(archiveBaseName(docs, ['svg', 'tsx'])).toBe('svndts-icons');
    expect(archiveBaseName([docs[0]], ['svg', 'tsx'])).toBe('svndts-nha-kho');
    expect(archiveBaseName(docs, ['favicon'])).toBe('svndts-favicon');
    expect(archiveBaseName([docs[0]], ['favicon'])).toBe('svndts-favicon');
  });

  it('limitList cắt phần dư', () => {
    expect(limitList([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], hidden: 2 });
    expect(limitList([1, 2], 3)).toEqual({ shown: [1, 2], hidden: 0 });
  });
});

describe('planExport', () => {
  it('nhiều icon: đếm đúng tệp, dung lượng chữ là chính xác, tải về dạng zip', async () => {
    const plan = await planExport(docs, DEFAULT_PALETTE, { formats: ['svg'], colorMode: 'currentColor' });
    expect(plan.files.map((file) => file.path)).toEqual(['svg/nha-kho.svg', 'svg/hoa-don.svg']);
    expect(plan.files.every((file) => !file.estimated && file.bytes > 0)).toBe(true);
    expect(plan.totalBytes).toBe(plan.files.reduce((sum, file) => sum + file.bytes, 0));
    expect(plan.asZip).toBe(true);
    expect(plan.downloadName).toBe('svndts-icons.zip');
    expect(plan.downloadBytes).toBeGreaterThan(plan.totalBytes);
    expect(plan.warnings).toEqual([]);
  });

  it('một tệp: tải thẳng, tên tệp là tên icon, không cộng phần đầu zip', async () => {
    const plan = await planExport([docs[0]], DEFAULT_PALETTE, { formats: ['svg'], colorMode: 'brand' });
    expect(plan.files).toHaveLength(1);
    expect(plan.asZip).toBe(false);
    expect(plan.downloadName).toBe('nha-kho.svg');
    expect(plan.downloadBytes).toBe(plan.totalBytes);
  });

  it('favicon: đủ 9 tệp, PNG và ICO chỉ là ước tính', async () => {
    const plan = await planExport(docs, DEFAULT_PALETTE, { formats: ['favicon'], colorMode: 'currentColor', faviconDocId: 'b' });
    expect(plan.files).toHaveLength(9);
    const byPath = new Map(plan.files.map((file) => [file.path, file]));
    expect(byPath.get('favicon/icon-512.png')).toEqual({
      path: 'favicon/icon-512.png',
      bytes: estimatePngBytes(512),
      estimated: true,
    });
    expect(byPath.get('favicon/favicon.ico')?.estimated).toBe(true);
    expect(byPath.get('favicon/head.html')?.estimated).toBe(false);
    expect(plan.downloadName).toBe('svndts-favicon.zip');
  });

  it('tên trùng được báo trong cảnh báo', async () => {
    const plan = await planExport([makeDoc('a', 'Home'), makeDoc('b', 'Home')], DEFAULT_PALETTE, {
      formats: ['svg'],
      colorMode: 'currentColor',
    });
    expect(plan.files.map((file) => file.path)).toEqual(['svg/home.svg', 'svg/home-2.svg']);
    expect(plan.warnings).toHaveLength(1);
  });

  it('chưa chọn định dạng hoặc chưa có icon: không có tệp, có cảnh báo', async () => {
    const none = await planExport(docs, DEFAULT_PALETTE, { formats: [], colorMode: 'currentColor' });
    expect(none.files).toEqual([]);
    expect(none.warnings).toHaveLength(1);
    const empty = await planExport([], DEFAULT_PALETTE, DEFAULT_CHOICE);
    expect(empty.files).toEqual([]);
    expect(empty.warnings).toHaveLength(1);
  });
});

describe('runExport', () => {
  const fakeRasterize = jest.fn(async (_svg: string, size: number) => new Uint8Array([...PNG, size & 0xff]));

  beforeEach(() => fakeRasterize.mockClear());

  it('một tệp: trả thẳng nội dung, không đóng zip', async () => {
    const result = await runExport([docs[0]], DEFAULT_PALETTE, { formats: ['svg'], colorMode: 'currentColor' }, fakeRasterize);
    expect(result.filename).toBe('nha-kho.svg');
    expect(result.mime).toBe('image/svg+xml');
    expect(typeof result.data).toBe('string');
    expect(result.data as string).toContain('<svg');
    expect(result.fileCount).toBe(1);
    expect(fakeRasterize).not.toHaveBeenCalled();
  });

  it('nhiều tệp: đóng zip có thư mục gốc', async () => {
    const result = await runExport(docs, DEFAULT_PALETTE, { formats: ['svg', 'json'], colorMode: 'currentColor' }, fakeRasterize);
    expect(result.filename).toBe('svndts-icons.zip');
    expect(result.mime).toBe('application/zip');
    expect(result.fileCount).toBe(3);
    const bytes = result.data as Uint8Array;
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = Buffer.from(bytes).toString('latin1');
    expect(text).toContain('svndts-icons/svg/nha-kho.svg');
    expect(text).toContain('svndts-icons/icons.json');
  });

  it('favicon dùng bộ vẽ truyền vào cho từng cạnh', async () => {
    const result = await runExport(docs, DEFAULT_PALETTE, { formats: ['favicon'], colorMode: 'brand' }, fakeRasterize);
    expect(fakeRasterize.mock.calls.map((call) => call[1])).toEqual([16, 32, 48, 180, 192, 512]);
    expect(result.filename).toBe('svndts-favicon.zip');
    expect(result.fileCount).toBe(9);
    expect(result.warnings).toEqual([]);
  });

  it('một cạnh vẽ lỗi vẫn xuất phần còn lại, kèm cảnh báo', async () => {
    const flaky = jest.fn(async (_svg: string, size: number) => {
      if (size === 512) throw new Error('hết bộ nhớ');
      return new Uint8Array([...PNG, 1]);
    });
    const result = await runExport(docs, DEFAULT_PALETTE, { formats: ['favicon'], colorMode: 'brand' }, flaky);
    // Thiếu icon-512 nên không có site.webmanifest: còn svg, ico, 16, 32, 180, 192 và head.html.
    expect(result.fileCount).toBe(7);
    expect(result.warnings).toEqual(['Không tạo được ảnh 512px: hết bộ nhớ']);
  });

  it('không có gì để xuất thì báo lỗi bằng lý do đầu tiên', async () => {
    await expect(runExport([], DEFAULT_PALETTE, DEFAULT_CHOICE, fakeRasterize)).rejects.toThrow('Chưa có icon');
    await expect(runExport(docs, DEFAULT_PALETTE, { formats: [], colorMode: 'brand' }, fakeRasterize)).rejects.toThrow('Chưa chọn');
  });
});
