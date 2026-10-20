import { buildExportBundle, FAVICON_RASTER_SIZES, withWhiteBackground, type ExportBundle, type ExportFile } from './bundle';
import { createDocument, createShape, type IconDocument } from './model';
import { DEFAULT_PALETTE } from './palette';
import { parseLibraryJson } from './validate';
import { createZip } from './zip';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function makeDoc(id: string, name: string, overrides: Partial<IconDocument> = {}): IconDocument {
  return createDocument({
    id,
    name,
    description: `Mô tả ${name}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    shapes: [
      createShape({ type: 'rect', x: 4, y: 4, width: 16, height: 16, rx: 3 }, { id: `${id}-r`, stroke: 'brand:sapphire' }),
      createShape({ type: 'ellipse', cx: 12, cy: 12, rx: 3, ry: 3 }, { id: `${id}-c`, fill: 'currentColor', stroke: 'none' }),
    ],
    ...overrides,
  });
}

interface RasterCall {
  svg: string;
  size: number;
}

/** Bộ vẽ PNG giả: ghi lại lời gọi và trả về PNG có chữ ký, chứa cạnh ảnh ở byte cuối. */
function fakeRasterize(calls: RasterCall[] = [], failSizes: readonly number[] = []) {
  return async (svg: string, size: number): Promise<Uint8Array> => {
    calls.push({ svg, size });
    if (failSizes.includes(size)) throw new Error(`lỗi ở ${size}`);
    return new Uint8Array([...SIGNATURE, size & 0xff, size >> 8]);
  };
}

const paths = (bundle: ExportBundle) => bundle.files.map((file) => file.path);
const text = (file: ExportFile | undefined): string => {
  if (!file) throw new Error('thiếu tệp');
  return typeof file.data === 'string' ? file.data : new TextDecoder().decode(file.data);
};
const fileOf = (bundle: ExportBundle, path: string) => bundle.files.find((file) => file.path === path);

describe('buildExportBundle: svg', () => {
  const docs = [makeDoc('a', 'Nhà kho'), makeDoc('b', 'Hóa đơn')];

  it('mỗi icon một tệp .svg, tên bỏ dấu', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['svg'] });
    expect(paths(bundle)).toEqual(['svg/nha-kho.svg', 'svg/hoa-don.svg']);
    expect(bundle.warnings).toEqual([]);
  });

  it('chế độ currentColor: mọi màu theo chữ xung quanh', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['svg'], colorMode: 'currentColor' });
    const svg = text(fileOf(bundle, 'svg/nha-kho.svg'));
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toContain('#2563eb');
  });

  it('chế độ brand: ghi cứng màu từ bảng màu', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['svg'], colorMode: 'brand', palette: DEFAULT_PALETTE });
    expect(text(fileOf(bundle, 'svg/nha-kho.svg'))).toContain('stroke="#2563eb"');
  });

  it('dùng bảng màu truyền vào', async () => {
    const palette = { tokens: [{ key: 'sapphire', label: 'Xanh', hex: '#112233' }] };
    const bundle = await buildExportBundle(docs, { formats: ['svg'], colorMode: 'brand', palette });
    expect(text(fileOf(bundle, 'svg/nha-kho.svg'))).toContain('#112233');
  });
});

describe('buildExportBundle: tsx', () => {
  it('mỗi icon một component và có index.ts', async () => {
    const docs = [makeDoc('a', 'Nhà kho'), makeDoc('b', 'Hóa đơn')];
    const bundle = await buildExportBundle(docs, { formats: ['tsx'] });
    expect(paths(bundle)).toEqual(['react/nha-kho.tsx', 'react/hoa-don.tsx', 'react/index.ts']);
    expect(text(fileOf(bundle, 'react/nha-kho.tsx'))).toContain('export function NhaKhoIcon(');
    const index = text(fileOf(bundle, 'react/index.ts'));
    expect(index).toContain("export { NhaKhoIcon } from './nha-kho';");
    expect(index).toContain("export { HoaDonIcon } from './hoa-don';");
  });
});

describe('buildExportBundle: tên trùng', () => {
  it('đổi tên tệp và component khi trùng slug', async () => {
    const docs = [makeDoc('a', 'Home'), makeDoc('b', 'home'), makeDoc('c', 'HOME'), makeDoc('d', 'Hóa đơn'), makeDoc('e', 'Hoa don')];
    const bundle = await buildExportBundle(docs, { formats: ['svg', 'tsx', 'sprite'] });

    const all = paths(bundle);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(
      expect.arrayContaining(['svg/home.svg', 'svg/home-2.svg', 'svg/home-3.svg', 'svg/hoa-don.svg', 'svg/hoa-don-2.svg']),
    );
    expect(bundle.warnings.filter((warning) => warning.includes('trùng'))).toHaveLength(3);

    const names = [...docs.keys()].map((index) => {
      const slug = ['home', 'home-2', 'home-3', 'hoa-don', 'hoa-don-2'][index];
      const match = /export function (\w+)\(/.exec(text(fileOf(bundle, `react/${slug}.tsx`)));
      return match?.[1];
    });
    expect(new Set(names).size).toBe(5);
    const index = text(fileOf(bundle, 'react/index.ts'));
    for (const name of names) expect(index).toContain(`export { ${name} }`);

    const sprite = text(fileOf(bundle, 'sprite.svg'));
    const ids = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('tên khác nhau nhưng trùng tên component vẫn được tách', async () => {
    const docs = [makeDoc('a', 'icon 1'), makeDoc('b', '1')];
    const bundle = await buildExportBundle(docs, { formats: ['tsx'] });
    const exported = [...text(fileOf(bundle, 'react/index.ts')).matchAll(/export \{ (\w+) \}/g)].map((match) => match[1]);
    expect(exported).toHaveLength(2);
    expect(new Set(exported).size).toBe(2);
  });

  it('tên "Index" không đè index.ts', async () => {
    const bundle = await buildExportBundle([makeDoc('a', 'Index')], { formats: ['tsx'] });
    expect(paths(bundle)).toEqual(['react/index-2.tsx', 'react/index.ts']);
  });

  it('tên rất dài vẫn tách được', async () => {
    const long = 'a'.repeat(120);
    const docs = [makeDoc('a', long), makeDoc('b', long), makeDoc('c', long)];
    const bundle = await buildExportBundle(docs, { formats: ['svg'] });
    expect(new Set(paths(bundle)).size).toBe(3);
  });
});

describe('buildExportBundle: sprite và json', () => {
  const docs = [makeDoc('a', 'Nhà kho'), makeDoc('b', 'Hóa đơn')];

  it('sprite.svg chứa một symbol cho mỗi icon', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['sprite'] });
    expect(paths(bundle)).toEqual(['sprite.svg']);
    const sprite = text(fileOf(bundle, 'sprite.svg'));
    expect(sprite.match(/<symbol /g)).toHaveLength(2);
    expect(sprite).toContain('id="svndts-nha-kho"');
  });

  it('icons.json nạp lại được bằng bộ đọc thư viện', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['json'] });
    expect(paths(bundle)).toEqual(['icons.json']);
    const parsed = parseLibraryJson(text(fileOf(bundle, 'icons.json')));
    expect(parsed.skipped).toBe(0);
    expect(parsed.docs.map((doc) => doc.id)).toEqual(['a', 'b']);
    expect(parsed.docs[0].shapes).toHaveLength(2);
  });

  it('json giữ nguyên tên gốc, không đổi theo dedupe', async () => {
    const dup = [makeDoc('a', 'Home'), makeDoc('b', 'Home')];
    const bundle = await buildExportBundle(dup, { formats: ['json'] });
    expect(parseLibraryJson(text(fileOf(bundle, 'icons.json'))).docs.map((doc) => doc.name)).toEqual(['Home', 'Home']);
    expect(bundle.warnings).toEqual([]);
  });
});

describe('buildExportBundle: favicon', () => {
  const docs = [makeDoc('a', 'Nhà kho'), makeDoc('b', 'Hóa đơn')];
  const FULL = [
    'favicon/favicon.svg',
    'favicon/favicon.ico',
    'favicon/favicon-16x16.png',
    'favicon/favicon-32x32.png',
    'favicon/apple-touch-icon.png',
    'favicon/icon-192.png',
    'favicon/icon-512.png',
    'favicon/site.webmanifest',
    'favicon/head.html',
  ];

  it('thiếu rasterize: chỉ có SVG và head.html, kèm cảnh báo', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['favicon'] });
    expect(paths(bundle)).toEqual(['favicon/favicon.svg', 'favicon/head.html']);
    expect(bundle.warnings).toHaveLength(1);
    expect(bundle.warnings[0]).toMatch(/PNG/);
    const head = text(fileOf(bundle, 'favicon/head.html'));
    expect(head).toContain('href="/favicon.svg"');
    expect(head).not.toContain('manifest');
    expect(head).not.toContain('apple-touch-icon');
  });

  it('favicon.svg luôn dùng màu thật, không còn currentColor', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['favicon'], colorMode: 'currentColor' });
    const svg = text(fileOf(bundle, 'favicon/favicon.svg'));
    expect(svg).not.toContain('currentColor');
    expect(svg).toContain('#2563eb');
  });

  it('faviconInk thay màu cho currentColor', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['favicon'], faviconInk: '#abc' });
    expect(text(fileOf(bundle, 'favicon/favicon.svg'))).toContain('#aabbcc');
  });

  it('có rasterize: đủ bộ tệp theo thứ tự', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['favicon'], rasterize: fakeRasterize() });
    expect(paths(bundle)).toEqual(FULL);
    expect(bundle.warnings).toEqual([]);
  });

  it('vẽ mỗi cạnh một lần; riêng apple-touch-icon có nền trắng', async () => {
    const calls: RasterCall[] = [];
    await buildExportBundle(docs, { formats: ['favicon'], rasterize: fakeRasterize(calls) });
    expect(calls.map((call) => call.size)).toEqual([...FAVICON_RASTER_SIZES]);
    expect(FAVICON_RASTER_SIZES).toEqual([16, 32, 48, 180, 192, 512]);
    for (const call of calls) {
      if (call.size === 180) expect(call.svg).toContain('<rect width="180" height="180" fill="#ffffff"');
      else expect(call.svg).not.toContain('<rect width=');
    }
  });

  it('favicon.ico gồm 3 ảnh 16, 32, 48 lấy từ PNG đã vẽ', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['favicon'], rasterize: fakeRasterize() });
    const ico = fileOf(bundle, 'favicon/favicon.ico')?.data;
    if (!(ico instanceof Uint8Array)) throw new Error('favicon.ico phải là nhị phân');
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(3);
    expect([0, 1, 2].map((i) => view.getUint8(6 + 16 * i))).toEqual([16, 32, 48]);
    const first = view.getUint32(6 + 12, true);
    expect(ico[first + 8]).toBe(16);
  });

  it('site.webmanifest và head.html trỏ đúng tệp', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['favicon'], rasterize: fakeRasterize(), appName: 'Kho SVNDTS', faviconBasePath: '/static' });
    const manifest = JSON.parse(text(fileOf(bundle, 'favicon/site.webmanifest')));
    expect(manifest.name).toBe('Kho SVNDTS');
    expect(manifest.icons).toEqual([
      { src: '/static/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/static/icon-512.png', sizes: '512x512', type: 'image/png' },
    ]);
    const head = text(fileOf(bundle, 'favicon/head.html'));
    expect(head).toContain('href="/static/favicon.ico"');
    expect(head).toContain('rel="apple-touch-icon" href="/static/apple-touch-icon.png"');
    expect(head).toContain('rel="manifest" href="/static/site.webmanifest"');
    expect(head).toContain('sizes="32x32"');
  });

  it('chọn icon bằng faviconDocId; mã lạ thì dùng icon đầu và cảnh báo', async () => {
    const distinct = [
      makeDoc('a', 'Nhà kho', { shapes: [createShape({ type: 'rect', x: 1, y: 1, width: 5, height: 5, rx: 0 }, { stroke: '#111111' })] }),
      makeDoc('b', 'Hóa đơn', { shapes: [createShape({ type: 'rect', x: 2, y: 2, width: 7, height: 7, rx: 0 }, { stroke: '#222222' })] }),
    ];
    const picked = await buildExportBundle(distinct, { formats: ['favicon'], faviconDocId: 'b' });
    expect(text(fileOf(picked, 'favicon/favicon.svg'))).toContain('#222222');
    expect(picked.warnings.some((warning) => warning.includes('Không tìm thấy icon'))).toBe(false);

    const missing = await buildExportBundle(distinct, { formats: ['favicon'], faviconDocId: 'zzz' });
    expect(text(fileOf(missing, 'favicon/favicon.svg'))).toContain('#111111');
    expect(missing.warnings.some((warning) => warning.includes('Không tìm thấy icon'))).toBe(true);
  });

  it('một cạnh vẽ lỗi: bỏ tệp đó, cảnh báo, các tệp khác vẫn có', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['favicon'], rasterize: fakeRasterize([], [512]) });
    const all = paths(bundle);
    expect(all).not.toContain('favicon/icon-512.png');
    expect(all).not.toContain('favicon/site.webmanifest');
    expect(all).toEqual(expect.arrayContaining(['favicon/favicon.ico', 'favicon/icon-192.png', 'favicon/favicon.svg']));
    expect(bundle.warnings).toEqual(['Không tạo được ảnh 512px: lỗi ở 512']);
  });

  it('cạnh của ICO vẽ lỗi thì ICO chỉ còn các ảnh vẽ được; mất cả ba thì bỏ ICO', async () => {
    const some = await buildExportBundle(docs, { formats: ['favicon'], rasterize: fakeRasterize([], [48]) });
    const ico = fileOf(some, 'favicon/favicon.ico')?.data as Uint8Array;
    expect(new DataView(ico.buffer, ico.byteOffset).getUint16(4, true)).toBe(2);

    const none = await buildExportBundle(docs, { formats: ['favicon'], rasterize: fakeRasterize([], [16, 32, 48]) });
    expect(paths(none)).not.toContain('favicon/favicon.ico');
    expect(paths(none)).not.toContain('favicon/favicon-16x16.png');
    expect(paths(none)).toContain('favicon/apple-touch-icon.png');
  });

  it('rasterize trả về không phải PNG thì coi là lỗi', async () => {
    const bundle = await buildExportBundle(docs, {
      formats: ['favicon'],
      rasterize: async () => new TextEncoder().encode('<svg />'),
    });
    expect(paths(bundle)).toEqual(['favicon/favicon.svg', 'favicon/head.html']);
    expect(bundle.warnings).toHaveLength(FAVICON_RASTER_SIZES.length);
  });
});

describe('buildExportBundle: chung', () => {
  const docs = [makeDoc('a', 'Nhà kho'), makeDoc('b', 'Hóa đơn')];

  it('kết hợp nhiều định dạng theo thứ tự svg, react, sprite, json, favicon', async () => {
    const bundle = await buildExportBundle(docs, {
      formats: ['favicon', 'json', 'sprite', 'tsx', 'svg'],
      rasterize: fakeRasterize(),
    });
    const all = paths(bundle);
    expect(all.slice(0, 2)).toEqual(['svg/nha-kho.svg', 'svg/hoa-don.svg']);
    expect(all.indexOf('react/index.ts')).toBeLessThan(all.indexOf('sprite.svg'));
    expect(all.indexOf('sprite.svg')).toBeLessThan(all.indexOf('icons.json'));
    expect(all.indexOf('icons.json')).toBeLessThan(all.indexOf('favicon/favicon.svg'));
    expect(new Set(all).size).toBe(all.length);
  });

  it('rootDir đặt trước mọi đường dẫn và bỏ phần nguy hiểm', async () => {
    const bundle = await buildExportBundle(docs, { formats: ['svg', 'json'], rootDir: '../svndts\\icons/' });
    expect(paths(bundle)).toEqual(['svndts/icons/svg/nha-kho.svg', 'svndts/icons/svg/hoa-don.svg', 'svndts/icons/icons.json']);
  });

  it('không có icon hoặc không chọn định dạng thì trả cảnh báo, không có tệp', async () => {
    const none = await buildExportBundle([], { formats: ['svg'] });
    expect(none.files).toEqual([]);
    expect(none.warnings).toHaveLength(1);
    const noFormat = await buildExportBundle(docs, { formats: [] });
    expect(noFormat.files).toEqual([]);
    expect(noFormat.warnings).toHaveLength(1);
  });

  it('cảnh báo icon chưa có hình nào, trừ khi chỉ xuất json', async () => {
    const empty = createDocument({ id: 'e', name: 'Trống' });
    const svg = await buildExportBundle([empty], { formats: ['svg'] });
    expect(svg.warnings).toEqual(['Icon "Trống" chưa có hình nào hiển thị.']);
    const json = await buildExportBundle([empty], { formats: ['json'] });
    expect(json.warnings).toEqual([]);
    const many = await buildExportBundle(
      ['1', '2', '3', '4'].map((id) => createDocument({ id, name: `Trống ${id}` })),
      { formats: ['svg'] },
    );
    expect(many.warnings).toEqual(['4 icon chưa có hình nào hiển thị.']);
  });

  it('cùng đầu vào cho cùng đầu ra', async () => {
    const options = { formats: ['svg', 'tsx', 'sprite', 'json', 'favicon'] as const, rasterize: fakeRasterize() };
    const first = await buildExportBundle(docs, options);
    const second = await buildExportBundle(docs, options);
    expect(second).toEqual(first);
  });

  it('đưa được vào createZip: số tệp khớp, không trùng đường dẫn', async () => {
    const bundle = await buildExportBundle(docs, {
      formats: ['svg', 'tsx', 'sprite', 'json', 'favicon'],
      rasterize: fakeRasterize(),
      rootDir: 'svndts-icons',
    });
    const zip = createZip(bundle.files);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(bundle.files.length);
  });
});

describe('withWhiteBackground', () => {
  it('lồng icon vào giữa nền trắng, có lề', () => {
    const wrapped = withWhiteBackground('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0" /></svg>');
    expect(wrapped.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">')).toBe(true);
    expect(wrapped).toContain('<rect width="180" height="180" fill="#ffffff" />');
    expect(wrapped).toContain('<svg x="18" y="18" width="144" height="144" xmlns=');
  });

  it('chuỗi không phải SVG được trả nguyên', () => {
    expect(withWhiteBackground('không phải svg')).toBe('không phải svg');
  });
});
